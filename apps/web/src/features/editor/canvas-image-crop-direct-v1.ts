import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import {
  editorRectCenterV1,
  resizeEditorNodeV1,
  rotateEditorPointV1,
  type EditorPointV1,
  type EditorResizeHandleV1,
} from "./editor-geometry-v1.js";

type ImageNodeV1 = Extract<EditorRuntimeNodeV1, { kind: "image" }>;

const HALF_TURN_DEGREES = 180;
const MINIMUM_CROP_SIZE = 0.01;
const MINIMUM_CROP_FRAME_SIZE = 24;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function localCropDelta(
  node: ImageNodeV1,
  delta: { readonly x: number; readonly y: number },
) {
  const radians = (-node.transform.rotation * Math.PI) / HALF_TURN_DEGREES;
  const rotated = {
    x: delta.x * Math.cos(radians) - delta.y * Math.sin(radians),
    y: delta.x * Math.sin(radians) + delta.y * Math.cos(radians),
  };
  return {
    x: node.transform.flipX ? -rotated.x : rotated.x,
    y: node.transform.flipY ? -rotated.y : rotated.y,
  };
}

function sourceCropHandle(
  node: ImageNodeV1,
  handle: EditorResizeHandleV1,
): EditorResizeHandleV1 {
  let vertical = "";
  if (handle.includes("n")) vertical = "n";
  else if (handle.includes("s")) vertical = "s";
  let horizontal = "";
  if (handle.includes("w")) horizontal = "w";
  else if (handle.includes("e")) horizontal = "e";
  if (node.transform.flipX) {
    if (horizontal === "w") horizontal = "e";
    else if (horizontal === "e") horizontal = "w";
  }
  if (node.transform.flipY) {
    if (vertical === "n") vertical = "s";
    else if (vertical === "s") vertical = "n";
  }
  return `${vertical}${horizontal}` as EditorResizeHandleV1;
}

function horizontalCropRatioLimit(
  crop: ImageNodeV1["image"]["crop"],
  handle: EditorResizeHandleV1,
): number {
  if (handle.includes("w")) return (crop.x + crop.width) / crop.width;
  if (handle.includes("e")) return (1 - crop.x) / crop.width;
  return 1;
}

function verticalCropRatioLimit(
  crop: ImageNodeV1["image"]["crop"],
  handle: EditorResizeHandleV1,
): number {
  if (handle.includes("n")) return (crop.y + crop.height) / crop.height;
  if (handle.includes("s")) return (1 - crop.y) / crop.height;
  return 1;
}

export function canvasImageNodeWithFreeCropFrameV1(
  node: ImageNodeV1,
  handle: EditorResizeHandleV1,
  point: EditorPointV1,
): ImageNodeV1 {
  const transform = node.transform;
  const desired = resizeEditorNodeV1(transform, handle, point, false);
  const crop = node.image.crop;
  const sourceHandle = sourceCropHandle(node, handle);
  const horizontalRatioLimit = horizontalCropRatioLimit(crop, sourceHandle);
  const verticalRatioLimit = verticalCropRatioLimit(crop, sourceHandle);
  const widthRatio =
    handle.includes("w") || handle.includes("e")
      ? clamp(
          desired.width / transform.width,
          MINIMUM_CROP_FRAME_SIZE / transform.width,
          horizontalRatioLimit,
        )
      : 1;
  const heightRatio =
    handle.includes("n") || handle.includes("s")
      ? clamp(
          desired.height / transform.height,
          MINIMUM_CROP_FRAME_SIZE / transform.height,
          verticalRatioLimit,
        )
      : 1;
  const cropWidth = crop.width * widthRatio;
  const cropHeight = crop.height * heightRatio;
  const cropX = sourceHandle.includes("w")
    ? crop.x + crop.width - cropWidth
    : crop.x;
  const cropY = sourceHandle.includes("n")
    ? crop.y + crop.height - cropHeight
    : crop.y;
  const center = editorRectCenterV1(transform);
  let localX = center.x;
  if (handle.includes("w")) {
    localX = transform.x + transform.width - transform.width * widthRatio;
  } else if (handle.includes("e")) {
    localX = transform.x + transform.width * widthRatio;
  }
  let localY = center.y;
  if (handle.includes("n")) {
    localY = transform.y + transform.height - transform.height * heightRatio;
  } else if (handle.includes("s")) {
    localY = transform.y + transform.height * heightRatio;
  }
  const localPoint = { x: localX, y: localY };
  const clampedPoint = rotateEditorPointV1(
    localPoint,
    center,
    transform.rotation,
  );
  const resizedTransform = resizeEditorNodeV1(
    transform,
    handle,
    clampedPoint,
    false,
  );
  return {
    ...node,
    transform: resizedTransform,
    image: {
      ...node.image,
      crop: {
        x: clamp(cropX, 0, 1 - cropWidth),
        y: clamp(cropY, 0, 1 - cropHeight),
        width: cropWidth,
        height: cropHeight,
      },
      fit: "cover",
      focalPoint: {
        x: clamp(cropX + cropWidth / 2, 0, 1),
        y: clamp(cropY + cropHeight / 2, 0, 1),
      },
    },
  };
}

export function canvasImageCropZoomV1(node: ImageNodeV1): number {
  return 1 / Math.max(node.image.crop.width, node.image.crop.height);
}

export function canvasImageNodeWithCropZoomV1(
  node: ImageNodeV1,
  zoom: number,
): ImageNodeV1 {
  const crop = node.image.crop;
  const aspect = crop.width / Math.max(MINIMUM_CROP_SIZE, crop.height);
  const normalizedZoom = Math.max(1, zoom);
  const baseWidth = aspect >= 1 ? 1 : aspect;
  const baseHeight = aspect >= 1 ? 1 / aspect : 1;
  const width = Math.max(MINIMUM_CROP_SIZE, baseWidth / normalizedZoom);
  const height = Math.max(MINIMUM_CROP_SIZE, baseHeight / normalizedZoom);
  const center = {
    x: crop.x + crop.width / 2,
    y: crop.y + crop.height / 2,
  };
  const x = clamp(center.x - width / 2, 0, 1 - width);
  const y = clamp(center.y - height / 2, 0, 1 - height);
  return {
    ...node,
    image: {
      ...node.image,
      crop: { x, y, width, height },
      fit: "cover",
      focalPoint: { x: x + width / 2, y: y + height / 2 },
    },
  };
}

export function canvasImageNodeWithCropFrameMoveV1(
  node: ImageNodeV1,
  delta: { readonly x: number; readonly y: number },
): ImageNodeV1 {
  const localDelta = localCropDelta(node, delta);
  const crop = node.image.crop;
  const sourcePreview = canvasImageCropSourcePreviewNodeV1(node);
  const x = clamp(
    crop.x + localDelta.x / sourcePreview.transform.width,
    0,
    1 - crop.width,
  );
  const y = clamp(
    crop.y + localDelta.y / sourcePreview.transform.height,
    0,
    1 - crop.height,
  );
  const appliedLocalDelta = {
    x:
      (x - crop.x) *
      sourcePreview.transform.width *
      (node.transform.flipX ? -1 : 1),
    y:
      (y - crop.y) *
      sourcePreview.transform.height *
      (node.transform.flipY ? -1 : 1),
  };
  const radians = (node.transform.rotation * Math.PI) / HALF_TURN_DEGREES;
  const appliedWorldDelta = {
    x:
      appliedLocalDelta.x * Math.cos(radians) -
      appliedLocalDelta.y * Math.sin(radians),
    y:
      appliedLocalDelta.x * Math.sin(radians) +
      appliedLocalDelta.y * Math.cos(radians),
  };
  return {
    ...node,
    transform: {
      ...node.transform,
      x: node.transform.x + appliedWorldDelta.x,
      y: node.transform.y + appliedWorldDelta.y,
    },
    image: {
      ...node.image,
      crop: { ...crop, x, y },
      fit: "cover",
      focalPoint: {
        x: x + crop.width / 2,
        y: y + crop.height / 2,
      },
    },
  };
}

export function canvasImageNodeWithCropFocalPointV1(
  node: ImageNodeV1,
  focalPoint: { readonly x: number; readonly y: number },
): ImageNodeV1 {
  const crop = node.image.crop;
  const centerX = clamp(focalPoint.x, crop.width / 2, 1 - crop.width / 2);
  const centerY = clamp(focalPoint.y, crop.height / 2, 1 - crop.height / 2);
  const x = centerX - crop.width / 2;
  const y = centerY - crop.height / 2;
  return {
    ...node,
    image: {
      ...node.image,
      crop: { ...crop, x, y },
      fit: "cover",
      focalPoint: { x: centerX, y: centerY },
    },
  };
}

export function canvasImageCropSourcePreviewNodeV1(
  node: ImageNodeV1,
): ImageNodeV1 {
  const crop = node.image.crop;
  const transform = node.transform;
  const width = transform.width / Math.max(crop.width, MINIMUM_CROP_SIZE);
  const height = transform.height / Math.max(crop.height, MINIMUM_CROP_SIZE);
  const localOffset = {
    x: (crop.x + crop.width / 2 - 0.5) * width * (transform.flipX ? -1 : 1),
    y: (crop.y + crop.height / 2 - 0.5) * height * (transform.flipY ? -1 : 1),
  };
  const radians = (transform.rotation * Math.PI) / HALF_TURN_DEGREES;
  const rotatedOffset = {
    x: localOffset.x * Math.cos(radians) - localOffset.y * Math.sin(radians),
    y: localOffset.x * Math.sin(radians) + localOffset.y * Math.cos(radians),
  };
  const cropFrameCenter = editorRectCenterV1(transform);
  const sourceCenter = {
    x: cropFrameCenter.x - rotatedOffset.x,
    y: cropFrameCenter.y - rotatedOffset.y,
  };
  return {
    ...node,
    transform: {
      ...transform,
      x: sourceCenter.x - width / 2,
      y: sourceCenter.y - height / 2,
      width,
      height,
    },
    image: {
      ...node.image,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      focalPoint: { x: 0.5, y: 0.5 },
    },
  };
}
