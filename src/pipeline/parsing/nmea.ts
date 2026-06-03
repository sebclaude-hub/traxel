// ---------------------------------------------------------------------------
// NMEA-Orchestrierung: Saetze → Schema-B-Track.
//
// Port der Idee aus build_dataframe + filter + consolidate (gps_pipeline):
//   - Stream durchlaufen, letztes RMC-Datum/-Zeit mitfuehren (GGA/VTG haben
//     keine eigene Datum/Zeit)
//   - pro Timestamp Position (GGA bevorzugt, sonst RMC), Hoehe (GGA),
//     Geschwindigkeit (RMC bevorzugt, sonst VTG) sammeln
//   - alles vor dem ersten gueltigen RMC-Fix (status "A") verwerfen
//
// GSV/GSA fliessen hier nicht in den Track (Diagnose/Satelliten → 6c).
// Reine Funktionen → unit-testbar.
// ---------------------------------------------------------------------------

import type { RawTrackPoint } from "../types";
import { parseNmeaLine, type NmeaMessage } from "./nmea-sentences";

const KMH_PER_KNOT = 1.852;

/** Parst alle Zeilen eines NMEA-Logs zu getypten Nachrichten (Stream-Reihenfolge). */
export function parseNmeaMessages(text: string): NmeaMessage[] {
  const out: NmeaMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = parseNmeaLine(line);
    if (m) out.push(m);
  }
  return out;
}

/**
 * NMEA-Datum (ddmmyy) + Zeit (hhmmss[.sss]) → Unix-ms (UTC). null bei Fehler.
 * 2-stelliges Jahr: <80 → 2000+, sonst 1900+ (uebliche Pivot-Konvention).
 */
export function combineDateTimeMs(
  date: string | null,
  time: string | null,
): number | null {
  if (!date || !time || date.length < 6 || time.length < 6) return null;
  const dd = parseInt(date.slice(0, 2), 10);
  const mm = parseInt(date.slice(2, 4), 10);
  const yy = parseInt(date.slice(4, 6), 10);
  const hh = parseInt(time.slice(0, 2), 10);
  const mi = parseInt(time.slice(2, 4), 10);
  const ss = parseFloat(time.slice(4));
  if ([dd, mm, yy, hh, mi].some(Number.isNaN) || Number.isNaN(ss)) return null;
  const year = yy < 80 ? 2000 + yy : 1900 + yy;
  const ms = Date.UTC(year, mm - 1, dd, hh, mi, Math.floor(ss), Math.round((ss % 1) * 1000));
  return Number.isNaN(ms) ? null : ms;
}

interface Rec {
  lat: number | null;
  lon: number | null;
  alt: number | null;
  speedKnots: number | null;
  speedKmph: number | null;
}

/** Konsolidiert Nachrichten zu einem nach Zeit sortierten Schema-B-Track. */
export function messagesToTrack(messages: NmeaMessage[]): RawTrackPoint[] {
  let lastDate: string | null = null;
  let lastTime: string | null = null;
  let firstValidFixMs: number | null = null;

  const byTs = new Map<number, Rec>();
  const getRec = (ms: number): Rec => {
    let r = byTs.get(ms);
    if (!r) {
      r = { lat: null, lon: null, alt: null, speedKnots: null, speedKmph: null };
      byTs.set(ms, r);
    }
    return r;
  };

  for (const m of messages) {
    if (m.type === "RMC") {
      if (m.date) lastDate = m.date;
      if (m.time) lastTime = m.time;
      const ms = combineDateTimeMs(lastDate, m.time);
      if (ms === null) continue;
      const r = getRec(ms);
      if (m.lat !== null) r.lat = m.lat;
      if (m.lon !== null) r.lon = m.lon;
      if (m.speedKnots !== null && r.speedKnots === null) r.speedKnots = m.speedKnots;
      if (m.status === "A" && firstValidFixMs === null) firstValidFixMs = ms;
    } else if (m.type === "GGA") {
      if (m.time) lastTime = m.time;
      const ms = combineDateTimeMs(lastDate, m.time);
      if (ms === null) continue;
      const r = getRec(ms);
      // GGA-Position ist die primaere Quelle (ueberschreibt ggf. RMC).
      if (m.lat !== null) r.lat = m.lat;
      if (m.lon !== null) r.lon = m.lon;
      if (m.altitude !== null) r.alt = m.altitude;
    } else if (m.type === "VTG") {
      const ms = combineDateTimeMs(lastDate, lastTime);
      if (ms === null) continue;
      const r = getRec(ms);
      if (m.speedKmph !== null) r.speedKmph = m.speedKmph;
      if (m.speedKnots !== null && r.speedKnots === null) r.speedKnots = m.speedKnots;
    }
    // GSA/GSV: nicht teil des Tracks
  }

  const entries = [...byTs.entries()].filter(
    ([, r]) => r.lat !== null && r.lon !== null,
  );
  entries.sort((a, b) => a[0] - b[0]);

  const points: RawTrackPoint[] = [];
  for (const [ms, r] of entries) {
    if (firstValidFixMs !== null && ms < firstValidFixMs) continue;
    let speedKmh = r.speedKmph;
    let speedKnots = r.speedKnots;
    if (speedKmh === null && speedKnots !== null) speedKmh = speedKnots * KMH_PER_KNOT;
    if (speedKnots === null && speedKmh !== null) speedKnots = speedKmh / KMH_PER_KNOT;
    points.push({
      timestampMs: ms,
      lat: r.lat as number,
      lon: r.lon as number,
      altM: r.alt,
      speedKmh,
      speedKnots,
    });
  }
  return points;
}
