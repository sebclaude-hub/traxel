// ---------------------------------------------------------------------------
// OPFS-Cache fuer terrarium-Kacheln.
//
// Geladene Kacheln werden im Origin Private File System abgelegt, damit beim
// erneuten Oeffnen desselben (oder eines ueberlappenden) Gebiets kein erneuter
// Download noetig ist — passt zur Vision "Daten/Caching lokal".
//
// Gecacht werden die rohen PNG-Bytes (klein, ~50–80 KB) — das spart den
// teuren Netzwerk-Roundtrip; das Dekodieren ist billig.
//
// Steht OPFS nicht zur Verfuegung (z.B. Node/Tests), arbeiten die Funktionen
// als No-Op: Lesen liefert null, Schreiben tut nichts.
// ---------------------------------------------------------------------------

import type { Tile } from "./tiles";

const CACHE_DIR = "traxel-dem-tiles";

export function tileFileName(t: Tile): string {
  return `terrarium_${t.z}_${t.x}_${t.y}.png`;
}

async function getCacheDir(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined") return null;
  const storage = navigator.storage as
    | (StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> })
    | undefined;
  if (!storage?.getDirectory) return null;
  try {
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle(CACHE_DIR, { create: true });
  } catch {
    return null;
  }
}

/** Liest die gecachten PNG-Bytes einer Kachel; null bei Fehlschlag/ohne Cache. */
export async function readCachedTile(t: Tile): Promise<ArrayBuffer | null> {
  const dir = await getCacheDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(tileFileName(t));
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch {
    return null; // nicht im Cache
  }
}

/** Schreibt die PNG-Bytes einer Kachel in den Cache (Fehler werden ignoriert). */
export async function writeCachedTile(
  t: Tile,
  bytes: ArrayBuffer,
): Promise<void> {
  const dir = await getCacheDir();
  if (!dir) return;
  try {
    const fh = await dir.getFileHandle(tileFileName(t), { create: true });
    const writable = await fh.createWritable();
    await writable.write(bytes);
    await writable.close();
  } catch {
    // Cache-Schreibfehler sind unkritisch — der Download hat ja geklappt.
  }
}
