import type {
  EffectiveInvocationSchema,
  WorkflowRunDetails,
} from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  workflowRunCompletedStepCountV1,
  workflowRunDisplayOutputFields,
  workflowRunExperienceStateV1,
  workflowRunIsTerminalV1,
  workflowRunPollIntervalV1,
  workflowRunProgressV1,
  workflowRunSourceArtifactIdsV1,
} from "./workflow-run-session-v1.js";

const createdAt = "2026-08-19T10:00:00.000Z";

function runNode(lifecycleStatus: string) {
  return { lifecycleStatus } as WorkflowRunDetails["nodes"][number];
}

describe("Workflow run session", () => {
  it("projects runtime states into user-facing creation states", () => {
    expect(workflowRunExperienceStateV1("queued")).toBe("preparing");
    expect(workflowRunExperienceStateV1("running")).toBe("working");
    expect(workflowRunExperienceStateV1("waiting")).toBe("waiting");
    expect(workflowRunExperienceStateV1("cancelling")).toBe("stopping");
    expect(workflowRunExperienceStateV1("completed")).toBe("complete");
    expect(workflowRunExperienceStateV1("completed", "partial_success")).toBe(
      "partial",
    );
    expect(workflowRunExperienceStateV1("completed", "no_usable_output")).toBe(
      "failed",
    );
    expect(workflowRunExperienceStateV1("failed")).toBe("failed");
    expect(workflowRunExperienceStateV1("cancelled")).toBe("cancelled");
  });

  it("stops polling terminal runs and slows settled active runs", () => {
    expect(workflowRunIsTerminalV1({ lifecycleStatus: "completed" })).toBe(
      true,
    );
    expect(
      workflowRunPollIntervalV1({ createdAt, lifecycleStatus: "failed" }),
    ).toBe(false);
    expect(
      workflowRunPollIntervalV1(
        { createdAt, lifecycleStatus: "running" },
        Date.parse(createdAt) + 31_000,
      ),
    ).toBe(2_000);
  });

  it("projects business progress from completed and skipped steps", () => {
    const nodes = [
      runNode("completed"),
      runNode("skipped"),
      runNode("running"),
      runNode("queued"),
    ];
    expect(workflowRunCompletedStepCountV1(nodes)).toBe(2);
    expect(workflowRunProgressV1(nodes)).toBe(50);
  });

  it("finds source artifacts only from invocation file fields", () => {
    const schema = {
      availability: "available",
      fields: [
        { key: "prompt", valueType: "string" },
        { key: "source", valueType: "artifact" },
        { key: "references", valueType: "artifact_list" },
      ],
    } as EffectiveInvocationSchema;
    expect(
      workflowRunSourceArtifactIdsV1(schema, {
        prompt: "poster",
        source: "01K00000000000000000000001",
        references: [
          "01K00000000000000000000002",
          "01K00000000000000000000001",
        ],
      }),
    ).toEqual(["01K00000000000000000000001", "01K00000000000000000000002"]);
  });

  it("presents selected text output without mistaking schema metadata for a result", () => {
    expect(
      workflowRunDisplayOutputFields(
        { schemaVersion: 1, notice: "Approved and complete" },
        {
          type: "object",
          properties: {
            notice: { type: "string", title: "Notice" },
          },
        },
      ),
    ).toEqual([
      {
        key: "notice",
        label: "Notice",
        value: "Approved and complete",
      },
    ]);
    expect(workflowRunDisplayOutputFields({}, {})).toEqual([]);
  });
});
