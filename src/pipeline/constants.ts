// ---------------------------------------------------------------------------
// Pipeline-Konstanten (Port der relevanten Werte aus gps_pipeline/config.py).
// ---------------------------------------------------------------------------

/** 1 m/s = 3.6 km/h */
export const KMH_PER_MPS = 3.6;

/** 1 m/s = 1.94384 Knoten */
export const KNOTS_PER_MPS = 1.94384;

/** Anzahl der Farb-Quantilklassen fuer Geschwindigkeit und Hoehe. */
export const DEFAULT_QUANTILES = 5;

/** Median-Hoehe ueber Terrain (m), ab der ein Track als "flight" gilt. */
export const FLIGHT_MEDIAN_AGL_M = 100;
