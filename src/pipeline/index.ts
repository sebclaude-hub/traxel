// ---------------------------------------------------------------------------
// Oeffentliche Pipeline-API.
//
// Fasst die Einzelschritte zu Workflows pro Quellformat zusammen — Aequivalent
// zu api.process_gpx + export_for_viewer aus der Python-Pipeline, aber liefert
// `TrackData` direkt im Speicher statt JSON auf der Platte.
// ---------------------------------------------------------------------------

import type { TrackData } from "../types";
import { parseGpx } from "./parsing/gpx";
import { parseKml } from "./parsing/kml";
import { messagesToTrack, parseNmeaMessages } from "./parsing/nmea";
import { enrichSpeed } from "./processing/enrich";
import { buildTrackData } from "./processing/track-model";

export type { TrackData } from "../types";
export type { RawTrackPoint, EnrichedTrackPoint } from "./types";

/**
 * Volle GPX-Pipeline: parsen → Schema B → anreichern → Schema C → TrackData.
 *
 * @param xml  GPX-Inhalt (XML als String).
 * @param name Anzeigename des Tracks im Viewer.
 */
export function processGpx(xml: string, name: string): TrackData {
  const raw = parseGpx(xml);
  const enriched = enrichSpeed(raw);
  return buildTrackData(enriched, { name, sourceType: "gpx" });
}

/**
 * Volle KML-Pipeline: parsen (gx:Track) → Schema B → anreichern → TrackData.
 * KML liefert keine Geschwindigkeit; enrichSpeed fuellt sie geodaetisch auf.
 *
 * @param xml  KML-Inhalt (XML als String).
 * @param name Anzeigename des Tracks im Viewer.
 */
export function processKml(xml: string, name: string): TrackData {
  const raw = parseKml(xml);
  const enriched = enrichSpeed(raw);
  return buildTrackData(enriched, { name, sourceType: "kml" });
}

/**
 * Volle NMEA-Pipeline: Saetze parsen → konsolidieren → Schema B → anreichern
 * → TrackData. (Satelliten/SkyPlot folgen separat.)
 *
 * @param text NMEA-Logfile-Inhalt.
 * @param name Anzeigename des Tracks im Viewer.
 */
export function processNmea(text: string, name: string): TrackData {
  const messages = parseNmeaMessages(text);
  const enriched = enrichSpeed(messagesToTrack(messages));
  return buildTrackData(enriched, { name, sourceType: "nmea" });
}
