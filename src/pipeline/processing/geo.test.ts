import { describe, expect, it } from "vitest";

import { geodesicDistanceMeters } from "./geo";

// Synthetische, klar fiktive Koordinaten (Aequator/Nullmeridian).
describe("geodesicDistanceMeters", () => {
  it("liefert 0 fuer identische Punkte", () => {
    expect(geodesicDistanceMeters(0, 0, 0, 0)).toBe(0);
    expect(geodesicDistanceMeters(12.5, -7.25, 12.5, -7.25)).toBe(0);
  });

  it("misst 1 Grad Laenge am Aequator (~111319 m, WGS84)", () => {
    const d = geodesicDistanceMeters(0, 0, 0, 1);
    expect(d).toBeCloseTo(111319.49, 0); // ±0.5 m
  });

  it("misst 1 Grad Breite am Aequator (~110574 m, WGS84)", () => {
    const d = geodesicDistanceMeters(0, 0, 1, 0);
    expect(d).toBeCloseTo(110574.39, 0);
  });

  it("ist symmetrisch", () => {
    const ab = geodesicDistanceMeters(10, 20, 11, 21);
    const ba = geodesicDistanceMeters(11, 21, 10, 20);
    expect(ab).toBeCloseTo(ba, 6);
  });
});
