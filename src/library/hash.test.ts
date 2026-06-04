import { describe, expect, it } from "vitest";

import { sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("ist deterministisch fuer gleiche Strings", async () => {
    expect(await sha256Hex("ZZZZ-track")).toBe(await sha256Hex("ZZZZ-track"));
  });

  it("unterscheidet verschiedene Strings", async () => {
    expect(await sha256Hex("ZZZZ-track")).not.toBe(await sha256Hex("ZZZZ-other"));
  });

  it("liefert einen 64-stelligen Hex-String", async () => {
    expect(await sha256Hex("ZZZZ-track")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stimmt fuer String- und gleichwertige Byte-Eingabe ueberein (UTF-8)", async () => {
    const text = "ZZZZ-track";
    const fromString = await sha256Hex(text);
    const fromBytes = await sha256Hex(new TextEncoder().encode(text).buffer);
    expect(fromString).toBe(fromBytes);
  });

  it("entspricht dem bekannten SHA-256 des leeren Strings", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
