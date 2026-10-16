import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type * as Antd from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentRunDiagnostics } from "./agent-run-diagnostics.js";
import "../../i18n/i18n.js";

vi.mock("antd", async (importOriginal) => ({
  ...(await importOriginal<typeof Antd>()),
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function renderDiagnostics(extra: Record<string, unknown> = {}) {
  const client = new QueryClient();
  client.setQueryData(["agent-run-diagnostics", "workspace", "run"], {
    runId: "run",
    threadId: "thread",
    lifecycleStatus: "failed",
    reasonCode: "agent.limit_exceeded",
    truncated: false,
    calls: [
      {
        id: "call",
        purpose: "plan",
        lifecycleStatus: "succeeded",
        routeResolved: true,
        providerAccepted: true,
        createdAt: "2026-10-10T01:26:33Z",
        updatedAt: "2026-10-10T01:26:40Z",
      },
    ],
    ...extra,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AgentRunDiagnostics
        workspaceId="workspace"
        runId="run"
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("Agent run diagnostic records", () => {
  it("shows model completion separately from a failed run and exposes diagnostic facts", () => {
    const html = renderDiagnostics({
      limits: { maximumModelCalls: 16, maximumToolCalls: 24 },
      calls: [
        {
          id: "call",
          callNumber: 16,
          purpose: "plan",
          lifecycleStatus: "succeeded",
          finishReason: "tool-calls",
          inputTokens: 12320,
          outputTokens: 135,
          modelProfileKey: "agent.test",
          routeResolved: true,
          providerAccepted: true,
          createdAt: "2026-10-10T01:26:33Z",
          updatedAt: "2026-10-10T01:26:40Z",
        },
      ],
      actions: [
        {
          id: "action",
          actionNumber: 4,
          toolKey: "capability.search",
          lifecycleStatus: "failed",
          reasonCode: "capability.unavailable",
          createdAt: "2026-10-10T01:26:40Z",
          updatedAt: "2026-10-10T01:26:41Z",
        },
      ],
    });
    for (const value of [
      "agent.limit_exceeded",
      "#16",
      "tool-calls",
      "12320",
      "135",
      "agent.test",
      "capability.search",
      "capability.unavailable",
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("NaN");
  });
  it("keeps records from an older server readable without invented values", () => {
    const html = renderDiagnostics();
    expect(html).toContain("agent.limit_exceeded");
    expect(html).not.toMatch(/NaN|undefined|#16|tool-calls/u);
  });
});
