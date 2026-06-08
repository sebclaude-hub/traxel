// ---------------------------------------------------------------------------
// Entry-Point des selbstenthaltenen Share-Viewers.
//
// Wird per vite.share.config.ts zu EINEM IIFE-Bundle gebaut, das die App spaeter
// zusammen mit der base64-Payload in die HTML-Huelle injiziert. Liest die
// Payload aus window.__TRAXEL_PAYLOAD__ (von der Huelle gesetzt) und mountet
// den read-only ShareApp.
// ---------------------------------------------------------------------------

import { setLoaderOptions } from "@loaders.gl/core";
import { createRoot } from "react-dom/client";

import { ShareApp } from "./ShareApp";

// Offline-Einzeldatei: loaders.gl-Worker abschalten (sonst Blob/unpkg-Worker,
// auf file:// eine "unique origin"-Warnung und offline ohnehin unerreichbar).
setLoaderOptions({ worker: false });

const payloadB64 = (window as unknown as { __TRAXEL_PAYLOAD__?: string })
  .__TRAXEL_PAYLOAD__;

const root = createRoot(document.getElementById("root")!);
if (payloadB64) {
  root.render(<ShareApp payloadB64={payloadB64} />);
} else {
  root.render(
    <div style={{ padding: 24, color: "#aaa", fontFamily: "system-ui, sans-serif" }}>
      Keine Track-Daten in dieser Datei gefunden.
    </div>,
  );
}
