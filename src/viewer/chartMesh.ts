// ---------------------------------------------------------------------------
// chartMesh — gedraptes Mesh fuer ein Karten-Overlay (Port aus
// gps_viewer/src/utils/chartMesh.ts).
//
// DAS VERTEX-/TRIANGLE-PROBLEM (warum es zwei Pfade gibt)
// ------------------------------------------------------
// Ein DEM-Quad wird in ZWEI Dreiecke geteilt — entlang einer Diagonale. Baut
// die Karte ihr EIGENES Gitter (frueher "Strategie B", bilineare Ecken), dann
// laufen ihre Diagonalen anders als die des Terrains. Selbst bei identischen
// Hoehen an den Eckpunkten interpolieren die beiden Flaechen INNERHALB eines
// Quads ueber verschiedene Diagonalen → sie kreuzen sich, und das Terrain-
// Dreieck ragt KONSISTENT auf einer Seite jeder Erhebung durch die Karte
// ("immer dieselbe Seite der Gipfel"). Kein Z-Lift behebt das zuverlaessig
// (ein scharfer Grat ragt beliebig weit).
//
// LOESUNG: Liegt ein DEM vor, baut die Karte IMMER (auch gedreht) auf den
// ECHTEN DEM-Vertices auf (buildFromTerrainSubgrid) — identische Positionen
// UND identische Triangulation (gleiche Iterations-/Index-Reihenfolge wie
// demMesh.ts). Damit sind Chart- und Terrain-Flaeche mathematisch gleich,
// Durchstoßen ist konstruktionsbedingt unmoeglich. Die UV werden aus den vier
// Eckkoordinaten abgeleitet (Parallelogramm-Inverse) und funktionieren bei
// beliebiger Rotation/Skalierung. WICHTIG: Die Index-Reihenfolge hier MUSS mit
// demMesh.ts uebereinstimmen (tl,bl,tr / tr,bl,br), sonst sind die Diagonalen
// wieder versetzt.
//
// Bilinearer Pfad (buildFromBilinearCorners) bleibt nur fuer den Fall OHNE DEM
// (flach) oder bei erzwungener Subdivision.
//
// Positionen sind Meter-Offsets vom Bounds-Zentrum (Anker), wie demMesh/curtain.
//
// BOUNDING-BOX-SCHATTEN (geloest via Cell-Culling, Loesung b): Der Subgrid deckt
// die ACHSENPARALLELE Bounding-Box der (gedrehten) Karte ab. Frueher schrieben
// die Zwickel-Dreiecke ausserhalb des gedrehten Rechtecks — trotz transparenter
// Textur — weiter in den Tiefenpuffer und verdeckten dahinterliegende Geometrie
// (schwacher "Schatten" in Bounding-Box-Form). Fix: beim Index-Aufbau werden nur
// Zellen emittiert, deren UV-Bounding-Box das Einheitsquadrat [0,1]² ueberlappt;
// komplett ausserhalb liegende Zellen werden verworfen. Ganze DEM-Zellen bleiben
// erhalten → Triangulation weiterhin identisch zum Terrain (kein Durchstoßen).
// (Die Alternative (a) — Depth-Write fuer den Chart-Layer abschalten — waere
// order-abhaengig sobald mehrere transparente Boden-Overlays uebereinanderliegen,
// daher hier bewusst die geometrische Loesung.)
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
  demOffset = 0,
): ChartMesh | null {
  // Achsenparallele Bounding-Box ueber ALLE vier Ecken (auch fuer gedrehte
  // Karten korrekt). Der Subgrid deckt die Box ab; ausserhalb des gedrehten
  // Rechtecks liegende Vertices bekommen UV ausserhalb [0,1]. Die rein
  // ausserhalb liegenden Zellen werden beim Index-Aufbau per Cell-Culling
  // verworfen (s. Kopfkommentar), die Randzellen bleiben dank Transparenzrand
  // des Bildes (clamp-to-edge) am Saum transparent.
  const lons = [chart.corner_tl[0], chart.corner_tr[0], chart.corner_bl[0], chart.corner_br[0]];
  const lats = [chart.corner_tl[1], chart.corner_tr[1], chart.corner_bl[1], chart.corner_br[1]];
  const lon_min = Math.min(...lons);
  const lon_max = Math.max(...lons);
  const lat_min = Math.min(...lats);
  const lat_max = Math.max(...lats);

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

  // UV aus den Eckkoordinaten (Parallelogramm-Inverse) — funktioniert fuer
  // jede Rotation/Skalierung: u laeuft entlang tl→tr, v entlang tl→bl.
  const cLat = (lats[0] + lats[1] + lats[2] + lats[3]) / 4;
  const cLon = (lons[0] + lons[1] + lons[2] + lons[3]) / 4;
  const mLat = 110540;
  const mLon = 111320 * Math.cos((cLat * Math.PI) / 180);
  const toM = (lon: number, lat: number): [number, number] => [
    (lon - cLon) * mLon,
    (lat - cLat) * mLat,
  ];
  const tlM = toM(chart.corner_tl[0], chart.corner_tl[1]);
  const trM = toM(chart.corner_tr[0], chart.corner_tr[1]);
  const blM = toM(chart.corner_bl[0], chart.corner_bl[1]);
  const ax: [number, number] = [trM[0] - tlM[0], trM[1] - tlM[1]];
  const ay: [number, number] = [blM[0] - tlM[0], blM[1] - tlM[1]];
  const ax2 = ax[0] * ax[0] + ax[1] * ax[1] || 1;
  const ay2 = ay[0] * ay[0] + ay[1] * ay[1] || 1;

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
      positions[pIdx++] = altBase + (elev + demOffset - altBase) * zScale + Z_LIFT_SUBGRID_M;

      const pm = toM(lon, lat);
      const relx = pm[0] - tlM[0];
      const rely = pm[1] - tlM[1];
      texCoords[tIdx++] = (relx * ax[0] + rely * ax[1]) / ax2;
      texCoords[tIdx++] = (relx * ay[0] + rely * ay[1]) / ay2;
    }
  }

  // Cell-Culling gegen das gedrehte Rechteck (= UV-Einheitsquadrat [0,1]²):
  // Nur Zellen emittieren, deren UV-Bounding-Box [0,1]² ueberlappt. Zellen, die
  // KOMPLETT ausserhalb liegen (die grossen Zwickel-Dreiecke der achsenparallelen
  // Bounding-Box bei gedrehten Karten), werden verworfen → kein transparenter
  // Overhang schreibt mehr Tiefe, der Bounding-Box-"Schatten" verschwindet.
  // Es bleiben GANZE DEM-Zellen erhalten (kein Beschneiden einzelner Dreiecke),
  // also identische Vertices + Triangulation wie das Terrain → Durchstoßen bleibt
  // konstruktionsbedingt unmoeglich. Hoechstens eine Randzelle ragt minimal ueber
  // die Karte hinaus, deren Aussenteil aber ohnehin im Transparenzrand der Textur
  // (clamp-to-edge) liegt. Die nicht referenzierten Vertices bleiben im Buffer
  // (harmlos), nur der Index-Buffer wird gefiltert.
  const nCells = (N_rows - 1) * (N_cols - 1);
  const indices = new Uint32Array(nCells * 6);
  const UV_EPS = 1e-4;
  let iIdx = 0;
  for (let r = 0; r < N_rows - 1; r++) {
    for (let c = 0; c < N_cols - 1; c++) {
      const tl = r * N_cols + c;
      const tr = tl + 1;
      const bl = tl + N_cols;
      const br = bl + 1;

      const uMin = Math.min(texCoords[tl * 2], texCoords[tr * 2], texCoords[bl * 2], texCoords[br * 2]);
      const uMax = Math.max(texCoords[tl * 2], texCoords[tr * 2], texCoords[bl * 2], texCoords[br * 2]);
      const vMin = Math.min(texCoords[tl * 2 + 1], texCoords[tr * 2 + 1], texCoords[bl * 2 + 1], texCoords[br * 2 + 1]);
      const vMax = Math.max(texCoords[tl * 2 + 1], texCoords[tr * 2 + 1], texCoords[bl * 2 + 1], texCoords[br * 2 + 1]);
      if (uMax < -UV_EPS || uMin > 1 + UV_EPS || vMax < -UV_EPS || vMin > 1 + UV_EPS) {
        continue; // Zelle liegt komplett ausserhalb der Karte
      }

      indices[iIdx++] = tl;
      indices[iIdx++] = bl;
      indices[iIdx++] = tr;
      indices[iIdx++] = tr;
      indices[iIdx++] = bl;
      indices[iIdx++] = br;
    }
  }
  return { positions, texCoords, indices: indices.slice(0, iIdx), anchor: [lon_center, lat_center] };
}

/**
 * Subdivision des Karten-Gitters. Mit DEM wird die Aufloesung an die
 * DEM-Vertex-Dichte gekoppelt: nur wenn das Karten-Gitter mindestens so fein
 * ist wie das DEM, sitzt an jedem Terrain-Gipfel ein Karten-Vertex und die
 * Karte folgt dem Gelaende, statt scharfe Features "abzuschneiden" (sonst
 * stoesst genau dieses Feature durch). Ohne DEM: ~50 m/Vertex.
 */
function computeSubdivision(chart: ChartOverlay, demGrid: DemGrid | null): number {
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

  let stepM = TARGET_METERS_PER_VERTEX;
  if (demGrid) {
    const demStepLatM = ((demGrid.lat_max - demGrid.lat_min) / Math.max(demGrid.n_rows - 1, 1)) * mpLat;
    const demStepLonM = ((demGrid.lon_max - demGrid.lon_min) / Math.max(demGrid.n_cols - 1, 1)) * mpLon;
    const demStep = Math.min(demStepLatM, demStepLonM);
    if (demStep > 0) stepM = demStep;
  }
  const raw = Math.ceil(maxM / stepM) + 1;
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
  demOffset = 0,
): ChartMesh {
  const requested = subdivision ?? chart.subdivision ?? computeSubdivision(chart, demGrid);
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
      positions[pIdx++] = altBase + (elev + demOffset - altBase + Z_LIFT_BILINEAR_RAW_M) * zScale;
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
  demOffset = 0,
): ChartMesh {
  // Mit DEM IMMER (auch gedreht) den Terrain-Subgrid nutzen: identische
  // Vertices und Triangulation wie das Terrain → kein Durchstoßen moeglich.
  // Bilinear nur ohne DEM oder bei erzwungener Subdivision.
  if (demGrid && subdivision == null && chart.subdivision == null) {
    const meshA = buildFromTerrainSubgrid(chart, demGrid, altBase, zScale, demOffset);
    if (meshA) return meshA;
  }
  return buildFromBilinearCorners(chart, demGrid, altBase, zScale, subdivision, demOffset);
}
