// ---------------------------------------------------------------------------
// GPX-Writer: Schema-B-Punkte → GPX-Text (fuer den Track-Merge, der sein
// Ergebnis als normale Datei in der Bibliothek ablegt).
//
// Bewusst GPX 1.0 statt 1.1: nur dort sind <speed> (m/s) und <hdop> direkt
// im <trkpt> zulaessig — beides soll den Roundtrip durch parseGpx ueberleben.
// Elementreihenfolge nach GPX-1.0-Schema: ele, time, speed, hdop.
// Jedes Segment wird ein eigenes <trkseg> — so bleibt die Nahtstelle zwischen
// den Quelltracks im Dateiformat sichtbar (der Parser flacht sie wieder ab).
// ---------------------------------------------------------------------------

import { KMH_PER_MPS } from "../constants";
import type { RawTrackPoint } from "../types";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trkpt(p: RawTrackPoint): string {
  const parts = [`    <trkpt lat="${p.lat}" lon="${p.lon}">`];
  if (p.altM !== null && Number.isFinite(p.altM)) {
    parts.push(`<ele>${p.altM}</ele>`);
  }
  parts.push(`<time>${new Date(p.timestampMs).toISOString()}</time>`);
  if (p.speedKmh !== null && Number.isFinite(p.speedKmh)) {
    // GPX erwartet m/s; auf mm/s runden (mehr gibt die Quelle nicht her).
    const ms = Math.round((p.speedKmh / KMH_PER_MPS) * 1000) / 1000;
    parts.push(`<speed>${ms}</speed>`);
  }
  if (p.hdop !== null && Number.isFinite(p.hdop)) {
    parts.push(`<hdop>${p.hdop}</hdop>`);
  }
  parts.push(`</trkpt>`);
  return parts.join("");
}

/** Serialisiert Punkt-Segmente als GPX-1.0-Dokument (ein <trkseg> je Segment). */
export function buildGpx(segments: RawTrackPoint[][], name: string): string {
  const segs = segments
    .filter((s) => s.length > 0)
    .map((s) => `  <trkseg>\n${s.map(trkpt).join("\n")}\n  </trkseg>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0" creator="Traxel" xmlns="http://www.topografix.com/GPX/1/0">
<trk><name>${xmlEscape(name)}</name>
${segs}
</trk>
</gpx>
`;
}
