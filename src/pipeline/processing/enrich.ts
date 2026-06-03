// ---------------------------------------------------------------------------
// Schema B → Schema C: geodaetische Distanz und Geschwindigkeit anreichern.
//
// Port von gps_pipeline/processing/enrich.py.
//
// Pro aufeinanderfolgendem Punktpaar:
//   * distanceM            — geodaetische Distanz zum Vorgaenger (m)
//   * speedGeodesicKmh/Knots — aus distance/dt
//
// NaN-/Null-Regeln (wie im Python-Original):
//   * Erster Punkt hat keinen Vorgaenger → null.
//   * Duplikat- oder nicht-monotone Zeitstempel (dt <= 0) → null statt Inf.
//
// Fehlt die gemeldete Geschwindigkeit durchgehend (typisch fuer KML, oft auch
// GPX), wird speedKmh/Knots aus der geodaetischen Berechnung aufgefuellt, damit
// die Geschwindigkeitsfarbe fuer alle Quellen funktioniert.
// ---------------------------------------------------------------------------

import { KMH_PER_MPS, KNOTS_PER_MPS } from "../constants";
import type { EnrichedTrackPoint, RawTrackPoint } from "../types";
import { geodesicDistanceMeters } from "./geo";

export function enrichSpeed(points: RawTrackPoint[]): EnrichedTrackPoint[] {
  const result: EnrichedTrackPoint[] = points.map((p) => ({
    ...p,
    distanceM: null,
    speedGeodesicKmh: null,
    speedGeodesicKnots: null,
  }));

  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1];
    const cur = result[i];

    const dtS = (cur.timestampMs - prev.timestampMs) / 1000;
    if (!Number.isFinite(dtS) || dtS <= 0) continue; // Duplikat/nicht-monoton

    const dist = geodesicDistanceMeters(prev.lat, prev.lon, cur.lat, cur.lon);
    cur.distanceM = dist;
    const speedMps = dist / dtS;
    cur.speedGeodesicKmh = speedMps * KMH_PER_MPS;
    cur.speedGeodesicKnots = speedMps * KNOTS_PER_MPS;
  }

  // Gemeldete Geschwindigkeit durchgehend leer? Dann aus der geodaetischen
  // Berechnung auffuellen (KML/GPX ohne <speed>).
  const hasReportedSpeed = result.some((p) => p.speedKmh !== null);
  if (!hasReportedSpeed) {
    for (const p of result) {
      p.speedKmh = p.speedGeodesicKmh;
      p.speedKnots = p.speedGeodesicKnots;
    }
  }

  return result;
}
