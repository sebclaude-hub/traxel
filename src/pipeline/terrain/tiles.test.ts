import { describe, expect, it } from "vitest";

import type { TrackBounds } from "../../types";
import {
  chooseZoom,
  latToTileY,
  lonToTileX,
  metersPerPixel,
  terrariumTileUrl,
  tileCount,
  tilesForBounds,
  tileToBounds,
} from "./tiles";

function bounds(
  lon_min: number,
  lat_min: number,
  lon_max: number,
  lat_max: number,
): TrackBounds {
  return { lon_min, lat_min, lon_max, lat_max };
}

describe("tile indices", () => {
  it("liefert bei z=0 immer (0,0)", () => {
    expect(lonToTileX(0, 0)).toBe(0);
    expect(lonToTileX(-179, 0)).toBe(0);
    expect(latToTileY(0, 0)).toBe(0);
  });

  it("rechnet bekannte Indizes (z=2, lon=170, lat=0 → x=3, y=2)", () => {
    expect(lonToTileX(170, 2)).toBe(3);
    expect(latToTileY(0, 2)).toBe(2);
  });
});

describe("tileToBounds", () => {
  it("umschliesst die Ausgangskoordinate (Round-Trip)", () => {
    // Neutrale Koordinate (Sahara), nur fuer die Mathematik.
    const lon = 10.0;
    const lat = 20.0;
    const z = 10;
    const b = tileToBounds(z, lonToTileX(lon, z), latToTileY(lat, z));
    expect(lon).toBeGreaterThanOrEqual(b.west);
    expect(lon).toBeLessThan(b.east);
    expect(lat).toBeGreaterThanOrEqual(b.south);
    expect(lat).toBeLessThan(b.north);
  });

  it("liefert bei z=0 die ganze Welt", () => {
    const b = tileToBounds(0, 0, 0);
    expect(b.west).toBeCloseTo(-180, 6);
    expect(b.east).toBeCloseTo(180, 6);
    expect(b.north).toBeCloseTo(85.0511, 3);
    expect(b.south).toBeCloseTo(-85.0511, 3);
  });
});

describe("tilesForBounds / tileCount", () => {
  it("eine winzige Box ergibt eine Kachel", () => {
    const b = bounds(10.01, 20.01, 10.02, 20.02);
    expect(tilesForBounds(b, 10)).toHaveLength(1);
  });

  it("ueber Kachelgrenzen ergibt mehrere Kacheln, konsistent mit tileCount", () => {
    const b = bounds(-10, -1, 10, 1); // bei z=2: 2×2 Kacheln
    expect(tileCount(b, 2)).toBe(4);
    expect(tilesForBounds(b, 2)).toHaveLength(4);
  });

  it("tilesForBounds-Laenge == tileCount", () => {
    const b = bounds(5, 45, 9, 48);
    for (const z of [6, 8, 10, 12]) {
      expect(tilesForBounds(b, z)).toHaveLength(tileCount(b, z));
    }
  });
});

describe("chooseZoom", () => {
  it("bleibt im erlaubten Zoom-Bereich", () => {
    const z = chooseZoom(bounds(5, 45, 9, 48), { minZoom: 6, maxZoom: 14 });
    expect(z).toBeGreaterThanOrEqual(6);
    expect(z).toBeLessThanOrEqual(14);
  });

  it("haelt die Kachelanzahl unter maxTiles (oder erreicht minZoom)", () => {
    const b = bounds(0, 40, 6, 46); // grosse Box
    const z = chooseZoom(b, { maxTiles: 24, minZoom: 6, maxZoom: 14 });
    expect(tileCount(b, z) <= 24 || z === 6).toBe(true);
  });

  it("waehlt fuer kleine Boxen einen hohen Zoom nahe der Zielaufloesung", () => {
    const z = chooseZoom(bounds(10.0, 20.0, 10.01, 20.01), {
      targetMetersPerPixel: 30,
      maxTiles: 24,
    });
    expect(z).toBeGreaterThanOrEqual(11);
  });
});

describe("metersPerPixel", () => {
  it("ist am Aequator bei z=0 ~156543 m/px und halbiert sich pro Zoomstufe", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 0);
    expect(metersPerPixel(0, 1)).toBeCloseTo(156543.03 / 2, 0);
  });
});

describe("terrariumTileUrl", () => {
  it("baut die elevation-tiles-prod-URL", () => {
    expect(terrariumTileUrl({ z: 12, x: 2200, y: 1500 })).toBe(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2200/1500.png",
    );
  });
});
