// ---------------------------------------------------------------------------
// Satellitenbilder: Esri World Imagery Kacheln laden und zu einem
// ImageBitmap zusammensetzen, das den Track-Bereich abdeckt.
//
// Quelle: Esri World Imagery (server.arcgisonline.com) — CORS-freigegeben,
// keine Authentifizierung noetig. URL-Schema: {z}/{y}/{x} (Esri-Reihenfolge,
// y = Kachel-Row, x = Kachel-Column).
//
// OPFS-Cache: rohe JPEG/PNG-Bytes werden unter "traxel-sat-tiles" gespeichert,
// damit dieselbe Region beim naechsten Laden aus dem Cache kommt.
//
// Das Ergebnis SatelliteImage enthaelt das fertige Bitmap und die geographische
// Ausdehnung des Tile-Mosaiks (Grundlage fuer die UV-Berechnung im Viewer).
// ---------------------------------------------------------------------------

import type { TrackBounds } from "../../types";
import { paddedBounds } from "./stitch";
import { chooseZoom, tilesForBounds, tileToBounds, type Tile } from "./tiles";

/** Geographische Ausdehnung des Kachel-Mosaiks (Grundlage fuer UV-Mapping). */
export interface SatBounds {
  lon_min: number;
  lat_min: number;
  lon_max: number;
  lat_max: number;
}

export interface SatelliteImage {
  image: ImageBitmap;
  bounds: SatBounds;
}

const SAT_CACHE_DIR = "traxel-sat-tiles";
const TILE_PX = 256;
const ESRI_URL = (t: Tile) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`;

// ---------------------------------------------------------------------------
// OPFS-Cache fuer Satelliten-Kacheln
// ---------------------------------------------------------------------------

async function getSatCacheDir(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined") return null;
  const storage = navigator.storage as
    | (StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> })
    | undefined;
  if (!storage?.getDirectory) return null;
  try {
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle(SAT_CACHE_DIR, { create: true });
  } catch {
    return null;
  }
}

function satFileName(t: Tile): string {
  return `sat_${t.z}_${t.x}_${t.y}.bin`;
}

async function readSatCache(t: Tile): Promise<ArrayBuffer | null> {
  const dir = await getSatCacheDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(satFileName(t));
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

async function writeSatCache(t: Tile, bytes: ArrayBuffer): Promise<void> {
  const dir = await getSatCacheDir();
  if (!dir) return;
  try {
    const fh = await dir.getFileHandle(satFileName(t), { create: true });
    const writable = await fh.createWritable();
    await writable.write(bytes);
    await writable.close();
  } catch {
    // Cache-Schreibfehler sind unkritisch.
  }
}

// ---------------------------------------------------------------------------
// Kachel-Fetch mit Cache
// ---------------------------------------------------------------------------

/** Laedt eine Satellitenkachel (aus Cache oder Netz) als ImageBitmap.
 *  Gibt null zurueck wenn die Kachel nicht geladen werden konnte. */
async function fetchSatTile(
  t: Tile,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  const cached = await readSatCache(t);
  if (cached) {
    try {
      return await createImageBitmap(new Blob([cached]));
    } catch {
      // Defekter Cache-Eintrag → Netz-Fallback.
    }
  }
  try {
    const res = await fetch(ESRI_URL(t), { signal });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    void writeSatCache(t, bytes);
    return await createImageBitmap(new Blob([bytes]));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Oeffentliche API
// ---------------------------------------------------------------------------

export interface BuildSatelliteOptions {
  maxTiles?: number;
  signal?: AbortSignal;
}

/**
 * Laedt Esri-Satellitenkacheln fuer den Track-Bereich und setzt sie zu einem
 * ImageBitmap zusammen. Das Bitmap ist im Kachel-Mosaik-Koordinatensystem
 * (nord-oben, Standard-Bildkonvention) und deckt `bounds` mit Puffer ab.
 *
 * UV-Mapping: u = (lon − bounds.lon_min) / (bounds.lon_max − bounds.lon_min),
 * v = 1 − (lat − bounds.lat_min) / (bounds.lat_max − bounds.lat_min).
 */
export async function buildSatelliteImage(
  bounds: TrackBounds,
  opts: BuildSatelliteOptions = {},
): Promise<SatelliteImage> {
  const padded = paddedBounds(bounds);
  const z = chooseZoom(padded, {
    maxTiles: opts.maxTiles ?? 16,
    targetMetersPerPixel: 30,
  });
  const tiles = tilesForBounds(padded, z);
  if (tiles.length === 0) throw new Error("buildSatelliteImage: keine Kacheln");

  // Mosaik-Ausdehnung in Kachel-Indizes ermitteln.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const t of tiles) {
    if (t.x < xMin) xMin = t.x;
    if (t.x > xMax) xMax = t.x;
    if (t.y < yMin) yMin = t.y;
    if (t.y > yMax) yMax = t.y;
  }

  const mosaicW = (xMax - xMin + 1) * TILE_PX;
  const mosaicH = (yMax - yMin + 1) * TILE_PX;

  const canvas = new OffscreenCanvas(mosaicW, mosaicH);
  const ctx = canvas.getContext("2d")!;

  // Alle Kacheln parallel laden und ins Mosaik zeichnen.
  const bitmaps = await Promise.all(tiles.map((t) => fetchSatTile(t, opts.signal)));
  for (let i = 0; i < tiles.length; i++) {
    const bmp = bitmaps[i];
    if (!bmp) continue;
    const px = (tiles[i].x - xMin) * TILE_PX;
    const py = (tiles[i].y - yMin) * TILE_PX;
    ctx.drawImage(bmp, px, py);
    bmp.close();
  }

  const image = await createImageBitmap(canvas);

  // Geographische Ausdehnung des Mosaiks (Kachel-Raender in Grad).
  // yMin = noerdlichste Kachel-Reihe (kleinster Y-Index = Norden).
  const nwTile = tileToBounds(z, xMin, yMin);
  const seTile = tileToBounds(z, xMax, yMax);
  const satBounds: SatBounds = {
    lon_min: nwTile.west,
    lat_min: seTile.south,
    lon_max: seTile.east,
    lat_max: nwTile.north,
  };

  return { image, bounds: satBounds };
}
