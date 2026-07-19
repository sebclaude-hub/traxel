import { describe, expect, it } from "vitest";

import type { TrackData } from "../../types";
import { geodesicDistanceMeters } from "./geo";
import { enrichKinematics } from "./kinematics";
import { mergeTracks } from "./merge";

/** Baut einen Track aus Punkt-Tupeln (ts in s, lon in Grad, speed km/h, optional hdop). */
function makeTrack(
  pts: { tsS: number; lon: number; speedKmh: number; hdop?: number | null }[],
  name = "t",
): TrackData {
  const n = pts.length;
  return {
    meta: {
      name,
      source_type: "gpx",
      n_points: n,
      total_distance_m: 0,
      duration_s: 0,
      timestamp_start_utc: null,
      timestamp_end_utc: null,
      bounds: { lon_min: 0, lat_min: 0, lon_max: 0, lat_max: 0 },
      track_mode: "ground",
      has_terrain: false,
      has_satellites: false,
    },
    quantile_breaks: { speed_kmh: [], altitude_m: [], n_quantiles: 5 },
    points: {
      lat: pts.map(() => 0),
      lon: pts.map((p) => p.lon),
      alt: pts.map(() => 100),
      terrain_elev: pts.map(() => null),
      above_terrain: pts.map(() => null),
      speed_kmh: pts.map((p) => p.speedKmh),
      distance_m: pts.map(() => 100),
      timestamp_ms: pts.map((p) => p.tsS * 1000),
      hdop: pts.map((p) => p.hdop ?? null),
      ...enrichKinematics({
        alt: pts.map(() => 100),
        speed_kmh: pts.map((p) => p.speedKmh),
        timestamp_ms: pts.map((p) => p.tsS * 1000),
      }),
    },
  };
}

// Erster Track: 0–20 s, endet bei lon 0.002.
function trackA(): TrackData {
  return makeTrack(
    [
      { tsS: 0, lon: 0.0, speedKmh: 40, hdop: 1.1 },
      { tsS: 10, lon: 0.001, speedKmh: 40, hdop: 1.2 },
      { tsS: 20, lon: 0.002, speedKmh: 40, hdop: 1.3 },
    ],
    "a",
  );
}

// Zweiter Track: startet 100 s nach Ende von A, bei lon 0.003.
function trackB(startS = 120): TrackData {
  return makeTrack(
    [
      { tsS: startS, lon: 0.003, speedKmh: 40 },
      { tsS: startS + 10, lon: 0.004, speedKmh: 40 },
    ],
    "b",
  );
}

/** Erwartete Brueckenzeit (ms) ueber die Naht A-Ende → B-Start bei 40 km/h. */
function expectedBridgeMs(): number {
  const d = geodesicDistanceMeters(0, 0.002, 0, 0.003);
  return Math.round((d / (40 / 3.6)) * 1000);
}

describe("mergeTracks", () => {
  it("gap: haengt disjunkte Tracks unveraendert aneinander (Luecke bleibt)", () => {
    const res = mergeTracks(trackA(), trackB(), "gap");
    expect(res.effectiveMode).toBe("gap");
    expect(res.shiftS).toBe(0);
    expect(res.segments).toHaveLength(2);
    expect(res.segments[0].map((p) => p.timestampMs)).toEqual([0, 10000, 20000]);
    expect(res.segments[1].map((p) => p.timestampMs)).toEqual([120000, 130000]);
  });

  it("uebernimmt Geschwindigkeit (km/h + Knoten) und HDOP in die Punkte", () => {
    const res = mergeTracks(trackA(), trackB(), "gap");
    const p = res.segments[0][1];
    expect(p.speedKmh).toBe(40);
    expect(p.speedKnots).toBeCloseTo((40 / 3.6) * 1.94384, 4);
    expect(p.hdop).toBe(1.2);
    expect(res.segments[1][0].hdop).toBeNull();
  });

  it("bridge: zieht den zweiten Track um Pause − Brueckenzeit nach vorne", () => {
    const res = mergeTracks(trackA(), trackB(), "bridge");
    expect(res.effectiveMode).toBe("bridge");
    const newStart = 20000 + expectedBridgeMs();
    expect(res.segments[1][0].timestampMs).toBe(newStart);
    // Alle Punkte des zweiten Tracks gleich verschoben (Abstaende erhalten).
    expect(res.segments[1][1].timestampMs).toBe(newStart + 10000);
    // Verschiebung positiv (nach vorne) und in Sekunden gemeldet.
    expect(res.shiftS).toBeCloseTo((120000 - newStart) / 1000, 1);
    // Erster Track unveraendert.
    expect(res.segments[0].map((p) => p.timestampMs)).toEqual([0, 10000, 20000]);
  });

  it("erzwingt bridge bei ueberlappenden Zeitbereichen (auch wenn gap gewuenscht)", () => {
    const res = mergeTracks(trackA(), trackB(10), "gap");
    expect(res.effectiveMode).toBe("bridge");
    const newStart = 20000 + expectedBridgeMs();
    expect(res.segments[1][0].timestampMs).toBe(newStart);
    // Zweiter Track musste nach HINTEN → negative Verschiebung.
    expect(res.shiftS).toBeLessThan(0);
    // Zeitverlauf ueber die Naht streng monoton.
    const all = res.segments.flat().map((p) => p.timestampMs);
    expect([...all].sort((x, y) => x - y)).toEqual(all);
  });

  it("veraendert die Eingangs-Tracks nicht", () => {
    const a = trackA();
    const b = trackB(10);
    mergeTracks(a, b, "bridge");
    expect(a.points.timestamp_ms).toEqual([0, 10000, 20000]);
    expect(b.points.timestamp_ms).toEqual([10000, 20000]);
  });

  it("laesst leere Tracks als Segment weg", () => {
    const res = mergeTracks(trackA(), makeTrack([]), "gap");
    expect(res.segments).toHaveLength(1);
    expect(res.segments[0]).toHaveLength(3);
  });
});
