// ---------------------------------------------------------------------------
// React-Hook fuer die Pipeline im Web Worker.
//
// Haelt eine Worker-Instanz ueber die Lebensdauer der Komponente, korreliert
// Anfragen/Antworten ueber eine fortlaufende ID und liefert das Ergebnis als
// Promise. Die Datei wird im Main-Thread gelesen (File.text()), die schwere
// Verarbeitung laeuft im Worker.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from "react";

import type { TrackData } from "../types";
import type {
  PipelineRequest,
  PipelineResponse,
} from "../workers/pipeline.worker";

type Pending = {
  resolve: (track: TrackData) => void;
  reject: (err: Error) => void;
};

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
      if (res.ok) pending.resolve(res.track);
      else pending.reject(new Error(res.error));
    };
    workerRef.current = worker;

    const pending = pendingRef.current;
    return () => {
      worker.terminate();
      pending.clear();
    };
  }, []);

  const loadGpxFile = useCallback(async (file: File): Promise<TrackData> => {
    const worker = workerRef.current;
    if (!worker) throw new Error("Worker nicht bereit");
    const text = await file.text();
    const id = nextIdRef.current++;
    const name = file.name.replace(/\.[^.]+$/, "");

    return new Promise<TrackData>((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject });
      const req: PipelineRequest = { id, format: "gpx", text, name };
      worker.postMessage(req);
    });
  }, []);

  return { loadGpxFile };
}
