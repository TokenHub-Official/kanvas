import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { createEditorPageV1 } from "./editor-document-factory-v1.js";
import {
  CanvasPageStripV1,
  canvasPageNavigationTargetV1,
  canvasPageReorderDirectionV1,
} from "./canvas-page-strip-v1.js";

const pages = [
  createEditorPageV1("page-1", "第二版"),
  createEditorPageV1("page-2", "横版延展标题非常长"),
  createEditorPageV1("page-3", "社媒方图"),
] as const;

function renderStrip({
  activePageId = "page-1",
  canEdit = true,
  renderedPages = pages,
}: {
  readonly activePageId?: string;
  readonly canEdit?: boolean;
  readonly renderedPages?: typeof pages | readonly [(typeof pages)[0]];
} = {}) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <CanvasPageStripV1
        activePageId={activePageId}
        canEdit={canEdit}
        onActivatePage={vi.fn()}
        onAddPage={vi.fn()}
        onDeletePage={vi.fn()}
        onMoveActivePageBackward={vi.fn()}
        onMoveActivePageForward={vi.fn()}
        onReorderPage={vi.fn()}
        pages={renderedPages}
        resources={new Map()}
      />
    </I18nextProvider>,
  );
}

describe("CanvasPageStripV1", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("keeps page actions inside one fixed page card without persistent move buttons", () => {
    const markup = renderStrip();

    expect(markup).toContain('aria-label="页面"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="第 1 页 · 第二版"');
    expect(markup).not.toContain('aria-label="页面前移"');
    expect(markup).not.toContain('aria-label="页面后移"');
    expect(markup).toContain('aria-label="删除页面 · 第二版"');
    expect(markup).toContain("group-hover/page-item:opacity-100");
    expect(markup.match(/aria-label="删除页面 · /g)).toHaveLength(3);
    expect(markup).toContain('data-page-strip-item="page-1"');
  });

  it("preserves long names for assistive text while truncating them visually", () => {
    const markup = renderStrip({ activePageId: "page-2" });

    expect(markup).toContain('aria-label="第 2 页 · 横版延展标题非常长"');
    expect(markup).toContain('title="第 2 页 · 横版延展标题非常长"');
    expect(markup).toContain("truncate");
  });

  it("protects the one-page and read-only boundaries", () => {
    const markup = renderStrip({
      canEdit: false,
      renderedPages: [pages[0]],
    });

    expect(markup).not.toContain("删除当前页");
    expect(markup).not.toContain("页面前移");
    expect(markup).not.toContain("页面后移");
    expect(markup).toContain('aria-label="添加页面"');
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
  });

  it("supports bounded adjacent and edge keyboard navigation", () => {
    expect(canvasPageNavigationTargetV1(pages, "page-2", "ArrowLeft")).toBe(
      "page-1",
    );
    expect(canvasPageNavigationTargetV1(pages, "page-2", "ArrowRight")).toBe(
      "page-3",
    );
    expect(canvasPageNavigationTargetV1(pages, "page-1", "ArrowLeft")).toBe(
      "page-1",
    );
    expect(canvasPageNavigationTargetV1(pages, "page-2", "Home")).toBe(
      "page-1",
    );
    expect(canvasPageNavigationTargetV1(pages, "page-2", "End")).toBe("page-3");
    expect(canvasPageNavigationTargetV1(pages, "missing", "End")).toBe(
      undefined,
    );
  });

  it("keeps reordering available through bounded Alt plus arrow shortcuts", () => {
    expect(canvasPageReorderDirectionV1("ArrowLeft", true, 1, 3)).toBe(
      "backward",
    );
    expect(canvasPageReorderDirectionV1("ArrowRight", true, 1, 3)).toBe(
      "forward",
    );
    expect(canvasPageReorderDirectionV1("ArrowLeft", true, 0, 3)).toBe(
      undefined,
    );
    expect(canvasPageReorderDirectionV1("ArrowRight", true, 2, 3)).toBe(
      undefined,
    );
    expect(canvasPageReorderDirectionV1("ArrowRight", false, 1, 3)).toBe(
      undefined,
    );
  });
});
