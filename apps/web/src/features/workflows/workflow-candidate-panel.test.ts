import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  workflowCandidateIdForDraft,
  workflowCandidateRecoveredTestInput,
  workflowCandidateTestValuesFromRun,
  workflowPublicationPanelStateV1,
  workflowRunPollIntervalV1,
} from "./workflow-candidate-panel.js";

describe("Workflow Candidate test preparation", () => {
  it("selects only the snapshot for the current saved Draft version", () => {
    expect(
      workflowCandidateIdForDraft(
        [
          { id: "candidate-v1", sourceDraftVersion: 1 },
          { id: "candidate-v3", sourceDraftVersion: 3 },
        ],
        3,
      ),
    ).toBe("candidate-v3");
    expect(
      workflowCandidateIdForDraft(
        [{ id: "candidate-v1", sourceDraftVersion: 1 }],
        2,
      ),
    ).toBeUndefined();
  });
});

describe("Workflow publication panel state", () => {
  it("does not report a permission error when an owner has no candidate yet", () => {
    expect(
      workflowPublicationPanelStateV1({
        canPublish: true,
        candidateError: false,
        candidateLoading: false,
        hasCandidate: false,
      }),
    ).toBe("candidate_missing");
  });

  it("keeps permission, loading, error, and ready states distinct", () => {
    expect(
      workflowPublicationPanelStateV1({
        canPublish: false,
        candidateError: false,
        candidateLoading: false,
        hasCandidate: true,
      }),
    ).toBe("permission_denied");
    expect(
      workflowPublicationPanelStateV1({
        canPublish: true,
        candidateError: false,
        candidateLoading: true,
        hasCandidate: false,
      }),
    ).toBe("candidate_loading");
    expect(
      workflowPublicationPanelStateV1({
        canPublish: true,
        candidateError: true,
        candidateLoading: false,
        hasCandidate: false,
      }),
    ).toBe("candidate_error");
    expect(
      workflowPublicationPanelStateV1({
        canPublish: true,
        candidateError: false,
        candidateLoading: false,
        hasCandidate: true,
      }),
    ).toBe("ready");
  });
});

describe("Workflow Run polling", () => {
  it("polls quickly for the first 30 seconds and then backs off", () => {
    const createdAt = "2026-08-19T00:00:00.000Z";
    const active = { createdAt, lifecycleStatus: "running" } as never;
    expect(
      workflowRunPollIntervalV1(active, Date.parse(createdAt) + 29_999),
    ).toBe(750);
    expect(
      workflowRunPollIntervalV1(active, Date.parse(createdAt) + 30_000),
    ).toBe(2_000);
  });

  it("stops polling terminal runs", () => {
    expect(
      workflowRunPollIntervalV1({ lifecycleStatus: "completed" } as never),
    ).toBe(false);
  });

  it("restores the Candidate's durable latest test Run before allowing repeats", () => {
    const source = readFileSync(
      new URL("./workflow-candidate-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("candidate.data?.latestTestRunId");
    expect(source).toContain("candidate.data?.activeTestRunIds");
    expect(source).toContain("prepareWorkflowCandidateTestAttempt");
    expect(source).toContain("runUnavailable");
    expect(source).toContain("workflowCandidateRecoveredTestInput(run.data");
    expect(source).toContain("workflows.candidate.openApprovalRun");
    expect(source).toContain(
      'to="/w/$workspaceId/workflow-runs/$workflowRunId"',
    );
  });

  it("restores only declared Workflow inputs from the recovered Run", () => {
    expect(
      workflowCandidateTestValuesFromRun(
        { notice: "Keep this after refresh", internal: "do not expose" },
        [
          {
            key: "notice",
            title: "Notice",
            type: "string",
            required: true,
          },
        ],
      ),
    ).toEqual({ notice: "Keep this after refresh" });
    expect(workflowCandidateTestValuesFromRun("invalid", [])).toBeUndefined();
  });

  it("keeps the input form safe while recovered Run details are loading", () => {
    expect(
      workflowCandidateRecoveredTestInput(undefined, undefined, []),
    ).toEqual({
      serialized: "{}",
      values: undefined,
    });
  });
});
