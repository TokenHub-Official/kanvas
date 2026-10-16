import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/i18n.js";
import { OperationsContent } from "./operations-page.js";

vi.mock("../features/agent/provider-result-recovery.js", () => ({
  ProviderResultRecovery: () => null,
}));
beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("task record original results", () => {
  it.each([true, false])(
    "shows only links returned by the authorized task API: %s",
    (hasLinks) => {
      const client = new QueryClient();
      const workspaceId = "01K00000000000000000000001";
      const runId = "01K00000000000000000000002";
      const url = "https://v3b.fal.media/result.png?signature=opaque";
      client.setQueryData(
        ["operational-timeline", workspaceId, "capability", runId],
        {
          items: [],
          generatedAt: "2026-10-12T03:32:47Z",
          truncated: false,
        },
      );
      client.setQueryData(["agent-capability-task", workspaceId, runId], {
        id: runId,
        lifecycleStatus: "failed",
        ...(hasLinks ? { externalResultUrls: [url] } : {}),
      });
      const html = renderToStaticMarkup(
        <App>
          <QueryClientProvider client={client}>
            <OperationsContent
              embedded
              kind="capability"
              workspaceId={workspaceId}
              workflowRunId={runId}
              canReadCapabilities
              canReadUsage={false}
              canManageProviders={false}
              canConfigureRoutes={false}
            />
          </QueryClientProvider>
        </App>,
      );
      if (hasLinks) {
        expect(html).toContain("已生成，未保存到 Kanvas");
        expect(html).toContain("打开原始文件");
        expect(html).toContain(url);
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain('referrerPolicy="no-referrer"');
      } else expect(html).not.toContain("打开原始文件");
      client.clear();
    },
  );
});
