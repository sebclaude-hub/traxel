import { describe, expect, it } from "vitest";

import { paddedBounds, stitchTiles } from "./stitch";
import type { DecodedTile } from "./terrarium";
import { tileToBounds } from "./tiles";

function makeTile(
  z: number,
  x: number,
  y: number,
  size: number,
  fn: (lx: number, ly: number) => number,
): DecodedTile {
  const elevations = new Float32Array(size * size);
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) elevations[ly * size + lx] = fn(lx, ly);
  }
  return { tile: { z, x, y }, bounds: tileToBounds(z, x, y), width: size, height: size, elevations };
}

describe("stitchTiles", () => {
  it("setzt die geografische Ausdehnung einer Kachel korrekt um", () => {
    const z = 10, x = 540, y = 360;
    const tile = makeTile(z, x, y, 8, (_lx, ly) => ly);
    const tb = tileToBounds(z, x, y);
    const grid = stitchTiles([tile], { crop: { lon_min: tb.west, lat_min: tb.south, lon_max: tb.east, lat_max: tb.north } });

    expect(grid.lon_min).toBeCloseTo(tb.west, 4);
    expect(grid.lon_max).toBeCloseTo(tb.east, 4);
    expect(grid.lat_min).toBeCloseTo(tb.south, 4);
    expect(grid.lat_max).toBeCloseTo(tb.north, 4);
    expect(grid.n_rows).toBeGreaterThanOrEqual(2);
    expect(grid.n_cols).toBeGreaterThanOrEqual(2);
  });

  it("orientiert das Grid sued-nach-nord (Zeile 0 = Sueden)", () => {
    // elev = ly (nord-oben gespeichert): Norden niedrig, Sueden hoch.
    const z = 10, x = 540, y = 360;
    const tile = makeTile(z, x, y, 8, (_lx, ly) => ly);
    const tb = tileToBounds(z, x, y);
    const grid = stitchTiles([tile], { crop: { lon_min: tb.west, lat_min: tb.south, lon_max: tb.east, lat_max: tb.north } });

    const southVal = grid.elevations[0] as number; // Zeile 0
    const northVal = grid.elevations[(grid.n_rows - 1) * grid.n_cols] as number;
    expect(southVal).toBeGreaterThan(northVal);
  });

  it("setzt zwei horizontal benachbarte Kacheln zusammen (West/Ost)", () => {
    const z = 10, y = 360;
    const tA = makeTile(z, 540, y, 8, () => 10); // West
    const tB = makeTile(z, 541, y, 8, () => 20); // Ost
    const grid = stitchTiles([tA, tB]);

    expect(grid.lon_min).toBeCloseTo(tileToBounds(z, 540, y).west, 4);
    expect(grid.lon_max).toBeCloseTo(tileToBounds(z, 541, y).east, 4);
    expect(grid.elevations[0] as number).toBeCloseTo(10, 5); // Westkante
    expect(grid.elevations[grid.n_cols - 1] as number).toBeCloseTo(20, 5); // Ostkante
  });

  it("schneidet auf die crop-Bounds zu (innerhalb der Kachel)", () => {
    const z = 10, x = 540, y = 360;
    const tile = makeTile(z, x, y, 16, () => 42);
    const tb = tileToBounds(z, x, y);
    const crop = {
      lon_min: tb.west + (tb.east - tb.west) * 0.25,
      lon_max: tb.west + (tb.east - tb.west) * 0.75,
      lat_min: tb.south + (tb.north - tb.south) * 0.25,
      lat_max: tb.south + (tb.north - tb.south) * 0.75,
    };
    const grid = stitchTiles([tile], { crop });
    expect(grid.lon_min).toBeCloseTo(crop.lon_min, 4);
    expect(grid.lon_max).toBeCloseTo(crop.lon_max, 4);
    expect(grid.elevations.every((e) => Math.abs((e as number) - 42) < 1e-3)).toBe(true);
  });

  it("begrenzt die Aufloesung per maxPixelsPerAxis", () => {
    const z = 10, x = 540, y = 360;
    const tile = makeTile(z, x, y, 64, () => 1);
    const grid = stitchTiles([tile], { maxPixelsPerAxis: 16 });
    expect(grid.n_rows).toBeLessThanOrEqual(16);
    expect(grid.n_cols).toBeLessThanOrEqual(16);
  });
});

describe("paddedBounds", () => {
  it("erweitert die Box symmetrisch", () => {
    const b = paddedBounds({ lon_min: 10, lat_min: 20, lon_max: 11, lat_max: 21 }, { pct: 0.1, deg: 0 });
    expect(b.lon_min).toBeCloseTo(9.9, 6);
    expect(b.lon_max).toBeCloseTo(11.1, 6);
    expect(b.lat_min).toBeCloseTo(19.9, 6);
    expect(b.lat_max).toBeCloseTo(21.1, 6);
  });
});
