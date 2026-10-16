import type { EditorPlacedImageV1 } from "@kanvas/contracts/editor";

export type EditorImageAdjustmentsV1 = NonNullable<
  EditorPlacedImageV1["adjustments"]
>;

export const defaultEditorImageAdjustmentsV1 = {
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
} as const satisfies EditorImageAdjustmentsV1;

export function editorImageAdjustmentsV1(
  image: Pick<EditorPlacedImageV1, "adjustments">,
): EditorImageAdjustmentsV1 {
  return {
    ...defaultEditorImageAdjustmentsV1,
    ...image.adjustments,
  };
}

export function editorImageCssFilterV1(
  adjustments: EditorImageAdjustmentsV1,
): string | undefined {
  const brightness =
    1 +
    adjustments.brightness +
    adjustments.shadows * 0.16 +
    adjustments.highlights * 0.08;
  const contrast =
    1 +
    adjustments.contrast +
    adjustments.highlights * 0.14 -
    adjustments.shadows * 0.08;
  const saturation =
    1 + adjustments.saturation + Math.abs(adjustments.temperature) * 0.16;
  const hue = adjustments.tint * 28 - adjustments.temperature * 9;
  const sepia = Math.min(
    1,
    adjustments.sepia + Math.abs(adjustments.temperature) * 0.12,
  );
  const filters = [
    Math.abs(brightness - 1) > 0.0001
      ? `brightness(${String(Math.max(0, brightness))})`
      : "",
    Math.abs(contrast - 1) > 0.0001
      ? `contrast(${String(Math.max(0, contrast))})`
      : "",
    Math.abs(saturation - 1) > 0.0001
      ? `saturate(${String(Math.max(0, saturation))})`
      : "",
    adjustments.grayscale > 0
      ? `grayscale(${String(adjustments.grayscale)})`
      : "",
    sepia > 0 ? `sepia(${String(sepia)})` : "",
    Math.abs(hue) > 0.0001 ? `hue-rotate(${String(hue)}deg)` : "",
    adjustments.blur > 0 ? `blur(${String(adjustments.blur)}px)` : "",
  ].filter(Boolean);
  return filters.length > 0 ? filters.join(" ") : undefined;
}
