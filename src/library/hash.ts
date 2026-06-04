// ---------------------------------------------------------------------------
// SHA-256-Identitaet fuer Bibliotheks-Elemente (Charts, Tracks). Gleicher Inhalt
// → gleicher Hash, unabhaengig vom Dateinamen. Reine WebCrypto, in Node 20+ fuer
// Tests verfuegbar.
// ---------------------------------------------------------------------------

/** SHA-256 der Eingabe als Hex-String. Strings werden UTF-8-kodiert. */
export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
