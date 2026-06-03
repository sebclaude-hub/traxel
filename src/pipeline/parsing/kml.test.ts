import { describe, expect, it } from "vitest";

import { parseKml } from "./kml";

// Synthetische KML-Fixtures mit klar fiktiven Koordinaten (Aequator-Naehe).
function kml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document><Placemark><gx:Track>
${body}
  </gx:Track></Placemark></Document>
</kml>`;
}

describe("parseKml", () => {
  it("parst parallele when/gx:coord-Listen (lon lat alt)", () => {
    const out = parseKml(
      kml(`
        <when>2024-01-01T00:00:00Z</when>
        <when>2024-01-01T00:00:10Z</when>
        <gx:coord>0.00 0.0 100</gx:coord>
        <gx:coord>0.01 0.0 200</gx:coord>`),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ lon: 0, lat: 0, altM: 100 });
    expect(out[1]).toMatchObject({ lon: 0.01, lat: 0, altM: 200 });
    expect(out[0].timestampMs).toBe(Date.parse("2024-01-01T00:00:00Z"));
    // KML hat keine Geschwindigkeit.
    expect(out[0].speedKmh).toBeNull();
  });

  it("behandelt fehlende Hoehe als null", () => {
    const out = parseKml(
      kml(`<when>2024-01-01T00:00:00Z</when><gx:coord>5.0 10.0</gx:coord>`),
    );
    expect(out).toHaveLength(1);
    expect(out[0].altM).toBeNull();
  });

  it("ueberspringt Tracks mit ungleich langen when/coord-Listen", () => {
    const out = parseKml(
      kml(`
        <when>2024-01-01T00:00:00Z</when>
        <when>2024-01-01T00:00:10Z</when>
        <gx:coord>0.0 0.0 100</gx:coord>`),
    );
    expect(out).toEqual([]);
  });

  it("sortiert nach Zeit", () => {
    const out = parseKml(
      kml(`
        <when>2024-01-01T00:00:20Z</when>
        <when>2024-01-01T00:00:00Z</when>
        <gx:coord>0.02 0.0 0</gx:coord>
        <gx:coord>0.00 0.0 0</gx:coord>`),
    );
    expect(out.map((p) => p.lon)).toEqual([0, 0.02]);
  });

  it("sammelt mehrere gx:Track-Elemente ein", () => {
    const xml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <Placemark><gx:Track>
      <when>2024-01-01T00:00:00Z</when><gx:coord>0.0 0.0 1</gx:coord>
    </gx:Track></Placemark>
    <Placemark><gx:Track>
      <when>2024-01-01T00:00:10Z</when><gx:coord>0.01 0.0 2</gx:coord>
    </gx:Track></Placemark>
  </Document>
</kml>`;
    expect(parseKml(xml)).toHaveLength(2);
  });

  it("liefert leeres Array fuer nicht unterstuetzte Dialekte (LineString)", () => {
    const xml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><Placemark><LineString>
    <coordinates>0,0,0 1,1,0</coordinates>
  </LineString></Placemark></Document>
</kml>`;
    expect(parseKml(xml)).toEqual([]);
  });

  it("liefert leeres Array bei kaputtem XML", () => {
    expect(parseKml("<kml>")).toEqual([]);
  });
});
