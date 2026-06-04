// ---------------------------------------------------------------------------
// IndexedDB-Wrapper fuer die lokale Bibliothek.
//
// Stores: charts (georeferenzierte Karten-Overlays) und tracks (geladene
// GPS-Tracks als Recents). Gespeichert werden jeweils Metadaten; die rohen
// Daten (PNG-Bytes bzw. Original-Dateitext) liegen daneben in OPFS
// (chart-store.ts / track-store.ts).
//
// Bewusst erweiterbar: weitere Stores in STORES eintragen + DB_VERSION
// hochzaehlen — onupgradeneeded legt fehlende Stores idempotent an.
//
// Steht IndexedDB nicht zur Verfuegung (z.B. Node/Tests), arbeiten die
// Funktionen als No-Op: getAll liefert [], put/delete tun nichts.
// ---------------------------------------------------------------------------

import type { ChartPlacement } from "../viewer/chartPlacement";
import type { TrackBounds } from "../types";

export interface ChartRecord {
  /** SHA-256 der PNG-Bytes (Hex) — Primary Key + OPFS-Dateiname. */
  hash: string;
  /** Anzeigename/Label (Default = Kurz-Hash); frei ueberschreibbar. */
  name: string;
  /** Achsenparallele Huelle der platzierten Karte — fuer die bbox-Wiederverwendung. */
  bbox: TrackBounds;
  /** Position/Groesse/Rotation, mit der die Karte verankert wurde. */
  placement: ChartPlacement;
  /** Hoehenreferenz in m (Fallback ohne DEM). */
  elevationM: number;
  /** Optionaler Override der Mesh-Aufloesung. */
  subdivision?: number | null;
  /** Speicherzeitpunkt (ms seit Epoch). */
  savedAt: number;
}

export interface TrackRecord {
  /** SHA-256 des Original-Dateitexts (Hex) — Primary Key + OPFS-Dateiname. */
  hash: string;
  /** Anzeigename (= td.meta.name, Datei-Basename). */
  name: string;
  /** Quellformat (= td.meta.source_type). */
  format: "gpx" | "kml" | "nmea";
  /** Achsenparallele Huelle des Tracks (= td.meta.bounds). */
  bbox: TrackBounds;
  timestampStartUtc: string | null;
  timestampEndUtc: string | null;
  nPoints: number;
  totalDistanceM: number;
  durationS: number;
  /** Speicherzeitpunkt (ms seit Epoch). */
  savedAt: number;
}

const DB_NAME = "traxel";
const DB_VERSION = 2;
const CHARTS_STORE = "charts";
const TRACKS_STORE = "tracks";
const STORES = [CHARTS_STORE, TRACKS_STORE];

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "hash" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** Promisifiziert einen IDBRequest. */
function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Generischer Store-Kern -------------------------------------------------

async function putRecord<T>(store: string, rec: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(store, "readwrite");
    await reqToPromise(tx.objectStore(store).put(rec));
  } catch {
    // Schreibfehler sind unkritisch — das Element ist im Speicher weiter nutzbar.
  } finally {
    db.close();
  }
}

async function getAllRecords<T>(store: string): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(store, "readonly");
    return await reqToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

async function deleteRecord(store: string, key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(store, "readwrite");
    await reqToPromise(tx.objectStore(store).delete(key));
  } catch {
    // ignorieren
  } finally {
    db.close();
  }
}

// --- Typisierte Wrapper -----------------------------------------------------

/** Speichert/aktualisiert einen Chart-Record (Upsert per hash). No-Op ohne IndexedDB. */
export const putChart = (rec: ChartRecord): Promise<void> => putRecord(CHARTS_STORE, rec);
/** Alle gespeicherten Chart-Records. [] ohne IndexedDB oder bei Fehler. */
export const getAllCharts = (): Promise<ChartRecord[]> => getAllRecords(CHARTS_STORE);
/** Loescht den Chart-Record mit diesem hash. No-Op ohne IndexedDB. */
export const deleteChart = (hash: string): Promise<void> => deleteRecord(CHARTS_STORE, hash);

/** Speichert/aktualisiert einen Track-Record (Upsert per hash). No-Op ohne IndexedDB. */
export const putTrack = (rec: TrackRecord): Promise<void> => putRecord(TRACKS_STORE, rec);
/** Alle gespeicherten Track-Records. [] ohne IndexedDB oder bei Fehler. */
export const getAllTracks = (): Promise<TrackRecord[]> => getAllRecords(TRACKS_STORE);
/** Loescht den Track-Record mit diesem hash. No-Op ohne IndexedDB. */
export const deleteTrack = (hash: string): Promise<void> => deleteRecord(TRACKS_STORE, hash);
