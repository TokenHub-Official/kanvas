import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createWorkflowRunQueryStore } from "../src/runtime/workflow-run-query-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const createdAt = new Date("2026-07-27T12:00:00.000Z");
const executionDeadlineAt = new Date("2026-07-27T13:00:00.000Z");
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const browserPlan = {
  schemaVersion: 1,
  workflowRevision: { id: id(3), canonicalDigest: digest("f") },
  topology: {
    schemaVersion: 1,
    key: "browser_run",
    entryNodeKey: "analyze",
    limits: { maxNodeRuns: 2, timeoutMs: 60_000 },
    nodes: [
      {
        key: "analyze",
        kind: "invoke",
        capability: {
          contractId: "image.palette.extract",
          revision: 1,
          canonicalDigest: digest("c"),
        },
        input: {},
        next: [],
      },
    ],
    outputs: {},
  },
  routes: [
    {
      nodeKey: "analyze",
      contractRevisionId: id(30),
      contractKey: "image.palette.extract",
      contractRevision: 1,
      contractDigest: digest("c"),
      candidates: [
        {
          candidateIndex: 0,
          bindingId: id(31),
          bindingVersion: 1,
          implementationRevisionId: id(32),
          implementationDigest: digest("d"),
          executionTarget: "browser",
          adapterKey: "browser.image-analysis",
          idempotencyMode: "intrinsic",
          retryPolicy: {
            maxAttempts: 1,
            backoff: "fixed",
            initialDelayMs: 0,
            maxDelayMs: 0,
          },
          attemptTimeoutMs: 30_000,
          fallbackOn: [],
        },
      ],
    },
  ],
};

describe("workflow run query store", () => {
  it("restricts Agent-started Workflow details to the requesting principal", async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    const store = createWorkflowRunQueryStore({ execute } as unknown as Pool);
    await expect(store.findById(id(2), id(1), id(4))).resolves.toBeUndefined();
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "run.idempotency_key NOT LIKE 'agent-workflow:%' OR run.created_by = ?",
    );
    expect(execute.mock.calls[0]?.[1]).toEqual([id(1), id(2), id(4)]);
  });

  it("lists only the current principal's recent production runs for one revision", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: "01K000000000000000000000001",
          brandKitId: "01K000000000000000000000020",
          brandKitRevisionId: "01K000000000000000000000021",
          brandName: "Kanvas 主品牌",
          brandRevisionNumber: 3,
          workflowRevisionId: "01K000000000000000000000003",
          displayName: "海报制作",
          brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
          description: "生成海报",
          lifecycleStatus: "completed",
          outcome: "full_success",
          output: JSON.stringify({ imageArtifactId: "artifact" }),
          createdAt,
          completedAt: createdAt,
        },
      ],
    ]);
    const store = createWorkflowRunQueryStore({
      execute,
    } as unknown as Pool);

    await expect(
      store.listForActor({
        workspaceId: "01K000000000000000000000002",
        actorId: "01K000000000000000000000004",
        workflowRevisionId: "01K000000000000000000000003",
        state: "completed",
        limit: 6,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          displayName: "海报制作",
          output: { imageArtifactId: "artifact" },
          lifecycleStatus: "completed",
        },
      ],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("run.created_by = ?"),
      [
        "01K000000000000000000000002",
        "01K000000000000000000000004",
        "01K000000000000000000000003",
      ],
    );
    expect(execute.mock.calls[0]?.[0]).toContain("LIMIT 7");
    expect(execute.mock.calls[0]?.[0]).toContain(
      "run.outcome IN ('full_success', 'partial_success')",
    );
    expect(execute.mock.calls[0]?.[0]).toContain(
      "LEFT JOIN brand_kit_revision",
    );
  });

  it("supports cursor pagination for active runs across revisions", async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    const store = createWorkflowRunQueryStore({
      execute,
    } as unknown as Pool);
    const cursorDate = new Date("2026-08-20T05:00:00.000Z");

    await store.listForActor({
      workspaceId: "01K000000000000000000000002",
      actorId: "01K000000000000000000000004",
      state: "active",
      cursor: {
        createdAt: cursorDate,
        id: "01K000000000000000000000005",
      },
      limit: 20,
    });

    expect(execute.mock.calls[0]?.[0]).toContain(
      "run.lifecycle_status IN ('queued', 'running', 'waiting', 'cancelling')",
    );
    expect(execute.mock.calls[0]?.[0]).toContain("run.created_at < ?");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      "01K000000000000000000000002",
      "01K000000000000000000000004",
      cursorDate,
      cursorDate,
      "01K000000000000000000000005",
    ]);
    expect(execute.mock.calls[0]?.[0]).toContain("LIMIT 21");
  });

  it("lists every recent production state when no status filter is selected", async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    const store = createWorkflowRunQueryStore({
      execute,
    } as unknown as Pool);

    await store.listForActor({
      workspaceId: "01K000000000000000000000002",
      actorId: "01K000000000000000000000004",
      state: "all",
      limit: 20,
    });

    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).not.toContain("run.lifecycle_status IN");
    expect(sql).not.toContain("run.outcome IN");
    expect(sql).toContain("ORDER BY run.created_at DESC");
  });

  it("projects the execution deadline, pending Approval, and pinned browser need", async () => {
    const approvalRequestId = id(40);
    const execute = vi.fn((sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("FROM workflow_run AS run")) {
        return Promise.resolve([
          [
            {
              id: "01K000000000000000000000001",
              workspaceId: "01K000000000000000000000002",
              definitionKind: "published_revision",
              workflowRevisionId: "01K000000000000000000000003",
              publicationCandidateId: null,
              brandKitId: "01K000000000000000000000020",
              brandKitRevisionId: "01K000000000000000000000021",
              brandName: "Kanvas 主品牌",
              brandRevisionNumber: 3,
              lifecycleStatus: "running",
              outcome: null,
              version: 2,
              input: JSON.stringify({ source: "artifact" }),
              output: null,
              executionPlanSnapshot: browserPlan,
              executionPlanHash: digestProviderValue(browserPlan),
              executionDeadlineAt,
              createdAt,
              updatedAt: createdAt,
              completedAt: null,
              cancelRequestedAt: null,
              cancelReasonCode: null,
              cancelDeadlineAt: null,
            },
          ],
        ]);
      }
      if (sql.includes("state.lifecycle_status = 'pending'")) {
        return Promise.resolve([
          [
            {
              id: approvalRequestId,
              workspaceId: id(2),
              workflowRunId: id(1),
              nodeRunId: id(41),
              nodeKey: "approval",
              requestPayload: { title: "检查结果", message: "确认后继续" },
              decisionSchema: {
                type: "object",
                properties: { approved: { type: "boolean" } },
                required: ["approved"],
              },
              authorizationContextDigest: digest("a"),
              expiresAt: executionDeadlineAt,
              createdAt,
              lifecycleStatus: "pending",
            },
          ],
        ]);
      }
      return Promise.resolve([[]]);
    });
    const store = createWorkflowRunQueryStore({
      execute,
    } as unknown as Pool);

    await expect(
      store.findById(
        "01K000000000000000000000002",
        "01K000000000000000000000001",
      ),
    ).resolves.toMatchObject({
      executionDeadlineAt,
      input: {
        source: "artifact",
      },
      pendingApprovals: [
        {
          id: approvalRequestId,
          title: "检查结果",
          message: "确认后继续",
        },
      ],
      browserExecution: {
        requiredCapabilityKeys: ["image.palette.extract"],
      },
      brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
    });
    expect(execute.mock.calls[0]?.[0]).toContain(
      "run.execution_deadline_at AS executionDeadlineAt",
    );
  });

  it("binds an Approval decision context to Workspace, Run, and request", async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    const store = createWorkflowRunQueryStore({
      execute,
    } as unknown as Pool);

    await store.findApprovalDecisionContext(id(1), id(2), id(3));

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("AND request.workflow_run_id = ?"),
      [id(1), id(2), id(3)],
    );
  });
});
