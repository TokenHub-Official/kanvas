import { describe, expect, it, vi } from "vitest";

import {
  authorizationModelVersion,
  createWorkflowPublication,
  type TrustedWorkspaceScope,
  type WorkflowCandidateReview,
  type WorkflowPublicationAuditContext,
  type WorkflowPublicationCandidateRecord,
  type WorkflowPublicationPort,
  type WorkflowRunView,
} from "../src/index.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = `sha256:${"a".repeat(64)}`;
const now = new Date("2026-08-10T03:00:00.000Z");
const audit: WorkflowPublicationAuditContext = {
  auditEventId: id(90),
  actorPrincipalId: id(3),
  actorType: "human",
  authenticationRefType: "session",
  authenticationRefHash: null,
  authorityType: "human_membership",
  authorityId: id(5),
  authorityVersion: 1,
};
const authority: TrustedWorkspaceScope = {
  workspaceId: id(1),
  organizationId: id(2),
  principalId: id(3),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: id(4),
  authorityType: "human_membership",
  authorityId: id(5),
  authorityVersion: 1,
  authorizationModelVersion,
  effectivePermissions: [
    "workflow.read",
    "workflow.author",
    "workflow.run",
    "workflow.publish",
  ],
  trusted: true,
};
const candidate: WorkflowPublicationCandidateRecord = {
  id: id(10),
  workspaceId: id(1),
  subjectKind: "workflow",
  subjectKey: "candidate_test",
  sourceDraftId: id(11),
  sourceDraftVersion: 3,
  schemaVersion: 1,
  contentDocument: {
    schemaVersion: 1,
    topology: {
      schemaVersion: 1,
      key: "candidate_test",
      entryNodeKey: "invoke",
      limits: { maxNodeRuns: 10, timeoutMs: 60_000 },
      nodes: [
        {
          key: "invoke",
          kind: "invoke",
          capability: {
            contractId: "foundation.echo",
            revision: 1,
            canonicalDigest: digest,
          },
          input: { source: "workflow_input" },
          next: [],
        },
      ],
      outputs: {},
    },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  },
  canonicalDigest: digest,
  parserProfileVersion: "workflow-v1",
  createdByPrincipalId: id(3),
  createdAt: now,
};

function createHarness() {
  const checks: WorkflowCandidateReview["checks"][number][] = [];
  const review: WorkflowCandidateReview = {
    candidate,
    latestTestRunId: id(20),
    activeTestRunIds: [id(20)],
    checks,
  };
  const port: WorkflowPublicationPort = {
    listWorkflowCandidates: vi.fn(() => Promise.resolve([])),
    getWorkflowCandidateReview: vi.fn(() => Promise.resolve(review)),
    submitCandidate: vi.fn(() => Promise.resolve(candidate)),
    recordCheck: vi.fn(
      (options: Parameters<WorkflowPublicationPort["recordCheck"]>[0]) => {
        checks.push({
          id: options.checkId,
          checkKind: options.checkKind,
          checkProfileVersion: options.checkProfileVersion,
          outcome: options.outcome,
          evidenceSummary: options.evidenceSummary,
          evidenceDigest: digest,
          checkedAt: options.now,
        });
        return Promise.resolve();
      },
    ),
    reviewCandidate: vi.fn(() => Promise.resolve()),
    publishWorkflow: vi.fn(() =>
      Promise.resolve({
        id: id(30),
        workspaceId: id(1),
        subjectKind: "workflow" as const,
        subjectKey: "candidate_test",
        revision: 1,
        canonicalDigest: digest,
        runtimeStatus: "enabled" as const,
        publishedAt: now,
      }),
    ),
  };
  let next = 40;
  return {
    checks,
    port,
    publication: createWorkflowPublication({
      port,
      now: () => now,
      nextId: () => id(next++),
    }),
  };
}

function candidateRun(
  lifecycleStatus: "completed" | "failed",
  outcome: WorkflowRunView["outcome"],
): WorkflowRunView {
  return {
    id: id(20),
    workspaceId: id(1),
    definitionKind: "publication_candidate",
    publicationCandidateId: candidate.id,
    nonProduction: true,
    lifecycleStatus,
    outcome,
    version: 2,
    input: { message: "test" },
    output: lifecycleStatus === "completed" ? { message: "test" } : null,
    nodes: [],
    executionDeadlineAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

describe("workflow publication", () => {
  it("returns the durable latest Candidate test Run identity", async () => {
    const harness = createHarness();

    await expect(
      harness.publication.get(authority, candidate.id),
    ).resolves.toMatchObject({
      latestTestRunId: id(20),
      activeTestRunIds: [id(20)],
    });
  });

  it("derives the non-eval checks from the immutable candidate", async () => {
    const harness = createHarness();

    await harness.publication.submit({
      authority,
      draftId: candidate.sourceDraftId,
      expectedDraftVersion: candidate.sourceDraftVersion,
      audit,
    });

    expect(harness.checks.map((check) => check.checkKind)).toEqual([
      "schema",
      "resources",
      "security",
      "compatibility",
    ]);
    expect(harness.checks.every((check) => check.outcome === "passed")).toBe(
      true,
    );
  });

  it.each([
    ["completed", "full_success", "passed"],
    ["failed", "no_usable_output", "failed"],
  ] as const)(
    "records a %s candidate run as %s evidence",
    async (lifecycleStatus, outcome, expected) => {
      const harness = createHarness();

      await harness.publication.recordEval({
        authority,
        candidateId: candidate.id,
        expectedCandidateDigest: digest,
        run: candidateRun(lifecycleStatus, outcome),
        audit,
      });

      expect(harness.checks).toHaveLength(1);
      expect(harness.checks[0]).toMatchObject({
        checkKind: "eval",
        outcome: expected,
      });
    },
  );
});
