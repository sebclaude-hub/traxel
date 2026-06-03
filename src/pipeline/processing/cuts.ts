// ---------------------------------------------------------------------------
// Cuts: Abschnitte eines Tracks ausblenden (Port von apply_cut_config.py +
// cut_config.py aus gps_pipeline).
//
// Drei Modi:
//   * trim      — Punkte entfernen, Zeitstempel unveraendert (Rand-/Muell-
//                 Schnitte; Edge-Cuts werden IMMER auf trim gezwungen)
//   * gap       — Punkte entfernen, Zeitstempel unveraendert; sichtbare Luecke
//   * synthetic — Punkte entfernen UND alle nachfolgenden Zeitstempel nach
//                 vorne schieben, sodass die Pause nicht erkennbar ist
//                 (Privacy). Brueckenzeit = Distanz / mittlere Nachbar-Speed.
//
// Datenschutz (synthetic): fuer den Eigentümer bleiben die Satellitendaten
// sichtbar, ergaenzt um eine Banner-Warnung, dass die Konstellation ab dem
// Cut nicht mehr der Realitaet entspricht. (Das Entfernen der Satellitendaten
// beim Export kommt mit der Export-Funktion.)
//
// Reine Funktion → unit-testbar.
// ---------------------------------------------------------------------------

import type { SatelliteData, TrackData, TrackPoints } from "../../types";
import { DEFAULT_QUANTILES } from "../constants";
import { geodesicDistanceMeters } from "./geo";
import { computeQuantileBreaks } from "./quantiles";

export type CutMode = "trim" | "gap" | "synthetic";

export interface CutSpec {
  start: number;
  end: number;
  mode: CutMode;
}

export interface Derivation {
  type: "gap" | "synthetic";
  severity: "info" | "warn";
  n_cuts: number;
  n_trim_cuts: number;
  n_gap_cuts: number;
  n_synthetic_cuts: number;
  n_points_before: number;
  n_points_after: number;
  n_points_removed: number;
  total_time_shift_s?: number;
  message: string;
}

export interface CutResult {
  track: TrackData;
  satellites: SatelliteData | null;
  derivation: Derivation | null;
}

export interface ApplyCutsOptions {
  /** Nachbarschaftsgroesse fuer die Brueckenzeit-Berechnung (Default 10). */
  interpN?: number;
}

/** Edge-Cuts (beruehren Anfang oder Ende) zwingend auf "trim" setzen. */
function forceEdgeTrim(specs: CutSpec[], n: number): CutSpec[] {
  if (n <= 0) return specs;
  const last = n - 1;
  return specs.map((s) =>
    (s.start <= 0 || s.end >= last) && s.mode !== "trim"
      ? { ...s, mode: "trim" as const }
      : s,
  );
}

/** Mittlere Geschwindigkeit der n Punkte links und rechts des Cuts. */
function avgSpeedKmhAround(
  speed: (number | null)[],
  lo: number,
  hi: number,
  n: number,
): number {
  const around: number[] = [];
  for (let i = Math.max(0, lo - n); i < lo; i++) {
    const v = speed[i];
    if (v !== null && Number.isFinite(v)) around.push(v);
  }
  for (let i = hi + 1; i < Math.min(speed.length, hi + 1 + n); i++) {
    const v = speed[i];
    if (v !== null && Number.isFinite(v)) around.push(v);
  }
  if (around.length > 0) {
    return around.reduce((a, b) => a + b, 0) / around.length;
  }
  const all = speed.filter((v): v is number => v !== null && Number.isFinite(v));
  if (all.length > 0) {
    const sorted = all.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return 50;
}

function minMax(arr: number[]): { min: number; max: number } {
  let min = arr[0];
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return { min, max };
}

function buildDerivation(
  counts: { trim: number; gap: number; synthetic: number },
  nBefore: number,
  nAfter: number,
  totalShiftS: number,
): Derivation | null {
  const total = counts.trim + counts.gap + counts.synthetic;
  if (total === 0) return null;
  const base = {
    n_cuts: total,
    n_trim_cuts: counts.trim,
    n_gap_cuts: counts.gap,
    n_synthetic_cuts: counts.synthetic,
    n_points_before: nBefore,
    n_points_after: nAfter,
    n_points_removed: nBefore - nAfter,
  };
  if (counts.synthetic > 0) {
    return {
      ...base,
      type: "synthetic",
      severity: "warn",
      total_time_shift_s: Math.round(totalShiftS * 10) / 10,
      message:
        "Zeitstempel wurden verschoben, um Pausen auszublenden. Die Satelliten" +
        "konstellation ab dem Schnitt entspricht nicht mehr der Realität.",
    };
  }
  if (counts.gap > 0) {
    return {
      ...base,
      type: "gap",
      severity: "info",
      message:
        "Im Track sind Lücken (entfernte Punkte). Die Geschwindigkeit in der " +
        "Lücke ist nicht aussagekräftig.",
    };
  }
  return null; // nur trim → kein Banner
}

/**
 * Wendet Cut-Spezifikationen auf einen Track (und optionale Satellitendaten)
 * an. Liefert einen neuen Track, neu ausgerichtete Satellitendaten und ein
 * Derivation-Banner. Der Originaltrack bleibt unveraendert.
 */
export function applyCuts(
  track: TrackData,
  satellites: SatelliteData | null,
  specs: CutSpec[],
  opts: ApplyCutsOptions = {},
): CutResult {
  const interpN = opts.interpN ?? 10;
  const p = track.points;
  const n = p.lat.length;
  if (n === 0 || specs.length === 0) {
    return { track, satellites, derivation: null };
  }

  // Normalisieren: Edge-Trim erzwingen, clampen, nach Start sortieren.
  const norm = forceEdgeTrim(specs, n)
    .map((s) => ({
      start: Math.max(0, Math.min(n - 1, s.start)),
      end: Math.max(0, Math.min(n - 1, s.end)),
      mode: s.mode,
    }))
    .filter((s) => s.start <= s.end)
    .sort((a, b) => a.start - b.start);

  const keep = new Array<boolean>(n).fill(true);
  const shiftAfterS = new Array<number>(n).fill(0);
  const isSynth = new Array<boolean>(n).fill(false);
  const counts = { trim: 0, gap: 0, synthetic: 0 };
  let totalShift = 0;

  for (const spec of norm) {
    const { start: lo, end: hi } = spec;
    for (let i = lo; i <= hi; i++) keep[i] = false;
    counts[spec.mode]++;

    if (spec.mode !== "synthetic") continue;
    if (lo === 0 || hi === n - 1) continue; // Edge: nichts zu ueberbruecken

    const pauseS = (p.timestamp_ms[hi + 1] - p.timestamp_ms[lo - 1]) / 1000;
    const bridgeM = geodesicDistanceMeters(
      p.lat[lo - 1],
      p.lon[lo - 1],
      p.lat[hi + 1],
      p.lon[hi + 1],
    );
    const avgKmh = avgSpeedKmhAround(p.speed_kmh, lo, hi, interpN);
    const avgMs = Math.max(avgKmh / 3.6, 0.1);
    const bridgeS = bridgeM / avgMs;
    const shiftS = pauseS - bridgeS;
    totalShift += shiftS;
    for (let i = hi + 1; i < n; i++) {
      shiftAfterS[i] += shiftS;
      isSynth[i] = true;
    }
  }

  // Gefilterte/-verschobene Punkt-Arrays bauen.
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);

  const pick = <T>(arr: T[]): T[] => idx.map((i) => arr[i]);
  const lat = pick(p.lat);
  const lon = pick(p.lon);
  const alt = pick(p.alt);
  const speed = pick(p.speed_kmh);
  const timestampMs = idx.map((i) => p.timestamp_ms[i] - Math.round(shiftAfterS[i] * 1000));

  const speedQ = computeQuantileBreaks(speed, DEFAULT_QUANTILES);
  const altQ = computeQuantileBreaks(alt, DEFAULT_QUANTILES);

  const newPoints: TrackPoints = {
    lat,
    lon,
    alt,
    terrain_elev: pick(p.terrain_elev),
    above_terrain: pick(p.above_terrain),
    speed_kmh: speed,
    distance_m: pick(p.distance_m),
    timestamp_ms: timestampMs,
    speed_q_idx: speedQ.qIdx,
    alt_q_idx: altQ.qIdx,
    is_synthetic: idx.map((i) => isSynth[i]),
  };

  const m = idx.length;
  let totalDistance = 0;
  for (const d of newPoints.distance_m) {
    if (d !== null && Number.isFinite(d)) totalDistance += d;
  }
  const bounds =
    m === 0
      ? { lon_min: 0, lat_min: 0, lon_max: 0, lat_max: 0 }
      : (() => {
          const lo2 = minMax(lon);
          const la2 = minMax(lat);
          return {
            lon_min: lo2.min,
            lat_min: la2.min,
            lon_max: lo2.max,
            lat_max: la2.max,
          };
        })();
  const durationS = m >= 2 ? (timestampMs[m - 1] - timestampMs[0]) / 1000 : 0;

  const newTrack: TrackData = {
    meta: {
      ...track.meta,
      n_points: m,
      total_distance_m: Math.round(totalDistance * 10) / 10,
      duration_s: Math.round(durationS * 10) / 10,
      timestamp_start_utc: m > 0 ? new Date(timestampMs[0]).toISOString() : null,
      timestamp_end_utc: m > 0 ? new Date(timestampMs[m - 1]).toISOString() : null,
      bounds,
    },
    quantile_breaks: {
      speed_kmh: speedQ.breaks,
      altitude_m: altQ.breaks,
      n_quantiles: DEFAULT_QUANTILES,
    },
    points: newPoints,
  };

  // Satelliten neu ausrichten: pro Talker den Burst-Index der behaltenen
  // Punkte auf die neuen Indizes uebertragen (Bursts selbst unveraendert).
  let newSatellites: SatelliteData | null = null;
  if (satellites) {
    const burstIdx: Record<string, number[]> = {};
    for (const talker of satellites.talkers) {
      const old = satellites.burst_idx_by_track[talker] ?? [];
      burstIdx[talker] = idx.map((i) => old[i] ?? -1);
    }
    newSatellites = {
      talkers: satellites.talkers,
      bursts_by_talker: satellites.bursts_by_talker,
      burst_idx_by_track: burstIdx,
    };
  }

  const derivation = buildDerivation(counts, n, m, totalShift);
  return { track: newTrack, satellites: newSatellites, derivation };
}
