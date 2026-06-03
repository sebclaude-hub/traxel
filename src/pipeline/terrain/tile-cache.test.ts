import { describe, expect, it } from "vitest";

import { readCachedTile, tileFileName } from "./tile-cache";

describe("tile-cache", () => {
  it("baut den Dateinamen aus z/x/y", () => {
    expect(tileFileName({ z: 12, x: 2200, y: 1500 })).toBe(
      "terrarium_12_2200_1500.png",
    );
  });

  it("ist ohne OPFS (Node) ein No-Op: Lesen liefert null", async () => {
    expect(await readCachedTile({ z: 1, x: 0, y: 0 })).toBeNull();
  });
});
