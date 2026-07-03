// ---------------------------------------------------------------------------
// Geteiltes Datenmodell zwischen Pipeline und Viewer.
//
// Entspricht dem erprobten Vertrag aus dem Vorgaenger-Viewer: die Pipeline
// erzeugt `TrackData`, der Viewer rendert es. Frueher lief dieser Vertrag
// ueber `track.json` auf der Platte — in Traxel wird `TrackData` direkt im
// Speicher uebergeben.
//
// Hier stehen nur die track-bezogenen Typen. DEM-, Satelliten- und
// Manifest-Typen kommen in spaeteren Phasen dazu.
// ---------------------------------------------------------------------------

export interface TrackBounds {
  lon_min: number;
  lat_min: number;
  lon_max: number;
  lat_max: number;
}

export interface TrackMeta {
  name: string;
  source_type: "nmea" | "gpx" | "kml" | "igc";
  n_points: number;
  total_distance_m: number;
  duration_s: number;
  timestamp_start_utc: string | null;
  timestamp_end_utc: string | null;
  bounds: TrackBounds;
  /** "flight" wenn der Track im Median >100 m ueber Terrain liegt, sonst
   *  "ground". Ohne Terrain-Daten immer "ground". */
  track_mode: "flight" | "ground";
  has_terrain: boolean;
  has_satellites: boolean;
}

export interface QuantileBreaks {
  /** n_quantiles+1 Grenzwerte (inkl. min und max) der Geschwindigkeit. */
  speed_kmh: number[];
  /** n_quantiles+1 Grenzwerte (inkl. min und max) der Hoehe. */
  altitude_m: number[];
  n_quantiles: number;
}

// "altitude" = Hoehe ueber MSL (faerbt nach alt); "altitude_gnd" = Hoehe ueber
// Grund (faerbt nach above_terrain, nur mit Terrain verfuegbar).
// "speed" = GPS-Grundgeschwindigkeit (SOG, 2D, horizontal);
// "speed3d" = 3D-Geschwindigkeit v3D = √(v_h² + v_z²) (mit Vertikalrate) — die
//   Basis der Tangential-Beschleunigung (a = d(v3D)/dt), daher im Selektor direkt
//   vor "accel" platziert.
// "energy" = spezifische Energie als Hoehenaequivalent H = h + v²/(2g)
// (vorzeichenlos); "energy_rate" = dH/dt (vorzeichenbehaftet, wie accel gefaerbt).
// "accuracy" = GPS-Genauigkeit (HDOP, Horizontal Dilution of Precision) — nur
// bei NMEA-Quellen mit Satellitendata verfuegbar.
export type ColorMode =
  | "speed"
  | "speed3d"
  | "altitude"
  | "altitude_gnd"
  | "flight"
  | "drone"
  | "accel"
  | "energy"
  | "energy_rate"
  | "accuracy";

export interface TrackPoints {
  lat: number[];
  lon: number[];
  alt: (number | null)[];
  terrain_elev: (number | null)[];
  above_terrain: (number | null)[];
  speed_kmh: (number | null)[];
  distance_m: (number | null)[];
  timestamp_ms: number[];
  /** Quantilklasse 0..n-1 der Geschwindigkeit pro Punkt; -1 = ohne Wert. */
  speed_q_idx: number[];
  /** Quantilklasse 0..n-1 der Hoehe pro Punkt; -1 = ohne Wert. */
  alt_q_idx: number[];
  // --- Abgeleitete Kinematik (Pipeline rechnet, Viewer mappt nur auf Farbe) ---
  // In der Pipeline vorberechnet (buildTrackData) und bei Cuts neu gerechnet
  // (applyCuts) — NICHT bloss mitgeschnitten. Im Share-Payload gestrippt und beim
  // Decode per ensureKinematics nachgerechnet (Datei klein halten). Der Viewer
  // setzt sie als vorhanden voraus; an den Eintrittspunkten (Worker/Decode) wird
  // das garantiert. Siehe pipeline/processing/kinematics.ts → enrichKinematics.
  /** 3D-Geschwindigkeit v3D = √(v_h² + v_z²) (m/s). */
  speed3d_ms: (number | null)[];
  /** Tangential-Beschleunigung a = d(v3D)/dt (m/s², vorzeichenbehaftet). */
  accel_tangential: (number | null)[];
  /** Spezifische Energie als Hoehenaequivalent H = h + v3D²/(2g) (m). */
  energy_height_m: (number | null)[];
  /** Energieaenderungsrate dH/dt (m/s, vorzeichenbehaftet). */
  energy_rate: (number | null)[];
  /** True, wenn der Zeitstempel dieses Punktes durch einen bridge-Cut
   *  (Ueberbruecken) nach vorne verschoben wurde (Pro-Punkt-Hinweis).
   *  Fehlt = ueberall false. */
  is_bridged?: boolean[];
  /** Horizontale Dilution of Precision (HDOP) aus GGA-Sätzen, einheitenlos.
   *  Nur in NMEA-Logs verfügbar; bei anderen Formaten null.
   *  Typische Werte: 0.8-2.0 = gut, 2.0-5.0 = moderat, >5.0 = schlecht. */
  hdop: (number | null)[];
}

export interface TrackData {
  meta: TrackMeta;
  quantile_breaks: QuantileBreaks;
  points: TrackPoints;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/** Regulaeres Hoehen-Grid in geografischen Koordinaten (lat/lon linear).
 *  Zeile 0 liegt im Sueden (lat_min), Spalte 0 im Westen (lon_min) —
 *  passend zur Mesh-/Sampling-Konvention. */
export interface DemGrid {
  n_rows: number;
  n_cols: number;
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
  elevations: (number | null)[];
}

// ---------------------------------------------------------------------------
// Satelliten (NMEA GSV)
// ---------------------------------------------------------------------------

/** Ein Satellit: [prn, elevation_deg, azimuth_deg, snr] — null = fehlend. */
export type SatRow = [
  number | null,
  number | null,
  number | null,
  number | null,
];

/** Ein GSV-Burst (Schnappschuss der sichtbaren Satelliten zu einem Zeitpunkt). */
export interface GsvBurst {
  ts_ms: number;
  sats: SatRow[];
}

/** Satellitendaten, pro Konstellation (Talker) und an Trackpunkte geheftet. */
export interface SatelliteData {
  talkers: string[];
  bursts_by_talker: Record<string, GsvBurst[]>;
  /** Pro Talker: Trackindex → Burst-Index in bursts_by_talker (-1 = keiner). */
  burst_idx_by_track: Record<string, number[]>;
}

// ---------------------------------------------------------------------------
// Karten-Overlay (Anflugkarten)
// ---------------------------------------------------------------------------

/** Platzierung einer geographischen Karte: Zentrum + Groesse (Meter) + Rotation. */
export interface ChartPlacement {
  centerLon: number;
  centerLat: number;
  widthM: number;
  heightM: number;
  rotationDeg: number;
}
