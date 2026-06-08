// ---------------------------------------------------------------------------
// Base64-Kodierung fuer Bytes. btoa/atob sind global in Browsern und Node >= 16.
//
// Wird genau einmal beim Einbetten des gzip-Blobs in die HTML-Huelle benutzt
// (HTML ist Text → der Binaer-Blob muss base64-kodiert werden). Die DEM-Daten
// bleiben bis dahin rohes int16 — so wird genau einmal base64-kodiert, nicht
// doppelt.
// ---------------------------------------------------------------------------

/** Uint8Array → base64. Chunkweise, um den Argument-Stack nicht zu sprengen. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** base64 → Uint8Array. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
