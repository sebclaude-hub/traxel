// ---------------------------------------------------------------------------
// KML-Parser (Google Earth gx:Track) → Schema B (eine Zeile pro Zeitstempel).
//
// Port von gps_pipeline/parsing/kml.py. Muendet in denselben Datenstrom wie
// GPX und NMEA (RawTrackPoint[]).
//
// Unterstuetzter Dialekt: <gx:Track> mit parallelen <when>- und <gx:coord>-
// Listen (Google Earth, FlightAware, viele EFBs). <gx:coord> ist
// "lon lat alt" (Leerzeichen-getrennt), Hoehe optional. <when> ist ISO 8601.
//
// Andere Varianten (<LineString> fuer statische Pfade, <Point> fuer Wegpunkte)
// liefern einfach ein leeres Ergebnis — sie haben keine Zeit-Position-Paare.
//
// KML hat keine Geschwindigkeit; enrichSpeed fuellt sie geodaetisch auf.
// ---------------------------------------------------------------------------

import type { RawTrackPoint } from "../types";
import { asArray, makeXmlParser, parseTimeMs } from "./xml";

const parser = makeXmlParser();

/** Text eines fast-xml-parser-Knotens (String oder { '#text': ... }). */
function textOf(node: unknown): string | null {
  if (typeof node === "string") return node;
  if (node && typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    return t === undefined || t === null ? null : String(t);
  }
  return null;
}

/** Alle <gx:Track>-Knoten (nach removeNSPrefix: "Track") rekursiv einsammeln. */
function collectTracks(node: unknown, out: Record<string, unknown>[]): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectTracks(x, out);
    return;
  }
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    if (key === "Track") {
      for (const t of asArray(val)) {
        if (t && typeof t === "object") out.push(t as Record<string, unknown>);
      }
    } else {
      collectTracks(val, out);
    }
  }
}

/** Wandelt "lon lat [alt]" in {lon, lat, alt} um; null bei Fehler. */
function parseCoord(
  text: string,
): { lon: number; lat: number; alt: number | null } | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lon = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  if (Number.isNaN(lon) || Number.isNaN(lat)) return null;
  const alt = parts.length >= 3 ? parseFloat(parts[2]) : NaN;
  return { lon, lat, alt: Number.isNaN(alt) ? null : alt };
}

/**
 * Liest KML-Inhalt mit <gx:Track> und gibt einen nach Zeit sortierten
 * Schema-B-Track zurueck. Bei Parse-Fehlern oder unsupportetem Dialekt:
 * leeres Array.
 */
export function parseKml(xml: string): RawTrackPoint[] {
  let root: unknown;
  try {
    root = parser.parse(xml);
  } catch {
    return [];
  }

  const tracks: Record<string, unknown>[] = [];
  collectTracks(root, tracks);

  const points: RawTrackPoint[] = [];
  for (const track of tracks) {
    const whens = asArray(track.when);
    const coords = asArray(track.coord);
    // <when> und <gx:coord> muessen paarweise zusammenpassen.
    if (whens.length !== coords.length) continue;

    for (let i = 0; i < whens.length; i++) {
      const timestampMs = parseTimeMs(textOf(whens[i]));
      if (timestampMs === null) continue;
      const coordText = textOf(coords[i]);
      if (coordText === null) continue;
      const c = parseCoord(coordText);
      if (c === null) continue;

      points.push({
        timestampMs,
        lat: c.lat,
        lon: c.lon,
        altM: c.alt,
        speedKmh: null,
        speedKnots: null,
      });
    }
  }

  points.sort((a, b) => a.timestampMs - b.timestampMs);
  return points;
}
