import { describe, expect, it } from "vitest";

import { processGpx } from "./index";

// End-to-End-Durchlauf der GPX-Pipeline auf einer synthetischen Datei.
const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="0" lon="0.00"><ele>10</ele><time>2024-01-01T00:00:00Z</time></trkpt>
    <trkpt lat="0" lon="0.01"><ele>20</ele><time>2024-01-01T00:00:10Z</time></trkpt>
    <trkpt lat="0" lon="0.02"><ele>30</ele><time>2024-01-01T00:00:20Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describe("processGpx", () => {
  it("erzeugt konsistente TrackData", () => {
    const td = processGpx(SAMPLE_GPX, "Testtrack");

    expect(td.meta.name).toBe("Testtrack");
    expect(td.meta.source_type).toBe("gpx");
    expect(td.meta.n_points).toBe(3);
    expect(td.meta.has_terrain).toBe(false);
    expect(td.meta.track_mode).toBe("ground");
    expect(td.meta.duration_s).toBe(20);
    expect(td.meta.timestamp_start_utc).toBe("2024-01-01T00:00:00.000Z");

    // Bounds umschliessen alle Punkte.
    expect(td.meta.bounds).toEqual({
      lon_min: 0,
      lat_min: 0,
      lon_max: 0.02,
      lat_max: 0,
    });

    // Gesamtdistanz ≈ 2 × (0.01 Grad am Aequator) ≈ 2226.4 m.
    expect(td.meta.total_distance_m).toBeCloseTo(2226.4, 0);
  });

  it("haelt alle Punkt-Arrays auf gleicher Laenge", () => {
    const td = processGpx(SAMPLE_GPX, "Testtrack");
    const p = td.points;
    const n = td.meta.n_points;
    for (const arr of [
      p.lat,
      p.lon,
      p.alt,
      p.terrain_elev,
      p.above_terrain,
      p.speed_kmh,
      p.distance_m,
      p.timestamp_ms,
      p.hdop,
    ]) {
      expect(arr).toHaveLength(n);
    }
  });

  it("fuellt Geschwindigkeit aus der Geodaesie (GPX ohne <speed>)", () => {
    const td = processGpx(SAMPLE_GPX, "Testtrack");
    expect(td.points.speed_kmh[0]).toBeNull(); // erster Punkt ohne Vorgaenger
    expect(td.points.speed_kmh[1]).toBeCloseTo(400.75, 0);
  });

  it("liefert eine leere, aber valide TrackData ohne Trackpunkte", () => {
    const td = processGpx("<gpx></gpx>", "Leer");
    expect(td.meta.n_points).toBe(0);
    expect(td.meta.timestamp_start_utc).toBeNull();
    expect(td.points.lat).toEqual([]);
  });
});
