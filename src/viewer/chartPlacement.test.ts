import { describe, expect, it } from "vitest";

import { placementToCorners } from "./chartPlacement";

describe("placementToCorners", () => {
  it("ist bei Rotation 0 achsenparallel und korrekt dimensioniert", () => {
    const c = placementToCorners({
      centerLon: 10,
      centerLat: 50,
      widthM: 2000,
      heightM: 1000,
      rotationDeg: 0,
    });
    // achsenparallel: gleiche Lat oben, gleiche Lat unten, gleiche Lon links/rechts
    expect(c.corner_tl[1]).toBeCloseTo(c.corner_tr[1], 9);
    expect(c.corner_bl[1]).toBeCloseTo(c.corner_br[1], 9);
    expect(c.corner_tl[0]).toBeCloseTo(c.corner_bl[0], 9);
    expect(c.corner_tr[0]).toBeCloseTo(c.corner_br[0], 9);
    // oben ist noerdlicher als unten, rechts oestlicher als links
    expect(c.corner_tl[1]).toBeGreaterThan(c.corner_bl[1]);
    expect(c.corner_tr[0]).toBeGreaterThan(c.corner_tl[0]);

    // Breite ~2000 m: Lon-Spanne * mpLon
    const mpLon = 111320 * Math.cos((50 * Math.PI) / 180);
    expect((c.corner_tr[0] - c.corner_tl[0]) * mpLon).toBeCloseTo(2000, 0);
    expect((c.corner_tl[1] - c.corner_bl[1]) * 110540).toBeCloseTo(1000, 0);
  });

  it("vertauscht bei 90° Rotation die Lon-/Lat-Spannen", () => {
    const c = placementToCorners({
      centerLon: 10,
      centerLat: 50,
      widthM: 2000,
      heightM: 1000,
      rotationDeg: 90,
    });
    const lons = [c.corner_tl[0], c.corner_tr[0], c.corner_bl[0], c.corner_br[0]];
    const lats = [c.corner_tl[1], c.corner_tr[1], c.corner_bl[1], c.corner_br[1]];
    const mpLon = 111320 * Math.cos((50 * Math.PI) / 180);
    const lonSpanM = (Math.max(...lons) - Math.min(...lons)) * mpLon;
    const latSpanM = (Math.max(...lats) - Math.min(...lats)) * 110540;
    // 90°: Breite (2000) liegt nun in Nord-Sued, Hoehe (1000) in Ost-West.
    expect(lonSpanM).toBeCloseTo(1000, 0);
    expect(latSpanM).toBeCloseTo(2000, 0);
  });

  it("zentriert die Karte um centerLon/centerLat", () => {
    const c = placementToCorners({
      centerLon: 8,
      centerLat: 47,
      widthM: 500,
      heightM: 500,
      rotationDeg: 30,
    });
    const lon = (c.corner_tl[0] + c.corner_tr[0] + c.corner_bl[0] + c.corner_br[0]) / 4;
    const lat = (c.corner_tl[1] + c.corner_tr[1] + c.corner_bl[1] + c.corner_br[1]) / 4;
    expect(lon).toBeCloseTo(8, 9);
    expect(lat).toBeCloseTo(47, 9);
  });
});
