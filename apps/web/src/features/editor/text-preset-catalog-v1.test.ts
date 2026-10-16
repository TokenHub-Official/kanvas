import { describe, expect, it } from "vitest";

import {
  canvasTextPresetCatalogV1,
  canvasTextPresetReferenceV1,
  canvasTextPresetV1,
} from "./text-preset-catalog-v1.js";

describe("Canvas Core V1 artistic text presets", () => {
  it("ships editable presets across the required effect families", () => {
    expect(canvasTextPresetCatalogV1.length).toBeGreaterThanOrEqual(10);
    const effects = new Set(
      canvasTextPresetCatalogV1.flatMap((preset) =>
        preset.effects.map((effect) => effect.kind),
      ),
    );
    expect(effects).toEqual(
      expect.objectContaining(
        new Set([
          "outline",
          "shadow",
          "glow",
          "hollow",
          "offset_layers",
          "background",
          "curve",
          "skew",
        ]),
      ),
    );
  });

  it("keeps presets editable rather than storing raster previews", () => {
    for (const preset of canvasTextPresetCatalogV1) {
      expect(preset.effects.length).toBeGreaterThan(0);
      expect(preset.fontId).not.toBe("");
      expect(preset).not.toHaveProperty("imageUrl");
      expect(preset).not.toHaveProperty("artifactId");
    }
  });

  it("resolves exact versioned preset references", () => {
    const reference = canvasTextPresetReferenceV1("text.glitch");
    expect(canvasTextPresetV1(reference).label).toBe("故障错位");
    expect(() =>
      canvasTextPresetV1({
        ...reference,
        revision: "missing",
      }),
    ).toThrow("is not loaded");
  });
});
