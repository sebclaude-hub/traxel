import { describe, expect, it } from "vitest";

import {
  computeAcceleration3D,
  computeEnergyRate,
  energyHeight,
  robustSymmetricScale,
  speed3D,
  type KinematicPoints,
} from "./kinematics";

const G = 9.80665;

// Hilfsbau: gleichmaessige 1-Sekunden-Schritte ab t0.
function pts(
  speed_kmh: (number | null)[],
  alt: (number | null)[],
  stepMs = 1000,
): KinematicPoints {
  return {
    speed_kmh,
    alt,
    timestamp_ms: speed_kmh.map((_v, i) => 1_000_000 + i * stepMs),
  };
}

describe("speed3D", () => {
  it("ist die Horizontalgeschwindigkeit, wenn die Hoehe konstant ist", () => {
    // 36 km/h = 10 m/s, flach → v3D = 10.
    const v = speed3D(pts([36, 36, 36], [100, 100, 100]));
    for (const s of v) expect(s).toBeCloseTo(10, 6);
  });

  it("ist die Steigrate bei reinem Steigflug (v_h = 0)", () => {
    // 0 horizontal, +5 m pro Sekunde → v_z = 5 → v3D = 5.
    const v = speed3D(pts([0, 0, 0], [0, 5, 10]));
    expect(v[1]).toBeCloseTo(5, 6); // zentrale Differenz in der Mitte
  });

  it("kombiniert horizontal und vertikal pythagoreisch", () => {
    // v_h = 10 (36 km/h), v_z = 7.5 (zentrale Differenz (15-0)/2) → 12.5.
    const v = speed3D(pts([36, 36, 36], [0, 7.5, 15]));
    expect(v[1]).toBeCloseTo(Math.hypot(10, 7.5), 6);
  });

  it("liefert null, wo keine Horizontalgeschwindigkeit vorliegt", () => {
    const v = speed3D(pts([null, 36], [0, 0]));
    expect(v[0]).toBeNull();
    expect(v[1]).toBeCloseTo(10, 6);
  });
});

describe("computeAcceleration3D", () => {
  it("ist ~0 bei konstanter Geschwindigkeit", () => {
    const a = computeAcceleration3D(pts([36, 36, 36, 36], [0, 0, 0, 0]));
    for (const x of a) expect(x ?? 0).toBeCloseTo(0, 6);
  });

  it("ist konstant positiv bei linearem Tempo-Anstieg", () => {
    // 0,10,20,30 m/s in 1-s-Schritten → a = +10 m/s² ueberall.
    const a = computeAcceleration3D(pts([0, 36, 72, 108], [0, 0, 0, 0]));
    for (const x of a) expect(x).toBeCloseTo(10, 6);
  });

  it("ist negativ beim Abbremsen (das gesuchte Brems-Signal)", () => {
    // 30 → 10 m/s → negative Beschleunigung.
    const a = computeAcceleration3D(pts([108, 72, 36], [0, 0, 0]));
    expect(a[1]).toBeLessThan(0);
  });

  it("liefert null bei Duplikat-Zeitstempeln (dt<=0)", () => {
    const p: KinematicPoints = {
      speed_kmh: [36, 72, 108],
      alt: [0, 0, 0],
      timestamp_ms: [1000, 1000, 1000], // dt = 0
    };
    for (const x of computeAcceleration3D(p)) expect(x).toBeNull();
  });

  it("behandelt die Endpunkte einseitig (kein null an den Raendern)", () => {
    const a = computeAcceleration3D(pts([0, 36, 72], [0, 0, 0]));
    expect(a[0]).not.toBeNull(); // vorwaerts
    expect(a[2]).not.toBeNull(); // rueckwaerts
  });
});

describe("robustSymmetricScale", () => {
  it("nimmt Betraege und ein hohes Perzentil", () => {
    const vals = [-1, -2, 3, -4, 5, null, 100]; // 100 ist Ausreisser
    const s = robustSymmetricScale(vals, 0.9);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100); // Ausreisser dominiert nicht das 90-Perzentil
  });

  it("faellt bei leerer Eingabe auf 1 zurueck", () => {
    expect(robustSymmetricScale([null, null])).toBe(1);
  });
});

describe("energyHeight", () => {
  it("ist H = h + v3D²/(2g)", () => {
    // 36 km/h = 10 m/s, flach (v_z=0), h=100 → H = 100 + 100/(2g).
    const H = energyHeight(pts([36, 36, 36], [100, 100, 100]));
    const expected = 100 + (10 * 10) / (2 * G);
    for (const h of H) expect(h).toBeCloseTo(expected, 4);
  });

  it("liefert null ohne Geschwindigkeit", () => {
    expect(energyHeight(pts([null, 36], [100, 100]))[0]).toBeNull();
  });
});

describe("computeEnergyRate", () => {
  it("ist ~0 bei konstanter Energie (Tempo + Hoehe konstant)", () => {
    const r = computeEnergyRate(pts([36, 36, 36, 36], [100, 100, 100, 100]));
    for (const x of r) expect(x ?? 0).toBeCloseTo(0, 6);
  });

  it("ist positiv, wenn bei gleicher Hoehe beschleunigt wird (Energiegewinn)", () => {
    const r = computeEnergyRate(pts([0, 36, 72, 108], [100, 100, 100, 100]));
    expect(r[1]).toBeGreaterThan(0);
  });
});
