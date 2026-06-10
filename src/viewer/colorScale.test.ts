import { describe, expect, it } from "vitest";

import type { TrackData } from "../types";
import { enrichKinematics } from "../pipeline/processing/kinematics";
import { computeQuantileBreaks } from "../pipeline/processing/quantiles";
import { combinedBreaks, colorScaleFor } from "./colorScale";

// Minimaler TrackData-Bau: nur die fuer die Faerbung relevanten Felder
// (speed_kmh + zugehoerige Quantilgrenzen) tragen Daten; der Rest ist neutral.
function track(speed: (number | null)[]): TrackData {
  const n = speed.length;
  const zeros = new Array<number>(n).fill(0);
  const breaks = computeQuantileBreaks(speed).breaks;
  return {
    meta: {
      name: "t",
      source_type: "gpx",
      n_points: n,
      total_distance_m: 0,
      duration_s: 0,
      timestamp_start_utc: null,
      timestamp_end_utc: null,
      bounds: { lon_min: 0, lat_min: 0, lon_max: 1, lat_max: 1 },
      track_mode: "ground",
      has_terrain: false,
      has_satellites: false,
    },
    quantile_breaks: { speed_kmh: breaks, altitude_m: breaks, n_quantiles: 5 },
    points: {
      lat: zeros,
      lon: zeros,
      alt: zeros,
      terrain_elev: zeros,
      above_terrain: zeros,
      speed_kmh: speed,
      distance_m: zeros,
      timestamp_ms: zeros,
      speed_q_idx: zeros,
      alt_q_idx: zeros,
      ...enrichKinematics({ alt: zeros, speed_kmh: speed, timestamp_ms: zeros }),
    },
  };
}

describe("combinedBreaks", () => {
  it("liefert bei genau einem Track die Einzelskala", () => {
    const a = track([10, 20, 30, 40, 50]);
    expect(combinedBreaks([a], "speed")).toEqual(colorScaleFor(a, "speed").breaks);
  });

  it("spannt ueber beide Tracks (gemeinsame Min/Max)", () => {
    // A langsam, B schnell und disjunkt → kombinierte Grenzen ueberspannen beide.
    const a = track([0, 10, 20, 30, 40]);
    const b = track([100, 110, 120, 130, 140]);
    const breaks = combinedBreaks([a, b], "speed");
    expect(breaks[0]).toBe(0); // Minimum aus A
    expect(breaks[breaks.length - 1]).toBe(140); // Maximum aus B
  });

  it("ist gleich den Grenzen ueber die konkatenierten Werte", () => {
    const a = track([5, 15, 25]);
    const b = track([35, 45, 55]);
    const expected = computeQuantileBreaks([5, 15, 25, 35, 45, 55]).breaks;
    expect(combinedBreaks([a, b], "speed")).toEqual(expected);
  });
});
