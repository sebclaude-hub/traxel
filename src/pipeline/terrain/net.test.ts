import { describe, expect, it } from "vitest";

import { TILE_FETCH_TIMEOUT_MS, fetchSignal } from "./net";

describe("fetchSignal", () => {
  it("liefert ein Signal, das nach dem Timeout abbricht", () => {
    const sig = fetchSignal(undefined, 1);
    expect(sig.aborted).toBe(false);
    return new Promise<void>((resolve) => {
      sig.addEventListener("abort", () => {
        expect(sig.aborted).toBe(true);
        resolve();
      });
    });
  });

  it("kombiniert das Aufrufer-Signal: dessen Abbruch feuert sofort", () => {
    const ctrl = new AbortController();
    const sig = fetchSignal(ctrl.signal, TILE_FETCH_TIMEOUT_MS);
    expect(sig.aborted).toBe(false);
    ctrl.abort();
    expect(sig.aborted).toBe(true); // ohne auf den 15s-Timeout zu warten
  });
});
