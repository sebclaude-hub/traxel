// ---------------------------------------------------------------------------
// Track-Bibliothek: verbindet IndexedDB-Metadaten (db.ts) mit dem rohen
// Original-Dateitext in OPFS. Ein Track wird ueber den SHA-256 seines Texts
// identifiziert (gleiche Datei = gleicher Track, unabhaengig vom Dateinamen).
//
// Wiederoeffnen = Text aus OPFS lesen → durch dieselbe Pipeline schicken
// (usePipeline.loadTrackText). Es wird bewusst NICHT die geparste TrackData
// gespeichert (grosse TypedArrays, muesste ohnehin neu angereichert werden).
//
// OPFS-Muster wie pipeline/terrain/tile-cache.ts: ohne OPFS (Node/Tests) sind
// die Funktionen No-Op.
// ---------------------------------------------------------------------------

import { sha256Hex } from "./hash";
import { deleteTrack, getAllTracks, getTrack, putTrack, type TrackRecord } from "./db";
import { opfsDirectory } from "./opfs";

const TRACK_DIR = "traxel-tracks";

/** SHA-256 des Track-Texts als Hex. Identitaet eines Tracks. */
export function hashTrackText(text: string): Promise<string> {
  return sha256Hex(text);
}

function trackFileName(hash: string): string {
  return `${hash}.txt`;
}

const getTrackDir = () => opfsDirectory(TRACK_DIR);

/** Verankert einen Track: Original-Text nach OPFS + Metadaten in IndexedDB. */
export async function saveTrack(rec: TrackRecord, text: string): Promise<void> {
  const dir = await getTrackDir();
  if (dir) {
    try {
      const fh = await dir.getFileHandle(trackFileName(rec.hash), { create: true });
      const writable = await fh.createWritable();
      await writable.write(text);
      await writable.close();
    } catch {
      // Schreibfehler sind unkritisch — der Track ist im Speicher weiter nutzbar.
    }
  }
  await putTrack(rec);
}

/** Alle gespeicherten Track-Metadaten (fuer die Bibliotheksliste). */
export function getAllTrackRecords(): Promise<TrackRecord[]> {
  return getAllTracks();
}

/** Einzelner Record (z.B. fuer Dedupe beim Laden). null wenn nicht vorhanden. */
export function getTrackRecord(hash: string): Promise<TrackRecord | null> {
  return getTrack(hash);
}

/** Original-Dateitext eines gespeicherten Tracks; null wenn nicht vorhanden. */
export async function readTrackText(hash: string): Promise<string | null> {
  const dir = await getTrackDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(trackFileName(hash));
    return await (await fh.getFile()).text();
  } catch {
    return null;
  }
}

/** Entfernt einen Track vollstaendig (OPFS-Datei + IndexedDB-Record). */
export async function removeTrack(hash: string): Promise<void> {
  const dir = await getTrackDir();
  if (dir) {
    try {
      await dir.removeEntry(trackFileName(hash));
    } catch {
      // Datei evtl. nicht vorhanden — egal.
    }
  }
  await deleteTrack(hash);
}
