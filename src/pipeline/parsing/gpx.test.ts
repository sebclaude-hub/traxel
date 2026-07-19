import { describe, expect, it } from "vitest";

import { parseGpx } from "./gpx";

// Synthetische GPX-Fixtures mit klar fiktiven Koordinaten (Aequator-Naehe).
function gpx(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
${body}
  </trkseg></trk>
</gpx>`;
}

describe("parseGpx", () => {
  it("parst Koordinaten, Hoehe und Zeit", () => {
    const out = parseGpx(
      gpx(`<trkpt lat="0.0" lon="0.0"><ele>100.5</ele><time>2024-01-01T00:00:00Z</time></trkpt>`),
    );
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBe(0);
    expect(out[0].lon).toBe(0);
    expect(out[0].altM).toBe(100.5);
    expect(out[0].timestampMs).toBe(Date.parse("2024-01-01T00:00:00Z"));
  });

  it("rechnet <speed> (m/s) in km/h und Knoten um", () => {
    const out = parseGpx(
      gpx(`<trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time><speed>10</speed></trkpt>`),
    );
    expect(out[0].speedKmh).toBeCloseTo(36, 6);
    expect(out[0].speedKnots).toBeCloseTo(19.4384, 4);
  });

  it("liest <speed> aus <extensions>", () => {
    const out = parseGpx(
      gpx(`<trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time><extensions><speed>5</speed></extensions></trkpt>`),
    );
    expect(out[0].speedKmh).toBeCloseTo(18, 6);
  });

  it("liest <hdop>", () => {
    const out = parseGpx(
      gpx(`<trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time><hdop>1.4</hdop></trkpt>`),
    );
    expect(out[0].hdop).toBe(1.4);
  });

  it("setzt fehlende Hoehe und Geschwindigkeit auf null", () => {
    const out = parseGpx(
      gpx(`<trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time></trkpt>`),
    );
    expect(out[0].altM).toBeNull();
    expect(out[0].speedKmh).toBeNull();
  });

  it("verwirft Trackpunkte ohne Zeitstempel und ohne gueltige Koordinaten", () => {
    const out = parseGpx(
      gpx(`
        <trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time></trkpt>
        <trkpt lat="0" lon="0.001"></trkpt>
        <trkpt lat="abc" lon="0"><time>2024-01-01T00:00:02Z</time></trkpt>`),
    );
    expect(out).toHaveLength(1);
  });

  it("sortiert stabil nach Zeit", () => {
    const out = parseGpx(
      gpx(`
        <trkpt lat="0" lon="0.002"><time>2024-01-01T00:00:02Z</time></trkpt>
        <trkpt lat="0" lon="0.000"><time>2024-01-01T00:00:00Z</time></trkpt>
        <trkpt lat="0" lon="0.001"><time>2024-01-01T00:00:01Z</time></trkpt>`),
    );
    expect(out.map((p) => p.lon)).toEqual([0, 0.001, 0.002]);
  });

  it("behaelt Duplikat-Zeitstempel", () => {
    const out = parseGpx(
      gpx(`
        <trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time></trkpt>
        <trkpt lat="0" lon="0.001"><time>2024-01-01T00:00:00Z</time></trkpt>`),
    );
    expect(out).toHaveLength(2);
  });

  it("versteht den gpx:-Namespace-Praefix", () => {
    const xml = `<?xml version="1.0"?>
<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1">
  <gpx:trk><gpx:trkseg>
    <gpx:trkpt lat="0" lon="0"><gpx:time>2024-01-01T00:00:00Z</gpx:time></gpx:trkpt>
  </gpx:trkseg></gpx:trk>
</gpx:gpx>`;
    const out = parseGpx(xml);
    expect(out).toHaveLength(1);
  });

  it("liefert leeres Array bei kaputtem XML und ohne Trackpunkte", () => {
    expect(parseGpx("<gpx>")).toEqual([]);
    expect(parseGpx(gpx(""))).toEqual([]);
  });
});
