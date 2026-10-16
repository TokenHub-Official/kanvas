import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { CanvasGroupIsolationPanelV1 } from "./canvas-group-isolation-panel-v1.js";
import type { EditorRuntimeGroupNodeV1 } from "./editor-runtime-v1.js";

const child = {
  id: "shape-1",
  name: "矩形",
  kind: "shape",
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  transform: {
    x: 0,
    y: 0,
    width: 100,
    height: 80,
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
  fill: { kind: "solid", color: "#3048f5" },
  stroke: { paint: { kind: "none" }, width: 0, alignment: "center" },
} as const;

const group = {
  id: "group-1",
  name: "组合",
  kind: "group",
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  transform: {
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  children: [child, { ...child, id: "shape-2", name: "圆形" }],
} as const satisfies EditorRuntimeGroupNodeV1;

describe("CanvasGroupIsolationPanelV1", () => {
  beforeAll(async () => i18n.changeLanguage("zh-CN"));

  it("keeps child traversal, layer actions and common properties in one panel", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <CanvasGroupIsolationPanelV1
          canEdit
          group={group}
          onExit={vi.fn()}
          onMove={vi.fn()}
          onPreview={vi.fn()}
          onPreviewCommit={vi.fn()}
          onReplace={vi.fn()}
          onSelect={vi.fn()}
          selectedChild={group.children[0]}
        />
      </I18nextProvider>,
    );

    for (const label of ["退出组内编辑", "名称", "透明度"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('role="listbox"');
    expect(markup.match(/role="option"/gu)).toHaveLength(2);
  });
});
