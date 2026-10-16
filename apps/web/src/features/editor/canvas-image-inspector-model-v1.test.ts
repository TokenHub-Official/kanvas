import { describe, expect, it } from "vitest";

import {
  canvasImageAdjustmentControlsV1,
  canvasImageControlsForSectionV1,
  canvasImageCropPresetIdForNodeV1,
  canvasImageCropPresetsV1,
  canvasImageFilterPresetsV1,
  canvasImageNodeWithAdjustmentV1,
  canvasImageNodeWithCropPresetV1,
  canvasImageNodeWithFitV1,
  resetCanvasImageNodeV1,
} from "./canvas-image-inspector-model-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import {
  canvasImageCropSourcePreviewNodeV1,
  canvasImageNodeWithCropFrameMoveV1,
  canvasImageNodeWithFreeCropFrameV1,
} from "./canvas-image-crop-direct-v1.js";

const imageNode = {
  id: "image:1",
  kind: "image",
  name: "Image",
  opacity: 1,
  blendMode: "normal",
  locked: false,
  visible: true,
  transform: {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    flipX: false,
    flipY: false,
    rotation: 0,
  },
  cornerRadius: 12,
  image: {
    source: {
      kind: "local",
      localId: "local:1",
      mediaType: "image/png",
      name: "image.png",
      previewUrl: "blob:image",
      size: 100,
      uploadState: "uploading",
    },
    intrinsicWidth: 800,
    intrinsicHeight: 600,
    crop: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
    fit: "contain",
    focalPoint: { x: 0.5, y: 0.5 },
  },
} as const satisfies Extract<EditorRuntimeNodeV1, { kind: "image" }>;

describe("Canvas image inspector model", () => {
  it("partitions every adjustment into one inspector section", () => {
    const light = canvasImageControlsForSectionV1("light");
    const color = canvasImageControlsForSectionV1("color");
    const detail = canvasImageControlsForSectionV1("detail");

    expect(light.map(([key]) => key)).toEqual([
      "brightness",
      "contrast",
      "highlights",
      "shadows",
    ]);
    expect(color.map(([key]) => key)).toEqual([
      "saturation",
      "temperature",
      "tint",
    ]);
    expect(detail.map(([key]) => key)).toEqual([
      "blur",
      "vignette",
      "grayscale",
      "sepia",
    ]);
    expect(light.length + color.length + detail.length).toBe(
      canvasImageAdjustmentControlsV1.length,
    );
  });

  it("publishes stable filter and crop choices without UI labels", () => {
    expect(canvasImageFilterPresetsV1[0]?.id).toBe("natural");
    expect(canvasImageCropPresetsV1.map(({ id }) => id)).toEqual([
      "original",
      "1:1",
      "4:5",
      "3:4",
      "16:9",
      "9:16",
    ]);
  });

  it("projects slider previews without mutating the input node", () => {
    const changed = canvasImageNodeWithAdjustmentV1(
      imageNode,
      "brightness",
      0.25,
    );

    expect(changed.image.adjustments?.brightness).toBe(0.25);
    expect("adjustments" in imageNode.image).toBe(false);
  });

  it("applies centered crop and fit as discrete node replacements", () => {
    const cropped = canvasImageNodeWithCropPresetV1(imageNode, "1:1");
    const fitted = canvasImageNodeWithFitV1(cropped, "cover");

    expect(cropped.image.crop).toEqual({
      x: 0.125,
      y: 0,
      width: 0.75,
      height: 1,
    });
    expect(cropped.transform).toEqual({
      ...imageNode.transform,
      x: 50,
      width: 300,
    });
    expect(canvasImageCropPresetIdForNodeV1(cropped)).toBe("1:1");
    expect(fitted.image.fit).toBe("cover");
    expect(imageNode.image.fit).toBe("contain");
  });

  it("derives every crop ratio from the same frame basis", () => {
    const square = canvasImageNodeWithCropPresetV1(imageNode, "1:1");
    const portrait = canvasImageNodeWithCropPresetV1(
      square,
      "9:16",
      imageNode.transform,
    );

    expect(square.transform.width / square.transform.height).toBe(1);
    expect(portrait.transform.width / portrait.transform.height).toBeCloseTo(
      9 / 16,
    );
    expect(portrait.transform.height).toBe(imageNode.transform.height);
  });

  it("replaces a free crop with a ratio mask on the full source", () => {
    const freeCrop = canvasImageNodeWithFreeCropFrameV1(imageNode, "e", {
      x: 260,
      y: 150,
    });
    const fullSource = canvasImageCropSourcePreviewNodeV1(freeCrop);
    const square = canvasImageNodeWithCropPresetV1(
      freeCrop,
      "1:1",
      fullSource.transform,
    );

    expect(square.transform).toMatchObject({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    expect(square.image.crop).toEqual({
      x: 0,
      y: 0,
      width: 0.75,
      height: 1,
    });
  });

  it("keeps the full source for a later non-destructive crop session", () => {
    const square = canvasImageNodeWithCropPresetV1(imageNode, "1:1");
    const movedSquare = canvasImageNodeWithCropFrameMoveV1(square, {
      x: 40,
      y: 0,
    });
    const fullSource = canvasImageCropSourcePreviewNodeV1(movedSquare);
    const portrait = canvasImageNodeWithCropPresetV1(
      movedSquare,
      "4:5",
      fullSource.transform,
    );
    const nextFullSource = canvasImageCropSourcePreviewNodeV1(portrait);

    expect(nextFullSource.transform).toMatchObject({
      x: fullSource.transform.x,
      y: fullSource.transform.y,
      width: fullSource.transform.width,
      height: fullSource.transform.height,
    });
    expect(portrait.transform.width / portrait.transform.height).toBeCloseTo(
      4 / 5,
    );
  });

  it("resets adjustments and radius in one replacement", () => {
    const changed = canvasImageNodeWithAdjustmentV1(imageNode, "contrast", 0.5);
    const reset = resetCanvasImageNodeV1(changed);

    expect(reset.cornerRadius).toBe(0);
    expect(reset.image.adjustments).toEqual({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 0,
      blur: 0,
      vignette: 0,
      grayscale: 0,
      sepia: 0,
    });
  });
});
