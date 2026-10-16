import { describe, expect, it } from "vitest";

import {
  acceptWorkflowCandidateTestAttempt,
  prepareWorkflowCandidateTestAttempt,
  readWorkflowCandidateTestAttempt,
  workflowCandidateTestInputFingerprint,
} from "./workflow-candidate-test-attempt.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("Workflow Candidate test attempt recovery", () => {
  it("reuses an uncertain attempt only for the same canonical input", () => {
    const target = storage();
    let next = 0;
    const prepare = (input: unknown) =>
      prepareWorkflowCandidateTestAttempt(
        {
          workspaceId: "workspace-1",
          candidateId: "candidate-1",
          input,
          createId: () => `attempt-${String(++next)}`,
        },
        target,
      );

    expect(prepare({ prompt: "poster", size: 2 }).idempotencyKey).toBe(
      "attempt-1",
    );
    expect(prepare({ size: 2, prompt: "poster" }).idempotencyKey).toBe(
      "attempt-1",
    );
    expect(prepare({ prompt: "banner", size: 2 }).idempotencyKey).toBe(
      "attempt-2",
    );
  });

  it("persists the accepted Run id and starts an explicit repeat separately", () => {
    const target = storage();
    const attempt = prepareWorkflowCandidateTestAttempt(
      {
        workspaceId: "workspace-1",
        candidateId: "candidate-1",
        input: { prompt: "poster" },
        createId: () => "attempt-1",
      },
      target,
    );
    acceptWorkflowCandidateTestAttempt("workspace-1", attempt, "run-1", target);

    expect(
      readWorkflowCandidateTestAttempt("workspace-1", "candidate-1", target)
        ?.runId,
    ).toBe("run-1");
    expect(
      prepareWorkflowCandidateTestAttempt(
        {
          workspaceId: "workspace-1",
          candidateId: "candidate-1",
          input: { prompt: "poster" },
          createId: () => "attempt-2",
          forceNew: true,
        },
        target,
      ).idempotencyKey,
    ).toBe("attempt-2");
  });

  it("fingerprints nested object keys deterministically", () => {
    expect(
      workflowCandidateTestInputFingerprint({ b: [{ y: 2, x: 1 }], a: 0 }),
    ).toBe('{"a":0,"b":[{"x":1,"y":2}]}');
  });
});
