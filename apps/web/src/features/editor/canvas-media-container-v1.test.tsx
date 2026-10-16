import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { CanvasMediaContainerPanelV1 } from "./canvas-media-container-panel-v1.js";
import {
  canvasMediaInsertionTargetV1,
  canvasMediaTargetImageV1,
  canvasMediaTargetNodeWithImageV1,
  canvasPlacedImageWithFocalPointV1,
  canvasPlacedImageWithZoomV1,
  canvasPlacedImageZoomV1,
} from "./canvas-media-container-v1.js";
import type {
  EditorRuntimeNodeV1,
  EditorRuntimePlacedImageV1,
} from "./editor-runtime-v1.js";

const image: EditorRuntimePlacedImageV1 = {
  source: {
    kind: "artifact",
    artifactId: "01K00000000000000000000031",
    assetId: "01K00000000000000000000041",
  },
  intrinsicWidth: 1600,
  intrinsicHeight: 900,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  fit: "cover",
  focalPoint: { x: 0.5, y: 0.5 },
};

const common = {
  name: "Media container",
  opacity: 1,
  blendMode: "normal" as const,
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
};

const frame = {
  ...common,
  id: "frame-1",
  kind: "frame",
  definition: {
    catalogId: "kanvas.core.frames",
    definitionId: "frame.rectangle",
    revision: "2026-07-31",
  },
  content: { image },
  fill: { kind: "none" },
  stroke: { paint: { kind: "none" }, width: 0, alignment: "center" },
} as const satisfies EditorRuntimeNodeV1;

describe("Canvas media container V1", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("projects frame and grid editor targets into insertion targets", () => {
    expect(
      canvasMediaInsertionTargetV1(
        { kind: "frame", nodeId: "frame-1" },
        "page-1",
      ),
    ).toEqual({ kind: "frame_content", pageId: "page-1", frameId: "frame-1" });
    expect(
      canvasMediaInsertionTargetV1(
        { kind: "grid", nodeId: "grid-1", slotId: "left" },
        "page-1",
      ),
    ).toEqual({
      kind: "grid_cell",
      pageId: "page-1",
      gridId: "grid-1",
      slotId: "left",
    });
  });

  it("keeps zoom and focal point inside normalized crop bounds", () => {
    const zoomed = canvasPlacedImageWithZoomV1(image, 2);
    expect(canvasPlacedImageZoomV1(zoomed)).toBe(2);
    expect(zoomed.crop).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });

    const focused = canvasPlacedImageWithFocalPointV1(zoomed, 1, 0);
    expect(focused.focalPoint).toEqual({ x: 1, y: 0 });
    expect(focused.crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });

  it("reads and updates the selected frame content without changing its identity", () => {
    const target = { kind: "frame", nodeId: "frame-1" } as const;
    const nextImage = { ...image, fit: "contain" as const };
    const updated = canvasMediaTargetNodeWithImageV1(frame, target, nextImage);

    expect(canvasMediaTargetImageV1(updated, target)?.fit).toBe("contain");
    expect(updated.id).toBe(frame.id);
  });

  it("renders replace, fit, zoom, focal point and remove controls together", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <CanvasMediaContainerPanelV1
          disabled={false}
          image={image}
          onBrowseAssets={vi.fn()}
          onChange={vi.fn()}
          onCommit={vi.fn()}
          onPreview={vi.fn()}
          onRemove={vi.fn()}
          onSelectGridSlot={vi.fn()}
          target={{ kind: "frame", nodeId: "frame-1" }}
        />
      </I18nextProvider>,
    );

    for (const label of [
      "替换图片",
      "图片适配",
      "内容缩放",
      "水平焦点",
      "垂直焦点",
      "移除图片",
    ]) {
      expect(markup).toContain(label);
    }
  });
});
