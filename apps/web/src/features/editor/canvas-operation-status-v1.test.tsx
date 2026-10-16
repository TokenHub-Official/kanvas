import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import type { CanvasOperationSessionV1 } from "./canvas-operation-runtime-v1.js";
import { CanvasOperationStatusV1 } from "./canvas-operation-status-v1.js";

const session: CanvasOperationSessionV1 = {
  schemaVersion: "kanvas.canvas-operation-session/v1",
  completionBehavior: "review_required",
  id: "operation-status-1",
  workspaceId: "01K00000000000000000000000",
  operationId: "image.background.remove",
  toolId: "tool-1",
  label: "移除背景",
  contractRevisionId: "01K00000000000000000000001",
  resultArtifactPath: ["artifactId"],
  availableOutputDispositions: ["replace_content"],
  sourceParameterKey: "sourceArtifactId",
  sourceValue: "artifact_id",
  source: {
    pageId: "page-1",
    nodeId: "image-1",
    artifactId: "01K00000000000000000000002",
    nodeFingerprint: "source",
  },
  parameters: {},
  outputDisposition: "replace_content",
  idempotencyKey: "status-1",
  phase: "running",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

function renderStatus(
  overrides: Partial<React.ComponentProps<typeof CanvasOperationStatusV1>> = {},
) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <CanvasOperationStatusV1
        busy={false}
        onCancel={() => undefined}
        onReconnect={() => undefined}
        session={session}
        {...overrides}
      />
    </I18nextProvider>,
  );
}

describe("Canvas operation status", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("announces running work without dialog semantics or autofocus", () => {
    const markup = renderStatus();

    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("autofocus");
    expect(markup).toContain("移除背景 · 正在处理");
    expect(markup).not.toMatch(/本机|云端|Worker|回退/u);
    expect(markup).toContain('aria-label="取消处理"');
  });

  it("exposes reconnect as the only recovery action for a status error", () => {
    const markup = renderStatus({
      statusError: "状态暂时无法同步",
    });

    expect(markup).toContain("状态暂时无法同步");
    expect(markup).toContain('aria-label="重新连接"');
    expect(markup).not.toContain('aria-label="取消处理"');
  });

  it("disables repeated cancellation while confirmation is pending", () => {
    const markup = renderStatus({
      session: {
        ...session,
        cancelRequested: true,
      },
    });

    expect(markup).toContain("移除背景 · 正在取消");
    expect(markup).toContain('aria-label="已请求取消"');
    expect(markup).toContain("disabled");
  });
});
