import { describe, expect, it } from "vitest";

import { checksumValid, parseNmeaLine } from "./nmea-sentences";

/** Haengt eine gueltige NMEA-Checksumme an einen Body (ohne $ und *) an. */
function nmea(fields: string[]): string {
  const body = fields.join(",");
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

describe("checksumValid", () => {
  it("akzeptiert korrekte und lehnt falsche Checksummen ab", () => {
    const line = nmea(["GPRMC", "120000.00", "A", "4807.038", "N", "01131.000", "E", "22.4", "84.4", "230394", "", ""]);
    expect(checksumValid(line)).toBe(true);
    expect(checksumValid(line.replace(/\*..$/, "*00"))).toBe(false);
  });
});

describe("parseNmeaLine", () => {
  it("parst RMC (Position, Speed, Status, Datum/Zeit)", () => {
    const msg = parseNmeaLine(
      nmea(["GPRMC", "120000.00", "A", "4807.038", "N", "01131.000", "E", "22.4", "84.4", "230394", "", ""]),
    );
    expect(msg?.type).toBe("RMC");
    if (msg?.type !== "RMC") throw new Error("kein RMC");
    expect(msg.lat).toBeCloseTo(48.1173, 4);
    expect(msg.lon).toBeCloseTo(11.516667, 5);
    expect(msg.speedKnots).toBeCloseTo(22.4, 4);
    expect(msg.status).toBe("A");
    expect(msg.time).toBe("120000.00");
    expect(msg.date).toBe("230394");
  });

  it("parst GGA (Hoehe, Fix-Qualitaet, Sats, HDOP)", () => {
    const msg = parseNmeaLine(
      nmea(["GPGGA", "120000.00", "4807.038", "N", "01131.000", "E", "1", "08", "0.9", "545.4", "M", "46.9", "M", "", ""]),
    );
    expect(msg?.type).toBe("GGA");
    if (msg?.type !== "GGA") throw new Error("kein GGA");
    expect(msg.altitude).toBeCloseTo(545.4, 4);
    expect(msg.gpsQuality).toBe(1);
    expect(msg.numSats).toBe(8);
    expect(msg.hdop).toBeCloseTo(0.9, 4);
    expect(msg.lat).toBeCloseTo(48.1173, 4);
  });

  it("parst GSA (Fix-Typ, DOP-Werte)", () => {
    const msg = parseNmeaLine(
      nmea(["GPGSA", "A", "3", "01", "02", "12", "14", "", "", "", "", "", "", "", "", "2.5", "1.3", "2.1"]),
    );
    expect(msg?.type).toBe("GSA");
    if (msg?.type !== "GSA") throw new Error("kein GSA");
    expect(msg.fixType).toBe(3);
    expect(msg.pdop).toBeCloseTo(2.5, 4);
    expect(msg.hdop).toBeCloseTo(1.3, 4);
    expect(msg.vdop).toBeCloseTo(2.1, 4);
  });

  it("parst VTG (Speed in Knoten und km/h)", () => {
    const msg = parseNmeaLine(
      nmea(["GPVTG", "84.4", "T", "", "M", "22.4", "N", "41.5", "K", "A"]),
    );
    expect(msg?.type).toBe("VTG");
    if (msg?.type !== "VTG") throw new Error("kein VTG");
    expect(msg.speedKnots).toBeCloseTo(22.4, 4);
    expect(msg.speedKmph).toBeCloseTo(41.5, 4);
  });

  it("parst GSV (Satelliten in Vierergruppen)", () => {
    const msg = parseNmeaLine(
      nmea(["GPGSV", "2", "1", "08", "01", "40", "083", "46", "02", "17", "308", "41", "12", "07", "344", "39", "14", "22", "228", "45"]),
    );
    expect(msg?.type).toBe("GSV");
    if (msg?.type !== "GSV") throw new Error("kein GSV");
    expect(msg.numMessages).toBe(2);
    expect(msg.msgNum).toBe(1);
    expect(msg.numSvInView).toBe(8);
    expect(msg.sats).toHaveLength(4);
    expect(msg.sats[0]).toEqual({ prn: 1, elevation: 40, azimuth: 83, snr: 46 });
    expect(msg.talker).toBe("GP");
  });

  it("liest die Talker-ID (GL = GLONASS)", () => {
    const msg = parseNmeaLine(nmea(["GLGSV", "1", "1", "01", "65", "30", "120", "33"]));
    expect(msg?.talker).toBe("GL");
  });

  it("verwirft ungueltige Checksumme, proprietaere und kaputte Zeilen", () => {
    const bad = nmea(["GPRMC", "120000.00", "A", "4807.038", "N", "01131.000", "E", "22.4", "84.4", "230394", "", ""]).replace(/\*..$/, "*00");
    expect(parseNmeaLine(bad)).toBeNull();
    expect(parseNmeaLine(nmea(["PGRMT", "foo"]))).toBeNull(); // proprietaer
    expect(parseNmeaLine("garbage line")).toBeNull();
    expect(parseNmeaLine("")).toBeNull();
  });
});
