import { describe, expect, it } from "vitest";

import { centeredImageCropForAspectV1 } from "./image-crop-v1.js";

describe("Canvas Core V1 image crop", () => {
  it("centers a square crop in landscape and portrait sources", () => {
    expect(centeredImageCropForAspectV1(1600, 900, 1)).toEqual({
      x: 0.21875,
      y: 0,
      width: 0.5625,
      height: 1,
    });
    expect(centeredImageCropForAspectV1(900, 1600, 1)).toEqual({
      x: 0,
      y: 0.21875,
      width: 1,
      height: 0.5625,
    });
  });

  it("rejects invalid geometry", () => {
    expect(() => centeredImageCropForAspectV1(0, 100, 1)).toThrow(
      "positive dimensions",
    );
  });
});
