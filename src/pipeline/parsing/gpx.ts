// ---------------------------------------------------------------------------
// GPX-Parser (XML) → Schema B (eine Zeile pro Zeitstempel).
//
// Port von gps_pipeline/parsing/gpx.py. Schema B ist dasselbe, das KML und
// NMEA spaeter produzieren — alle Quellen muenden in denselben Datenstrom und
// werden ab `enrichSpeed` gleich behandelt.
//
// GPX-Struktur::
//
//     <trkpt lat="..." lon="...">
//         <ele>...</ele>          (Hoehe in m, optional)
//         <time>...Z</time>       (ISO 8601 UTC)
//         <speed>...</speed>      (m/s; manche Apps, sonst in <extensions>)
//         <hdop>...</hdop>        (einheitenlos; viele Logger, optional)
//     </trkpt>
//
// Im Web Worker steht kein DOMParser zur Verfuegung, daher fast-xml-parser
// (laeuft auch in Node fuer die Tests).
//
// Duplikat-Behandlung: Trackpunkte mit identischem Zeitstempel bleiben
// erhalten — nachgelagerte Module (enrichSpeed) gehen damit um.
// ---------------------------------------------------------------------------

import { KMH_PER_MPS, KNOTS_PER_MPS } from "../constants";
import type { RawTrackPoint } from "../types";
import { asArray, makeXmlParser, parseFloatOrNull, parseTimeMs } from "./xml";

const parser = makeXmlParser();

/** Geschwindigkeit (m/s) aus <speed> oder <extensions><speed>. */
function findSpeedMs(trkpt: Record<string, unknown>): number | null {
  const direct = parseFloatOrNull(trkpt.speed);
  if (direct !== null) return direct;

  const ext = trkpt.extensions as Record<string, unknown> | undefined;
  if (ext && typeof ext === "object") {
    const extSpeed = parseFloatOrNull(ext.speed);
    if (extSpeed !== null) return extSpeed;
  }
  return null;
}

/**
 * Liest GPX-Inhalt (XML als String) und gibt einen nach Zeit sortierten
 * Schema-B-Track zurueck. Bei Parse-Fehlern oder ohne gueltige Trackpunkte:
 * leeres Array.
 */
export function parseGpx(xml: string): RawTrackPoint[] {
  let root: Record<string, unknown>;
  try {
    root = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  const gpx = root.gpx as Record<string, unknown> | undefined;
  if (!gpx) return [];

  const points: RawTrackPoint[] = [];
  for (const trk of asArray(gpx.trk as unknown)) {
    const trkObj = trk as Record<string, unknown>;
    for (const seg of asArray(trkObj.trkseg as unknown)) {
      const segObj = seg as Record<string, unknown>;
      for (const pt of asArray(segObj.trkpt as unknown)) {
        const trkpt = pt as Record<string, unknown>;

        const lat = parseFloatOrNull(trkpt["@_lat"]);
        const lon = parseFloatOrNull(trkpt["@_lon"]);
        if (lat === null || lon === null) continue; // ungueltige Koordinaten

        const timestampMs = parseTimeMs(trkpt.time);
        if (timestampMs === null) continue; // ohne Zeitstempel verwerfen

        const speedMs = findSpeedMs(trkpt);
        const speedKmh = speedMs !== null ? speedMs * KMH_PER_MPS : null;
        const speedKnots = speedMs !== null ? speedMs * KNOTS_PER_MPS : null;

        points.push({
          timestampMs,
          lat,
          lon,
          altM: parseFloatOrNull(trkpt.ele),
          speedKmh,
          speedKnots,
          hdop: parseFloatOrNull(trkpt.hdop),
        });
      }
    }
  }

  // Stabil nach Zeit sortieren (Array.prototype.sort ist seit ES2019 stabil),
  // sodass die Original-Reihenfolge bei gleichem Zeitstempel erhalten bleibt.
  points.sort((a, b) => a.timestampMs - b.timestampMs);
  return points;
}
