export interface CanvasViewportV1 {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface CanvasViewportPointV1 {
  readonly x: number;
  readonly y: number;
}

export interface CanvasViewportSizeV1 {
  readonly width: number;
  readonly height: number;
}

export type CanvasViewportModeV1 = "fit" | "manual";

export type PersistedCanvasViewportV1 =
  | {
      readonly mode: "fit";
    }
  | ({
      readonly mode: "manual";
    } & CanvasViewportV1);

// Manual viewport gestures keep a usable editing scale. Fit is allowed to go
// lower so every supported or custom page can remain fully visible.
export const canvasViewportMinimumZoomV1 = 0.25;
export const canvasViewportFitMinimumZoomV1 = 0.001;
export const canvasViewportMaximumZoomV1 = 2;
export const canvasViewportDefaultSafeAreaV1 = {
  top: 94,
  inline: 120,
  bottom: 180,
} as const;

export function canvasViewportInsetFromCssV1(styles: {
  readonly getPropertyValue: (property: string) => string;
}): CanvasViewportSizeV1 {
  const readLength = (property: string, fallback: number): number => {
    const value = Number.parseFloat(styles.getPropertyValue(property));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const safeTop = readLength(
    "--canvas-v1-stage-safe-top",
    canvasViewportDefaultSafeAreaV1.top,
  );
  const safeInline = readLength(
    "--canvas-v1-stage-safe-inline",
    canvasViewportDefaultSafeAreaV1.inline,
  );
  const safeBottom = readLength(
    "--canvas-v1-stage-safe-bottom",
    canvasViewportDefaultSafeAreaV1.bottom,
  );
  return {
    width: safeInline * 2,
    height: safeTop + safeBottom,
  };
}

export function clampCanvasZoomV1(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(
    canvasViewportMaximumZoomV1,
    Math.max(canvasViewportMinimumZoomV1, zoom),
  );
}

export function fitCanvasViewportV1(
  stage: CanvasViewportSizeV1,
  page: CanvasViewportSizeV1,
  inset: CanvasViewportSizeV1 = {
    width: canvasViewportDefaultSafeAreaV1.inline * 2,
    height:
      canvasViewportDefaultSafeAreaV1.top +
      canvasViewportDefaultSafeAreaV1.bottom,
  },
): CanvasViewportV1 {
  const availableWidth = Math.max(1, stage.width - inset.width);
  const availableHeight = Math.max(1, stage.height - inset.height);
  return {
    zoom: Math.max(
      canvasViewportFitMinimumZoomV1,
      Math.min(
        1,
        availableWidth / Math.max(1, page.width),
        availableHeight / Math.max(1, page.height),
      ),
    ),
    panX: 0,
    panY: 0,
  };
}

export function zoomCanvasViewportAtPointV1(
  viewport: CanvasViewportV1,
  stage: CanvasViewportSizeV1,
  page: CanvasViewportSizeV1,
  anchor: CanvasViewportPointV1,
  nextZoom: number,
): CanvasViewportV1 {
  const zoom = clampCanvasZoomV1(nextZoom);
  const center = {
    x: stage.width / 2,
    y: stage.height / 2,
  };
  const pagePoint = {
    x: page.width / 2 + (anchor.x - center.x - viewport.panX) / viewport.zoom,
    y: page.height / 2 + (anchor.y - center.y - viewport.panY) / viewport.zoom,
  };
  return {
    zoom,
    panX: anchor.x - center.x - (pagePoint.x - page.width / 2) * zoom,
    panY: anchor.y - center.y - (pagePoint.y - page.height / 2) * zoom,
  };
}

export function panCanvasViewportV1(
  viewport: CanvasViewportV1,
  delta: CanvasViewportPointV1,
): CanvasViewportV1 {
  return {
    ...viewport,
    panX: viewport.panX + delta.x,
    panY: viewport.panY + delta.y,
  };
}

export function canvasViewportStorageKeyV1(
  workspaceId: string,
  documentId: string,
  pageId: string,
): string {
  return [
    "kanvas",
    "canvas-viewport",
    "v1",
    workspaceId,
    documentId,
    pageId,
  ].join(":");
}

export function parseCanvasViewportV1(
  value: string | null,
): PersistedCanvasViewportV1 | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Partial<PersistedCanvasViewportV1>;
    if (parsed.mode === "fit") {
      return {
        mode: "fit",
      };
    }
    if (
      parsed.mode !== "manual" ||
      typeof parsed.zoom !== "number" ||
      typeof parsed.panX !== "number" ||
      typeof parsed.panY !== "number" ||
      !Number.isFinite(parsed.panX) ||
      !Number.isFinite(parsed.panY)
    ) {
      return undefined;
    }
    return {
      mode: "manual",
      zoom: clampCanvasZoomV1(parsed.zoom),
      panX: parsed.panX,
      panY: parsed.panY,
    };
  } catch {
    return undefined;
  }
}
