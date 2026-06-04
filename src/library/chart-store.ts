// ---------------------------------------------------------------------------
// Chart-Bibliothek: verbindet IndexedDB-Metadaten (db.ts) mit den rohen
// PNG-Bytes in OPFS. Eine Karte wird ueber den SHA-256 ihrer Bytes identifiziert
// (gleiches Bild = gleiche Karte, unabhaengig vom Dateinamen).
//
// OPFS-Muster wie pipeline/terrain/tile-cache.ts: ohne OPFS (Node/Tests)
// arbeiten Lese-/Schreibfunktionen als No-Op.
// ---------------------------------------------------------------------------

import { bboxIntersects } from "./spatial";
import { deleteChart, getAllCharts, putChart, type ChartRecord } from "./db";
import type { TrackBounds } from "../types";

const CHART_DIR = "traxel-charts";

/** SHA-256 der Bytes als Hex-String. Identitaet einer Karte. */
export async function hashImageBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function chartFileName(hash: string): string {
  return `${hash}.png`;
}

async function getChartDir(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined") return null;
  const storage = navigator.storage as
    | (StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> })
    | undefined;
  if (!storage?.getDirectory) return null;
  try {
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle(CHART_DIR, { create: true });
  } catch {
    return null;
  }
}

async function readChartBytes(hash: string): Promise<ArrayBuffer | null> {
  const dir = await getChartDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(chartFileName(hash));
    return await (await fh.getFile()).arrayBuffer();
  } catch {
    return null; // nicht im Cache
  }
}

async function writeChartBytes(hash: string, bytes: ArrayBuffer): Promise<void> {
  const dir = await getChartDir();
  if (!dir) return;
  try {
    const fh = await dir.getFileHandle(chartFileName(hash), { create: true });
    const writable = await fh.createWritable();
    await writable.write(bytes);
    await writable.close();
  } catch {
    // Schreibfehler sind unkritisch.
  }
}

/** Verankert eine Karte: PNG-Bytes nach OPFS + Metadaten/Platzierung in IndexedDB. */
export async function saveChart(rec: ChartRecord, bytes: ArrayBuffer): Promise<void> {
  await writeChartBytes(rec.hash, bytes);
  await putChart(rec);
}

/** Liest einen einzelnen Record (für Hash-Treffer beim Import). null wenn nicht vorhanden. */
export async function getChartRecord(hash: string): Promise<ChartRecord | null> {
  const all = await getAllCharts();
  return all.find((r) => r.hash === hash) ?? null;
}

/**
 * Alle gespeicherten Karten, deren bbox den Track-Bereich ueberlappt — inkl.
 * ihrer PNG-Bytes aus OPFS. Records ohne lesbare Bytes werden uebersprungen.
 */
export async function loadChartsForBounds(
  bounds: TrackBounds,
): Promise<{ rec: ChartRecord; bytes: ArrayBuffer }[]> {
  const all = await getAllCharts();
  const out: { rec: ChartRecord; bytes: ArrayBuffer }[] = [];
  for (const rec of all) {
    if (!bboxIntersects(rec.bbox, bounds)) continue;
    const bytes = await readChartBytes(rec.hash);
    if (bytes) out.push({ rec, bytes });
  }
  return out;
}

/** Entfernt eine Karte vollstaendig (OPFS-Datei + IndexedDB-Record). */
export async function removeChart(hash: string): Promise<void> {
  const dir = await getChartDir();
  if (dir) {
    try {
      await dir.removeEntry(chartFileName(hash));
    } catch {
      // Datei evtl. nicht vorhanden — egal.
    }
  }
  await deleteChart(hash);
}
