import { describe, expect, it } from "vitest";

import { workflowPrimaryModules } from "./workflow-module-nav.js";

describe("Workflow module navigation", () => {
  it("keeps only creation views in the primary switcher", () => {
    expect(workflowPrimaryModules).toEqual(["templates", "runs"]);
  });
});
