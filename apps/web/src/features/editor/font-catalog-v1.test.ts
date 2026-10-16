import { describe, expect, it } from "vitest";

import {
  canvasFontCatalogV1,
  canvasFontDefinitionV1,
  findCanvasFontDefinitionV1,
  prioritizeCanvasFontsV1,
} from "./font-catalog-v1.js";

describe("Canvas Core V1 font catalog", () => {
  it("provides a practical Chinese and Latin font range", () => {
    expect(canvasFontCatalogV1.length).toBeGreaterThanOrEqual(24);
    expect(
      canvasFontCatalogV1.filter((font) => font.languages.includes("zh-Hans"))
        .length,
    ).toBeGreaterThanOrEqual(9);
    expect(new Set(canvasFontCatalogV1.map((font) => font.category))).toEqual(
      new Set(["sans", "serif", "display", "handwriting"]),
    );
  });

  it("uses unique, versioned and license-declared identities", () => {
    const ids = canvasFontCatalogV1.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      canvasFontCatalogV1.every(
        (font) =>
          font.revision.length > 0 &&
          font.license === "OFL-1.1" &&
          font.weights.length > 0,
      ),
    ).toBe(true);
  });

  it("finds by ID or family but requires the exact durable revision", () => {
    expect(findCanvasFontDefinitionV1("noto-sans-sc")?.family).toBe(
      "Noto Sans SC",
    );
    expect(findCanvasFontDefinitionV1("Noto Sans SC")?.id).toBe("noto-sans-sc");
    expect(() =>
      canvasFontDefinitionV1("noto-sans-sc", "missing-revision"),
    ).toThrow("is not loaded");
  });

  it("prioritizes fonts matching the active interface language", () => {
    const ordered = prioritizeCanvasFontsV1(canvasFontCatalogV1, "zh-CN");
    const firstEnglishOnly = ordered.findIndex(
      (font) => !font.languages.includes("zh-Hans"),
    );

    expect(firstEnglishOnly).toBeGreaterThan(0);
    expect(
      ordered
        .slice(0, firstEnglishOnly)
        .every((font) => font.languages.includes("zh-Hans")),
    ).toBe(true);
  });
});
