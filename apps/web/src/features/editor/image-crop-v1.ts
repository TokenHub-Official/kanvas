import type { EditorPlacedImageV1 } from "@kanvas/contracts/editor";

export function centeredImageCropForAspectV1(
  intrinsicWidth: number,
  intrinsicHeight: number,
  aspectRatio: number,
): EditorPlacedImageV1["crop"] {
  if (
    !Number.isFinite(intrinsicWidth) ||
    !Number.isFinite(intrinsicHeight) ||
    !Number.isFinite(aspectRatio) ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0 ||
    aspectRatio <= 0
  ) {
    throw new Error(
      "Image crop requires positive dimensions and aspect ratio.",
    );
  }
  const sourceAspect = intrinsicWidth / intrinsicHeight;
  if (sourceAspect > aspectRatio) {
    const width = aspectRatio / sourceAspect;
    return {
      x: (1 - width) / 2,
      y: 0,
      width,
      height: 1,
    };
  }
  const height = sourceAspect / aspectRatio;
  return {
    x: 0,
    y: (1 - height) / 2,
    width: 1,
    height,
  };
}
