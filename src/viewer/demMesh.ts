// ---------------------------------------------------------------------------
// DEM-Grid → trianguliertes Mesh (Port aus gps_viewer/src/utils/demMesh.ts).
//
// positions: [lon-offset_m, lat-offset_m, elev, ...] relativ zu `anchor`
// colors:    hypsometrische RGBA pro Vertex
// indices:   2 Dreiecke pro Gitterzelle
//
// NaN/null-Hoehen → 0 (Meeresspiegel), um Loecher zu vermeiden.
// ---------------------------------------------------------------------------

import type { DemGrid } from "../types";

export interface DemMesh {
  positions: Float32Array;
  indices: Uint32Array;
  colors: Uint8Array;
  /** Anker-Position des Mesh in lng/lat (fuer SimpleMeshLayer.getPosition). */
  anchor: [number, number];
}

// Hypsometrische Farbskala (Tiefland-Gruen → Alpen-Weiss).
const HYPSO_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [90, 145, 110]],
  [120, [165, 195, 130]],
  [300, [205, 180, 115]],
  [450, [165, 130, 90]],
  [600, [155, 135, 120]],
  [1100, [240, 240, 245]],
];

function hypsoColor(elev: number): [number, number, number] {
  if (elev <= HYPSO_STOPS[0][0]) {
    return [...HYPSO_STOPS[0][1]] as [number, number, number];
  }
  for (let i = 1; i < HYPSO_STOPS.length; i++) {
    const [e1, c1] = HYPSO_STOPS[i];
    if (elev <= e1) {
      const [e0, c0] = HYPSO_STOPS[i - 1];
      const t = (elev - e0) / (e1 - e0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  const last = HYPSO_STOPS[HYPSO_STOPS.length - 1][1];
  return [...last] as [number, number, number];
}

/**
 * Konvertiert ein DEM-Grid zu einem Mesh in Meter-Offsets vom Bounds-Zentrum.
 * SimpleMeshLayer interpretiert die Positionen als Meter-Offsets vom
 * getPosition-Anker (Equirectangular-Naeherung, gueltig fuer wenige Grad).
 */
export function gridToMesh(grid: DemGrid, altBase = 0, zScale = 1): DemMesh {
  const { n_rows, n_cols, lat_min, lat_max, lon_min, lon_max, elevations } = grid;

  const latCenter = (lat_min + lat_max) / 2;
  const lonCenter = (lon_min + lon_max) / 2;
  const mPerLon = 111320 * Math.cos((latCenter * Math.PI) / 180);
  const mPerLat = 110540;

  const positions = new Float32Array(n_rows * n_cols * 3);
  const colors = new Uint8Array(n_rows * n_cols * 4);
  let p = 0;
  let cI = 0;

  for (let r = 0; r < n_rows; r++) {
    const lat = lat_min + (r / Math.max(n_rows - 1, 1)) * (lat_max - lat_min);
    for (let col = 0; col < n_cols; col++) {
      const lon = lon_min + (col / Math.max(n_cols - 1, 1)) * (lon_max - lon_min);
      const elev = elevations[r * n_cols + col] ?? 0;
      positions[p++] = (lon - lonCenter) * mPerLon;
      positions[p++] = (lat - latCenter) * mPerLat;
      positions[p++] = altBase + (elev - altBase) * zScale;
      const [cr, cg, cb] = hypsoColor(elev);
      colors[cI++] = cr;
      colors[cI++] = cg;
      colors[cI++] = cb;
      colors[cI++] = 220;
    }
  }

  const nCells = (n_rows - 1) * (n_cols - 1);
  const indices = new Uint32Array(nCells * 6);
  let iI = 0;
  for (let r = 0; r < n_rows - 1; r++) {
    for (let col = 0; col < n_cols - 1; col++) {
      const tl = r * n_cols + col;
      const tr = tl + 1;
      const bl = tl + n_cols;
      const br = bl + 1;
      indices[iI++] = tl;
      indices[iI++] = bl;
      indices[iI++] = tr;
      indices[iI++] = tr;
      indices[iI++] = bl;
      indices[iI++] = br;
    }
  }

  return { positions, indices, colors, anchor: [lonCenter, latCenter] };
}

/**
 * Bilineare Hoehe an (lon, lat) im Grid. null ausserhalb des Grid-Bereichs.
 */
export function sampleDem(grid: DemGrid, lon: number, lat: number): number | null {
  const { n_rows, n_cols, lat_min, lat_max, lon_min, lon_max, elevations } = grid;
  if (lon < lon_min || lon > lon_max || lat < lat_min || lat > lat_max) return null;

  const fc = ((lon - lon_min) / (lon_max - lon_min)) * (n_cols - 1);
  const fr = ((lat - lat_min) / (lat_max - lat_min)) * (n_rows - 1);

  const c0 = Math.min(Math.floor(fc), n_cols - 2);
  const r0 = Math.min(Math.floor(fr), n_rows - 2);
  const tc = fc - c0;
  const tr = fr - r0;

  const v00 = elevations[r0 * n_cols + c0] ?? 0;
  const v10 = elevations[r0 * n_cols + c0 + 1] ?? 0;
  const v01 = elevations[(r0 + 1) * n_cols + c0] ?? 0;
  const v11 = elevations[(r0 + 1) * n_cols + c0 + 1] ?? 0;

  return (
    v00 * (1 - tc) * (1 - tr) +
    v10 * tc * (1 - tr) +
    v01 * (1 - tc) * tr +
    v11 * tc * tr
  );
}
