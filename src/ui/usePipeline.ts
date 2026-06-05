// ---------------------------------------------------------------------------
// React-Hook fuer die Pipeline im Web Worker.
//
// Haelt eine Worker-Instanz, korreliert Anfragen/Antworten ueber eine
// fortlaufende ID und liefert Ergebnisse als Promise. Unterstuetzt GPX-Parsing
// und Terrain-Download.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from "react";

import type { DemGrid, SatelliteData, TrackBounds, TrackData } from "../types";
import type { SatBounds, SatelliteImage } from "../pipeline/terrain/satellite";
import type {
  PipelineRequest,
  PipelineResponse,
  TerrainOpts,
} from "../workers/pipeline.worker";

export interface LoadedTrack {
  track: TrackData;
  satellites: SatelliteData | null;
}

type Pending = {
  resolve: (res: PipelineResponse) => void;
  reject: (err: Error) => void;
};

// Distributiver Omit: erhaelt die einzelnen Varianten der Union (sonst bleiben
// nur die gemeinsamen Felder uebrig).
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;
type PipelineRequestInput = DistributiveOmit<PipelineRequest, "id">;

export function usePipeline() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, Pending>>(new Map());
  const nextIdRef = useRef(1);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/pipeline.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent<PipelineResponse>) => {
      const res = e.data;
      const pending = pendingRef.current.get(res.id);
      if (!pending) return;
      pendingRef.current.delete(res.id);
      if (res.ok) pending.resolve(res);
      else pending.reject(new Error(res.error));
    };
    workerRef.current = worker;

    const pending = pendingRef.current;
    return () => {
      worker.terminate();
      pending.clear();
    };
  }, []);

  const post = useCallback(
    (req: PipelineRequestInput): Promise<PipelineResponse> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error("Worker nicht bereit"));
      const id = nextIdRef.current++;
      return new Promise<PipelineResponse>((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        worker.postMessage({ ...req, id } as PipelineRequest);
      });
    },
    [],
  );

  // Track aus Roh-Text + Name (Endung) parsen. Genutzt vom Datei-Import und vom
  // Wiederoeffnen aus der Bibliothek (dort liegt nur der gespeicherte Text vor).
  const loadTrackText = useCallback(
    async (text: string, fileName: string): Promise<LoadedTrack> => {
      const name = fileName.replace(/\.[^.]+$/, "");
      const ext = fileName.split(".").pop()?.toLowerCase();
      const kind =
        ext === "kml"
          ? "kml"
          : ext === "nmea" || ext === "log" || ext === "txt"
            ? "nmea"
            : "gpx";
      const res = await post({ kind, text, name });
      if (res.ok && res.kind === "nmea") {
        return { track: res.track, satellites: res.satellites };
      }
      if (res.ok && (res.kind === "gpx" || res.kind === "kml")) {
        return { track: res.track, satellites: null };
      }
      throw new Error("Unerwartete Antwort fuer Track-Anfrage");
    },
    [post],
  );

  const loadTrackFile = useCallback(
    async (file: File): Promise<LoadedTrack> =>
      loadTrackText(await file.text(), file.name),
    [loadTrackText],
  );

  const loadTerrain = useCallback(
    async (bounds: TrackBounds, opts?: TerrainOpts): Promise<DemGrid> => {
      const res = await post({ kind: "terrain", bounds, opts });
      if (res.ok && res.kind === "terrain") return res.dem;
      throw new Error("Unerwartete Antwort fuer Terrain-Anfrage");
    },
    [post],
  );

  const loadSatellite = useCallback(
    async (bounds: TrackBounds): Promise<SatelliteImage> => {
      const res = await post({ kind: "satellite", bounds });
      if (res.ok && res.kind === "satellite") {
        return { image: res.image, bounds: res.bounds as SatBounds };
      }
      throw new Error("Unerwartete Antwort fuer Satelliten-Anfrage");
    },
    [post],
  );

  return { loadTrackFile, loadTrackText, loadTerrain, loadSatellite };
}
