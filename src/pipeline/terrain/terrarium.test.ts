import { describe, expect, it } from "vitest";

import { decodeTerrarium } from "./terrarium";

/** Hilfsfunktion: Hoehe → terrarium-RGB-Bytes (Umkehrung der Dekodierung). */
function encode(elevationM: number): [number, number, number] {
  const v = elevationM + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - Math.floor(v)) * 256);
  return [r, g, b];
}

function rgbaFrom(elevations: number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(elevations.length * 4);
  elevations.forEach((e, i) => {
    const [r, g, b] = encode(e);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return data;
}

describe("decodeTerrarium", () => {
  it("dekodiert Meereshoehe (0 m → R=128,G=0,B=0)", () => {
    const data = new Uint8ClampedArray([128, 0, 0, 255]);
    expect(decodeTerrarium(data, 1, 1)[0]).toBe(0);
  });

  it("dekodiert bekannte Hoehen verlustfrei (ganze Meter)", () => {
    const heights = [0, 1, 100, 1500, 8848, -10, -420];
    const out = decodeTerrarium(rgbaFrom(heights), heights.length, 1);
    heights.forEach((h, i) => expect(out[i]).toBeCloseTo(h, 6));
  });

  it("verarbeitet ein 2x2-Raster", () => {
    const heights = [10, 20, 30, 40];
    const out = decodeTerrarium(rgbaFrom(heights), 2, 2);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
  });
});
