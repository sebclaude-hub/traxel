// ---------------------------------------------------------------------------
// Kachel-Mathematik fuer das XYZ-/Slippy-Map-Schema (Web Mercator, EPSG:3857).
//
// Wird fuer den Terrain-Auto-Download genutzt: aus einer Bounding-Box die
// abzudeckenden terrarium-Kacheln (elevation-tiles-prod) bestimmen.
//
// Hinweis zur Quelle: Copernicus GLO-30 (copernicus-dem-30m) hat kein CORS und
// ist im Browser nicht ladbar. Stattdessen AWS Terrain Tiles
// (elevation-tiles-prod), die CORS erlauben.
// ---------------------------------------------------------------------------

import type { TrackBounds } from "../../types";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Mercator-Breitengrenze; jenseits davon ist die Projektion undefiniert. */
const MERCATOR_MAX_LAT = 85.05112878;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Geografische Ausdehnung einer Kachel in Grad. */
export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

function clampLat(lat: number): number {
  return Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
}

/** Laengengrad → fraktionaler Kachel-X-Index bei Zoom z. */
function lonToTileXf(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

/** Breitengrad → fraktionaler Kachel-Y-Index bei Zoom z. */
function latToTileYf(lat: number, z: number): number {
  const r = clampLat(lat) * DEG2RAD;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(lonToTileXf(lon, z));
}

export function latToTileY(lat: number, z: number): number {
  return Math.floor(latToTileYf(lat, z));
}

/** West-/Nord-Kante (und damit Ausdehnung) einer Kachel in Grad. */
export function tileToBounds(z: number, x: number, y: number): TileBounds {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * RAD2DEG;
  const south = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * RAD2DEG;
  return { west, south, east, north };
}

/** Bodenaufloesung (Meter pro Pixel) bei Zoom z und Breite lat, 256-px-Kacheln. */
export function metersPerPixel(lat: number, z: number): number {
  return (156543.03392 * Math.cos(clampLat(lat) * DEG2RAD)) / 2 ** z;
}

export interface ZoomOptions {
  /** Angestrebte Bodenaufloesung in m/px (Default ~30, wie GLO-30). */
  targetMetersPerPixel?: number;
  /** Obergrenze fuer die Kachelanzahl (schuetzt vor zu vielen Downloads). */
  maxTiles?: number;
  minZoom?: number;
  maxZoom?: number;
}

/** Anzahl Kacheln, die die Box bei Zoom z abdeckt. */
export function tileCount(bounds: TrackBounds, z: number): number {
  const xMin = lonToTileX(bounds.lon_min, z);
  const xMax = lonToTileX(bounds.lon_max, z);
  const yMin = latToTileY(bounds.lat_max, z); // Norden = kleineres y
  const yMax = latToTileY(bounds.lat_min, z);
  return (xMax - xMin + 1) * (yMax - yMin + 1);
}

/**
 * Waehlt einen Zoom: nahe der Ziel-Aufloesung, aber so reduziert, dass die
 * Kachelanzahl unter `maxTiles` bleibt. Geklemmt auf [minZoom, maxZoom].
 */
export function chooseZoom(bounds: TrackBounds, opts: ZoomOptions = {}): number {
  const {
    targetMetersPerPixel = 30,
    maxTiles = 24,
    minZoom = 6,
    maxZoom = 14,
  } = opts;

  const latMid = (bounds.lat_min + bounds.lat_max) / 2;
  const ideal =
    Math.log2((156543.03392 * Math.cos(clampLat(latMid) * DEG2RAD)) / targetMetersPerPixel);
  let z = Math.max(minZoom, Math.min(maxZoom, Math.round(ideal)));

  while (z > minZoom && tileCount(bounds, z) > maxTiles) z--;
  return z;
}

/** Alle Kacheln bei Zoom z, die die Bounding-Box abdecken. */
export function tilesForBounds(bounds: TrackBounds, z: number): Tile[] {
  const xMin = lonToTileX(bounds.lon_min, z);
  const xMax = lonToTileX(bounds.lon_max, z);
  const yMin = latToTileY(bounds.lat_max, z); // Norden = kleineres y
  const yMax = latToTileY(bounds.lat_min, z);

  const tiles: Tile[] = [];
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

/** URL einer terrarium-Hoehenkachel auf elevation-tiles-prod. */
export function terrariumTileUrl(t: Tile): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`;
}
