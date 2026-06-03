// ---------------------------------------------------------------------------
// Pipeline-Web-Worker.
//
// Faehrt die schwere Verarbeitung aus dem Main-Thread heraus, damit die UI
// nicht einfriert:
//   - "gpx":     GPX-Text → TrackData
//   - "terrain": Track-Bounds → DemGrid (Kacheln laden/dekodieren/stitchen)
//
// Im Worker steht kein DOMParser zur Verfuegung — GPX nutzt fast-xml-parser,
// Terrain nutzt fetch/createImageBitmap/OffscreenCanvas.
// ---------------------------------------------------------------------------

import { processGpx } from "../pipeline";
import { buildTerrain } from "../pipeline/terrain";
import type { DemGrid, TrackBounds, TrackData } from "../types";

export type PipelineRequest =
  | { id: number; kind: "gpx"; text: string; name: string }
  | { id: number; kind: "terrain"; bounds: TrackBounds };

export type PipelineResponse =
  | { id: number; ok: true; kind: "gpx"; track: TrackData }
  | { id: number; ok: true; kind: "terrain"; dem: DemGrid }
  | { id: number; ok: false; error: string };

function post(res: PipelineResponse): void {
  self.postMessage(res);
}

self.onmessage = async (e: MessageEvent<PipelineRequest>) => {
  const req = e.data;
  try {
    switch (req.kind) {
      case "gpx":
        post({ id: req.id, ok: true, kind: "gpx", track: processGpx(req.text, req.name) });
        break;
      case "terrain":
        post({ id: req.id, ok: true, kind: "terrain", dem: await buildTerrain(req.bounds) });
        break;
      default:
        throw new Error("Unbekannter Request-Typ");
    }
  } catch (err) {
    post({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
