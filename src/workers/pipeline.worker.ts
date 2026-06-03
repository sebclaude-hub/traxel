// ---------------------------------------------------------------------------
// Pipeline-Web-Worker.
//
// Faehrt die schwere Track-Verarbeitung (Parsen + Anreichern + Modellbau) aus
// dem Main-Thread heraus, damit die UI beim Laden grosser Tracks nicht
// einfriert. Der Worker liefert fertige `TrackData` zurueck.
//
// Im Worker steht kein DOMParser zur Verfuegung — die GPX-Pipeline nutzt
// deshalb fast-xml-parser (siehe pipeline/parsing/gpx.ts).
// ---------------------------------------------------------------------------

import { processGpx } from "../pipeline";
import type { TrackData } from "../types";

export interface PipelineRequest {
  id: number;
  format: "gpx";
  text: string;
  name: string;
}

export type PipelineResponse =
  | { id: number; ok: true; track: TrackData }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<PipelineRequest>) => {
  const req = e.data;
  try {
    let track: TrackData;
    switch (req.format) {
      case "gpx":
        track = processGpx(req.text, req.name);
        break;
      default:
        throw new Error(`Unbekanntes Format: ${req.format as string}`);
    }
    const res: PipelineResponse = { id: req.id, ok: true, track };
    self.postMessage(res);
  } catch (err) {
    const res: PipelineResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};
