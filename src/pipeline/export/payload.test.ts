import { describe, expect, it } from "vitest";

import type { DemGrid, SatelliteData, TrackData } from "../../types";
import type { Derivation } from "../processing/cuts";
import { enrichKinematics } from "../processing/kinematics";
import { stripKinematics } from "../processing/track-model";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { gunzip } from "./gzip";
import { decodePayload, encodePayload } from "./payload";

function makeTrack(n = 5): TrackData {
  return {
    meta: {
      name: "demo",
      source_type: "nmea",
      n_points: n,
      total_distance_m: 1234.5,
      duration_s: 60,
      timestamp_start_utc: "2026-06-08T10:00:00.000Z",
      timestamp_end_utc: "2026-06-08T10:01:00.000Z",
      bounds: { lon_min: 7, lat_min: 47, lon_max: 7.1, lat_max: 47.1 },
      track_mode: "ground",
      has_terrain: true,
      has_satellites: true,
    },
    quantile_breaks: { speed_kmh: [0, 40], altitude_m: [100, 200], n_quantiles: 5 },
    points: {
      lat: Array.from({ length: n }, (_, i) => 47 + i * 0.01),
      lon: Array.from({ length: n }, (_, i) => 7 + i * 0.01),
      alt: Array.from({ length: n }, (_, i) => 100 + i),
      terrain_elev: Array.from({ length: n }, () => 90),
      above_terrain: Array.from({ length: n }, (_, i) => 10 + i),
      speed_kmh: Array.from({ length: n }, () => 40),
      distance_m: Array.from({ length: n }, () => 100),
      timestamp_ms: Array.from({ length: n }, (_, i) => i * 1000),
      speed_q_idx: Array.from({ length: n }, () => 0),
      alt_q_idx: Array.from({ length: n }, () => 0),
      is_bridged: Array.from({ length: n }, () => false),
      ...enrichKinematics({
        alt: Array.from({ length: n }, (_, i) => 100 + i),
        speed_kmh: Array.from({ length: n }, () => 40),
        timestamp_ms: Array.from({ length: n }, (_, i) => i * 1000),
      }),
    },
  };
}

/** Glattes, terrain-aehnliches DEM (gut komprimierbar wie echtes Gelaende). */
function makeDem(rows: number, cols: number, withNulls = false): DemGrid {
  const elevations = new Array<number | null>(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (withNulls && (r + c) % 37 === 0) {
        elevations[idx] = null; // vereinzelte Loecher (z.B. Wasser/Rand)
        continue;
      }
      elevations[idx] =
        800 +
        400 * Math.sin(r / 30) * Math.cos(c / 40) +
        50 * Math.sin((r + c) / 12);
    }
  }
  return {
    n_rows: rows,
    n_cols: cols,
    lat_min: 47,
    lat_max: 47.5,
    lon_min: 7,
    lon_max: 7.5,
    elevations,
  };
}

describe("encodePayload / decodePayload", () => {
  it("Roundtrip ohne DEM (track + derivation + satellites)", async () => {
    const track = makeTrack();
    const derivation: Derivation = {
      type: "bridge",
      severity: "warn",
      n_cuts: 1,
      n_trim_cuts: 0,
      n_gap_cuts: 0,
      n_bridge_cuts: 1,
      n_points_before: 5,
      n_points_after: 4,
      n_points_removed: 1,
      total_time_shift_s: 20,
      message: "Pausen wurden überbrückt …",
    };
    const satellites: SatelliteData = {
      talkers: ["GP"],
      bursts_by_talker: { GP: [{ ts_ms: 0, sats: [[1, 45, 90, 38]] }] },
      burst_idx_by_track: { GP: [0, 0, 0, 0, 0] },
    };

    const packed = await encodePayload({ track, satellites, derivation });
    const out = await decodePayload(packed);

    expect(out.version).toBe(2);
    expect(out.dem).toBeNull();
    // Abgeleitete Kinematik wird beim Export gestrippt (reproduzierbar, der
    // Share-Viewer rechnet sie per ensureKinematics nach) — der Rest reist 1:1.
    expect(out.track).toEqual({ ...track, points: stripKinematics(track.points) });
    expect(out.derivation).toEqual(derivation);
    // Transparenz-Hinweis und Satellitendaten reisen mit — kein Stripping.
    expect(out.satellites).toEqual(satellites);
  });

  it("DEM-Roundtrip rundet auf ganze Meter (Fehler ≤ 0,5 m)", async () => {
    const track = makeTrack();
    const dem = makeDem(20, 25);
    const packed = await encodePayload({ track, dem });
    const out = await decodePayload(packed);

    expect(out.dem).not.toBeNull();
    expect(out.dem!.n_rows).toBe(20);
    expect(out.dem!.n_cols).toBe(25);
    expect(out.dem!.lat_min).toBe(dem.lat_min);
    let maxErr = 0;
    for (let i = 0; i < dem.elevations.length; i++) {
      const orig = dem.elevations[i] as number;
      const got = out.dem!.elevations[i] as number;
      maxErr = Math.max(maxErr, Math.abs(orig - got));
    }
    expect(maxErr).toBeLessThanOrEqual(0.5);
  });

  it("null-Hoehen ueberleben den Roundtrip (Sentinel)", async () => {
    const dem = makeDem(15, 15, true);
    const nullCount = dem.elevations.filter((e) => e === null).length;
    expect(nullCount).toBeGreaterThan(0);

    const out = await decodePayload(await encodePayload({ track: makeTrack(), dem }));
    let maxErr = 0;
    for (let i = 0; i < dem.elevations.length; i++) {
      if (dem.elevations[i] === null) {
        expect(out.dem!.elevations[i]).toBeNull();
      } else {
        // Werte nach einem Loch muessen ueber die Delta-Carry-Logik exakt bleiben.
        expect(out.dem!.elevations[i]).not.toBeNull();
        const orig = dem.elevations[i] as number;
        const got = out.dem!.elevations[i] as number;
        maxErr = Math.max(maxErr, Math.abs(orig - got));
      }
    }
    expect(maxErr).toBeLessThanOrEqual(0.5);
  });

  it("klemmt extreme Hoehen auf -32767, kollidiert nie mit dem null-Sentinel", async () => {
    // Ein sehr tiefer echter Wert darf nicht zu null werden.
    const dem: DemGrid = {
      n_rows: 1,
      n_cols: 3,
      lat_min: 0,
      lat_max: 1,
      lon_min: 0,
      lon_max: 1,
      elevations: [-99999, 50000, 0],
    };
    const out = await decodePayload(await encodePayload({ track: makeTrack(), dem }));
    expect(out.dem!.elevations[0]).toBe(-32767); // geklemmt, NICHT null
    expect(out.dem!.elevations[0]).not.toBeNull();
    expect(out.dem!.elevations[1]).toBe(32767);
    expect(out.dem!.elevations[2]).toBe(0);
  });

  it("lehnt fremde Daten ab (Magic fehlt)", async () => {
    const garbage = await (async () => {
      const { gzip } = await import("./gzip");
      return gzip(new TextEncoder().encode("kein traxel paket"));
    })();
    await expect(decodePayload(garbage)).rejects.toThrow(/Kennung/);
  });

  it("lehnt eine neuere Format-Version laut ab", async () => {
    // Echtes Paket bauen und das Versions-Feld (Byte 4/5 im Container) auf 99 setzen.
    const packed = await encodePayload({ track: makeTrack() });
    const container = await gunzip(packed);
    const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
    view.setUint16(4, 99, true);
    const { gzip } = await import("./gzip");
    const reSealed = await gzip(container);
    await expect(decodePayload(reSealed)).rejects.toThrow(/neueren Traxel-Version/);
  });

  it("base64 ist round-trip-stabil", async () => {
    const packed = await encodePayload({ track: makeTrack(), dem: makeDem(10, 10) });
    const b64 = bytesToBase64(packed);
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(packed));
    const out = await decodePayload(back);
    expect(out.track.meta.name).toBe("demo");
  });

  it("Chart-Roundtrip mit DEM (afterDemPos-Offset)", async () => {
    const track = makeTrack();
    const dem = makeDem(20, 25);
    const placement = {
      centerLon: 7.05,
      centerLat: 47.05,
      widthM: 500,
      heightM: 400,
      rotationDeg: 15,
    };
    // Minimale synthetische PNG-Bytes (kein gueltiges PNG — nur Byte-Identitaet zählt).
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0xff]);
    const chartItem = { name: "Platzrunde", placement, elevationM: 450.5, pngBytes };

    const packed = await encodePayload({ track, dem, charts: [chartItem] });
    const out = await decodePayload(packed);

    expect(out.charts).toHaveLength(1);
    expect(out.charts[0].name).toBe("Platzrunde");
    expect(out.charts[0].elevationM).toBe(450.5);
    expect(out.charts[0].placement).toEqual(placement);
    expect(Array.from(out.charts[0].pngBytes)).toEqual(Array.from(pngBytes));
    // DEM muss trotzdem korrekt sein (Offset-Arithmetik).
    expect(out.dem).not.toBeNull();
    expect(out.dem!.n_rows).toBe(20);
    expect(out.dem!.n_cols).toBe(25);
  });

  it("leere Charts-Array wenn keine Karten übergeben", async () => {
    const out = await decodePayload(await encodePayload({ track: makeTrack() }));
    expect(out.charts).toEqual([]);
  });

  // Sanity-Check der "teilbar"-Annahme: wie gross wird der HTML-Blob wirklich?
  it.each([
    ["standard ~600×600", 600, 600],
    ["max ~2000×2000", 2000, 2000],
  ])("Größenmessung %s", async (_label, rows, cols) => {
    const dem = makeDem(rows, cols);
    const rawFloatBytes = rows * cols * 8; // float64 als Referenz
    const packed = await encodePayload({ track: makeTrack(2000), dem });
    const b64Len = bytesToBase64(packed).length;
    const kib = (n: number) => (n / 1024).toFixed(0);
    // eslint-disable-next-line no-console
    console.log(
      `[Export-Größe] ${_label}: roh(float64) ${kib(rawFloatBytes)} KiB → ` +
        `delta+gzip ${kib(packed.length)} KiB → base64(HTML) ${kib(b64Len)} KiB`,
    );
    // gzip+int16 muss klar unter der float64-Rohgroesse liegen.
    expect(packed.length).toBeLessThan(rawFloatBytes);
  });
});
