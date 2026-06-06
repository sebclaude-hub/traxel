// ---------------------------------------------------------------------------
// Werte + Quantilgrenzen fuer den aktiven Farbmodus an EINER Stelle bestimmen,
// damit Track-Faerbung (TrackViewer) und Legende (ColorLegend) garantiert
// dieselbe Skala verwenden.
//
// speed/altitude nutzen die von der Pipeline gelieferten Grenzen. altitude_gnd
// (Hoehe ueber Grund) faerbt nach above_terrain — diese Grenzen gibt es NICHT
// aus der Pipeline (AGL entsteht erst nach der Terrain-Anreicherung im Viewer),
// daher werden sie hier on-the-fly aus dem (terrain-angereicherten) Track
// berechnet. Aufrufer memoisieren das Ergebnis.
// ---------------------------------------------------------------------------

import type { ColorMode, TrackData } from "../types";
import { computeQuantileBreaks } from "../pipeline/processing/quantiles";
import { energyHeight } from "./kinematics";

export interface ColorScale {
  /** Rohwerte pro Punkt fuer den Modus (null → spaeter FALLBACK-Farbe). */
  values: (number | null)[];
  /** k+1 Quantilgrenzen (inkl. min/max). */
  breaks: number[];
}

/**
 * Quantilgrenzen ueber MEHRERE Tracks fuer den Track-Vergleich: damit "Rot =
 * gleiche Geschwindigkeit" auf beiden ueberlagerten Tracks gilt, muss die
 * Transferfunktion (breaks) ueber die KOMBINIERTEN Werte berechnet und von
 * beiden geteilt werden. Bei genau einem Track unveraendert zur Einzelskala
 * (gleiche Quelle/Grenzen wie zuvor → kein Regress fuer den Single-Track-Fall).
 */
export function combinedBreaks(tracks: TrackData[], mode: ColorMode): number[] {
  if (tracks.length === 1) return colorScaleFor(tracks[0], mode).breaks;
  const all = tracks.flatMap((t) => colorScaleFor(t, mode).values);
  return computeQuantileBreaks(all).breaks;
}

export function colorScaleFor(track: TrackData, mode: ColorMode): ColorScale {
  if (mode === "altitude") {
    return { values: track.points.alt, breaks: track.quantile_breaks.altitude_m };
  }
  if (mode === "altitude_gnd") {
    const values = track.points.above_terrain;
    return { values, breaks: computeQuantileBreaks(values).breaks };
  }
  if (mode === "energy") {
    // Vorzeichenlose Energiehoehe → wie Hoehe/Tempo quantil-entzerrt. Werte werden
    // viewer-seitig gerechnet, daher auch die Grenzen on-the-fly.
    const values = energyHeight(track.points);
    return { values, breaks: computeQuantileBreaks(values).breaks };
  }
  // speed (Default; flight/drone/accel werden vom Aufrufer separat behandelt
  // bzw. fallen hier bewusst auf die Speed-Skala zurueck).
  return { values: track.points.speed_kmh, breaks: track.quantile_breaks.speed_kmh };
}
