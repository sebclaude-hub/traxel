// ---------------------------------------------------------------------------
// Export-Payload: buendelt alles, was der Viewer zum erneuten Rendern eines
// geteilten Tracks braucht, in ein kompaktes, gzip-komprimiertes Byte-Paket.
//
// Inhalt: TrackData + optionale Satellitendaten + optionale Derivation
// (Transparenz-Hinweis eines bridge-Cuts, der MIT in die Datei reist) +
// optionales DEM. Die Satellitendaten werden NICHT entfernt.
//
// Groessen-Trick (DEM kann Millionen Zellen haben):
//   1. Hoehen auf int16-Meter quantisieren (Verlust < Quell-Genauigkeit von
//      Copernicus GLO-30, ~2-4 m vertikal).
//   2. Zeilenweise DELTA-Vorkodierung: statt absoluter Hoehen die Differenz
//      zum linken Nachbarn — benachbarte Gelaendezellen unterscheiden sich nur
//      um wenige Meter → kleine Ganzzahlen → gzip greift ~2,4x besser.
//   3. Loecher (null, z.B. Wasser/Rand) ueber eine separate Null-BITMASKE,
//      nicht im Wertebereich — so bleiben die Deltas klein und ein echter
//      Tiefwert kollidiert nie mit einem Sentinel.
// Das alles bleibt dependency-frei und beidseitig nativ (gzip) — xz/brotli
// waeren kleiner, muessten aber einen Dekompressor in jede HTML-Datei einbetten.
//
// Container-Layout (VOR gzip):
//   [ "TRXL" 4 Byte ][ version u16 LE ][ headerLen u32 LE ]
//   [ Header-JSON (UTF-8, ohne dem.elevations) ]
//   [ DEM-Block: Null-Bitmaske (ceil(count/8) Byte) + count × delta int16 LE ]
//
// Endianness ist explizit Little-Endian per DataView — niemals
// `new Int16Array(buffer)`, das wuerde Host-Endianness benutzen und geteilte
// Dateien plattformuebergreifend korrumpieren.
// ---------------------------------------------------------------------------

import type { DemGrid, SatelliteData, TrackData } from "../../types";
import type { Derivation } from "../processing/cuts";
import { gunzip, gzip } from "./gzip";

const MAGIC = "TRXL"; // 4 ASCII-Bytes
const FORMAT_VERSION = 1;

// Gueltige Hoehen werden auf [-32767, 32767] geklemmt (Erde: -432 .. 8849 m).
const ELEV_MIN = -32767;
const ELEV_MAX = 32767;

const HEADER_OFFSET = 10; // 4 (magic) + 2 (version) + 4 (headerLen)

export interface ExportInput {
  track: TrackData;
  satellites?: SatelliteData | null;
  derivation?: Derivation | null;
  dem?: DemGrid | null;
}

export interface DecodedPayload {
  version: number;
  track: TrackData;
  satellites: SatelliteData | null;
  derivation: Derivation | null;
  dem: DemGrid | null;
}

/** Hoehe → gerundetes, geklemmtes int16-Meter-Quantum. */
function clampElev(e: number): number {
  const r = Math.round(e);
  return r < ELEV_MIN ? ELEV_MIN : r > ELEV_MAX ? ELEV_MAX : r;
}

/** Beliebige Ganzzahl in den int16-Bereich [-32768, 32767] falten (mod 2^16). */
function wrapInt16(x: number): number {
  const m = (((x + 32768) % 65536) + 65536) % 65536;
  return m - 32768;
}

/**
 * Kodiert ein DEM in Null-Bitmaske + zeilenweise Delta-int16 (LE).
 * prev wird je Zeile auf 0 zurueckgesetzt (Zeilengrenzen sind geografisch
 * keine Nachbarn); null-Zellen lassen prev unveraendert (Delta 0).
 */
function encodeDemBlock(dem: DemGrid): Uint8Array {
  const rows = dem.n_rows;
  const cols = dem.n_cols;
  const count = rows * cols;
  const maskLen = (count + 7) >> 3;

  const out = new Uint8Array(maskLen + count * 2);
  const view = new DataView(out.buffer);

  let dOff = maskLen;
  for (let r = 0; r < rows; r++) {
    let prev = 0;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const e = dem.elevations[i];
      if (e === null || !Number.isFinite(e)) {
        out[i >> 3] |= 1 << (i & 7); // Null markieren
        view.setInt16(dOff, 0, true); // Delta 0, prev unveraendert
      } else {
        const v = clampElev(e);
        view.setInt16(dOff, wrapInt16(v - prev), true);
        prev = v;
      }
      dOff += 2;
    }
  }
  return out;
}

/** Liest einen DEM-Block (Bitmaske + Delta-int16) ab `start` zurueck. */
function decodeDemBlock(
  view: DataView,
  start: number,
  rows: number,
  cols: number,
): (number | null)[] {
  const count = rows * cols;
  const maskLen = (count + 7) >> 3;
  const elevations = new Array<number | null>(count);

  let dOff = start + maskLen;
  for (let r = 0; r < rows; r++) {
    let prev = 0;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const d = view.getInt16(dOff, true);
      dOff += 2;
      const cur = wrapInt16(prev + d);
      const isNull = (view.getUint8(start + (i >> 3)) >> (i & 7)) & 1;
      if (isNull) {
        elevations[i] = null; // cur === prev (Delta war 0), prev bleibt
      } else {
        elevations[i] = cur;
        prev = cur;
      }
    }
  }
  return elevations;
}

/**
 * Baut ein gzip-komprimiertes Export-Paket (siehe Datei-Kopf fuer das Layout).
 */
export async function encodePayload(input: ExportInput): Promise<Uint8Array> {
  const dem = input.dem ?? null;

  // JSON-Kopf: alles ausser den DEM-Hoehen (die kommen als Binaerblock).
  const header = {
    track: input.track,
    satellites: input.satellites ?? null,
    derivation: input.derivation ?? null,
    dem: dem
      ? {
          n_rows: dem.n_rows,
          n_cols: dem.n_cols,
          lat_min: dem.lat_min,
          lat_max: dem.lat_max,
          lon_min: dem.lon_min,
          lon_max: dem.lon_max,
        }
      : null,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const demBytes = dem ? encodeDemBlock(dem) : new Uint8Array(0);

  const total = HEADER_OFFSET + headerBytes.length + demBytes.length;
  const container = new Uint8Array(total);
  const view = new DataView(container.buffer);

  for (let i = 0; i < MAGIC.length; i++) view.setUint8(i, MAGIC.charCodeAt(i));
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint32(6, headerBytes.length, true);
  container.set(headerBytes, HEADER_OFFSET);
  container.set(demBytes, HEADER_OFFSET + headerBytes.length);

  return gzip(container);
}

/**
 * Liest ein mit `encodePayload` erzeugtes Paket. Liefert exakt die
 * In-Memory-Typen, die der Viewer ohnehin konsumiert (TrackData/DemGrid/...),
 * damit die HTML-Huelle den Viewer ohne Anpassung wiederverwenden kann.
 *
 * Wirft laut bei fremder/neuerer Datei statt still falsch zu parsen.
 */
export async function decodePayload(packed: Uint8Array): Promise<DecodedPayload> {
  const container = await gunzip(packed);
  if (container.length < HEADER_OFFSET) {
    throw new Error("Ungültige Traxel-Datei: zu kurz.");
  }
  const view = new DataView(
    container.buffer,
    container.byteOffset,
    container.byteLength,
  );

  // Magic pruefen.
  for (let i = 0; i < MAGIC.length; i++) {
    if (view.getUint8(i) !== MAGIC.charCodeAt(i)) {
      throw new Error("Keine gültige Traxel-Export-Datei (Kennung fehlt).");
    }
  }

  // Version laut pruefen.
  const version = view.getUint16(4, true);
  if (version !== FORMAT_VERSION) {
    const hint =
      version > FORMAT_VERSION
        ? "Sie wurde mit einer neueren Traxel-Version erstellt — bitte Viewer aktualisieren."
        : "Das Format ist veraltet und wird nicht mehr unterstützt.";
    throw new Error(
      `Traxel-Datei Format ${version}, dieser Viewer erwartet ${FORMAT_VERSION}. ${hint}`,
    );
  }

  const headerLen = view.getUint32(6, true);
  const headerEnd = HEADER_OFFSET + headerLen;
  const headerBytes = container.subarray(HEADER_OFFSET, headerEnd);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));

  let dem: DemGrid | null = null;
  if (header.dem) {
    const { n_rows, n_cols } = header.dem;
    const count = n_rows * n_cols;
    const need = headerEnd + ((count + 7) >> 3) + count * 2;
    if (container.length < need) {
      throw new Error("Ungültige Traxel-Datei: DEM-Block unvollständig.");
    }
    dem = {
      ...header.dem,
      elevations: decodeDemBlock(view, headerEnd, n_rows, n_cols),
    };
  }

  return {
    version,
    track: header.track as TrackData,
    satellites: (header.satellites ?? null) as SatelliteData | null,
    derivation: (header.derivation ?? null) as Derivation | null,
    dem,
  };
}
