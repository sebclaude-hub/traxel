// ---------------------------------------------------------------------------
// gzip/gunzip ueber die native CompressionStream-API (Browser + Node >= 18).
//
// Kein npm-Modul noetig. Die API ist stream-basiert; diese Helfer pumpen ein
// Uint8Array hindurch und sammeln die Chunks wieder zu einem Uint8Array
// zusammen, damit Aufrufer (und Tests) nicht mit dem Stream-API ringen.
// ---------------------------------------------------------------------------

/** Sammelt alle Chunks eines ReadableStream zu einem Uint8Array. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Pumpt `bytes` durch einen Transform-Stream und sammelt das Ergebnis. */
async function pump(
  bytes: Uint8Array,
  stream: TransformStream<Uint8Array, Uint8Array>,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return collect(stream.readable);
}

/** gzip-komprimiert ein Uint8Array. */
export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pump(bytes, new CompressionStream("gzip"));
}

/** Dekomprimiert ein gzip-Uint8Array. */
export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pump(bytes, new DecompressionStream("gzip"));
}
