import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { CanvasViewControlsV1 } from "./canvas-view-controls-v1.js";

function renderControls(shortcutsOpen = false, zoom = 0.55) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <CanvasViewControlsV1
        onFit={() => undefined}
        onShortcutsOpenChange={() => undefined}
        onZoomChange={() => undefined}
        shortcutsOpen={shortcutsOpen}
        zoom={zoom}
      />
    </I18nextProvider>,
  );
}

describe("Canvas View Controls V1", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("renders the compact view toolbar with a separate zoom value", () => {
    const markup = renderControls();

    expect(markup).toContain('aria-label="视图控制"');
    expect(markup).toContain('aria-label="缩放"');
    expect(markup).toContain('aria-label="缩放百分比"');
    expect(markup).toContain('value="55"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("owns the shortcuts dialog from its keyboard control", () => {
    const markup = renderControls(true);

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="画板快捷键"');
    expect(markup).toContain("适配画板");
    expect(markup).toContain("复制对象");
    expect(markup).toContain("移动 10 px");
    expect(markup).toContain("旋转 15°");
    expect(markup).toContain("退出当前操作");
  });

  it("can display a fitted zoom below the manual zoom floor", () => {
    const markup = renderControls(false, 0.2);

    expect(markup).toContain('aria-label="缩放"');
    expect(markup).toContain('aria-valuemin="0.2"');
    expect(markup).toContain('aria-valuenow="0.2"');
    expect(markup).toContain('value="20"');
    expect(markup).toContain('aria-label="缩小"');
    expect(markup).toContain("disabled");
  });
});
