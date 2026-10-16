import type { EditorPlacedImageV1 } from "@kanvas/contracts/editor";

import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import {
  editorRectCenterV1,
  rotateEditorPointV1,
} from "./editor-geometry-v1.js";
import { centeredImageCropForAspectV1 } from "./image-crop-v1.js";
import {
  defaultEditorImageAdjustmentsV1,
  editorImageAdjustmentsV1,
  type EditorImageAdjustmentsV1,
} from "./image-adjustments-v1.js";

export type CanvasImageInspectorSectionV1 = "adjust" | "crop" | "filters";

export type CanvasImageAdjustmentSectionV1 = "color" | "detail" | "light";

export type CanvasImageCropPresetIdV1 =
  "original" | "1:1" | "4:5" | "3:4" | "16:9" | "9:16";

export interface CanvasImageFilterPresetV1 {
  readonly adjustments: EditorImageAdjustmentsV1;
  readonly group: "base" | "style" | "temperature";
  readonly id: string;
  readonly labelKey: string;
}

export const canvasImageAdjustmentControlsV1 = [
  ["brightness", -1, 1, 0.01, "light"],
  ["contrast", -1, 1, 0.01, "light"],
  ["highlights", -1, 1, 0.01, "light"],
  ["shadows", -1, 1, 0.01, "light"],
  ["saturation", -1, 1, 0.01, "color"],
  ["temperature", -1, 1, 0.01, "color"],
  ["tint", -1, 1, 0.01, "color"],
  ["blur", 0, 100, 0.5, "detail"],
  ["vignette", 0, 1, 0.01, "detail"],
  ["grayscale", 0, 1, 0.01, "detail"],
  ["sepia", 0, 1, 0.01, "detail"],
] as const satisfies readonly [
  keyof EditorImageAdjustmentsV1,
  number,
  number,
  number,
  CanvasImageAdjustmentSectionV1,
][];

export const canvasImageCropPresetsV1 = [
  { id: "original" },
  { id: "1:1", aspect: 1 },
  { id: "4:5", aspect: 4 / 5 },
  { id: "3:4", aspect: 3 / 4 },
  { id: "16:9", aspect: 16 / 9 },
  { id: "9:16", aspect: 9 / 16 },
] as const satisfies readonly {
  readonly aspect?: number;
  readonly id: CanvasImageCropPresetIdV1;
}[];

export const canvasImageFilterPresetsV1: readonly CanvasImageFilterPresetV1[] =
  [
    {
      id: "natural",
      labelKey: "natural",
      group: "base",
      adjustments: defaultEditorImageAdjustmentsV1,
    },
    {
      id: "bright",
      labelKey: "bright",
      group: "base",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        brightness: 0.1,
        contrast: 0.04,
        saturation: 0.06,
      },
    },
    {
      id: "soft",
      labelKey: "soft",
      group: "base",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: -0.08,
        highlights: 0.08,
        saturation: -0.04,
      },
    },
    {
      id: "clean",
      labelKey: "clear",
      group: "base",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        brightness: 0.06,
        highlights: 0.12,
        shadows: 0.08,
      },
    },
    {
      id: "vivid",
      labelKey: "vivid",
      group: "base",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: 0.08,
        saturation: 0.18,
      },
    },
    {
      id: "matte",
      labelKey: "matte",
      group: "base",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: -0.12,
        saturation: -0.06,
        shadows: 0.16,
      },
    },
    {
      id: "warm",
      labelKey: "warm",
      group: "temperature",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        saturation: 0.05,
        temperature: 0.18,
      },
    },
    {
      id: "cool",
      labelKey: "cool",
      group: "temperature",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        temperature: -0.18,
        tint: 0.03,
      },
    },
    {
      id: "golden",
      labelKey: "gold",
      group: "temperature",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        highlights: 0.08,
        sepia: 0.08,
        temperature: 0.28,
      },
    },
    {
      id: "blue-hour",
      labelKey: "blue",
      group: "temperature",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        shadows: -0.08,
        temperature: -0.28,
        tint: 0.06,
      },
    },
    {
      id: "rose",
      labelKey: "rose",
      group: "temperature",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        saturation: 0.05,
        temperature: 0.08,
        tint: 0.18,
      },
    },
    {
      id: "jade",
      labelKey: "teal",
      group: "temperature",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        saturation: 0.04,
        temperature: -0.04,
        tint: -0.16,
      },
    },
    {
      id: "mono",
      labelKey: "mono",
      group: "style",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: 0.08,
        grayscale: 1,
      },
    },
    {
      id: "vintage",
      labelKey: "vintage",
      group: "style",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        sepia: 0.72,
        temperature: 0.14,
        vignette: 0.18,
      },
    },
    {
      id: "dramatic",
      labelKey: "rich",
      group: "style",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: 0.2,
        saturation: 0.12,
        shadows: -0.08,
        vignette: 0.12,
      },
    },
    {
      id: "faded",
      labelKey: "fade",
      group: "style",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: -0.16,
        highlights: 0.12,
        saturation: -0.18,
      },
    },
    {
      id: "cinema",
      labelKey: "cinema",
      group: "style",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: 0.1,
        saturation: -0.08,
        temperature: 0.06,
        vignette: 0.22,
      },
    },
    {
      id: "high-contrast",
      labelKey: "contrast",
      group: "style",
      adjustments: {
        ...defaultEditorImageAdjustmentsV1,
        contrast: 0.3,
        highlights: 0.08,
        shadows: -0.15,
      },
    },
  ];

export function canvasImageControlsForSectionV1(
  section: CanvasImageAdjustmentSectionV1,
) {
  return canvasImageAdjustmentControlsV1.filter(
    (control) => control[4] === section,
  );
}

export function canvasImageNodeWithAdjustmentV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
  key: keyof EditorImageAdjustmentsV1,
  value: number,
): Extract<EditorRuntimeNodeV1, { kind: "image" }> {
  return {
    ...node,
    image: {
      ...node.image,
      adjustments: {
        ...editorImageAdjustmentsV1(node.image),
        [key]: value,
      },
    },
  };
}

export function canvasImageNodeWithFilterV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
  preset: CanvasImageFilterPresetV1,
): Extract<EditorRuntimeNodeV1, { kind: "image" }> {
  return {
    ...node,
    image: {
      ...node.image,
      adjustments: { ...preset.adjustments },
    },
  };
}

export function canvasImageNodeWithCropPresetV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
  presetId: CanvasImageCropPresetIdV1,
  sourceTransform = node.transform,
): Extract<EditorRuntimeNodeV1, { kind: "image" }> {
  const preset = canvasImageCropPresetsV1.find(
    (candidate) => candidate.id === presetId,
  );
  const sourceWidth = node.image.intrinsicWidth ?? node.transform.width;
  const sourceHeight = node.image.intrinsicHeight ?? node.transform.height;
  const aspect =
    !preset || preset.id === "original"
      ? sourceWidth / sourceHeight
      : preset.aspect;
  const centeredCrop =
    !preset || preset.id === "original"
      ? { x: 0, y: 0, width: 1, height: 1 }
      : centeredImageCropForAspectV1(sourceWidth, sourceHeight, aspect);
  const currentCrop = node.image.crop;
  const currentCenter = {
    x: currentCrop.x + currentCrop.width / 2,
    y: currentCrop.y + currentCrop.height / 2,
  };
  const crop = {
    x: Math.min(
      1 - centeredCrop.width,
      Math.max(0, currentCenter.x - centeredCrop.width / 2),
    ),
    y: Math.min(
      1 - centeredCrop.height,
      Math.max(0, currentCenter.y - centeredCrop.height / 2),
    ),
    width: centeredCrop.width,
    height: centeredCrop.height,
  };
  const sourceCenter = editorRectCenterV1(sourceTransform);
  const cropCenter = {
    x: crop.x + crop.width / 2,
    y: crop.y + crop.height / 2,
  };
  const localCropCenter = {
    x:
      sourceCenter.x +
      (cropCenter.x - 0.5) *
        sourceTransform.width *
        (sourceTransform.flipX ? -1 : 1),
    y:
      sourceCenter.y +
      (cropCenter.y - 0.5) *
        sourceTransform.height *
        (sourceTransform.flipY ? -1 : 1),
  };
  const worldCropCenter = rotateEditorPointV1(
    localCropCenter,
    sourceCenter,
    sourceTransform.rotation,
  );
  const width = sourceTransform.width * crop.width;
  const height = sourceTransform.height * crop.height;
  return {
    ...node,
    transform: {
      ...node.transform,
      x: worldCropCenter.x - width / 2,
      y: worldCropCenter.y - height / 2,
      width,
      height,
      rotation: sourceTransform.rotation,
    },
    image: {
      ...node.image,
      crop,
      fit: "cover",
      focalPoint: cropCenter,
    },
  };
}

export function canvasImageCropPresetIdForNodeV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
): CanvasImageCropPresetIdV1 | undefined {
  const crop = node.image.crop;
  if (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1) {
    return "original";
  }
  const sourceWidth = node.image.intrinsicWidth ?? node.transform.width;
  const sourceHeight = node.image.intrinsicHeight ?? node.transform.height;
  if (sourceWidth <= 0 || sourceHeight <= 0 || crop.height <= 0) {
    return undefined;
  }
  const croppedAspect =
    (sourceWidth * crop.width) / (sourceHeight * crop.height);
  return canvasImageCropPresetsV1.find(
    (preset) =>
      preset.id !== "original" &&
      Math.abs(preset.aspect - croppedAspect) < 0.001,
  )?.id;
}

export function canvasImageNodeWithFitV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
  fit: EditorPlacedImageV1["fit"],
): Extract<EditorRuntimeNodeV1, { kind: "image" }> {
  return {
    ...node,
    image: { ...node.image, fit },
  };
}

export function resetCanvasImageNodeV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "image" }>,
): Extract<EditorRuntimeNodeV1, { kind: "image" }> {
  return {
    ...node,
    cornerRadius: 0,
    image: {
      ...node.image,
      adjustments: { ...defaultEditorImageAdjustmentsV1 },
    },
  };
}

export function canvasImageFilterIsActiveV1(
  image: Pick<EditorPlacedImageV1, "adjustments">,
  preset: CanvasImageFilterPresetV1,
): boolean {
  const adjustments = editorImageAdjustmentsV1(image);
  return (
    Object.entries(preset.adjustments) as [
      keyof EditorImageAdjustmentsV1,
      number,
    ][]
  ).every(([key, value]) => adjustments[key] === value);
}
