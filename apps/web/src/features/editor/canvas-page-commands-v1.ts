import type { TFunction } from "i18next";

import { createEditorPageV1 } from "./editor-document-factory-v1.js";
import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";
import type { EditorActionV1 } from "./editor-state-v1.js";

export function createCanvasPageCommandsV1({
  commitPreview,
  hideEditorPanels,
  mutate,
  page,
  pageCount,
  t,
}: {
  readonly commitPreview: () => void;
  readonly hideEditorPanels: () => void;
  readonly mutate: (action: EditorActionV1) => void;
  readonly page: EditorRuntimePageV1;
  readonly pageCount: number;
  readonly t: TFunction;
}) {
  const addPage = () => {
    mutate({
      type: "add_page",
      page: createEditorPageV1(
        `page:${crypto.randomUUID()}`,
        t("canvas.names.page", {
          number: pageCount + 1,
        }),
        page,
      ),
    });
  };

  const duplicatePage = () => {
    mutate({
      type: "add_page",
      page: {
        ...page,
        id: `page:${crypto.randomUUID()}`,
        name: `${page.name}${t("canvas.names.copySuffix")}`,
      },
    });
  };

  const deletePage = (pageId = page.id) => {
    mutate({
      type: "delete_page",
      pageId,
    });
  };

  const movePageBackward = () => {
    mutate({
      type: "move_page",
      pageId: page.id,
      direction: "backward",
    });
  };

  const movePageForward = () => {
    mutate({
      type: "move_page",
      pageId: page.id,
      direction: "forward",
    });
  };

  const renamePage = (name: string) => {
    mutate({ type: "rename_page", pageId: page.id, name });
  };

  const reorderPage = (pageId: string, targetIndex: number) => {
    mutate({ type: "reorder_page", pageId, targetIndex });
  };

  const addGuide = (axis: "horizontal" | "vertical") => {
    mutate({
      type: "set_page_guides",
      pageId: page.id,
      guides: [
        ...(page.overlays?.guides ?? []),
        {
          id: `guide:${crypto.randomUUID()}`,
          axis,
          position: axis === "vertical" ? page.width / 2 : page.height / 2,
          locked: false,
        },
      ],
    });
  };

  const clearGuides = () => {
    mutate({
      type: "set_page_guides",
      pageId: page.id,
      guides: [],
    });
  };

  const activatePage = (pageId: string) => {
    commitPreview();
    hideEditorPanels();
    mutate({ type: "set_active_page", pageId });
  };

  const setBackgroundColor = (color: string) => {
    mutate({
      type: "set_page_background",
      pageId: page.id,
      background: {
        kind: "paint",
        paint: {
          kind: "solid",
          color,
        },
      },
    });
  };

  const previewBackgroundColor = (color: string) => {
    mutate({
      type: "preview_page_background",
      pageId: page.id,
      background: {
        kind: "paint",
        paint: {
          kind: "solid",
          color,
        },
      },
    });
  };

  const setBackgroundGradient = (
    first: string,
    second: string,
    angle: number,
  ) => {
    mutate({
      type: "set_page_background",
      pageId: page.id,
      background: {
        kind: "paint",
        paint: {
          kind: "linear_gradient",
          angle,
          stops: [
            { color: first, offset: 0 },
            { color: second, offset: 1 },
          ],
        },
      },
    });
  };

  const previewBackgroundGradient = (
    first: string,
    second: string,
    angle: number,
  ) => {
    mutate({
      type: "preview_page_background",
      pageId: page.id,
      background: {
        kind: "paint",
        paint: {
          kind: "linear_gradient",
          angle,
          stops: [
            { color: first, offset: 0 },
            { color: second, offset: 1 },
          ],
        },
      },
    });
  };

  const previewBackgroundFocalPoint = (x: number, y: number) => {
    if (page.background.kind !== "image") {
      return;
    }
    mutate({
      type: "preview_page_background",
      pageId: page.id,
      background: {
        ...page.background,
        image: {
          ...page.background.image,
          focalPoint: { x, y },
        },
      },
    });
  };

  const setBackgroundImageFit = (fit: "contain" | "cover" | "fill") => {
    if (page.background.kind !== "image") {
      return;
    }
    mutate({
      type: "set_page_background",
      pageId: page.id,
      background: {
        ...page.background,
        image: {
          ...page.background.image,
          fit,
        },
      },
    });
  };

  const previewBackgroundImageOpacity = (opacity: number) => {
    if (page.background.kind !== "image") {
      return;
    }
    mutate({
      type: "preview_page_background",
      pageId: page.id,
      background: {
        ...page.background,
        opacity,
      },
    });
  };

  const setTransparentBackground = () => {
    mutate({
      type: "set_page_background",
      pageId: page.id,
      background: {
        kind: "transparent",
      },
    });
  };

  const convertBackgroundImage = () => {
    if (page.background.kind !== "image") {
      return;
    }
    mutate({
      type: "convert_background_to_image",
      pageId: page.id,
      node: {
        id: `image:${crypto.randomUUID()}`,
        name: t("canvas.editor.backgroundImageName"),
        kind: "image",
        transform: {
          x: 0,
          y: 0,
          width: page.width,
          height: page.height,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        opacity: page.background.opacity,
        blendMode: "normal",
        visible: true,
        locked: false,
        image: page.background.image,
        cornerRadius: 0,
      },
    });
  };

  const resizePage = (
    width: number,
    height: number,
    mode: "keep" | "scale",
  ) => {
    mutate({
      type: "resize_page",
      pageId: page.id,
      width,
      height,
      mode,
    });
  };

  return {
    activatePage,
    addGuide,
    addPage,
    clearGuides,
    convertBackgroundImage,
    deletePage,
    duplicatePage,
    movePageBackward,
    movePageForward,
    renamePage,
    reorderPage,
    previewBackgroundColor,
    previewBackgroundFocalPoint,
    previewBackgroundGradient,
    previewBackgroundImageOpacity,
    resizePage,
    setBackgroundColor,
    setBackgroundGradient,
    setBackgroundImageFit,
    setTransparentBackground,
  } as const;
}
