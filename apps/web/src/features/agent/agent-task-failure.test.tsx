import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AgentTaskFailure,
  agentTaskFailureKind,
} from "./agent-task-failure.js";

const { query } = vi.hoisted(() => ({
  query: vi.fn(
    (
      options: unknown,
    ): {
      data: { error: Record<string, unknown>; externalResultUrls?: string[] };
    } => {
      void options;
      return {
        data: {
          error: {
            code: "provider.remote_invalid_request",
            upstream: {
              statusCode: 400,
              requestId: "fixture-tokenhub-400",
              body: '{"code":"invalid_request","message":"image is not allowed","data":null}',
            },
          },
        },
      };
    },
  ),
}));
vi.mock("./provider-result-recovery.js", () => ({
  ProviderResultRecovery: () => null,
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: query }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { id?: string }) =>
      args?.id ? `${key}: ${args.id}` : key,
  }),
}));

describe("Agent failure details", () => {
  it.each(["inline", "detail"] as const)(
    "offers the generated file in %s instead of asking for another generation",
    (presentation) => {
      query.mockReturnValueOnce({
        data: {
          error: { code: "attempt.execution_deadline_expired" },
          externalResultUrls: [
            "https://files.example.test/result.png?signature=opaque",
          ],
        },
      });
      const html = renderToStaticMarkup(
        <AgentTaskFailure
          workspaceId="workspace"
          capabilityRunId="failed-capability"
          canReadCapabilities
          presentation={presentation}
        />,
      );
      expect(html).toContain("agent.taskFailure.externalResultTitle");
      expect(html).toContain(
        "https://files.example.test/result.png?signature=opaque",
      );
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).not.toContain("agent.taskFailure.inlineContinue");
      expect(html).not.toContain("agent.taskFailure.unconfirmed.title");
    },
  );
  it("keeps conversation failures compact and reserves diagnostic details for the side panel", () => {
    query.mockImplementationOnce(() => ({
      data: {
        error: {
          code: "attempt.execution_deadline_expired",
          externalState: "unknown",
        },
      },
    }));
    const html = renderToStaticMarkup(
      <AgentTaskFailure
        workspaceId="workspace"
        capabilityRunId="failed-capability"
        canReadCapabilities
        presentation="inline"
        onOpenDetails={vi.fn()}
      />,
    );
    expect(html).toContain("agent.taskFailure.inlineContinue");
    expect(html).toContain("agent.taskFailure.openDetails");
    expect(html).not.toContain("failed-capability");
    expect(html).not.toContain("attempt.execution_deadline_expired");
    expect(html).not.toContain("agent.copyProblemReference");
    expect(html).not.toContain("ant-alert");
  });
  it("distinguishes saving a generated result from a generation timeout", () => {
    expect(
      agentTaskFailureKind({ code: "provider.output_materialization_failed" }),
    ).toBe("delivery");
    expect(
      agentTaskFailureKind({ code: "attempt.execution_deadline_expired" }),
    ).toBe("timeout");
    expect(
      agentTaskFailureKind({
        code: "attempt.execution_deadline_expired",
        externalState: "unknown",
      }),
    ).toBe("unconfirmed");
  });

  it("explains an unconfirmed result and exposes a bounded support reference", () => {
    query.mockImplementationOnce(() => ({
      data: {
        error: {
          code: "attempt.execution_deadline_expired",
          externalState: "unknown",
          upstream: { body: "private output URL" },
        },
      },
    }));
    const html = renderToStaticMarkup(
      <AgentTaskFailure
        workspaceId="workspace"
        capabilityRunId="failed-capability"
        canReadCapabilities
      />,
    );

    expect(html).toContain("agent.taskFailure.unconfirmed.title");
    expect(html).toContain("failed-capability");
    expect(html).toContain("attempt.execution_deadline_expired");
    expect(html).not.toContain("private output URL");
  });

  it("offers a support reference without exposing provider diagnostics or a Composer action", () => {
    const html = renderToStaticMarkup(
      <AgentTaskFailure
        workspaceId="workspace"
        capabilityRunId="failed-capability"
        canReadCapabilities
      />,
    );
    expect(html).not.toContain("image is not allowed");
    expect(html).not.toContain("fixture-tokenhub-400");
    expect(html).toContain("agent.copyProblemReference");
    expect(html).not.toContain("agent.prepareTaskRetry");
    expect(html).toContain("agent.taskFailure.input.title");
    const options = query.mock.calls[0]?.[0] as {
      queryKey: string[];
      enabled: boolean;
    };
    expect(options.queryKey).toEqual([
      "agent-capability-task",
      "workspace",
      "failed-capability",
    ]);
    expect(options.enabled).toBe(true);
  });

  it("shows correlation identity without requiring a technical response body", () => {
    query.mockImplementationOnce(() => ({
      data: {
        error: {
          code: "provider.remote_unavailable",
          upstream: { requestId: "safe-request-500" },
        },
      },
    }));
    const html = renderToStaticMarkup(
      <AgentTaskFailure
        workspaceId="workspace"
        capabilityRunId="failed-capability"
        canReadCapabilities
      />,
    );

    expect(html).not.toContain("safe-request-500");
    expect(html).toContain("agent.copyProblemReference");
    expect(html).toContain("agent.taskFailure.busy.title");
    expect(html).not.toContain("private prompt");
  });
});
