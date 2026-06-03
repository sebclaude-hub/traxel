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
