import { describe, expect, it } from "vitest";

import {
  canvasImageCropSourcePreviewNodeV1,
  canvasImageNodeWithCropFrameMoveV1,
  canvasImageNodeWithCropFocalPointV1,
  canvasImageNodeWithFreeCropFrameV1,
  canvasImageCropZoomV1,
  canvasImageNodeWithCropZoomV1,
} from "./canvas-image-crop-direct-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const image = {
  id: "image-1",
  kind: "image",
  name: "Image",
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  transform: {
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  image: {
    source: { kind: "artifact", artifactId: "artifact-1" },
    intrinsicWidth: 1600,
    intrinsicHeight: 900,
    crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    fit: "cover",
    focalPoint: { x: 0.5, y: 0.5 },
  },
  cornerRadius: 0,
} as const satisfies EditorRuntimeNodeV1;

describe("Canvas direct image crop", () => {
  it("zooms around the current crop center without changing node geometry", () => {
    const zoomed = canvasImageNodeWithCropZoomV1(image, 4);

    expect(canvasImageCropZoomV1(zoomed)).toBe(4);
    expect(zoomed.transform).toEqual(image.transform);
    expect(zoomed.image.crop).toEqual({
      x: 0.375,
      y: 0.375,
      width: 0.25,
      height: 0.25,
    });
  });

  it("moves the crop frame with the pointer and clamps it to the source", () => {
    const moved = canvasImageNodeWithCropFrameMoveV1(image, { x: 80, y: -60 });

    expect(moved.transform).toMatchObject({ x: 180, y: 40 });
    expect(moved.image.crop).toEqual({
      x: 0.35,
      y: 0.15,
      width: 0.5,
      height: 0.5,
    });
    expect(
      canvasImageNodeWithCropFrameMoveV1(image, {
        x: 10_000,
        y: 10_000,
      }).image.crop,
    ).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("respects rotation and flip while moving the crop frame", () => {
    const transformed = {
      ...image,
      transform: { ...image.transform, rotation: 90, flipX: true },
    };
    const moved = canvasImageNodeWithCropFrameMoveV1(transformed, {
      x: 0,
      y: 60,
    });

    expect(moved.image.crop.x).toBeCloseTo(0.175);
    expect(moved.image.crop.y).toBeCloseTo(0.25);
    expect(moved.transform.x).toBeCloseTo(100);
    expect(moved.transform.y).toBeCloseTo(160);
  });

  it("moves crop content from keyboard-accessible focal point controls", () => {
    const focused = canvasImageNodeWithCropFocalPointV1(image, {
      x: 0.9,
      y: 0.1,
    });

    expect(focused.image.crop).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
    expect(focused.image.focalPoint).toEqual({ x: 0.75, y: 0.25 });
  });

  it("free-crops an edge without scaling the visible image content", () => {
    const cropped = canvasImageNodeWithFreeCropFrameV1(image, "e", {
      x: 300,
      y: 250,
    });

    expect(cropped.transform).toMatchObject({ x: 100, width: 200 });
    expect(cropped.image.crop).toMatchObject({
      x: 0.25,
      width: 0.25,
    });
  });

  it("free-crops both axes from a corner and keeps the opposite corner fixed", () => {
    const cropped = canvasImageNodeWithFreeCropFrameV1(image, "nw", {
      x: 200,
      y: 175,
    });

    expect(cropped.transform).toMatchObject({
      x: 200,
      y: 175,
      width: 300,
      height: 225,
    });
    expect(cropped.image.crop).toEqual({
      x: 0.375,
      y: 0.375,
      width: 0.375,
      height: 0.375,
    });
  });

  it("maps visual free-crop edges through image flips", () => {
    const flipped = {
      ...image,
      transform: { ...image.transform, flipX: true },
    };
    const cropped = canvasImageNodeWithFreeCropFrameV1(flipped, "w", {
      x: 200,
      y: 250,
    });

    expect(cropped.image.crop).toMatchObject({
      x: 0.25,
      width: 0.375,
    });
  });

  it("renders the full source behind an uncommitted crop frame", () => {
    const preview = canvasImageCropSourcePreviewNodeV1(image);

    expect(preview.transform).toMatchObject({
      x: -100,
      y: -50,
      width: 800,
      height: 600,
    });
    expect(preview.image.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("keeps the crop center aligned when previewing a rotated source", () => {
    const rotated = {
      ...image,
      transform: { ...image.transform, rotation: 90 },
    };
    const preview = canvasImageCropSourcePreviewNodeV1(rotated);

    expect(preview.transform).toMatchObject({
      x: -100,
      y: -50,
      width: 800,
      height: 600,
      rotation: 90,
    });
  });
});
