// ---------------------------------------------------------------------------
// Hoehe an einer Position aus einem DemGrid abtasten (bilinear).
//
// Reine Grid-Mathematik (kein Rendering) → gehoert in die Pipeline. Wird vom
// Viewer (Vorhang-Boden) und von der Terrain-Anreicherung genutzt.
// ---------------------------------------------------------------------------

import type { DemGrid } from "../../types";

/** Bilineare Hoehe an (lon, lat). null ausserhalb des Grid-Bereichs. */
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
