import { describe, expect, it } from "vitest";

import {
  distributeTicks,
  quantileLinearPosition,
  quantileLinearPositions,
} from "./colorMap";

// k = 5 Quantile, gleichmaessige Grenzen.
const B = [0, 20, 40, 60, 80, 100];

describe("quantileLinearPosition", () => {
  it("klemmt unter/ueber den Grenzen auf 0 bzw. 1", () => {
    expect(quantileLinearPosition(-5, B)).toBe(0);
    expect(quantileLinearPosition(0, B)).toBe(0);
    expect(quantileLinearPosition(100, B)).toBe(1);
    expect(quantileLinearPosition(150, B)).toBe(1);
  });

  it("Mitte eines Quantils liegt in der Mitte seines Farb-Abschnitts", () => {
    // v=50 → Q3 (40..60), Mitte → (2 + 0.5)/5 = 0.5
    expect(quantileLinearPosition(50, B)).toBeCloseTo(0.5, 6);
    // v=10 → Q1 (0..20), Mitte → (0 + 0.5)/5 = 0.1
    expect(quantileLinearPosition(10, B)).toBeCloseTo(0.1, 6);
  });

  it("verteilt innerhalb eines Quantils LINEAR nach Wert", () => {
    // Q3 = 40..60 → Abschnitt [0.4, 0.6]
    expect(quantileLinearPosition(40, B)).toBeCloseTo(0.4, 6);
    expect(quantileLinearPosition(45, B)).toBeCloseTo(0.45, 6);
    expect(quantileLinearPosition(55, B)).toBeCloseTo(0.55, 6);
  });

  it("entzerrt einen schmalen Cluster ueber einen ganzen Abschnitt", () => {
    // Drei fast gleiche Werte in Q3 → trotzdem ueber [0.4,0.6] gespreizt.
    const lo = quantileLinearPosition(40.1, B);
    const hi = quantileLinearPosition(59.9, B);
    expect(hi - lo).toBeGreaterThan(0.19); // fast die vollen 0.2 des Abschnitts
  });

  it("behandelt degenerierte (doppelte) Grenzen ohne NaN", () => {
    const deg = [0, 10, 10, 20, 30, 40]; // Bin 1 ist entartet
    const p = quantileLinearPosition(10, deg);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe("quantileLinearPositions", () => {
  it("liefert NaN fuer null/NaN, sonst die Position", () => {
    const out = quantileLinearPositions([10, null, 50, NaN], B);
    expect(out[0]).toBeCloseTo(0.1, 6);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBeCloseTo(0.5, 6);
    expect(Number.isNaN(out[3])).toBe(true);
  });
});

describe("distributeTicks", () => {
  it("verteilt gleichmaessige Grenzen ~proportional (Endpunkte 0 und 1)", () => {
    const pos = distributeTicks([0, 1, 2, 3, 4, 5], 0.1);
    expect(pos[0]).toBeCloseTo(0, 6);
    expect(pos[pos.length - 1]).toBeCloseTo(1, 6);
    expect(pos[2]).toBeCloseTo(0.4, 2);
  });

  it("erzwingt Mindestabstand bei gedraengten Grenzen", () => {
    // 1.0/1.1/1.2/1.3 liegen eng beieinander, 10 weit weg.
    const pos = distributeTicks([0, 1, 1.1, 1.2, 1.3, 10], 0.1);
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i] - pos[i - 1]).toBeGreaterThan(0.09); // >= ~minGap
    }
    expect(pos[0]).toBeCloseTo(0, 6);
    expect(pos[pos.length - 1]).toBeCloseTo(1, 6);
  });

  it("faellt bei Nullspanne auf gleichmaessige Positionen zurueck", () => {
    const pos = distributeTicks([5, 5, 5, 5], 0.1);
    expect(pos[0]).toBeCloseTo(0, 6);
    expect(pos[3]).toBeCloseTo(1, 6);
  });
});
