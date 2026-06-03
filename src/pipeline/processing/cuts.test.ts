import { describe, expect, it } from "vitest";

import type { SatelliteData, TrackData } from "../../types";
import { applyCuts } from "./cuts";

/** Baut einen Track aus Punkt-Tupeln (ts in s, lon in Grad, speed km/h). */
function makeTrack(
  pts: { tsS: number; lon: number; speedKmh: number }[],
): TrackData {
  const n = pts.length;
  return {
    meta: {
      name: "t",
      source_type: "nmea",
      n_points: n,
      total_distance_m: 0,
      duration_s: 0,
      timestamp_start_utc: null,
      timestamp_end_utc: null,
      bounds: { lon_min: 0, lat_min: 0, lon_max: 0, lat_max: 0 },
      track_mode: "ground",
      has_terrain: false,
      has_satellites: false,
    },
    quantile_breaks: { speed_kmh: [], altitude_m: [], n_quantiles: 5 },
    points: {
      lat: pts.map(() => 0),
      lon: pts.map((p) => p.lon),
      alt: pts.map(() => 100),
      terrain_elev: pts.map(() => null),
      above_terrain: pts.map(() => null),
      speed_kmh: pts.map((p) => p.speedKmh),
      distance_m: pts.map(() => 100),
      timestamp_ms: pts.map((p) => p.tsS * 1000),
      speed_q_idx: pts.map(() => -1),
      alt_q_idx: pts.map(() => -1),
    },
  };
}

// 6 Punkte, 10 s Abstand, konstant 40 km/h.
function sample(): TrackData {
  return makeTrack([
    { tsS: 0, lon: 0.0, speedKmh: 40 },
    { tsS: 10, lon: 0.001, speedKmh: 40 },
    { tsS: 20, lon: 0.0015, speedKmh: 40 },
    { tsS: 30, lon: 0.0018, speedKmh: 40 },
    { tsS: 40, lon: 0.002, speedKmh: 40 },
    { tsS: 50, lon: 0.003, speedKmh: 40 },
  ]);
}

describe("applyCuts", () => {
  it("trim entfernt Punkte ohne Zeitverschiebung, kein Banner", () => {
    const res = applyCuts(sample(), null, [{ start: 0, end: 1, mode: "trim" }]);
    expect(res.track.meta.n_points).toBe(4);
    // verbleibende Zeitstempel unveraendert (20,30,40,50 s)
    expect(res.track.points.timestamp_ms).toEqual([20000, 30000, 40000, 50000]);
    expect(res.derivation).toBeNull();
  });

  it("gap entfernt Punkte, behaelt Zeitstempel, Info-Banner", () => {
    const res = applyCuts(sample(), null, [{ start: 2, end: 3, mode: "gap" }]);
    expect(res.track.meta.n_points).toBe(4);
    expect(res.track.points.timestamp_ms).toEqual([0, 10000, 40000, 50000]);
    expect(res.track.points.is_synthetic).toEqual([false, false, false, false]);
    expect(res.derivation?.type).toBe("gap");
    expect(res.derivation?.severity).toBe("info");
  });

  it("synthetic verschiebt nachfolgende Zeitstempel und markiert is_synthetic", () => {
    const res = applyCuts(sample(), null, [{ start: 2, end: 3, mode: "synthetic" }]);
    expect(res.track.meta.n_points).toBe(4);
    const ts = res.track.points.timestamp_ms;
    // Punkte 0,1 unveraendert; 4,5 nach vorne geschoben (Pause 30s − Brueckenzeit ~10s ≈ 20s).
    expect(ts[0]).toBe(0);
    expect(ts[1]).toBe(10000);
    expect(ts[2]).toBeGreaterThan(18000);
    expect(ts[2]).toBeLessThan(22000);
    // Abstand zwischen den verschobenen Punkten bleibt 10 s.
    expect(ts[3] - ts[2]).toBe(10000);
    expect(res.track.points.is_synthetic).toEqual([false, false, true, true]);
    expect(res.derivation?.type).toBe("synthetic");
    expect(res.derivation?.severity).toBe("warn");
    expect(res.derivation?.total_time_shift_s).toBeGreaterThan(15);
    expect(res.derivation?.total_time_shift_s).toBeLessThan(25);
  });

  it("erzwingt trim fuer Edge-Cuts (synthetic am Anfang → trim, kein Banner)", () => {
    const res = applyCuts(sample(), null, [{ start: 0, end: 1, mode: "synthetic" }]);
    expect(res.track.points.timestamp_ms).toEqual([20000, 30000, 40000, 50000]);
    expect(res.derivation).toBeNull();
  });

  it("richtet Satellitendaten auf die neuen Indizes aus", () => {
    const sat: SatelliteData = {
      talkers: ["GP"],
      bursts_by_talker: { GP: [{ ts_ms: 0, sats: [] }, { ts_ms: 1, sats: [] }, { ts_ms: 2, sats: [] }] },
      burst_idx_by_track: { GP: [0, 0, 1, 1, 2, 2] },
    };
    const res = applyCuts(sample(), sat, [{ start: 2, end: 3, mode: "gap" }]);
    // behalten: alte Indizes 0,1,4,5 → Burst-Indizes 0,0,2,2
    expect(res.satellites?.burst_idx_by_track.GP).toEqual([0, 0, 2, 2]);
  });

  it("ist ein No-Op ohne Cuts", () => {
    const t = sample();
    const res = applyCuts(t, null, []);
    expect(res.track).toBe(t);
    expect(res.derivation).toBeNull();
  });
});
