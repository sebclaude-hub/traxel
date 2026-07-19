// ---------------------------------------------------------------------------
// Merge: zwei Tracks zu einem zusammenfuegen.
//
// Zwei Faelle, analog zu den Cut-Modi (cuts.ts):
//   * Disjunkte Zeitbereiche (zweiter Track startet nach Ende des ersten):
//       - "gap"    — Zeitstempel unveraendert; die Pause zwischen den Tracks
//                    bleibt als sichtbare Luecke (ehrliche Gesamtzeit).
//       - "bridge" — der zweite Track wird zeitlich nach vorne gezogen, sodass
//                    die Pause durch eine plausible Brueckenzeit ersetzt wird
//                    (t = s/v wie beim Bridge-Cut) → reine Bewegungszeit.
//   * Ueberlappende Zeitbereiche: die Reihenfolge legt der Aufrufer fest; der
//     zweite Track wird zwingend hinter das Ende des ersten geschoben
//     ("bridge" erzwungen — mit unveraenderten Zeiten gaebe es keinen
//     monotonen Zeitverlauf).
//
// Ergebnis sind Schema-B-Punkte (ein Segment pro Quelltrack) — der Aufrufer
// serialisiert sie zu GPX (export/gpx.ts) und schickt das Ergebnis durch die
// normale Pipeline. So ist der gespeicherte Bibliothekstrack garantiert
// identisch mit dem angezeigten. Reine Funktion → unit-testbar.
// ---------------------------------------------------------------------------

import type { TrackData } from "../../types";
import { KMH_PER_MPS, KNOTS_PER_MPS } from "../constants";
import type { RawTrackPoint } from "../types";
import { avgSpeedKmhAround } from "./cuts";
import { geodesicDistanceMeters } from "./geo";

export type JoinMode = "gap" | "bridge";

export interface MergeResult {
  /** Ein Segment pro Quelltrack, in finaler Reihenfolge (→ je ein <trkseg>). */
  segments: RawTrackPoint[][];
  /** Tatsaechlich angewandter Modus ("gap" wird bei Ueberlappung zu "bridge"). */
  effectiveMode: JoinMode;
  /** Zeitverschiebung des zweiten Tracks in Sekunden.
   *  Positiv = nach vorne gezogen (frueher), negativ = nach hinten geschoben.
   *  0 im gap-Modus. */
  shiftS: number;
}

export interface MergeOptions {
  /** Nachbarschaftsgroesse fuer die Brueckenzeit (wie ApplyCutsOptions). */
  interpN?: number;
}

/** TrackData-Spalten → Schema-B-Punkte (Knoten aus km/h zurueckgerechnet). */
function toRawPoints(track: TrackData, shiftMs: number): RawTrackPoint[] {
  const p = track.points;
  return p.lat.map((lat, i) => {
    const kmh = p.speed_kmh[i];
    return {
      timestampMs: p.timestamp_ms[i] - shiftMs,
      lat,
      lon: p.lon[i],
      altM: p.alt[i],
      speedKmh: kmh,
      speedKnots: kmh === null ? null : (kmh / KMH_PER_MPS) * KNOTS_PER_MPS,
      hdop: p.hdop[i],
    };
  });
}

/**
 * Fuegt `second` hinter `first` an. Die Reihenfolge bestimmt der Aufrufer
 * (typisch: frueherer Startzeitpunkt zuerst). Beide Tracks bleiben
 * unveraendert.
 */
export function mergeTracks(
  first: TrackData,
  second: TrackData,
  mode: JoinMode,
  opts: MergeOptions = {},
): MergeResult {
  const interpN = opts.interpN ?? 10;
  const pa = first.points;
  const pb = second.points;
  const na = pa.lat.length;
  const nb = pb.lat.length;
  if (na === 0 || nb === 0) {
    return {
      segments: [toRawPoints(first, 0), toRawPoints(second, 0)].filter(
        (s) => s.length > 0,
      ),
      effectiveMode: mode,
      shiftS: 0,
    };
  }

  const firstEndMs = pa.timestamp_ms[na - 1];
  const secondStartMs = pb.timestamp_ms[0];
  // Ueberlappung (oder verkehrte Reihenfolge) → Zeit MUSS verschoben werden.
  const overlap = secondStartMs <= firstEndMs;
  const effectiveMode: JoinMode = overlap ? "bridge" : mode;

  let shiftMs = 0;
  if (effectiveMode === "bridge") {
    // Brueckenzeit wie beim Bridge-Cut: t = s / v ueber die Nahtstelle, v aus
    // den bis zu interpN Nachbarpunkten beidseits (leerer Bereich, s. cuts.ts).
    const bridgeM = geodesicDistanceMeters(
      pa.lat[na - 1],
      pa.lon[na - 1],
      pb.lat[0],
      pb.lon[0],
    );
    const avgKmh = avgSpeedKmhAround(
      [...pa.speed_kmh, ...pb.speed_kmh],
      na,
      na - 1,
      interpN,
    );
    const bridgeS = bridgeM / Math.max(avgKmh / KMH_PER_MPS, 0.1);
    const newSecondStartMs = firstEndMs + Math.round(bridgeS * 1000);
    shiftMs = secondStartMs - newSecondStartMs;
  }

  return {
    segments: [toRawPoints(first, 0), toRawPoints(second, shiftMs)],
    effectiveMode,
    shiftS: Math.round((shiftMs / 1000) * 10) / 10,
  };
}
