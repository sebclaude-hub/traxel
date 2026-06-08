// ---------------------------------------------------------------------------
// Separater Build fuer den selbstenthaltenen Share-Viewer.
//
// Ziel: EIN klassisches IIFE-<script> (kein ES-Modul!), das React + deck.gl +
// TrackViewer buendelt und von file:// laeuft. ES-Module sind ueber file://
// CORS-gesperrt; das IIFE-Format vermeidet das. inlineDynamicImports erzwingt
// eine einzige Datei (deck.gl nutzt sonst Code-Splitting).
//
// Aufruf:  npx vite build --config vite.share.config.ts
// Ausgabe: share-dist/share-viewer.js  (wird spaeter per ?raw in die App
//          importiert und zur Laufzeit in die HTML-Huelle injiziert).
// ---------------------------------------------------------------------------

import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // React liest process.env.NODE_ENV; im Lib-Build sonst undefined.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "share-dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/share/share-main.tsx"),
      formats: ["iife"],
      name: "TraxelShare",
      fileName: () => "share-viewer.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
