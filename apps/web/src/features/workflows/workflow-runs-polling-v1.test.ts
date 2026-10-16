import { describe, expect, it } from "vitest";

import { workflowRunsRefetchIntervalV1 } from "./workflow-runs-polling-v1.js";

describe("My creations polling", () => {
  it("polls healthy views that can contain active runs", () => {
    expect(workflowRunsRefetchIntervalV1("all", false)).toBe(2_000);
    expect(workflowRunsRefetchIntervalV1("all", true)).toBe(false);
    expect(workflowRunsRefetchIntervalV1("active", false)).toBe(2_000);
    expect(workflowRunsRefetchIntervalV1("active", true)).toBe(false);
    expect(workflowRunsRefetchIntervalV1("completed", false)).toBe(false);
    expect(workflowRunsRefetchIntervalV1("unfinished", false)).toBe(false);
  });
});
