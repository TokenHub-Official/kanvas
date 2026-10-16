import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createPublicationGovernanceStore } from "../src/runtime/publication-governance-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;

describe("publication governance Candidate review", () => {
  it("recovers the latest non-production test Run scoped to the Candidate", async () => {
    const workspaceId = identity(1);
    const candidateId = identity(2);
    const runId = identity(3);
    const document = { schemaVersion: 1 };
    const execute = vi.fn((sqlValue: unknown, parameters?: unknown) => {
      void parameters;
      const sql = String(sqlValue);
      if (sql.includes("FROM publication_candidate")) {
        return [
          [
            {
              id: candidateId,
              workspaceId,
              subjectKind: "workflow",
              subjectKey: "poster",
              sourceDraftId: identity(4),
              sourceDraftVersion: 2,
              schemaVersion: 1,
              contentDocument: document,
              canonicalDigest: digestProviderValue(document),
              parserProfileVersion: "workflow-v1",
              createdByPrincipalId: identity(5),
              createdAt: new Date("2026-09-14T12:00:00.000Z"),
            },
          ],
        ];
      }
      if (sql.includes("FROM workflow_run")) {
        return [[{ id: runId, lifecycleStatus: "running" }]];
      }
      return [[]];
    });
    const release = vi.fn();
    const connection = { execute, release } as unknown as PoolConnection;
    const pool = {
      getConnection: vi.fn(() => Promise.resolve(connection)),
    } as unknown as Pool;
    const store = createPublicationGovernanceStore(pool, {
      validateSkill: () => [],
      validateWorkflow: () => [],
    });

    await expect(
      store.getWorkflowCandidateReview(workspaceId, candidateId),
    ).resolves.toMatchObject({
      latestTestRunId: runId,
      activeTestRunIds: [runId],
    });
    const runQuery = execute.mock.calls.find(([sql]) =>
      String(sql).includes("FROM workflow_run"),
    );
    expect(runQuery?.[0]).toContain(
      "definition_kind = 'publication_candidate'",
    );
    expect(runQuery?.[0]).toContain("non_production = TRUE");
    expect(runQuery?.[1]).toEqual([workspaceId, candidateId]);
    expect(release).toHaveBeenCalledOnce();
  });
});
