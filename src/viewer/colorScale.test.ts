import { describe, it, expect } from "vitest";
import { colorScaleFor } from "./colorScale";
import type { TrackData } from "../types";

describe("colorScale", () => {
  describe("accuracy mode (HDOP)", () => {
    it("should extract HDOP values and compute quantile breaks", () => {
      const track: TrackData = {
        meta: {
          name: "Test HDOP Track",
          source_type: "nmea",
          n_points: 5,
          total_distance_m: 1000,
          duration_s: 100,
          timestamp_start_utc: "2026-06-01T10:00:00Z",
          timestamp_end_utc: "2026-06-01T10:01:40Z",
          bounds: { lon_min: 0, lon_max: 1, lat_min: 0, lat_max: 1 },
          track_mode: "ground",
          has_terrain: false,
          has_satellites: true,
        },
        quantile_breaks: {
          speed_kmh: [0, 10, 20, 30, 40],
          altitude_m: [0, 100, 200, 300, 400],
          n_quantiles: 4,
        },
        points: {
          lat: [0.5, 0.51, 0.52, 0.53, 0.54],
          lon: [0.5, 0.51, 0.52, 0.53, 0.54],
          alt: [100, 101, 102, 103, 104],
          terrain_elev: [null, null, null, null, null],
          above_terrain: [null, null, null, null, null],
          speed_kmh: [10, 20, 30, 20, 10],
          distance_m: [null, 100, 100, 100, 100],
          timestamp_ms: [1622546400000, 1622546420000, 1622546440000, 1622546460000, 1622546480000],
          speed3d_ms: [2.8, 5.6, 8.3, 5.6, 2.8],
          accel_tangential: [0, 1.4, 1.4, -1.4, -1.4],
          energy_height_m: [100.4, 101.6, 102.7, 103.6, 104.4],
          energy_rate: [0.04, 0.06, 0.05, -0.05, -0.06],
          hdop: [1.5, 2.3, 1.8, 3.5, 2.1],
        },
      };

      const scale = colorScaleFor(track, "accuracy");

      // Should have HDOP values
      expect(scale.values).toEqual([1.5, 2.3, 1.8, 3.5, 2.1]);

      // Should compute quantile breaks from HDOP values
      expect(scale.breaks).toBeDefined();
      expect(scale.breaks.length).toBeGreaterThan(0);
      expect(scale.breaks[0]).toBe(1.5); // min HDOP
      expect(scale.breaks[scale.breaks.length - 1]).toBe(3.5); // max HDOP
    });

    it("should handle null HDOP values gracefully", () => {
      const track: TrackData = {
        meta: {
          name: "Test Track with null HDOP",
          source_type: "gpx",
          n_points: 3,
          total_distance_m: 500,
          duration_s: 50,
          timestamp_start_utc: "2026-06-01T10:00:00Z",
          timestamp_end_utc: "2026-06-01T10:00:50Z",
          bounds: { lon_min: 0, lon_max: 1, lat_min: 0, lat_max: 1 },
          track_mode: "ground",
          has_terrain: false,
          has_satellites: false,
        },
        quantile_breaks: {
          speed_kmh: [0, 10, 20],
          altitude_m: [0, 100, 200],
          n_quantiles: 2,
        },
        points: {
          lat: [0.5, 0.51, 0.52],
          lon: [0.5, 0.51, 0.52],
          alt: [100, 101, 102],
          terrain_elev: [null, null, null],
          above_terrain: [null, null, null],
          speed_kmh: [10, 20, 10],
          distance_m: [null, 100, 100],
          timestamp_ms: [1622546400000, 1622546420000, 1622546440000],
          speed3d_ms: [2.8, 5.6, 2.8],
          accel_tangential: [0, 1.4, -1.4],
          energy_height_m: [100.4, 101.6, 102.4],
          energy_rate: [0.04, 0.06, -0.06],
          hdop: [null, null, null],
        },
      };

      const scale = colorScaleFor(track, "accuracy");

      // Should have all null HDOP values
      expect(scale.values).toEqual([null, null, null]);

      // Should still produce breaks (from null values)
      expect(scale.breaks).toBeDefined();
      expect(scale.breaks.length).toBeGreaterThan(0);
    });

    it("should compute different color scales for different HDOP patterns", () => {
      const goodHdopTrack: TrackData = {
        meta: {
          name: "Good HDOP Track",
          source_type: "nmea",
          n_points: 3,
          total_distance_m: 300,
          duration_s: 30,
          timestamp_start_utc: "2026-06-01T10:00:00Z",
          timestamp_end_utc: "2026-06-01T10:00:30Z",
          bounds: { lon_min: 0, lon_max: 1, lat_min: 0, lat_max: 1 },
          track_mode: "ground",
          has_terrain: false,
          has_satellites: true,
        },
        quantile_breaks: {
          speed_kmh: [0, 10, 20],
          altitude_m: [0, 100, 200],
          n_quantiles: 2,
        },
        points: {
          lat: [0.5, 0.51, 0.52],
          lon: [0.5, 0.51, 0.52],
          alt: [100, 101, 102],
          terrain_elev: [null, null, null],
          above_terrain: [null, null, null],
          speed_kmh: [10, 20, 10],
          distance_m: [null, 100, 100],
          timestamp_ms: [1622546400000, 1622546420000, 1622546440000],
          speed3d_ms: [2.8, 5.6, 2.8],
          accel_tangential: [0, 1.4, -1.4],
          energy_height_m: [100.4, 101.6, 102.4],
          energy_rate: [0.04, 0.06, -0.06],
          hdop: [0.8, 1.2, 0.9],
        },
      };

      const badHdopTrack: TrackData = {
        ...goodHdopTrack,
        meta: { ...goodHdopTrack.meta, name: "Bad HDOP Track" },
        points: {
          ...goodHdopTrack.points,
          hdop: [15, 20, 18],
        },
      };

      const goodScale = colorScaleFor(goodHdopTrack, "accuracy");
      const badScale = colorScaleFor(badHdopTrack, "accuracy");

      // Good HDOP has lower range
      expect(goodScale.breaks[goodScale.breaks.length - 1]).toBeLessThan(
        badScale.breaks[badScale.breaks.length - 1]
      );
    });
  });
});
