import { describe, expect, it } from "vitest";

import { computeQuantileBreaks } from "./quantiles";

describe("computeQuantileBreaks", () => {
  it("bildet gleich besetzte Klassengrenzen fuer 1..10 bei n=5", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { breaks } = computeQuantileBreaks(values, 5);
    expect(breaks).toEqual([1, 2.8, 4.6, 6.4, 8.2, 10]);
  });

  it("gibt n+1 Klassengrenzen zurueck", () => {
    const { breaks } = computeQuantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(breaks).toHaveLength(6);
  });

  it("ignoriert fehlende Werte bei der Grenzberechnung", () => {
    const { breaks } = computeQuantileBreaks([1, null, 5, null, 10], 5);
    expect(breaks[0]).toBe(1);
    expect(breaks[5]).toBe(10);
  });

  it("entartet bei nur einem eindeutigen Wert: Grenzen alle 0", () => {
    const { breaks } = computeQuantileBreaks([7, 7, 7], 5);
    expect(breaks).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("entartet bei ausschliesslich fehlenden Werten", () => {
    const { breaks } = computeQuantileBreaks([null, null], 5);
    expect(breaks).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
