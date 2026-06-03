// ---------------------------------------------------------------------------
// GSV-Satelliten: Multi-Sentence-Groups aggregieren und an Trackpunkte heften.
//
// Port von aggregate_gsv + align_satellites_to_track + export_satellite_json
// (gps_pipeline) in eine reine Funktion → SatelliteData fuer den SkyPlot.
//
// GSV-Saetze haben keinen eigenen Timestamp; sie bekommen den zuletzt im Stream
// gesehenen RMC/GGA-Timestamp. Pro Konstellation (Talker) werden bis zu 4
// Satelliten pro Satz ueber num_messages/msg_num zu einer Gruppe vereint.
//
// Alignment: pro Trackpunkt und Talker der zuletzt gueltige Burst (backward,
// "was war zu dem Zeitpunkt am Himmel?"). Vor dem ersten Burst → -1.
// ---------------------------------------------------------------------------

import type { GsvBurst, SatelliteData, SatRow } from "../../types";
import { combineDateTimeMs } from "./nmea";
import type { GsvSat, NmeaMessage } from "./nmea-sentences";

interface RawBurst {
  tsMs: number;
  talker: string;
  sats: GsvSat[];
}

/** Schritt 1: GSV-Saetze zu zeitgestempelten Bursts pro Talker aggregieren. */
function aggregateGsv(messages: NmeaMessage[]): RawBurst[] {
  const out: RawBurst[] = [];
  let lastDate: string | null = null;
  let lastTsMs: number | null = null;

  let curTalker: string | null = null;
  let curSats: GsvSat[] = [];

  const finalize = () => {
    if (curTalker !== null && lastTsMs !== null) {
      out.push({ tsMs: lastTsMs, talker: curTalker, sats: curSats });
    }
    curTalker = null;
    curSats = [];
  };

  for (const m of messages) {
    if (m.type === "RMC") {
      if (m.date) lastDate = m.date;
      const ts = combineDateTimeMs(lastDate, m.time);
      if (ts !== null) lastTsMs = ts;
      continue;
    }
    if (m.type === "GGA") {
      const ts = combineDateTimeMs(lastDate, m.time);
      if (ts !== null) lastTsMs = ts;
      continue;
    }
    if (m.type !== "GSV") continue;

    const numSv = m.numSvInView ?? 0;
    if (numSv === 0) {
      // Leerer Burst ("0 Satelliten in View") — bewusst als gueltiger Zustand.
      finalize();
      if (lastTsMs !== null) out.push({ tsMs: lastTsMs, talker: m.talker, sats: [] });
      continue;
    }

    if (m.msgNum === 1 || m.talker !== curTalker) {
      finalize();
      curTalker = m.talker;
    }
    curSats.push(...m.sats);

    if (m.numMessages !== null && m.msgNum === m.numMessages) finalize();
  }
  finalize();
  return out;
}

function toSatRow(s: GsvSat): SatRow {
  return [s.prn, s.elevation, s.azimuth, s.snr];
}

/**
 * Baut SatelliteData aus dem Nachrichten-Stream und den (zeitsortierten)
 * Track-Timestamps. null, wenn keine GSV-Bursts vorhanden sind.
 */
export function buildSatelliteData(
  messages: NmeaMessage[],
  trackTimestampsMs: number[],
): SatelliteData | null {
  const bursts = aggregateGsv(messages);
  if (bursts.length === 0) return null;

  // Pro Talker: Bursts nach Zeit sortieren, je Timestamp den letzten behalten.
  const byTalker = new Map<string, RawBurst[]>();
  for (const b of bursts) {
    const list = byTalker.get(b.talker) ?? [];
    list.push(b);
    byTalker.set(b.talker, list);
  }

  const talkers = [...byTalker.keys()].sort();
  const burstsByTalker: Record<string, GsvBurst[]> = {};
  const burstIdxByTrack: Record<string, number[]> = {};
  const n = trackTimestampsMs.length;

  for (const talker of talkers) {
    const raw = byTalker.get(talker) as RawBurst[];
    raw.sort((a, b) => a.tsMs - b.tsMs);
    // Dedupe nach Timestamp: letzter gewinnt (aktuellster Stand).
    const deduped: RawBurst[] = [];
    for (const b of raw) {
      if (deduped.length > 0 && deduped[deduped.length - 1].tsMs === b.tsMs) {
        deduped[deduped.length - 1] = b;
      } else {
        deduped.push(b);
      }
    }

    burstsByTalker[talker] = deduped.map((b) => ({
      ts_ms: b.tsMs,
      sats: b.sats.map(toSatRow),
    }));

    // Backward-Asof: Track ist zeitsortiert, Bursts auch → Zwei-Zeiger-Lauf.
    const lookup = new Array<number>(n).fill(-1);
    let bi = -1;
    for (let i = 0; i < n; i++) {
      const t = trackTimestampsMs[i];
      while (bi + 1 < deduped.length && deduped[bi + 1].tsMs <= t) bi++;
      lookup[i] = bi; // -1, solange noch kein Burst <= t
    }
    burstIdxByTrack[talker] = lookup;
  }

  return { talkers, bursts_by_talker: burstsByTalker, burst_idx_by_track: burstIdxByTrack };
}
