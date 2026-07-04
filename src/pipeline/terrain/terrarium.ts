// ---------------------------------------------------------------------------
// terrarium-Hoehenkacheln laden und dekodieren.
//
// Quelle: AWS Terrain Tiles (elevation-tiles-prod), CORS-faehig.
// Kodierung: Hoehe[m] = R*256 + G + B/256 − 32768 (pro Pixel).
//
// `decodeTerrarium` ist rein und unit-testbar. `fetchTerrariumTile` nutzt
// Browser-/Worker-APIs (fetch, createImageBitmap, OffscreenCanvas) und ist
// daher nur dort lauffaehig.
// ---------------------------------------------------------------------------

import { fetchSignal } from "./net";
import { readCachedTile, writeCachedTile } from "./tile-cache";
import { type Tile, terrariumTileUrl, tileToBounds, type TileBounds } from "./tiles";

export interface DecodedTile {
  tile: Tile;
  /** Geografische Ausdehnung der Kachel in Grad. */
  bounds: TileBounds;
  width: number;
  height: number;
  /** Hoehen in Metern, zeilenweise von Nord (oben) nach Sued. */
  elevations: Float32Array;
}

/** Dekodiert terrarium-RGBA-Bytes zu Hoehen in Metern. */
export function decodeTerrarium(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

/**
 * Laedt und dekodiert eine einzelne terrarium-Kachel.
 * Nutzt den OPFS-Cache (Treffer → kein Netzwerk). Nur im Browser/Worker
 * lauffaehig (createImageBitmap/OffscreenCanvas).
 *
 * Gibt bei Netzwerkfehler, Timeout, HTTP-Fehler oder Dekodier-Problem `null`
 * zurueck (statt zu werfen), damit eine EINZELNE ausgefallene Kachel nicht den
 * gesamten Terrain-Aufbau kippt — der Stitcher fuellt die Luecke mit 0. Parallel
 * zur Satelliten-Logik (fetchSatTile).
 */
export async function fetchTerrariumTile(
  tile: Tile,
  signal?: AbortSignal,
): Promise<DecodedTile | null> {
  try {
    let bytes = await readCachedTile(tile);
    if (!bytes) {
      const resp = await fetch(terrariumTileUrl(tile), { signal: fetchSignal(signal) });
      if (!resp.ok) return null;
      bytes = await resp.arrayBuffer();
      await writeCachedTile(tile, bytes);
    }
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const { width, height } = bitmap;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const img = ctx.getImageData(0, 0, width, height);
    return {
      tile,
      bounds: tileToBounds(tile.z, tile.x, tile.y),
      width,
      height,
      elevations: decodeTerrarium(img.data, width, height),
    };
  } catch {
    // Netzwerkfehler / Timeout / Dekodier-Fehler → Kachel ausfallen lassen.
    return null;
  }
}
