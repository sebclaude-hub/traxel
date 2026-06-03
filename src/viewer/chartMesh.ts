// ---------------------------------------------------------------------------
// chartMesh — gedraptes Mesh fuer ein Karten-Overlay (Port aus
// gps_viewer/src/utils/chartMesh.ts).
//
// Strategie A: bei DEM + achsenparalleler Karte exakt die DEM-Vertices in den
// Bounds wiederverwenden (kein Z-Konflikt mit dem Terrain).
// Strategie B (Fallback): bilineare Eck-Interpolation mit adaptiver
// Subdivision, DEM pro Vertex gesampelt, kleiner Z-Lift.
//
// Positionen sind Meter-Offsets vom Bounds-Zentrum (Anker), wie demMesh/curtain.
// ---------------------------------------------------------------------------

import { sampleDem } from "../pipeline/terrain/sample";
import type { DemGrid } from "../types";

export interface ChartOverlay {
  name: string;
  corner_tl: [number, number];
  corner_tr: [number, number];
  corner_bl: [number, number];
  corner_br: [number, number];
  elevation_m: number;
  subdivision?: number | null;
}

export interface ChartMesh {
  positions: Float32Array;
  texCoords: Float32Array;
  indices: Uint32Array;
  anchor: [number, number];
}

const TARGET_METERS_PER_VERTEX = 50;
const SUBDIV_CAP = 256;
const SUBDIV_FLOOR = 8;
const Z_LIFT_SUBGRID_M = 0.0;
// Strategie B liftet in ECHTEN Metern (vor der Z-Ueberhoehung), damit der Lift
// automatisch mit zScale waechst und das Terrain nicht zwischen den (anders
// triangulierten) Vertices durchstoesst. 8 m sind auf grossen Karten unsichtbar.
const Z_LIFT_BILINEAR_RAW_M = 8.0;
const AXIS_ALIGN_EPS_DEG = 1e-6;

function isAxisAligned(chart: ChartOverlay): boolean {
  return (
    Math.abs(chart.corner_tl[1] - chart.corner_tr[1]) < AXIS_ALIGN_EPS_DEG &&
    Math.abs(chart.corner_bl[1] - chart.corner_br[1]) < AXIS_ALIGN_EPS_DEG &&
    Math.abs(chart.corner_tl[0] - chart.corner_bl[0]) < AXIS_ALIGN_EPS_DEG &&
    Math.abs(chart.corner_tr[0] - chart.corner_br[0]) < AXIS_ALIGN_EPS_DEG
  );
}

function metersPerDegree(latCenterDeg: number): { mpLon: number; mpLat: number } {
  return {
    mpLon: 111320 * Math.cos((latCenterDeg * Math.PI) / 180),
    mpLat: 110540,
  };
}

function buildFromTerrainSubgrid(
  chart: ChartOverlay,
  demGrid: DemGrid,
  altBase: number,
  zScale: number,
): ChartMesh | null {
  const lon_min = Math.min(chart.corner_tl[0], chart.corner_bl[0]);
  const lon_max = Math.max(chart.corner_tr[0], chart.corner_br[0]);
  const lat_min = Math.min(chart.corner_bl[1], chart.corner_br[1]);
  const lat_max = Math.max(chart.corner_tl[1], chart.corner_tr[1]);

  const dem_dlat = (demGrid.lat_max - demGrid.lat_min) / Math.max(demGrid.n_rows - 1, 1);
  const dem_dlon = (demGrid.lon_max - demGrid.lon_min) / Math.max(demGrid.n_cols - 1, 1);
  if (dem_dlat <= 0 || dem_dlon <= 0) return null;

  let r_min = Math.ceil((lat_min - demGrid.lat_min) / dem_dlat);
  let r_max = Math.floor((lat_max - demGrid.lat_min) / dem_dlat);
  let c_min = Math.ceil((lon_min - demGrid.lon_min) / dem_dlon);
  let c_max = Math.floor((lon_max - demGrid.lon_min) / dem_dlon);
  r_min = Math.max(0, r_min);
  r_max = Math.min(demGrid.n_rows - 1, r_max);
  c_min = Math.max(0, c_min);
  c_max = Math.min(demGrid.n_cols - 1, c_max);

  const N_rows = r_max - r_min + 1;
  const N_cols = c_max - c_min + 1;
  if (N_rows < 2 || N_cols < 2) return null;

  const lon_center = (demGrid.lon_min + demGrid.lon_max) / 2;
  const lat_center = (demGrid.lat_min + demGrid.lat_max) / 2;
  const { mpLon, mpLat } = metersPerDegree(lat_center);

  const positions = new Float32Array(N_rows * N_cols * 3);
  const texCoords = new Float32Array(N_rows * N_cols * 2);
  let pIdx = 0;
  let tIdx = 0;
  for (let rr = 0; rr < N_rows; rr++) {
    const r = r_min + rr;
    const lat = demGrid.lat_min + r * dem_dlat;
    for (let cc = 0; cc < N_cols; cc++) {
      const c = c_min + cc;
      const lon = demGrid.lon_min + c * dem_dlon;
      const elev = demGrid.elevations[r * demGrid.n_cols + c] ?? 0;
      positions[pIdx++] = (lon - lon_center) * mpLon;
      positions[pIdx++] = (lat - lat_center) * mpLat;
      positions[pIdx++] = altBase + (elev - altBase) * zScale + Z_LIFT_SUBGRID_M;
      texCoords[tIdx++] = (lon - lon_min) / (lon_max - lon_min);
      texCoords[tIdx++] = (lat_max - lat) / (lat_max - lat_min);
    }
  }

  const nCells = (N_rows - 1) * (N_cols - 1);
  const indices = new Uint32Array(nCells * 6);
  let iIdx = 0;
  for (let r = 0; r < N_rows - 1; r++) {
    for (let c = 0; c < N_cols - 1; c++) {
      const tl = r * N_cols + c;
      const tr = tl + 1;
      const bl = tl + N_cols;
      const br = bl + 1;
      indices[iIdx++] = tl;
      indices[iIdx++] = bl;
      indices[iIdx++] = tr;
      indices[iIdx++] = tr;
      indices[iIdx++] = bl;
      indices[iIdx++] = br;
    }
  }
  return { positions, texCoords, indices, anchor: [lon_center, lat_center] };
}

function computeAdaptiveSubdivision(chart: ChartOverlay): number {
  const lonSpan = Math.max(
    Math.abs(chart.corner_tr[0] - chart.corner_tl[0]),
    Math.abs(chart.corner_br[0] - chart.corner_bl[0]),
  );
  const latSpan = Math.max(
    Math.abs(chart.corner_tl[1] - chart.corner_bl[1]),
    Math.abs(chart.corner_tr[1] - chart.corner_br[1]),
  );
  const latCenter =
    (chart.corner_tl[1] + chart.corner_tr[1] + chart.corner_bl[1] + chart.corner_br[1]) / 4;
  const { mpLon, mpLat } = metersPerDegree(latCenter);
  const maxM = Math.max(lonSpan * mpLon, latSpan * mpLat);
  const raw = Math.ceil(maxM / TARGET_METERS_PER_VERTEX);
  return Math.max(SUBDIV_FLOOR, Math.min(SUBDIV_CAP, raw));
}

function lerpCorners(chart: ChartOverlay, u: number, v: number): [number, number] {
  const [tlx, tly] = chart.corner_tl;
  const [trx, try_] = chart.corner_tr;
  const [blx, bly] = chart.corner_bl;
  const [brx, bry] = chart.corner_br;
  const topX = tlx + (trx - tlx) * u;
  const topY = tly + (try_ - tly) * u;
  const botX = blx + (brx - blx) * u;
  const botY = bly + (bry - bly) * u;
  return [topX + (botX - topX) * v, topY + (botY - topY) * v];
}

function buildFromBilinearCorners(
  chart: ChartOverlay,
  demGrid: DemGrid | null,
  altBase: number,
  zScale: number,
  subdivision?: number | null,
): ChartMesh {
  const requested = subdivision ?? chart.subdivision ?? computeAdaptiveSubdivision(chart);
  const N = Math.max(2, requested);

  const lon_center =
    (chart.corner_tl[0] + chart.corner_tr[0] + chart.corner_bl[0] + chart.corner_br[0]) / 4;
  const lat_center =
    (chart.corner_tl[1] + chart.corner_tr[1] + chart.corner_bl[1] + chart.corner_br[1]) / 4;
  const { mpLon, mpLat } = metersPerDegree(lat_center);

  const positions = new Float32Array(N * N * 3);
  const texCoords = new Float32Array(N * N * 2);
  let pIdx = 0;
  let tIdx = 0;
  for (let r = 0; r < N; r++) {
    const v = r / (N - 1);
    for (let c = 0; c < N; c++) {
      const u = c / (N - 1);
      const [lon, lat] = lerpCorners(chart, u, v);
      let elev = chart.elevation_m;
      if (demGrid) {
        const sampled = sampleDem(demGrid, lon, lat);
        if (sampled !== null) elev = sampled;
      }
      positions[pIdx++] = (lon - lon_center) * mpLon;
      positions[pIdx++] = (lat - lat_center) * mpLat;
      positions[pIdx++] = altBase + (elev - altBase + Z_LIFT_BILINEAR_RAW_M) * zScale;
      texCoords[tIdx++] = u;
      texCoords[tIdx++] = v;
    }
  }

  const nCells = (N - 1) * (N - 1);
  const indices = new Uint32Array(nCells * 6);
  let iIdx = 0;
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const tl = r * N + c;
      const tr = tl + 1;
      const bl = tl + N;
      const br = bl + 1;
      indices[iIdx++] = tl;
      indices[iIdx++] = bl;
      indices[iIdx++] = tr;
      indices[iIdx++] = tr;
      indices[iIdx++] = bl;
      indices[iIdx++] = br;
    }
  }
  return { positions, texCoords, indices, anchor: [lon_center, lat_center] };
}

export function buildChartMesh(
  chart: ChartOverlay,
  demGrid: DemGrid | null,
  altBase = 0,
  zScale = 1,
  subdivision?: number | null,
): ChartMesh {
  if (demGrid && isAxisAligned(chart) && subdivision == null && chart.subdivision == null) {
    const meshA = buildFromTerrainSubgrid(chart, demGrid, altBase, zScale);
    if (meshA) return meshA;
  }
  return buildFromBilinearCorners(chart, demGrid, altBase, zScale, subdivision);
}
