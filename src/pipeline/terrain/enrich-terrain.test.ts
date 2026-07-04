import { describe, expect, it } from "vitest";

import type { DemGrid, TrackData } from "../../types";
import { enrichKinematics } from "../processing/kinematics";
import { enrichTrackWithTerrain, suggestDemOffset } from "./enrich-terrain";

/** Flaches Terrain auf 100 m ueber [0,1]×[0,1]. */
const FLAT_100: DemGrid = {
  n_rows: 2,
  n_cols: 2,
  lat_min: 0,
  lat_max: 1,
  lon_min: 0,
  lon_max: 1,
  elevations: [100, 100, 100, 100],
};

function makeTrack(pts: { lon: number; lat: number; alt: number | null }[]): TrackData {
  const n = pts.length;
  return {
    meta: {
      name: "t",
      source_type: "gpx",
      n_points: n,
      total_distance_m: 0,
      duration_s: 0,
      timestamp_start_utc: null,
      timestamp_end_utc: null,
      bounds: { lon_min: 0, lat_min: 0, lon_max: 1, lat_max: 1 },
      track_mode: "ground",
      has_terrain: false,
      has_satellites: false,
    },
    quantile_breaks: { speed_kmh: [], altitude_m: [], n_quantiles: 5 },
    points: {
      lat: pts.map((p) => p.lat),
      lon: pts.map((p) => p.lon),
      alt: pts.map((p) => p.alt),
      terrain_elev: pts.map(() => null),
      above_terrain: pts.map(() => null),
      speed_kmh: pts.map(() => null),
      distance_m: pts.map(() => null),
      timestamp_ms: pts.map((_p, i) => i * 1000),
      hdop: pts.map(() => null),
      ...enrichKinematics({
        alt: pts.map((p) => p.alt),
        speed_kmh: pts.map(() => null),
        timestamp_ms: pts.map((_p, i) => i * 1000),
      }),
    },
  };
}

describe("enrichTrackWithTerrain", () => {
  it("fuellt terrain_elev und above_terrain", () => {
    const track = makeTrack([
      { lon: 0.2, lat: 0.5, alt: 250 },
      { lon: 0.5, lat: 0.5, alt: 260 },
    ]);
    const out = enrichTrackWithTerrain(track, FLAT_100);
    expect(out.points.terrain_elev).toEqual([100, 100]);
    expect(out.points.above_terrain).toEqual([150, 160]);
    expect(out.meta.has_terrain).toBe(true);
  });

  it("erkennt Flug (Median AGL > 100 m)", () => {
    const track = makeTrack([
      { lon: 0.3, lat: 0.5, alt: 250 },
      { lon: 0.5, lat: 0.5, alt: 250 },
      { lon: 0.7, lat: 0.5, alt: 250 },
    ]);
    expect(enrichTrackWithTerrain(track, FLAT_100).meta.track_mode).toBe("flight");
  });

  it("erkennt Boden (Median AGL <= 100 m)", () => {
    const track = makeTrack([
      { lon: 0.3, lat: 0.5, alt: 120 },
      { lon: 0.5, lat: 0.5, alt: 120 },
    ]);
    expect(enrichTrackWithTerrain(track, FLAT_100).meta.track_mode).toBe("ground");
  });

  it("liefert null ausserhalb des Grids; ohne Treffer kein Terrain", () => {
    const track = makeTrack([
      { lon: 5, lat: 5, alt: 250 },
      { lon: 6, lat: 6, alt: 250 },
    ]);
    const out = enrichTrackWithTerrain(track, FLAT_100);
    expect(out.points.terrain_elev).toEqual([null, null]);
    expect(out.points.above_terrain).toEqual([null, null]);
    expect(out.meta.has_terrain).toBe(false);
    expect(out.meta.track_mode).toBe("ground");
  });

  it("laesst den Originaltrack unveraendert", () => {
    const track = makeTrack([{ lon: 0.5, lat: 0.5, alt: 250 }]);
    enrichTrackWithTerrain(track, FLAT_100);
    expect(track.points.terrain_elev).toEqual([null]);
    expect(track.meta.has_terrain).toBe(false);
  });
});

describe("suggestDemOffset", () => {
  it("Boden-Track: hebt das DEM bis knapp unter den tiefsten Punkt", () => {
    // Terrain 100, Track durchgaengig 50 m darueber → Offset 50 (AGL → 0).
    const track = makeTrack([
      { lon: 0.3, lat: 0.5, alt: 150 },
      { lon: 0.5, lat: 0.5, alt: 150 },
      { lon: 0.7, lat: 0.5, alt: 150 },
    ]);
    expect(suggestDemOffset(track, FLAT_100)).toBeCloseTo(50, 5);
  });

  it("Boden-Track: angewandter Offset setzt den tiefsten Punkt ~auf den Boden", () => {
    const track = makeTrack([
      { lon: 0.3, lat: 0.5, alt: 146 },
      { lon: 0.5, lat: 0.5, alt: 150 },
      { lon: 0.7, lat: 0.5, alt: 160 },
    ]);
    const off = suggestDemOffset(track, FLAT_100);
    const enriched = enrichTrackWithTerrain(track, FLAT_100, off);
    const agl = enriched.points.above_terrain.filter((v): v is number => v !== null);
    // Tiefster Punkt sitzt praktisch auf dem Boden. Das kleine Perzentil (statt
    // striktem Minimum) darf den absolut tiefsten Punkt minimal unterschreiten.
    expect(Math.min(...agl)).toBeGreaterThan(-1);
    expect(Math.min(...agl)).toBeLessThan(1);
  });

  it("Flug-Track: schlaegt 0 vor (kein Bodenbezug)", () => {
    const track = makeTrack([
      { lon: 0.3, lat: 0.5, alt: 250 },
      { lon: 0.5, lat: 0.5, alt: 250 },
      { lon: 0.7, lat: 0.5, alt: 250 },
    ]);
    expect(suggestDemOffset(track, FLAT_100)).toBe(0);
  });

  it("ignoriert einzelne Ausreisser (GPS-Hoehen-Aussetzer)", () => {
    // 100 saubere Bodenpunkte (Offset 50) + 1 Aussetzer 200 m unter Terrain.
    const pts = Array.from({ length: 100 }, () => ({ lon: 0.5, lat: 0.5, alt: 150 }));
    pts.push({ lon: 0.5, lat: 0.5, alt: -100 }); // diff −200
    const off = suggestDemOffset(makeTrack(pts), FLAT_100);
    expect(off).toBeCloseTo(50, 5); // nicht −200
  });

  it("ohne DEM-Treffer: 0", () => {
    const track = makeTrack([
      { lon: 5, lat: 5, alt: 150 },
      { lon: 6, lat: 6, alt: 150 },
    ]);
    expect(suggestDemOffset(track, FLAT_100)).toBe(0);
  });
});
