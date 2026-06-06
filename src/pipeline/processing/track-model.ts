// ---------------------------------------------------------------------------
// Schema C (EnrichedTrackPoint[]) → Viewer-Modell (TrackData).
//
// In-Memory-Aequivalent von export_track_json aus der Python-Pipeline: baut
// die spaltenorientierten Punkt-Arrays, Meta-Daten und Quantil-Grenzen.
//
// Terrain-, Satelliten- und Synthetic-Cut-Felder werden hier noch nicht
// gefuellt (spaetere Phasen): terrain_elev/above_terrain bleiben null,
// has_terrain/has_satellites false, track_mode "ground".
// ---------------------------------------------------------------------------

import type {
  TrackBounds,
  TrackData,
  TrackMeta,
  TrackPoints,
} from "../../types";
import { DEFAULT_QUANTILES } from "../constants";
import type { EnrichedTrackPoint } from "../types";
import { computeQuantileBreaks } from "./quantiles";

export interface BuildTrackDataOptions {
  name: string;
  sourceType: "nmea" | "gpx" | "kml" | "igc";
  nQuantiles?: number;
}

function roundN(v: number | null, decimals: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

const EMPTY_BOUNDS: TrackBounds = {
  lon_min: 0,
  lat_min: 0,
  lon_max: 0,
  lat_max: 0,
};

/** Min/Max per Schleife — `Math.min(...arr)` sprengt bei langen Tracks den Stack. */
function minMax(arr: number[]): { min: number; max: number } {
  let min = arr[0];
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return { min, max };
}

export function buildTrackData(
  points: EnrichedTrackPoint[],
  opts: BuildTrackDataOptions,
): TrackData {
  const nQuantiles = opts.nQuantiles ?? DEFAULT_QUANTILES;
  const n = points.length;

  const lat = points.map((p) => roundN(p.lat, 7) as number);
  const lon = points.map((p) => roundN(p.lon, 7) as number);
  const alt = points.map((p) => roundN(p.altM, 1));
  const speed = points.map((p) => roundN(p.speedKmh, 2));
  const distance = points.map((p) => roundN(p.distanceM, 1));
  const timestampMs = points.map((p) => p.timestampMs);

  const speedQ = computeQuantileBreaks(speed, nQuantiles);
  const altQ = computeQuantileBreaks(alt, nQuantiles);

  const trackPoints: TrackPoints = {
    lat,
    lon,
    alt,
    terrain_elev: points.map(() => null),
    above_terrain: points.map(() => null),
    speed_kmh: speed,
    distance_m: distance,
    timestamp_ms: timestampMs,
    speed_q_idx: speedQ.qIdx,
    alt_q_idx: altQ.qIdx,
  };

  // Meta
  let totalDistance = 0;
  for (const p of points) {
    if (p.distanceM !== null && Number.isFinite(p.distanceM)) {
      totalDistance += p.distanceM;
    }
  }

  const durationS =
    n >= 2 ? (timestampMs[n - 1] - timestampMs[0]) / 1000 : 0;

  let bounds: TrackBounds;
  if (n === 0) {
    bounds = { ...EMPTY_BOUNDS };
  } else {
    const lonMM = minMax(lon);
    const latMM = minMax(lat);
    bounds = {
      lon_min: roundN(lonMM.min, 6) as number,
      lat_min: roundN(latMM.min, 6) as number,
      lon_max: roundN(lonMM.max, 6) as number,
      lat_max: roundN(latMM.max, 6) as number,
    };
  }

  const meta: TrackMeta = {
    name: opts.name,
    source_type: opts.sourceType,
    n_points: n,
    total_distance_m: roundN(totalDistance, 1) ?? 0,
    duration_s: roundN(durationS, 1) ?? 0,
    timestamp_start_utc:
      n > 0 ? new Date(timestampMs[0]).toISOString() : null,
    timestamp_end_utc:
      n > 0 ? new Date(timestampMs[n - 1]).toISOString() : null,
    bounds,
    track_mode: "ground", // ohne Terrain immer "ground"
    has_terrain: false,
    has_satellites: false,
  };

  return {
    meta,
    quantile_breaks: {
      speed_kmh: speedQ.breaks,
      altitude_m: altQ.breaks,
      n_quantiles: nQuantiles,
    },
    points: trackPoints,
  };
}
