import type { EditorShapeNodeV1 } from "@kanvas/contracts/editor";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { NodeStyleInspectorV1 } from "./canvas-node-style-inspector-v1.js";
import { createCanvasFreehandNodeV1 } from "./canvas-quick-tools-v1.js";
import { nodeWithEditedTextV1 } from "./canvas-workspace-model-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

type StyleNodeV1 = Extract<
  EditorRuntimeNodeV1,
  { kind: "frame" | "graphic" | "grid" | "line" | "shape" }
>;

const shapeNode = {
  id: "shape-1",
  kind: "shape",
  name: "Shape",
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  transform: {
    x: 0,
    y: 0,
    width: 280,
    height: 260,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  definition: {
    catalogId: "kanvas.core.shapes",
    definitionId: "basic.rectangle",
    revision: "2026-07-31",
  },
  parameters: {},
  fill: { kind: "solid", color: "#d7838e" },
  stroke: {
    paint: { kind: "solid", color: "#3048f5" },
    width: 2,
    alignment: "center",
  },
} as const satisfies EditorShapeNodeV1;

function renderInspector(node: StyleNodeV1) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <NodeStyleInspectorV1
        disabled={false}
        documentColors={["#d7838e", "#3048f5"]}
        node={node}
        onChange={vi.fn()}
        onPreview={vi.fn()}
        onPreviewCommit={vi.fn()}
        workspaceId="workspace-1"
      />
    </I18nextProvider>,
  );
}

describe("NodeStyleInspectorV1", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("groups shape appearance into stable visual sections", () => {
    const markup = renderInspector(shapeNode);

    expect(markup).toContain("填充");
    expect(markup).toContain("描边");
    expect(markup).toContain("渐变");
    expect(markup).toContain("描边位置");
    expect(markup).toContain("内部");
    expect(markup).toContain("外部");
    expect(markup).not.toContain("内部文字");
  });

  it("exposes gradient colors and angle for an existing gradient shape", () => {
    const markup = renderInspector({
      ...shapeNode,
      fill: {
        kind: "linear_gradient",
        angle: 35,
        stops: [
          { color: "#3048f5", offset: 0 },
          { color: "#bdf248", offset: 1 },
        ],
      },
    });

    expect(markup).toContain('aria-label="渐变起始色"');
    expect(markup).toContain('aria-label="渐变结束色"');
    expect(markup).toContain("渐变角度");
    expect(markup).toContain("35°");
  });

  it("keeps labeled shape content separate from appearance controls", () => {
    const labeled = nodeWithEditedTextV1(shapeNode, "内部说明");
    if (labeled.kind !== "shape") {
      throw new Error("Expected shape label edit to preserve the node kind.");
    }

    const markup = renderInspector(labeled);

    expect(markup).toContain("内部文字");
    expect(markup).toContain("内部说明");
    expect(markup).toContain("移除内部文字");
    expect(markup).not.toContain("canvas.node.removeInternalText");
  });

  it("keeps freehand color, thickness and opacity in one selected-stroke editor", () => {
    const freehand = createCanvasFreehandNodeV1({
      id: "stroke-1",
      points: [
        { x: 20, y: 30 },
        { x: 180, y: 120 },
      ],
      color: "#3048f5",
      opacity: 0.46,
      width: 22,
    });
    if (!freehand) {
      throw new Error("Expected a freehand node.");
    }

    const markup = renderInspector(freehand);

    expect(markup).toContain('aria-label="线条颜色"');
    expect(markup).toContain(">粗细</span>");
    expect(markup).toContain(">透明度</span>");
    expect(markup).toContain("46%");
  });

  it("shows durable Shape bindings and explicit disconnect actions", () => {
    const line = {
      ...shapeNode,
      id: "line-1",
      kind: "line",
      pathKind: "straight",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      startCap: "none",
      endCap: "arrow",
      startBinding: { nodeId: "shape-a", anchor: "right" },
      role: "design",
    } as const satisfies StyleNodeV1;

    const markup = renderInspector(line);

    expect(markup).toContain("对象连接");
    expect(markup).toContain("shape-a · 右侧");
    expect(markup).toContain("断开");
    expect(markup).toContain("未连接");
  });

  it("explains recolorable graphics and exposes every used color slot", () => {
    const graphic = {
      ...shapeNode,
      id: "graphic-1",
      kind: "graphic",
      source: {
        kind: "catalog",
        catalogId: "kanvas.core.graphics",
        resourceId: "graphic.badge-check",
        revision: "2026-07-31",
      },
      colorSlots: {},
      preserveAspectRatio: true,
    } as const satisfies StyleNodeV1;

    const markup = renderInspector(graphic);

    expect(markup).toContain("可换色矢量素材");
    expect(markup).toContain('aria-label="主颜色"');
    expect(markup).toContain('aria-label="辅助颜色"');
    expect(markup).toContain("恢复素材默认色");
  });
});
