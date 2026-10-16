import { describe, expect, it } from "vitest";

import {
  addRecentCanvasColorV1,
  normalizeCanvasHexColorV1,
} from "./canvas-color-library-v1.js";

describe("canvas color library", () => {
  it("normalizes valid six-digit hex values", () => {
    expect(normalizeCanvasHexColorV1(" AABBCC ")).toBe("#aabbcc");
    expect(normalizeCanvasHexColorV1("#12EF90")).toBe("#12ef90");
  });

  it("rejects partial or non-hex values", () => {
    expect(normalizeCanvasHexColorV1("#fff")).toBeUndefined();
    expect(normalizeCanvasHexColorV1("transparent")).toBeUndefined();
  });

  it("deduplicates and caps recent colors", () => {
    expect(
      addRecentCanvasColorV1(["#ffffff", "#112233", "#445566"], "#112233", 3),
    ).toEqual(["#112233", "#ffffff", "#445566"]);
  });
});
