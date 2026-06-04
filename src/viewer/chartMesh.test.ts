import { describe, expect, it } from "vitest";

import type { DemGrid } from "../types";
import { buildChartMesh, type ChartOverlay } from "./chartMesh";

const FLAT_100: DemGrid = {
  n_rows: 5,
  n_cols: 5,
  lat_min: 0,
  lat_max: 1,
  lon_min: 0,
  lon_max: 1,
  elevations: new Array(25).fill(100),
};

function axisAlignedChart(): ChartOverlay {
  return {
    name: "c",
    corner_tl: [0.2, 0.8],
    corner_tr: [0.8, 0.8],
    corner_bl: [0.2, 0.2],
    corner_br: [0.8, 0.2],
    elevation_m: 0,
  };
}

describe("buildChartMesh", () => {
  it("baut ohne DEM ein bilineares Mesh (Struktur stimmt)", () => {
    const mesh = buildChartMesh(axisAlignedChart(), null, 0, 1);
    const nVerts = mesh.positions.length / 3;
    expect(mesh.texCoords.length).toBe(nVerts * 2);
    expect(mesh.indices.length % 6).toBe(0);
    // Anker = Zentrum der Karte (0.5, 0.5).
    expect(mesh.anchor[0]).toBeCloseTo(0.5, 6);
    expect(mesh.anchor[1]).toBeCloseTo(0.5, 6);
  });

  it("drapt mit DEM (Strategie A): Vertex-Z folgt der Terrain-Hoehe", () => {
    const mesh = buildChartMesh(axisAlignedChart(), FLAT_100, 0, 1);
    // Bei flachem Terrain 100 m und zScale 1 liegt jede Vertex-Z bei ~100.
    for (let i = 2; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeCloseTo(100, 3);
    }
  });

  it("skaliert die Vertex-Z mit der Z-Ueberhoehung", () => {
    const mesh = buildChartMesh(axisAlignedChart(), FLAT_100, 0, 3);
    // altBase 0, zScale 3 → 0 + (100-0)*3 = 300.
    expect(mesh.positions[2]).toBeCloseTo(300, 3);
  });

  it("gedrehte Karte nutzt mit DEM den Terrain-Subgrid (Z = Terrain, UV ueberlaeuft)", () => {
    // Feines flaches DEM (11x11 @ 100 m), damit der Subgrid genug Vertices hat.
    const fine: DemGrid = {
      n_rows: 11,
      n_cols: 11,
      lat_min: 0,
      lat_max: 1,
      lon_min: 0,
      lon_max: 1,
      elevations: new Array(121).fill(100),
    };
    // 45°-Raute (gedrehtes Quadrat) zentriert bei (0.5, 0.5).
    const rotated: ChartOverlay = {
      name: "r",
      corner_tl: [0.5, 0.7],
      corner_tr: [0.7, 0.5],
      corner_bl: [0.3, 0.5],
      corner_br: [0.5, 0.3],
      elevation_m: 0,
    };
    const mesh = buildChartMesh(rotated, fine, 0, 1);
    // Vertex-Z folgt exakt dem Terrain (kein Lift-Float) → Durchstoßen unmoeglich.
    for (let i = 2; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeCloseTo(100, 3);
    }
    // Bounding-Box-Ecken liegen ausserhalb der Raute → UV laeuft ueber [0,1].
    let maxUV = -Infinity;
    let minUV = Infinity;
    for (const t of mesh.texCoords) {
      if (t > maxUV) maxUV = t;
      if (t < minUV) minUV = t;
    }
    expect(maxUV > 1 || minUV < 0).toBe(true);
  });

  it("cullt bei gedrehter Karte die Zwickel-Zellen ausserhalb des Rechtecks", () => {
    const fine: DemGrid = {
      n_rows: 21,
      n_cols: 21,
      lat_min: 0,
      lat_max: 1,
      lon_min: 0,
      lon_max: 1,
      elevations: new Array(441).fill(100),
    };
    // 45°-Raute zentriert bei (0.5, 0.5): die achsenparallele Bounding-Box ist
    // doppelt so gross wie die Raute → die vier Eck-Zwickel muessen weg.
    const rotated: ChartOverlay = {
      name: "r",
      corner_tl: [0.5, 0.7],
      corner_tr: [0.7, 0.5],
      corner_bl: [0.3, 0.5],
      corner_br: [0.5, 0.3],
      elevation_m: 0,
    };
    const mesh = buildChartMesh(rotated, fine, 0, 1);

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 6).toBe(0); // ganze Zellen, kein Teil-Dreieck

    // Die weit aussen liegenden Zwickel-Vertices (UV bis ~±0.5 bei dieser Raute)
    // duerfen NICHT mehr referenziert werden. Eine Randzelle ragt UV-seitig um
    // hoechstens ~eine Zellbreite (~0.25) hinaus — alles darueber waere ein nicht
    // gecullter Zwickel. Schranke 0.3 trennt beides sauber.
    for (let i = 0; i < mesh.indices.length; i++) {
      const idx = mesh.indices[i];
      const u = mesh.texCoords[idx * 2];
      const v = mesh.texCoords[idx * 2 + 1];
      expect(u).toBeGreaterThan(-0.3);
      expect(u).toBeLessThan(1.3);
      expect(v).toBeGreaterThan(-0.3);
      expect(v).toBeLessThan(1.3);
    }

    // Sanity: deutlich weniger als das volle 20x20-Zellgitter (×6 Indizes),
    // weil die ~halbe Bounding-Box (Zwickel) weggecullt ist.
    expect(mesh.indices.length).toBeLessThan(20 * 20 * 6);
  });

  it("texCoords decken im bilinearen Pfad den Bereich [0,1] ab", () => {
    // Ohne DEM → Strategie B (Ecken), u/v laufen exakt 0..1.
    const mesh = buildChartMesh(axisAlignedChart(), null, 0, 1);
    let min = Infinity;
    let max = -Infinity;
    for (const t of mesh.texCoords) {
      if (t < min) min = t;
      if (t > max) max = t;
    }
    expect(min).toBeCloseTo(0, 3);
    expect(max).toBeCloseTo(1, 3);
  });
});
