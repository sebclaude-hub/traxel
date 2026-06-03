// ---------------------------------------------------------------------------
// Oeffentliche Pipeline-API.
//
// Fasst die Einzelschritte zu Workflows pro Quellformat zusammen — Aequivalent
// zu api.process_gpx + export_for_viewer aus der Python-Pipeline, aber liefert
// `TrackData` direkt im Speicher statt JSON auf der Platte.
// ---------------------------------------------------------------------------

import type { TrackData } from "../types";
import { parseGpx } from "./parsing/gpx";
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
