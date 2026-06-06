import { describe, expect, it } from "vitest";

import { parseIgc } from "./igc";

// Synthetische IGC-Records (neutrale Koordinaten). B-Record-Spaltenlayout:
//   B HHMMSS  DDMMmmm N  DDDMMmmm E  V  PPPPP GGGGG
//   0 1----6  7-----14   15----23    24 25-29 30-34
// Jede Zeile ist exakt 35 Zeichen lang.

// "5206000N" → 52° + 06.000' = 52.1 ;  "00012000E" → 0° + 12.000' = 0.2
const B1 = "B1101355206000N00012000EA0100001200";
// 10 s spaeter, leicht versetzt, GNSS-Hoehe 0 → Fallback auf Druckhoehe 800
const B2 = "B1101455206100N00012100EA0080000000";
// Suedhalbkugel/West: "3330000S" → -33.5 ; "01500000W" → -15.0
const Bsouth = "B1102003330000S01500000WA0050000500";

const HEADER_OLD = "AXXX\nHFDTE150709\n";

describe("parseIgc", () => {
  it("dekodiert B-Records mit Datum aus HFDTE", () => {
    const pts = parseIgc(HEADER_OLD + B1 + "\n" + B2 + "\n");
    expect(pts).toHaveLength(2);
    expect(pts[0].lat).toBeCloseTo(52.1, 6);
    expect(pts[0].lon).toBeCloseTo(0.2, 6);
    expect(pts[0].altM).toBe(1200); // GNSS bevorzugt
    // 2009-07-15 11:01:35 UTC
    expect(pts[0].timestampMs).toBe(Date.UTC(2009, 6, 15, 11, 1, 35));
    expect(pts[0].speedKmh).toBeNull();
  });

  it("weicht bei GNSS-Hoehe 0 auf die Druckhoehe aus", () => {
    const pts = parseIgc(HEADER_OLD + B2 + "\n");
    expect(pts[0].altM).toBe(800);
  });

  it("behandelt Sued/West-Hemisphaeren als negativ", () => {
    const pts = parseIgc(HEADER_OLD + Bsouth + "\n");
    expect(pts[0].lat).toBeCloseTo(-33.5, 6);
    expect(pts[0].lon).toBeCloseTo(-15.0, 6);
  });

  it("liest das neue HFDTEDATE:-Format", () => {
    const pts = parseIgc("HFDTEDATE:150709,01\n" + B1 + "\n");
    expect(pts).toHaveLength(1);
    expect(pts[0].timestampMs).toBe(Date.UTC(2009, 6, 15, 11, 1, 35));
  });

  it("ueberspringt ungueltige Fixes (Spalte 24 = 'V')", () => {
    const invalid = "B1101555206000N00012000EV0100001200";
    const pts = parseIgc(HEADER_OLD + invalid + "\n");
    expect(pts).toHaveLength(0);
  });

  it("zaehlt UTC-Mitternacht hoch (Datum rollt auf den Folgetag)", () => {
    const late = "B2359595206000N00012000EA0100001200"; // 23:59:59
    const early = "B0000105206100N00012100EA0100001200"; // 00:00:10 (Folgetag)
    const pts = parseIgc(HEADER_OLD + late + "\n" + early + "\n");
    expect(pts).toHaveLength(2);
    expect(pts[0].timestampMs).toBe(Date.UTC(2009, 6, 15, 23, 59, 59));
    expect(pts[1].timestampMs).toBe(Date.UTC(2009, 6, 16, 0, 0, 10));
  });

  it("liefert ohne HFDTE-Datum ein leeres Ergebnis", () => {
    expect(parseIgc(B1 + "\n")).toEqual([]);
  });

  it("ignoriert Nicht-B-Records und zu kurze Zeilen", () => {
    const pts = parseIgc(HEADER_OLD + "LXXX Kommentar\n" + "B123\n" + B1 + "\n");
    expect(pts).toHaveLength(1);
  });
});
