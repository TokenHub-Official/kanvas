import { describe, expect, it } from "vitest";

import {
  agentDisplaySummary,
  agentTaskPresentationStatus,
  agentTaskStatusTone,
} from "./agent-presentation.js";

describe("Agent presentation", () => {
  it("localizes only the system-managed Workspace default summary", () => {
    const sourceSummary = "General-purpose creative Agent";
    expect(
      agentDisplaySummary(
        {
          managementKind: "system",
          summary: sourceSummary,
          systemKey: "workspace-default",
        },
        "处理当前工作区中的通用创作与协作任务。",
      ),
    ).toBe("处理当前工作区中的通用创作与协作任务。");
    expect(
      agentDisplaySummary(
        {
          managementKind: "workspace",
          summary: sourceSummary,
        },
        "处理当前工作区中的通用创作与协作任务。",
      ),
    ).toBe(sourceSummary);
  });

  it("uses the actual Capability status instead of the submission receipt", () => {
    expect(
      agentTaskPresentationStatus(
        "succeeded",
        undefined,
        "capability",
        "completed",
      ),
    ).toBe("completed");
    expect(
      agentTaskPresentationStatus(
        "succeeded",
        undefined,
        "capability",
        "running",
      ),
    ).toBe("working");
    expect(
      agentTaskPresentationStatus(
        "succeeded",
        undefined,
        "capability",
        "failed",
      ),
    ).toBe("failed");
  });
  it("uses semantic tones for task state", () => {
    expect(agentTaskStatusTone("completed")).toBe("positive");
    expect(agentTaskStatusTone("running")).toBe("info");
    expect(agentTaskStatusTone("waiting_approval")).toBe("warning");
    expect(agentTaskStatusTone("failed")).toBe("danger");
  });

  it("projects the live Workflow state identically in messages and details", () => {
    expect(agentTaskPresentationStatus("succeeded", undefined, "brand")).toBe(
      "completed",
    );
    expect(agentTaskPresentationStatus("succeeded", undefined, "skill")).toBe(
      "completed",
    );
    expect(agentTaskPresentationStatus("waiting_approval", "running")).toBe(
      "working",
    );
    expect(agentTaskPresentationStatus("running", "waiting")).toBe("waiting");
    expect(agentTaskPresentationStatus("running", "cancelled")).toBe(
      "cancelled",
    );
  });
});
