import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/i18n.js";
import { TaskRecordsContent } from "./task-records-page.js";

const workspaceId = "01K00000000000000000000001";
beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

describe("administrator task directory", () => {
  it("renders successful, failed, active and cancelled records with their support references", () => {
    const client = new QueryClient();
    const items = ["completed", "failed", "running", "cancelled"].map(
      (status, index) => ({
        id: `01K0000000000000000000001${index}`,
        kind: "capability",
        title: `Image task ${status}`,
        status,
        creatorId: workspaceId,
        creatorName: "Studio member",
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:01:00.000Z",
        ...(status === "running"
          ? {}
          : { completedAt: "2026-09-21T00:01:00.000Z" }),
      }),
    );
    client.setQueryData(
      ["task-records", workspaceId, "en-US", { limit: "50" }],
      { items },
    );
    const html = renderToStaticMarkup(
      <App>
        <QueryClientProvider client={client}>
          <TaskRecordsContent
            workspaceId={workspaceId}
            permissions={["audit.read"]}
          />
        </QueryClientProvider>
      </App>,
    );
    for (const record of items) {
      expect(html).toContain(record.id);
      expect(html).toContain(record.title);
    }
    expect(html).toContain("Studio member");
    expect(html).toContain("1m 0s");
    expect(html).toContain("More filters");
    expect(html).toContain("All statuses");
    expect(html).not.toContain("retryTaskPrompt");
  });
});
