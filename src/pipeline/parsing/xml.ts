// ---------------------------------------------------------------------------
// Geteilte XML-Helfer fuer die GPX- und KML-Parser.
//
// Im Web Worker steht kein DOMParser zur Verfuegung → fast-xml-parser (laeuft
// auch in Node fuer die Tests). removeNSPrefix normalisiert Namespace-Praefixe
// (z.B. <gx:coord> → coord, <gpx:trkpt> → trkpt).
// ---------------------------------------------------------------------------

import { XMLParser } from "fast-xml-parser";

/** Gemeinsam genutzter, namespace-normalisierender XML-Parser. */
export function makeXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
  });
}

/** Normalisiert fast-xml-parser-Ergebnisse: Einzelelement → Array. */
export function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

export function parseFloatOrNull(text: unknown): number | null {
  if (text === undefined || text === null) return null;
  const v = parseFloat(String(text));
  return Number.isNaN(v) ? null : v;
}

/**
 * ISO-8601-Zeit zu Unix-Millisekunden (UTC). null bei Fehler.
 * Fehlt die Zeitzone, wird UTC angenommen (GPX/KML-Specs schreiben UTC vor —
 * wie pd.to_datetime(..., utc=True) im Python-Port).
 */
export function parseTimeMs(text: unknown): number | null {
  if (text === undefined || text === null) return null;
  let s = String(text).trim();
  if (s === "") return null;
  const hasTz = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) s += "Z";
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}
