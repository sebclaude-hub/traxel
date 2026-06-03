import { describe, expect, it } from "vitest";

import { buildSatelliteData } from "./nmea-gsv";
import { parseNmeaMessages } from "./nmea";

function nmea(fields: string[]): string {
  const body = fields.join(",");
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

const T1 = Date.UTC(2024, 5, 1, 12, 0, 0, 0);
const T2 = Date.UTC(2024, 5, 1, 12, 0, 10, 0);

describe("buildSatelliteData", () => {
  it("liefert null ohne GSV", () => {
    const msgs = parseNmeaMessages(
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "0", "0", "010624", "", ""]),
    );
    expect(buildSatelliteData(msgs, [T1])).toBeNull();
  });

  it("aggregiert Multi-Sentence-GSV einer Konstellation zu einem Burst", () => {
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "0", "0", "010624", "", ""]),
      nmea(["GPGSV", "2", "1", "05", "01", "40", "083", "46", "02", "17", "308", "41", "12", "07", "344", "39", "14", "22", "228", "45"]),
      nmea(["GPGSV", "2", "2", "05", "25", "60", "150", "48"]),
    ].join("\n");
    const sat = buildSatelliteData(parseNmeaMessages(lines), [T1]);
    expect(sat).not.toBeNull();
    expect(sat!.talkers).toEqual(["GP"]);
    expect(sat!.bursts_by_talker.GP).toHaveLength(1);
    expect(sat!.bursts_by_talker.GP[0].ts_ms).toBe(T1);
    // 4 + 1 = 5 Satelliten ueber beide Saetze.
    expect(sat!.bursts_by_talker.GP[0].sats).toHaveLength(5);
    expect(sat!.bursts_by_talker.GP[0].sats[0]).toEqual([1, 40, 83, 46]);
    // Trackpunkt bei T1 → Burst-Index 0.
    expect(sat!.burst_idx_by_track.GP).toEqual([0]);
  });

  it("trennt Konstellationen (GP vs GL) und sortiert Talker", () => {
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "0", "0", "010624", "", ""]),
      nmea(["GLGSV", "1", "1", "01", "65", "30", "120", "33"]),
      nmea(["GPGSV", "1", "1", "01", "01", "40", "083", "46"]),
    ].join("\n");
    const sat = buildSatelliteData(parseNmeaMessages(lines), [T1])!;
    expect(sat.talkers).toEqual(["GL", "GP"]);
    expect(sat.bursts_by_talker.GL[0].sats[0]).toEqual([65, 30, 120, 33]);
  });

  it("heftet per Backward-Asof den letzten Burst an jeden Trackpunkt", () => {
    // Burst nur bei T1; Trackpunkte bei T1 und T2 → beide nutzen Burst 0.
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "0", "0", "010624", "", ""]),
      nmea(["GPGSV", "1", "1", "01", "01", "40", "083", "46"]),
    ].join("\n");
    const sat = buildSatelliteData(parseNmeaMessages(lines), [T1, T2])!;
    expect(sat.burst_idx_by_track.GP).toEqual([0, 0]);
  });

  it("vergibt -1 fuer Trackpunkte vor dem ersten Burst", () => {
    // Burst erst bei T2; Trackpunkt bei T1 (davor) → -1, T2 → 0.
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "0", "0", "010624", "", ""]),
      nmea(["GPRMC", "120010.00", "A", "0000.000", "N", "00000.000", "E", "0", "0", "010624", "", ""]),
      nmea(["GPGSV", "1", "1", "01", "01", "40", "083", "46"]),
    ].join("\n");
    const sat = buildSatelliteData(parseNmeaMessages(lines), [T1, T2])!;
    expect(sat.burst_idx_by_track.GP).toEqual([-1, 0]);
  });

  it("behandelt einen leeren Burst (0 Satelliten in View)", () => {
    const lines = [
      nmea(["GPRMC", "120000.00", "A", "0000.000", "N", "00000.000", "E", "0", "0", "010624", "", ""]),
      nmea(["GPGSV", "1", "1", "00"]),
    ].join("\n");
    const sat = buildSatelliteData(parseNmeaMessages(lines), [T1])!;
    expect(sat.bursts_by_talker.GP[0].sats).toEqual([]);
  });
});
