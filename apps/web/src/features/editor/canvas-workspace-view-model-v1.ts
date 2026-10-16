import type { CanvasOperationOutputMode } from "./canvas-operation-registry.js";
import type { CanvasInspectorModeV1 } from "./canvas-inspector-state-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export type CanvasSaveStatusV1 =
  "error" | "idle" | "saved" | "saving" | "uploading";

export function effectiveCanvasSaveStatusV1({
  fingerprintMatchesSaved,
  pendingUploadCount,
  status,
}: {
  readonly fingerprintMatchesSaved: boolean;
  readonly pendingUploadCount: number;
  readonly status: CanvasSaveStatusV1;
}): CanvasSaveStatusV1 {
  if (
    status === "uploading" &&
    pendingUploadCount === 0 &&
    fingerprintMatchesSaved
  ) {
    return "saved";
  }
  if (pendingUploadCount > 0 && status !== "saving" && status !== "error") {
    return "uploading";
  }
  return status;
}

export function preferredCanvasOutputDispositionV1(
  explicitDisposition: CanvasOperationOutputMode | undefined,
  supportedModes: readonly CanvasOperationOutputMode[],
): CanvasOperationOutputMode | undefined {
  if (explicitDisposition) {
    return explicitDisposition;
  }
  const preference: readonly CanvasOperationOutputMode[] = [
    "replace_content",
    "add_node",
    "asset_only",
    "set_background",
  ];
  return preference.find((mode) => supportedModes.includes(mode));
}

export function selectedCanvasImagePreviewUrlV1(
  selected: EditorRuntimeNodeV1 | undefined,
  artifactSourceUrl: (artifactId: string) => string | undefined,
): string | undefined {
  if (selected?.kind !== "image") {
    return undefined;
  }
  if (selected.image.source.kind === "local") {
    return selected.image.source.previewUrl;
  }
  return artifactSourceUrl(selected.image.source.artifactId);
}

export function canvasSaveStatusMessageKeyV1(
  canEdit: boolean,
  status: CanvasSaveStatusV1,
) {
  if (!canEdit) {
    return "canvas.shell.readOnly";
  }
  const keys = {
    error: "canvas.shell.notSaved",
    idle: "canvas.shell.neverSaved",
    saved: "canvas.shell.saved",
    saving: "canvas.shell.saving",
    uploading: "canvas.shell.uploading",
  } as const satisfies Record<CanvasSaveStatusV1, string>;
  return keys[status];
}

export function canvasInspectorTitleKeyV1(mode: CanvasInspectorModeV1) {
  const keys = {
    common: "canvas.common.object",
    layers: "canvas.layers.layers",
    position: "canvas.layers.position",
    style: "canvas.node.style",
    "text-effects": "canvas.text.effectsTitle",
    "text-spacing": "canvas.text.spacingTitle",
  } as const satisfies Record<CanvasInspectorModeV1, string>;
  return keys[mode];
}
