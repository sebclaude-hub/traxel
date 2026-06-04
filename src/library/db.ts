// ---------------------------------------------------------------------------
// IndexedDB-Wrapper fuer die lokale Bibliothek.
//
// Aktuell nur der charts-Store (georeferenzierte Karten-Overlays): gespeichert
// werden Metadaten + Platzierung, die rohen PNG-Bytes liegen daneben in OPFS
// (s. chart-store.ts). Beim Oeffnen eines Tracks werden Karten, deren bbox im
// Track-Bereich liegt, automatisch wieder geladen.
//
// Bewusst erweiterbar: weitere Stores (tracks, dems) lassen sich in
// onupgradeneeded ergaenzen (DB-Version hochzaehlen).
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

const DB_NAME = "traxel";
const DB_VERSION = 1;
const CHARTS_STORE = "charts";

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
      if (!db.objectStoreNames.contains(CHARTS_STORE)) {
        db.createObjectStore(CHARTS_STORE, { keyPath: "hash" });
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

/** Speichert/aktualisiert einen Chart-Record (Upsert per hash). No-Op ohne IndexedDB. */
export async function putChart(rec: ChartRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(CHARTS_STORE, "readwrite");
    await reqToPromise(tx.objectStore(CHARTS_STORE).put(rec));
  } catch {
    // Schreibfehler sind unkritisch — die Karte ist im Speicher weiterhin nutzbar.
  } finally {
    db.close();
  }
}

/** Alle gespeicherten Chart-Records. [] ohne IndexedDB oder bei Fehler. */
export async function getAllCharts(): Promise<ChartRecord[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(CHARTS_STORE, "readonly");
    return await reqToPromise(tx.objectStore(CHARTS_STORE).getAll() as IDBRequest<ChartRecord[]>);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Loescht den Chart-Record mit diesem hash. No-Op ohne IndexedDB. */
export async function deleteChart(hash: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(CHARTS_STORE, "readwrite");
    await reqToPromise(tx.objectStore(CHARTS_STORE).delete(hash));
  } catch {
    // ignorieren
  } finally {
    db.close();
  }
}
