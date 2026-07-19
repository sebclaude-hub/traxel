// ---------------------------------------------------------------------------
// Interne Pipeline-Zwischenschemata.
//
// Alle Parser (GPX/KML/NMEA) muenden in Schema B: eine Zeile pro Zeitstempel.
// `enrichSpeed` reichert es zu Schema C an (Distanz + geodaetische
// Geschwindigkeit). Aus Schema C baut `buildTrackData` das Viewer-Modell
// (`TrackData` in ../types.ts).
//
// Diese Typen sind pipeline-intern und nicht Teil des Viewer-Vertrags.
// ---------------------------------------------------------------------------

/** Schema B — ein Trackpunkt direkt nach dem Parsen, vor der Anreicherung. */
export interface RawTrackPoint {
  /** Unix-Zeit in Millisekunden (UTC). */
  timestampMs: number;
  /** WGS84-Breite in Dezimalgrad. */
  lat: number;
  /** WGS84-Laenge in Dezimalgrad. */
  lon: number;
  /** Hoehe in Metern, oder null wenn die Quelle keine liefert. */
  altM: number | null;
  /** Gemeldete Geschwindigkeit (km/h) aus der Quelle, oder null. */
  speedKmh: number | null;
  /** Gemeldete Geschwindigkeit (Knoten) aus der Quelle, oder null. */
  speedKnots: number | null;
  /** Horizontale Dilution of Precision (HDOP), einheitenlos, oder null.
   *  Quellen: NMEA-GGA-Sätze und GPX-<hdop>; KML/IGC liefern keine.
   *  Typische Werte: 0.8-2.0 gut, 2.0-5.0 moderat, >5.0 schlecht. */
  hdop: number | null;
}

/** Schema C — Schema B plus geodaetische Distanz/Geschwindigkeit. */
export interface EnrichedTrackPoint extends RawTrackPoint {
  /** Geodaetische Distanz zum Vorgaengerpunkt in Metern; null fuer den
   *  ersten Punkt, bei fehlenden Koordinaten oder Duplikat-Zeitstempeln. */
  distanceM: number | null;
  /** Aus distance/dt berechnete Geschwindigkeit (km/h); null wie distanceM. */
  speedGeodesicKmh: number | null;
  /** Aus distance/dt berechnete Geschwindigkeit (Knoten); null wie distanceM. */
  speedGeodesicKnots: number | null;
}
