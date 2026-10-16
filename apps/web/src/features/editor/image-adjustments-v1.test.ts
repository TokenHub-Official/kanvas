import { describe, expect, it } from "vitest";

import {
  defaultEditorImageAdjustmentsV1,
  editorImageAdjustmentsV1,
  editorImageCssFilterV1,
} from "./image-adjustments-v1.js";

describe("Canvas Core V1 image adjustments", () => {
  it("provides a neutral complete adjustment set", () => {
    expect(editorImageAdjustmentsV1({})).toEqual(
      defaultEditorImageAdjustmentsV1,
    );
    expect(
      editorImageCssFilterV1(defaultEditorImageAdjustmentsV1),
    ).toBeUndefined();
  });

  it("projects every tonal control into a deterministic browser filter", () => {
    const filter = editorImageCssFilterV1({
      ...defaultEditorImageAdjustmentsV1,
      brightness: 0.1,
      contrast: 0.2,
      saturation: -0.1,
      temperature: 0.5,
      tint: -0.3,
      highlights: 0.4,
      shadows: 0.25,
      blur: 2,
      grayscale: 0.2,
      sepia: 0.1,
    });

    expect(filter).toContain("brightness(");
    expect(filter).toContain("contrast(");
    expect(filter).toContain("saturate(");
    expect(filter).toContain("grayscale(0.2)");
    expect(filter).toContain("sepia(");
    expect(filter).toContain("hue-rotate(");
    expect(filter).toContain("blur(2px)");
  });
});
