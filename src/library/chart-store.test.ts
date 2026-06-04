import { describe, expect, it } from "vitest";

import { hashImageBytes } from "./chart-store";

const bytesOf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;

describe("hashImageBytes", () => {
  it("ist deterministisch fuer gleiche Bytes", async () => {
    const a = await hashImageBytes(bytesOf("ZZZZ-chart"));
    const b = await hashImageBytes(bytesOf("ZZZZ-chart"));
    expect(a).toBe(b);
  });

  it("unterscheidet verschiedene Bytes", async () => {
    const a = await hashImageBytes(bytesOf("ZZZZ-chart"));
    const b = await hashImageBytes(bytesOf("ZZZZ-other"));
    expect(a).not.toBe(b);
  });

  it("liefert einen 64-stelligen Hex-String (SHA-256)", async () => {
    const h = await hashImageBytes(bytesOf("ZZZZ-chart"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
