import { describe, expect, it } from "vitest";

import { combineDateTimeMs, messagesToTrack, parseNmeaMessages } from "./nmea";

/** Haengt eine gueltige NMEA-Checksumme an. */
function nmea(fields: string[]): string {
  const body = fields.join(",");
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

// Ein kleiner synthetischer Stream: 2 Ticks à RMC+GGA+VTG, am Aequator.
function sampleLog(): string {
  const lines: string[] = [];
  // Tick 1: 12:00:00, lat 0, lon 0
  lines.push(nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "10.0", "90.0", "010624", "", ""]));
  lines.push(nmea(["GPGGA", "120000.00", "0000.000", "N", "00000.000", "E", "1", "08", "0.9", "100.0", "M", "0.0", "M", "", ""]));
  lines.push(nmea(["GPVTG", "90.0", "T", "", "M", "10.0", "N", "18.52", "K", "A"]));
  // Tick 2: 12:00:10, lon 0.01°  (= 0000.600 E in ddmm.mmmm: 0.6 min = 0.01°)
  lines.push(nmea(["GPRMC", "120010.00", "A", "0000.000", "N", "00000.600", "E", "12.0", "90.0", "010624", "", ""]));
  lines.push(nmea(["GPGGA", "120010.00", "0000.000", "N", "00000.600", "E", "1", "08", "0.9", "200.0", "M", "0.0", "M", "", ""]));
  lines.push(nmea(["GPVTG", "90.0", "T", "", "M", "12.0", "N", "22.224", "K", "A"]));
  return lines.join("\r\n");
}

describe("combineDateTimeMs", () => {
  it("kombiniert ddmmyy + hhmmss zu UTC-ms", () => {
    expect(combineDateTimeMs("010624", "120000.00")).toBe(
      Date.UTC(2024, 5, 1, 12, 0, 0, 0),
    );
  });
  it("liefert null bei fehlenden/kaputten Werten", () => {
    expect(combineDateTimeMs(null, "120000")).toBeNull();
    expect(combineDateTimeMs("010624", null)).toBeNull();
  });
});

describe("parseNmeaMessages + messagesToTrack", () => {
  it("konsolidiert RMC/GGA/VTG zu Schema-B-Punkten pro Timestamp", () => {
    const track = messagesToTrack(parseNmeaMessages(sampleLog()));
    expect(track).toHaveLength(2);
    expect(track[0]).toMatchObject({ lat: 0, lon: 0, altM: 100 });
    expect(track[1].lon).toBeCloseTo(0.01, 6);
    expect(track[1].altM).toBe(200);
    // Geschwindigkeit aus VTG (km/h) bzw. RMC (Knoten).
    expect(track[0].speedKmh).toBeCloseTo(18.52, 2);
    expect(track[0].speedKnots).toBeCloseTo(10.0, 2);
    // Zeit aus RMC-Datum + Zeit.
    expect(track[0].timestampMs).toBe(Date.UTC(2024, 5, 1, 12, 0, 0, 0));
    // HDOP aus GGA-Sätzen.
    expect(track[0].hdop).toBe(0.9);
    expect(track[1].hdop).toBe(0.9);
  });

  it("verwirft Punkte vor dem ersten gueltigen RMC-Fix (status A)", () => {
    const lines = [
      // ungueltiger Fix (status V) zuerst — muss rausfallen
      nmea(["GPRMC", "115950.00", "V", "0000.000", "N", "00000.000", "E", "0.0", "0.0", "010624", "", ""]),
      nmea(["GPGGA", "115950.00", "0000.000", "N", "00000.000", "E", "0", "00", "9.9", "0.0", "M", "0.0", "M", "", ""]),
      // gueltiger Fix
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "10.0", "90.0", "010624", "", ""]),
      nmea(["GPGGA", "120000.00", "0000.000", "N", "00000.000", "E", "1", "08", "0.9", "100.0", "M", "0.0", "M", "", ""]),
    ].join("\n");
    const track = messagesToTrack(parseNmeaMessages(lines));
    expect(track).toHaveLength(1);
    expect(track[0].timestampMs).toBe(Date.UTC(2024, 5, 1, 12, 0, 0, 0));
  });

  it("ignoriert GSV/GSA-Saetze fuer den Track", () => {
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "10.0", "90.0", "010624", "", ""]),
      nmea(["GPGGA", "120000.00", "0000.000", "N", "00000.000", "E", "1", "08", "0.9", "100.0", "M", "0.0", "M", "", ""]),
      nmea(["GPGSV", "1", "1", "01", "01", "40", "083", "46"]),
      nmea(["GPGSA", "A", "3", "01", "", "", "", "", "", "", "", "", "", "", "", "2.5", "1.3", "2.1"]),
    ].join("\n");
    const track = messagesToTrack(parseNmeaMessages(lines));
    expect(track).toHaveLength(1);
  });

  it("extrahiert HDOP aus GGA-Saetzen", () => {
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "10.0", "90.0", "010624", "", ""]),
      nmea(["GPGGA", "120000.00", "0000.000", "N", "00000.000", "E", "1", "08", "1.5", "100.0", "M", "0.0", "M", "", ""]),
    ].join("\n");
    const track = messagesToTrack(parseNmeaMessages(lines));
    expect(track).toHaveLength(1);
    expect(track[0].hdop).toBe(1.5);
  });

  it("nimmt Minimum-HDOP bei mehreren GGA pro Timestamp", () => {
    // Zwei GGA-Saetze pro Timestamp: 2.5 und 1.2 → sollte 1.2 sein
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "10.0", "90.0", "010624", "", ""]),
      nmea(["GPGGA", "120000.00", "0000.000", "N", "00000.000", "E", "1", "08", "2.5", "100.0", "M", "0.0", "M", "", ""]),
      nmea(["GPGGA", "120000.00", "0000.000", "N", "00000.000", "E", "1", "08", "1.2", "100.0", "M", "0.0", "M", "", ""]),
    ].join("\n");
    const track = messagesToTrack(parseNmeaMessages(lines));
    expect(track).toHaveLength(1);
    expect(track[0].hdop).toBe(1.2);
  });

  it("setzt HDOP auf null wenn GGA keine hat", () => {
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "10.0", "90.0", "010624", "", ""]),
      nmea(["GPGGA", "120000.00", "0000.000", "N", "00000.000", "E", "1", "08", "", "100.0", "M", "0.0", "M", "", ""]),
    ].join("\n");
    const track = messagesToTrack(parseNmeaMessages(lines));
    expect(track).toHaveLength(1);
    expect(track[0].hdop).toBeNull();
  });
});
