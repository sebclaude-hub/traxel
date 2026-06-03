// ---------------------------------------------------------------------------
// Dekodierte terrarium-Kacheln zu einem regulaeren lat/lon-Grid zusammensetzen.
//
// terrarium-Kacheln liegen in Web Mercator (EPSG:3857) vor: Spalten sind in
// der Laenge linear, Zeilen aber in der Breite NICHT (Mercator-Verzerrung) und
// nord-oben gespeichert. Das Mesh-/Sampling-Modell (DemGrid) erwartet dagegen
// ein lat-lineares Grid mit Zeile 0 im Sueden.
//
// Loesung: auf ein regulaeres lat/lon-Zielraster resampeln (bilinear). Dabei
// werden Zuschnitt (auf die Track-Bounds) und Downsampling gleich miterledigt.
// Reine Funktion → unit-testbar ohne Netzwerk.
// ---------------------------------------------------------------------------

import type { DemGrid, TrackBounds } from "../../types";
import type { DecodedTile } from "./terrarium";

const DEG2RAD = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fraktionaler globaler Mercator-Y-Pixel fuer eine Breite (nord-oben). */
function latToGlobalPxY(lat: number, z: number, tilePx: number): number {
  const r = lat * DEG2RAD;
  const f = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  return f * 2 ** z * tilePx;
}

/** Fraktionaler globaler X-Pixel fuer eine Laenge (linear). */
function lonToGlobalPxX(lon: number, z: number, tilePx: number): number {
  return ((lon + 180) / 360) * 2 ** z * tilePx;
}

export interface StitchOptions {
  /** Zuschnitt auf diese Bounds (sonst gesamte Kachel-Abdeckung). */
  crop?: TrackBounds;
  /** Harte Obergrenze fuer die Zielraster-Kantenlaenge. Default 600. */
  maxPixelsPerAxis?: number;
}

export function stitchTiles(
  tiles: DecodedTile[],
  opts: StitchOptions = {},
): DemGrid {
  if (tiles.length === 0) {
    throw new Error("stitchTiles: keine Kacheln");
  }
  const { maxPixelsPerAxis = 600 } = opts;
  const z = tiles[0].tile.z;
  const tilePx = tiles[0].width; // 256 in Produktion; klein in Tests

  // Kachel-Index + Mosaik-Ausdehnung (Tile-Indizes).
  const byKey = new Map<string, DecodedTile>();
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const t of tiles) {
    byKey.set(`${t.tile.x}_${t.tile.y}`, t);
    xMin = Math.min(xMin, t.tile.x);
    xMax = Math.max(xMax, t.tile.x);
    yMin = Math.min(yMin, t.tile.y);
    yMax = Math.max(yMax, t.tile.y);
  }

  // Mosaik-Ausdehnung in Grad (Kanten).
  const mosaicWest = (xMin / 2 ** z) * 360 - 180;
  const mosaicEast = ((xMax + 1) / 2 ** z) * 360 - 180;
  const mercTop = Math.atan(Math.sinh(Math.PI * (1 - (2 * yMin) / 2 ** z))) / DEG2RAD;
  const mercBot = Math.atan(Math.sinh(Math.PI * (1 - (2 * (yMax + 1)) / 2 ** z))) / DEG2RAD;

  // Zielbereich = Mosaik ∩ Zuschnitt.
  const c = opts.crop;
  const lonMin = c ? clamp(c.lon_min, mosaicWest, mosaicEast) : mosaicWest;
  const lonMax = c ? clamp(c.lon_max, mosaicWest, mosaicEast) : mosaicEast;
  const latMin = c ? clamp(c.lat_min, mercBot, mercTop) : mercBot;
  const latMax = c ? clamp(c.lat_max, mercBot, mercTop) : mercTop;

  // Native Pixelanzahl im Zielbereich, dann auf maxPixelsPerAxis begrenzen.
  const nativeCols = Math.max(
    2,
    Math.round(lonToGlobalPxX(lonMax, z, tilePx) - lonToGlobalPxX(lonMin, z, tilePx)),
  );
  const nativeRows = Math.max(
    2,
    Math.round(latToGlobalPxY(latMin, z, tilePx) - latToGlobalPxY(latMax, z, tilePx)),
  );
  const step = Math.max(1, Math.ceil(Math.max(nativeCols, nativeRows) / maxPixelsPerAxis));
  const nCols = Math.max(2, Math.floor(nativeCols / step));
  const nRows = Math.max(2, Math.floor(nativeRows / step));

  // Pixelzugriff im Mosaik (global px, nord-oben), an die Raender geklemmt.
  const gxLo = xMin * tilePx;
  const gxHi = (xMax + 1) * tilePx - 1;
  const gyLo = yMin * tilePx;
  const gyHi = (yMax + 1) * tilePx - 1;
  const pixelAt = (gx: number, gy: number): number => {
    const px = clamp(gx, gxLo, gxHi);
    const py = clamp(gy, gyLo, gyHi);
    const tx = Math.floor(px / tilePx);
    const ty = Math.floor(py / tilePx);
    const tile = byKey.get(`${tx}_${ty}`);
    if (!tile) return 0;
    const lx = Math.floor(px) - tx * tilePx;
    const ly = Math.floor(py) - ty * tilePx;
    return tile.elevations[ly * tile.width + lx];
  };
  const sampleMosaic = (lon: number, lat: number): number => {
    const gx = lonToGlobalPxX(lon, z, tilePx) - 0.5;
    const gy = latToGlobalPxY(lat, z, tilePx) - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const v00 = pixelAt(x0, y0);
    const v10 = pixelAt(x0 + 1, y0);
    const v01 = pixelAt(x0, y0 + 1);
    const v11 = pixelAt(x0 + 1, y0 + 1);
    return (
      v00 * (1 - tx) * (1 - ty) +
      v10 * tx * (1 - ty) +
      v01 * (1 - tx) * ty +
      v11 * tx * ty
    );
  };

  // Zielraster fuellen: Zeile 0 = Sueden (lat_min), Spalte 0 = Westen.
  const elevations: number[] = new Array(nRows * nCols);
  for (let r = 0; r < nRows; r++) {
    const lat = latMin + (r / (nRows - 1)) * (latMax - latMin);
    for (let col = 0; col < nCols; col++) {
      const lon = lonMin + (col / (nCols - 1)) * (lonMax - lonMin);
      elevations[r * nCols + col] = sampleMosaic(lon, lat);
    }
  }

  return {
    n_rows: nRows,
    n_cols: nCols,
    lat_min: latMin,
    lat_max: latMax,
    lon_min: lonMin,
    lon_max: lonMax,
    elevations,
  };
}

/** Bequemer Zuschnitt: Track-Bounds mit prozentualem + festem Puffer (wie dem.py). */
export function paddedBounds(
  bounds: TrackBounds,
  { pct = 0.15, deg = 0.005 }: { pct?: number; deg?: number } = {},
): TrackBounds {
  const lonSpan = bounds.lon_max - bounds.lon_min;
  const latSpan = bounds.lat_max - bounds.lat_min;
  const pad = deg + Math.min(pct * lonSpan, pct * latSpan);
  return {
    lon_min: bounds.lon_min - pad,
    lat_min: bounds.lat_min - pad,
    lon_max: bounds.lon_max + pad,
    lat_max: bounds.lat_max + pad,
  };
}
