import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { CanvasWorkspaceNoticeV1 } from "./canvas-workspace-notice-v1.js";

function renderNotice(
  overrides: Partial<React.ComponentProps<typeof CanvasWorkspaceNoticeV1>>,
) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <CanvasWorkspaceNoticeV1
        onDismissOperationMessage={vi.fn()}
        onDismissSaveError={vi.fn()}
        onResolveSaveConflict={vi.fn()}
        onRetryDraftSave={vi.fn()}
        saveConflictActive={false}
        sourceDeletionCancellationPending={false}
        {...overrides}
      />
    </I18nextProvider>,
  );
}

describe("CanvasWorkspaceNoticeV1", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("renders save recovery as an alert with an Ant Design action", () => {
    const markup = renderNotice({ draftSaveError: "暂时无法保存" });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("暂时无法保存");
    expect(markup).toContain("ant-btn");
    expect(markup).toContain("重试保存");
  });

  it("renders operation feedback as a polite dismissible status", () => {
    const markup = renderNotice({ operationMessage: "处理已完成" });

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("处理已完成");
    expect(markup).toContain('aria-label="关闭消息"');
  });
});
