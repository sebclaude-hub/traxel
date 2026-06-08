// Dev-Helfer: erzeugt eine echte share.html mit synthetischer Demo-Payload,
// um den Decode→Render→Steuerung-Pfad im Browser (file://) zu pruefen.
//   npx vite-node scripts/gen-share-demo.ts
import { readFileSync, writeFileSync } from "node:fs";

import { bytesToBase64 } from "../src/pipeline/export/base64";
import { encodePayload } from "../src/pipeline/export/payload";
import type { Derivation } from "../src/pipeline/processing/cuts";
import { sampleDem } from "../src/pipeline/terrain/sample";
import { assembleShareHtml } from "../src/share/assembleShareHtml";
import type { DemGrid, TrackData } from "../src/types";

// Kuenstlicher Ellipsoid-Versatz wie bei SkyDemon-GPX (~+47 m ueber NN-DEM):
// der Track folgt dem Gelaende, sitzt aber 47 m zu hoch. So muss der Auto-Offset
// sichtbar nach unten auf den Boden schnappen (Boden-Fall, nicht Flug).
const ELLIPSOID_M = 47;

function makeDem(): DemGrid {
  const n = 40;
  const elevations: (number | null)[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dr = (r - 20) / 11;
      const dc = (c - 20) / 11;
      elevations.push(450 + 350 * Math.exp(-(dr * dr + dc * dc)) + 20 * Math.sin(c / 3));
    }
  }
  return {
    n_rows: n,
    n_cols: n,
    lat_min: 47.0,
    lat_max: 47.06,
    lon_min: 11.0,
    lon_max: 11.06,
    elevations,
  };
}

function makeTrack(dem: DemGrid): TrackData {
  const n = 160;
  const lat: number[] = [];
  const lon: number[] = [];
  const alt: (number | null)[] = [];
  const speed: (number | null)[] = [];
  const timestamp_ms: number[] = [];
  const distance_m: (number | null)[] = [];
  const speed_q_idx: number[] = [];
  const alt_q_idx: number[] = [];
  let altMin = Infinity;
  let altMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    // S-Kurve ueber den Huegel
    const la = 47.008 + f * 0.044;
    const lo = 11.01 + 0.04 * (0.5 + 0.4 * Math.sin(f * Math.PI * 2));
    lat.push(la);
    lon.push(lo);
    // Track folgt dem Gelaende (wenige Meter drueber) + Ellipsoid-Versatz.
    const terr = sampleDem(dem, lo, la) ?? 500;
    const a = terr + ELLIPSOID_M + 4 + 8 * Math.abs(Math.sin(f * Math.PI * 4));
    alt.push(a);
    altMin = Math.min(altMin, a);
    altMax = Math.max(altMax, a);
    speed.push(35 + 45 * Math.abs(Math.sin(f * Math.PI * 3)));
    timestamp_ms.push(i * 2000);
    distance_m.push(80);
    speed_q_idx.push(Math.min(4, Math.floor((speed[i] as number - 35) / 11)));
    alt_q_idx.push(Math.min(4, Math.floor(f * 5)));
  }
  const altStep = (altMax - altMin) / 5 || 1;
  for (let i = 0; i < n; i++) {
    alt_q_idx[i] = Math.min(4, Math.floor(((alt[i] as number) - altMin) / altStep));
  }
  return {
    meta: {
      name: "Demo-Tour Karwendel",
      source_type: "gpx",
      n_points: n,
      total_distance_m: 80 * n,
      duration_s: (n - 1) * 2,
      timestamp_start_utc: "2026-06-08T08:00:00.000Z",
      timestamp_end_utc: "2026-06-08T08:05:18.000Z",
      bounds: { lon_min: 11.01, lat_min: 47.008, lon_max: 11.05, lat_max: 47.052 },
      track_mode: "ground",
      has_terrain: true,
      has_satellites: false,
    },
    quantile_breaks: {
      speed_kmh: [35, 46, 57, 68, 79, 80],
      altitude_m: [0, 1, 2, 3, 4, 5].map((k) => altMin + (altStep * 5 * k) / 5),
      n_quantiles: 5,
    },
    points: {
      lat,
      lon,
      alt,
      terrain_elev: alt.map(() => null),
      above_terrain: alt.map(() => null),
      speed_kmh: speed,
      distance_m,
      timestamp_ms,
      speed_q_idx,
      alt_q_idx,
    },
  };
}

const derivation: Derivation = {
  type: "bridge",
  severity: "warn",
  n_cuts: 1,
  n_trim_cuts: 0,
  n_gap_cuts: 0,
  n_bridge_cuts: 1,
  n_points_before: 170,
  n_points_after: 160,
  n_points_removed: 10,
  total_time_shift_s: 240,
  message:
    "Pausen wurden überbrückt (Zeitlücke geschlossen). Die Satellitenkonstellation " +
    "ab dem Schnitt entspricht nicht mehr der echten Zeit.",
};

const dem = makeDem();
const track = makeTrack(dem);
const { suggestDemOffset } = await import("../src/pipeline/terrain/enrich-terrain");
console.log(`erwarteter Auto-Offset: ${suggestDemOffset(track, dem).toFixed(1)} m`);
const payload = await encodePayload({ track, dem, derivation });
const b64 = bytesToBase64(payload);
const viewerJs = readFileSync("share-dist/share-viewer.js", "utf8");
const html = assembleShareHtml({ viewerJs, payloadB64: b64, title: track.meta.name });
writeFileSync("share-dist/share.html", html);
console.log(
  `share.html geschrieben: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB ` +
    `(Payload base64 ${(b64.length / 1024).toFixed(0)} KiB)`,
);
