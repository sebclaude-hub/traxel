import { describe, expect, it } from "vitest";

import { parseGpx } from "../parsing/gpx";
import type { RawTrackPoint } from "../types";
import { buildGpx } from "./gpx";

function pt(overrides: Partial<RawTrackPoint> = {}): RawTrackPoint {
  return {
    timestampMs: Date.parse("2024-01-01T00:00:00Z"),
    lat: 0,
    lon: 0,
    altM: 100.5,
    speedKmh: 36,
    speedKnots: 19.4384,
    hdop: 1.2,
    ...overrides,
  };
}

describe("buildGpx", () => {
  it("Roundtrip: parseGpx liest Zeit, Position, Hoehe, Speed und HDOP zurueck", () => {
    const xml = buildGpx(
      [[pt(), pt({ timestampMs: Date.parse("2024-01-01T00:00:10Z"), lon: 0.001 })]],
      "roundtrip",
    );
    const out = parseGpx(xml);
    expect(out).toHaveLength(2);
    expect(out[0].timestampMs).toBe(Date.parse("2024-01-01T00:00:00Z"));
    expect(out[0].lat).toBe(0);
    expect(out[1].lon).toBe(0.001);
    expect(out[0].altM).toBe(100.5);
    expect(out[0].speedKmh).toBeCloseTo(36, 3);
    expect(out[0].hdop).toBe(1.2);
  });

  it("laesst fehlende optionale Felder weg (null nach Roundtrip)", () => {
    const xml = buildGpx([[pt({ altM: null, speedKmh: null, hdop: null })]], "n");
    expect(xml).not.toContain("<ele>");
    expect(xml).not.toContain("<speed>");
    expect(xml).not.toContain("<hdop>");
    const out = parseGpx(xml);
    expect(out[0].altM).toBeNull();
    expect(out[0].speedKmh).toBeNull();
    expect(out[0].hdop).toBeNull();
  });

  it("schreibt ein <trkseg> je Segment; der Parser flacht sie wieder ab", () => {
    const xml = buildGpx(
      [
        [pt()],
        [pt({ timestampMs: Date.parse("2024-01-01T00:01:00Z"), lon: 0.002 })],
      ],
      "segs",
    );
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
    expect(parseGpx(xml)).toHaveLength(2);
  });

  it("escapet XML-Sonderzeichen im Namen", () => {
    const xml = buildGpx([[pt()]], `a<b>&"c"`);
    expect(xml).toContain("<name>a&lt;b&gt;&amp;&quot;c&quot;</name>");
  });
});
