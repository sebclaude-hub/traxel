import { describe, expect, it } from "vitest";

import { computeQuantileBreaks } from "./quantiles";

describe("computeQuantileBreaks", () => {
  it("bildet gleich besetzte Klassen fuer 1..10 bei n=5", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { breaks, qIdx } = computeQuantileBreaks(values, 5);
    expect(breaks).toEqual([1, 2.8, 4.6, 6.4, 8.2, 10]);
    expect(qIdx).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("gibt n+1 Klassengrenzen zurueck", () => {
    const { breaks } = computeQuantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(breaks).toHaveLength(6);
  });

  it("vergibt -1 fuer fehlende Werte, ordnet vorhandene korrekt ein", () => {
    const values = [1, null, 5, null, 10];
    const { qIdx } = computeQuantileBreaks(values, 5);
    expect(qIdx[1]).toBe(-1);
    expect(qIdx[3]).toBe(-1);
    expect(qIdx[0]).toBe(0);
    expect(qIdx[4]).toBeGreaterThanOrEqual(0);
  });

  it("entartet bei nur einem eindeutigen Wert: alle Klasse 0, Grenzen 0", () => {
    const { breaks, qIdx } = computeQuantileBreaks([7, 7, 7], 5);
    expect(breaks).toEqual([0, 0, 0, 0, 0, 0]);
    expect(qIdx).toEqual([0, 0, 0]);
  });

  it("entartet bei ausschliesslich fehlenden Werten", () => {
    const { breaks, qIdx } = computeQuantileBreaks([null, null], 5);
    expect(breaks).toEqual([0, 0, 0, 0, 0, 0]);
    expect(qIdx).toEqual([0, 0]);
  });
});
