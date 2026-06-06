// ---------------------------------------------------------------------------
// IGC-Parser (FAI-Segelflug-Logger) → Schema B (eine Zeile pro Zeitstempel).
//
// IGC ist ein flaches Zeilenformat. Relevant sind:
//   - H-Records (Header): das Flugdatum steht im "HFDTE"-Record, entweder alt
//     "HFDTE150709" oder neu "HFDTEDATE:150709,01" (DDMMYY).
//   - B-Records (Fix): pro GPS-Fix eine feste Spaltenstruktur:
//
//       B HHMMSS DDMMmmm N DDDMMmmm E A PPPPP GGGGG
//       0 1----6 7-----13 14 15---22 23 24 25-29 30-34
//
//     Zeit (UTC) aus HHMMSS, Datum aus dem HFDTE-Record → Zeitstempel.
//     Breite/Laenge in Grad + Minuten*1000 mit Hemisphaere. Spalte 24 ist die
//     Fix-Gueltigkeit ('A' = 3D-Fix, 'V' = kein/2D-Fix). PPPPP = Druckhoehe,
//     GGGGG = GNSS-Hoehe (beide in Metern).
//
// Hoehe: GNSS-Hoehe wird bevorzugt (passt zu den uebrigen GPS-Hoehen im
// Projekt). Sie ist WGS84-ELLIPSOIDISCH — am DEM (NN-bezogen) also ~46 m zu
// hoch bei ~50°N; der z-Offset-Regler im Viewer gleicht das aus (wie bei
// SkyDemon-GPX). Ist die GNSS-Hoehe 0/fehlend, wird auf die Druckhoehe
// zurueckgegriffen.
//
// IGC liefert keine Geschwindigkeit → null; enrichSpeed fuellt sie geodaetisch
// auf (wie bei KML).
// ---------------------------------------------------------------------------

import type { RawTrackPoint } from "../types";

/** Ganzzahl aus festem Feld; nicht-numerisch/leer → null. */
function intOrNull(s: string): number | null {
  const v = parseInt(s, 10);
  return Number.isNaN(v) ? null : v;
}

interface IgcDate {
  y: number;
  mo: number; // 1..12
  d: number; // 1..31
}

/** DDMMYY aus dem Rest eines HFDTE-Records ziehen (alte und DATE:-Variante). */
function parseHfdte(rest: string): IgcDate | null {
  const m = rest.match(/(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  const yy = +m[3];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  // Zweistelliges Jahr: Pivot bei 80 (IGC existiert erst seit den 1990ern,
  // praktisch sind alle Fluege >= 2000).
  const y = yy >= 80 ? 1900 + yy : 2000 + yy;
  return { y, mo, d };
}

/**
 * Liest IGC-Inhalt und gibt einen nach Zeit sortierten Schema-B-Track zurueck.
 * Ohne gueltiges HFDTE-Datum oder ohne 3D-Fixes: leeres Array.
 */
export function parseIgc(text: string): RawTrackPoint[] {
  const lines = text.split(/\r?\n/);
  let date: IgcDate | null = null;
  let dayOffset = 0; // zaehlt UTC-Mitternachts-Uebergaenge hoch
  let prevSecOfDay = -1;
  const points: RawTrackPoint[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("HFDTE")) {
      date = parseHfdte(line.slice(5)) ?? date;
      continue;
    }

    if (line[0] !== "B" || line.length < 35) continue;
    if (!date) continue; // ohne Datum kein Zeitstempel
    if (line[24] !== "A") continue; // nur gueltige 3D-Fixes

    const hh = +line.slice(1, 3);
    const mi = +line.slice(3, 5);
    const ss = +line.slice(5, 7);
    if (hh > 23 || mi > 59 || ss > 59 || !Number.isInteger(hh + mi + ss)) continue;

    const latDeg = +line.slice(7, 9);
    const latMin = +line.slice(9, 14) / 1000; // MMmmm → Minuten
    const latHemi = line[14];
    const lonDeg = +line.slice(15, 18);
    const lonMin = +line.slice(18, 23) / 1000;
    const lonHemi = line[23];

    let lat = latDeg + latMin / 60;
    let lon = lonDeg + lonMin / 60;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (latHemi === "S") lat = -lat;
    if (lonHemi === "W") lon = -lon;
    if (lat === 0 && lon === 0) continue; // Null-Island-Sentinel (kein Fix)

    const pAlt = intOrNull(line.slice(25, 30)); // Druckhoehe
    const gAlt = intOrNull(line.slice(30, 35)); // GNSS-Hoehe (ellipsoidisch)
    // GNSS bevorzugt; bei 0/fehlend auf Druckhoehe ausweichen.
    const altM =
      gAlt !== null && gAlt !== 0 ? gAlt : pAlt !== null && pAlt !== 0 ? pAlt : gAlt;

    const secOfDay = hh * 3600 + mi * 60 + ss;
    if (prevSecOfDay >= 0 && secOfDay < prevSecOfDay - 1) dayOffset++;
    prevSecOfDay = secOfDay;

    const timestampMs = Date.UTC(date.y, date.mo - 1, date.d + dayOffset, hh, mi, ss);

    points.push({ timestampMs, lat, lon, altM, speedKmh: null, speedKnots: null });
  }

  // Stabil nach Zeit sortieren (Reihenfolge bei gleichem Zeitstempel bleibt).
  points.sort((a, b) => a.timestampMs - b.timestampMs);
  return points;
}
