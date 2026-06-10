import { describe, expect, it } from "vitest";

import {
  computeAcceleration3D,
  computeEnergyRate,
  decomposeAcceleration,
  energyHeight,
  robustSymmetricScale,
  speed3D,
  type AccelDecomp,
  type GeoKinematicPoints,
  type KinematicPoints,
} from "./kinematics";

const G = 9.80665;
const M_PER_DEG = 111320;

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

describe("decomposeAcceleration", () => {
  // Baut Punkte am Aequator (cos(lat0)=1 → 1° ≈ M_PER_DEG m in beide Richtungen),
  // sodass east=lon*M, north=lat*M. dt = 1 s.
  function geo(
    xy: [number, number][], // (Ost, Nord) in Metern
    alt: (number | null)[],
  ): GeoKinematicPoints {
    return {
      lon: xy.map(([e]) => e / M_PER_DEG),
      lat: xy.map(([, nth]) => nth / M_PER_DEG),
      alt,
      timestamp_ms: xy.map((_p, i) => 1_000_000 + i * 1000),
    };
  }

  it("liefert ~0 bei gleichfoermiger Geradeausfahrt", () => {
    const xy: [number, number][] = Array.from({ length: 9 }, (_v, k) => [10 * k, 0]);
    const d = decomposeAcceleration(geo(xy, xy.map(() => 100)))[4]!;
    expect(d).not.toBeNull();
    expect(Math.abs(d.long)).toBeLessThan(0.02);
    expect(Math.abs(d.lateral)).toBeLessThan(0.02);
    expect(Math.abs(d.vertical)).toBeLessThan(0.02);
  });

  it("misst die Querbeschleunigung v²/r einer Linkskurve (+ = links)", () => {
    const r = 100;
    const omega = 0.05; // rad/s → v = omega*r = 5 m/s, a_zentripetal = v²/r = 0.25
    const xy: [number, number][] = Array.from({ length: 60 }, (_v, k) => {
      const th = omega * k; // CCW → Linkskurve
      return [r * Math.cos(th), r * Math.sin(th)];
    });
    const d = decomposeAcceleration(geo(xy, xy.map(() => 100)))[30]!;
    expect(d).not.toBeNull();
    expect(d.lateral).toBeCloseTo(0.25, 2); // + = links (CCW)
    expect(Math.abs(d.long)).toBeLessThan(0.02);
    expect(Math.abs(d.vertical)).toBeLessThan(0.02);
  });

  it("dreht das Vorzeichen der Querbeschleunigung bei Rechtskurve", () => {
    const r = 100;
    const omega = 0.05;
    const xy: [number, number][] = Array.from({ length: 60 }, (_v, k) => {
      const th = -omega * k; // CW → Rechtskurve
      return [r * Math.cos(th), r * Math.sin(th)];
    });
    const d = decomposeAcceleration(geo(xy, xy.map(() => 100)))[30]!;
    expect(d.lateral).toBeCloseTo(-0.25, 2);
  });

  it("misst Laengsbeschleunigung beim Beschleunigen geradeaus", () => {
    // x = 0.5*a*t², a = 2 m/s² → mittiger Punkt long ≈ 2.
    const xy: [number, number][] = Array.from({ length: 9 }, (_v, k) => [k * k, 0]);
    const d = decomposeAcceleration(geo(xy, xy.map(() => 100)))[4]!;
    expect(d.long).toBeCloseTo(2, 5);
    expect(Math.abs(d.lateral)).toBeLessThan(0.02);
  });

  it("misst Vertikalbeschleunigung bei konstanter Horizontalfahrt", () => {
    // Ost mit 10 m/s konstant; alt = 0.5*3*t² → vertikal ≈ 3, long ≈ 0.
    const xy: [number, number][] = Array.from({ length: 9 }, (_v, k) => [10 * k, 0]);
    const alt = xy.map((_p, k) => 1.5 * k * k);
    const d = decomposeAcceleration(geo(xy, alt))[4]!;
    expect(d.vertical).toBeCloseTo(3, 5);
    expect(Math.abs(d.long)).toBeLessThan(0.02);
    expect(Math.abs(d.lateral)).toBeLessThan(0.02);
  });

  it("liefert null bei Stillstand (Richtung unbestimmt)", () => {
    const xy: [number, number][] = Array.from({ length: 5 }, () => [0, 0]);
    const d = decomposeAcceleration(geo(xy, xy.map(() => 100)));
    expect(d[2]).toBeNull();
  });

  it("daempft mit smooth den Querbeschleunigungs-Spike eines Ausreissers", () => {
    // Geradeausfahrt nach Osten mit 10 m/s; Punkt 4 ist um 1 m nach Nord
    // versetzt → erzeugt einen scharfen Quer-Spike (doppelte Differenz).
    const xy: [number, number][] = Array.from({ length: 9 }, (_v, k) => [
      10 * k,
      k === 4 ? 1 : 0,
    ]);
    const pts = geo(xy, xy.map(() => 100));
    const peak = (ds: (AccelDecomp | null)[]) =>
      Math.max(...ds.map((d) => (d ? Math.abs(d.lateral) : 0)));
    const raw = peak(decomposeAcceleration(pts));
    const smoothed3 = peak(decomposeAcceleration(pts, { smoothWindow: 3 }));
    const smoothed5 = peak(decomposeAcceleration(pts, { smoothWindow: 5 }));
    expect(smoothed3).toBeLessThan(raw); // 3-Punkt-Mittel senkt die Spitze
    expect(smoothed5).toBeLessThan(smoothed3); // groesseres Fenster senkt sie weiter
  });

  it("laesst gleichmaessige Beschleunigung unveraendert (Konstante bleibt konstant)", () => {
    // x = t² → a = 2 m/s² ueberall; ein gleitendes Mittel einer Konstanten
    // gibt dieselbe Konstante zurueck.
    const xy: [number, number][] = Array.from({ length: 9 }, (_v, k) => [k * k, 0]);
    const d = decomposeAcceleration(geo(xy, xy.map(() => 100)), { smoothWindow: 3 })[4]!;
    expect(d.long).toBeCloseTo(2, 5);
    expect(Math.abs(d.lateral)).toBeLessThan(0.02);
  });
});
