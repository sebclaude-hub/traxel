import { describe, expect, it } from "vitest";

import type { ChartCorners } from "../viewer/chartPlacement";
import type { TrackBounds } from "../types";
import { bboxIntersects, cornersToBounds } from "./spatial";

const bb = (lon_min: number, lat_min: number, lon_max: number, lat_max: number): TrackBounds => ({
  lon_min,
  lat_min,
  lon_max,
  lat_max,
});

describe("bboxIntersects", () => {
  it("erkennt klare Ueberlappung", () => {
    expect(bboxIntersects(bb(0, 0, 2, 2), bb(1, 1, 3, 3))).toBe(true);
  });

  it("erkennt vollstaendige Enthaltung (eine in der anderen)", () => {
    expect(bboxIntersects(bb(0, 0, 10, 10), bb(4, 4, 5, 5))).toBe(true);
  });

  it("zaehlt Kantenberuehrung als Ueberlappung", () => {
    expect(bboxIntersects(bb(0, 0, 2, 2), bb(2, 0, 4, 2))).toBe(true);
  });

  it("ist disjunkt in Laenge", () => {
    expect(bboxIntersects(bb(0, 0, 2, 2), bb(3, 0, 5, 2))).toBe(false);
  });

  it("ist disjunkt in Breite", () => {
    expect(bboxIntersects(bb(0, 0, 2, 2), bb(0, 3, 2, 5))).toBe(false);
  });
});

describe("cornersToBounds", () => {
  it("bildet die Huelle ueber eine achsenparallele Karte", () => {
    const c: ChartCorners = {
      corner_tl: [1, 4],
      corner_tr: [3, 4],
      corner_bl: [1, 2],
      corner_br: [3, 2],
    };
    expect(cornersToBounds(c)).toEqual(bb(1, 2, 3, 4));
  });

  it("bildet die Huelle ueber eine gedrehte Karte (Raute)", () => {
    // 45°-Raute zentriert bei (5,5): Ecken auf den Achsen.
    const c: ChartCorners = {
      corner_tl: [5, 7],
      corner_tr: [7, 5],
      corner_bl: [3, 5],
      corner_br: [5, 3],
    };
    expect(cornersToBounds(c)).toEqual(bb(3, 3, 7, 7));
  });
});
