import { describe, expect, it } from "vitest";

import type { RawTrackPoint } from "../types";
import { enrichSpeed } from "./enrich";

function pt(over: Partial<RawTrackPoint> & { timestampMs: number }): RawTrackPoint {
  return {
    lat: 0,
    lon: 0,
    altM: null,
    speedKmh: null,
    speedKnots: null,
    hdop: null,
    ...over,
  };
}

describe("enrichSpeed", () => {
  it("setzt distance/speed des ersten Punktes auf null", () => {
    const out = enrichSpeed([pt({ timestampMs: 0 }), pt({ timestampMs: 1000, lon: 0.01 })]);
    expect(out[0].distanceM).toBeNull();
    expect(out[0].speedGeodesicKmh).toBeNull();
  });

  it("berechnet Distanz und geodaetische Geschwindigkeit", () => {
    // 0.01 Grad Laenge am Aequator ≈ 1113.19 m, in 10 s → ~400.7 km/h
    const out = enrichSpeed([
      pt({ timestampMs: 0, lat: 0, lon: 0 }),
      pt({ timestampMs: 10_000, lat: 0, lon: 0.01 }),
    ]);
    expect(out[1].distanceM).toBeCloseTo(1113.19, 1);
    expect(out[1].speedGeodesicKmh).toBeCloseTo(400.75, 1);
  });

  it("setzt null bei Duplikat-Zeitstempel (dt = 0)", () => {
    const out = enrichSpeed([
      pt({ timestampMs: 5000, lon: 0 }),
      pt({ timestampMs: 5000, lon: 0.01 }),
    ]);
    expect(out[1].distanceM).toBeNull();
    expect(out[1].speedGeodesicKmh).toBeNull();
  });

  it("fuellt fehlende gemeldete Geschwindigkeit aus der Geodaesie auf", () => {
    const out = enrichSpeed([
      pt({ timestampMs: 0, lon: 0 }),
      pt({ timestampMs: 10_000, lon: 0.01 }),
    ]);
    expect(out[1].speedKmh).toBeCloseTo(out[1].speedGeodesicKmh as number, 6);
  });

  it("behaelt vorhandene gemeldete Geschwindigkeit bei", () => {
    const out = enrichSpeed([
      pt({ timestampMs: 0, lon: 0, speedKmh: 50, speedKnots: 27 }),
      pt({ timestampMs: 10_000, lon: 0.01, speedKmh: 60, speedKnots: 32.4 }),
    ]);
    expect(out[0].speedKmh).toBe(50);
    expect(out[1].speedKmh).toBe(60);
  });
});
