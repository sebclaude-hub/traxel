// ---------------------------------------------------------------------------
// Terrain-Auto-Download: aus Track-Bounds ein DemGrid bauen.
//
// Ablauf: Bounds puffern → Zoom waehlen → terrarium-Kacheln bestimmen →
// laden+dekodieren → zu einem regulaeren lat/lon-Grid stitchen.
//
// Nutzt fetch/createImageBitmap/OffscreenCanvas → nur im Browser/Worker.
// ---------------------------------------------------------------------------

import type { DemGrid, TrackBounds } from "../../types";
import { paddedBounds, stitchTiles } from "./stitch";
import { fetchTerrariumTile } from "./terrarium";
import { chooseZoom, tilesForBounds } from "./tiles";

export interface BuildTerrainOptions {
  maxTiles?: number;
  targetMetersPerPixel?: number;
  maxPixelsPerAxis?: number;
  signal?: AbortSignal;
}

export async function buildTerrain(
  bounds: TrackBounds,
  opts: BuildTerrainOptions = {},
): Promise<DemGrid> {
  const padded = paddedBounds(bounds);
  const z = chooseZoom(padded, {
    maxTiles: opts.maxTiles ?? 24,
    targetMetersPerPixel: opts.targetMetersPerPixel ?? 30,
  });
  const tiles = tilesForBounds(padded, z);
  const decoded = await Promise.all(
    tiles.map((t) => fetchTerrariumTile(t, opts.signal)),
  );
  return stitchTiles(decoded, {
    crop: padded,
    maxPixelsPerAxis: opts.maxPixelsPerAxis ?? 600,
  });
}
