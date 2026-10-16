import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";

import {
  clampCanvasZoomV1,
  canvasViewportInsetFromCssV1,
  canvasViewportStorageKeyV1,
  fitCanvasViewportV1,
  panCanvasViewportV1,
  parseCanvasViewportV1,
  zoomCanvasViewportAtPointV1,
  type CanvasViewportModeV1,
} from "./canvas-viewport-v1.js";
import { canvasWheelEventPathOwnsOverlayV1 } from "./canvas-interaction-boundary-v1.js";

const wheelZoomSensitivity = 0.002;
const DEFAULT_CANVAS_ZOOM = 0.55;

export interface CanvasViewportPanV1 {
  readonly x: number;
  readonly y: number;
}

export function useCanvasViewportV1({
  documentId,
  pageHeight,
  pageId,
  pageWidth,
  persist = true,
  spaceHeld,
  workspaceId,
}: {
  readonly documentId: string;
  readonly pageHeight: number;
  readonly pageId: string;
  readonly pageWidth: number;
  readonly persist?: boolean;
  readonly spaceHeld: boolean;
  readonly workspaceId: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const connectStage = useCallback((element: HTMLDivElement | null) => {
    stage.current = element;
    setStageElement(element);
  }, []);
  const [viewportMode, setViewportModeState] =
    useState<CanvasViewportModeV1>("fit");
  const [zoom, setZoom] = useState(DEFAULT_CANVAS_ZOOM);
  const [pan, setPan] = useState<CanvasViewportPanV1>({
    x: 0,
    y: 0,
  });
  const [panGesture, setPanGesture] = useState<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    readonly panX: number;
    readonly panY: number;
  }>();
  const [restoredViewportKey, setRestoredViewportKey] = useState<string>();
  const viewportModeRef = useRef<CanvasViewportModeV1>("fit");

  const setViewportMode = useCallback((mode: CanvasViewportModeV1) => {
    viewportModeRef.current = mode;
    setViewportModeState(mode);
  }, []);

  const applyFitViewport = useCallback(() => {
    const element = stage.current;
    const bounds = element?.getBoundingClientRect();
    if (!element || !bounds) {
      return;
    }
    const next = fitCanvasViewportV1(
      {
        width: bounds.width,
        height: bounds.height,
      },
      {
        width: pageWidth,
        height: pageHeight,
      },
      canvasViewportInsetFromCssV1(window.getComputedStyle(element)),
    );
    setZoom(next.zoom);
    setPan({ x: next.panX, y: next.panY });
  }, [pageHeight, pageWidth]);

  const fitViewport = useCallback(() => {
    setViewportMode("fit");
    applyFitViewport();
  }, [applyFitViewport, setViewportMode]);

  const beginPan = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 1 && !(event.button === 0 && spaceHeld)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setViewportMode("manual");
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanGesture({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  };

  const updatePan = (event: PointerEvent<HTMLElement>) => {
    if (!panGesture || event.pointerId !== panGesture.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setPan({
      x: panGesture.panX + event.clientX - panGesture.startX,
      y: panGesture.panY + event.clientY - panGesture.startY,
    });
  };

  const finishPan = (event: PointerEvent<HTMLElement>) => {
    if (!panGesture || event.pointerId !== panGesture.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setPanGesture(undefined);
  };

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    if (canvasWheelEventPathOwnsOverlayV1(event.nativeEvent.composedPath())) {
      return;
    }
    event.preventDefault();
    setViewportMode("manual");
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      const scale = Math.exp(-event.deltaY * wheelZoomSensitivity);
      const next = zoomCanvasViewportAtPointV1(
        {
          zoom,
          panX: pan.x,
          panY: pan.y,
        },
        {
          width: bounds.width,
          height: bounds.height,
        },
        {
          width: pageWidth,
          height: pageHeight,
        },
        {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
        zoom * scale,
      );
      setZoom(next.zoom);
      setPan({ x: next.panX, y: next.panY });
      return;
    }
    const next = panCanvasViewportV1(
      {
        zoom,
        panX: pan.x,
        panY: pan.y,
      },
      {
        x: -event.deltaX,
        y: -event.deltaY,
      },
    );
    setPan({ x: next.panX, y: next.panY });
  };

  const changeZoom = (nextZoom: number) => {
    setViewportMode("manual");
    setZoom(clampCanvasZoomV1(nextZoom));
  };

  const viewportStorageKey = useMemo(
    () => canvasViewportStorageKeyV1(workspaceId, documentId, pageId),
    [documentId, pageId, workspaceId],
  );

  useLayoutEffect(() => {
    if (restoredViewportKey === viewportStorageKey) {
      return;
    }
    if (!persist) {
      setViewportMode("fit");
      fitViewport();
      setRestoredViewportKey(viewportStorageKey);
      return;
    }
    let restored: ReturnType<typeof parseCanvasViewportV1>;
    try {
      restored = parseCanvasViewportV1(
        window.localStorage.getItem(viewportStorageKey),
      );
    } catch {
      restored = undefined;
    }
    if (restored?.mode === "manual") {
      setViewportMode("manual");
      setZoom(restored.zoom);
      setPan({
        x: restored.panX,
        y: restored.panY,
      });
    } else {
      fitViewport();
    }
    setRestoredViewportKey(viewportStorageKey);
  }, [
    fitViewport,
    persist,
    restoredViewportKey,
    setViewportMode,
    viewportStorageKey,
  ]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) {
      return;
    }
    if (viewportModeRef.current === "fit") {
      applyFitViewport();
    }
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (viewportModeRef.current === "fit") {
        applyFitViewport();
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [applyFitViewport]);

  useEffect(() => {
    if (!persist || restoredViewportKey !== viewportStorageKey) {
      return;
    }
    const persisted =
      viewportMode === "fit"
        ? {
            mode: "fit" as const,
          }
        : {
            mode: "manual" as const,
            zoom,
            panX: pan.x,
            panY: pan.y,
          };
    try {
      window.localStorage.setItem(
        viewportStorageKey,
        JSON.stringify(persisted),
      );
    } catch {
      // Viewport persistence is an enhancement; editing must remain usable.
    }
  }, [
    pan.x,
    pan.y,
    persist,
    restoredViewportKey,
    viewportMode,
    viewportStorageKey,
    zoom,
  ]);

  return {
    beginPan,
    changeZoom,
    connectStage,
    finishPan,
    fitViewport,
    handleWheel,
    pan,
    panning: Boolean(panGesture),
    setPan,
    setViewportMode,
    setZoom,
    stage,
    stageElement,
    updatePan,
    zoom,
  } as const;
}
