import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  getWorkspaceAgentModelSettingsRoute,
  UpdateWorkspaceAgentModelSettingsBodySchema,
  updateWorkspaceAgentModelSettingsRoute,
  WorkspaceAgentModelSettingsSchema,
} from "../src/api/index.js";

describe("Agent model settings contract", () => {
  it("exposes user-facing choices and a bounded optimistic update", () => {
    expect(
      Value.Check(WorkspaceAgentModelSettingsSchema, {
        version: 3,
        currentDefaultModelId: "01K00000000000000000000001",
        currentFastModelId: "01K00000000000000000000002",
        reasoningLevel: "medium",
        webSearchMode: "off",
        actionConfirmationRequired: false,
        options: [
          {
            id: "01K00000000000000000000001",
            modelName: "Balanced model",
            ready: true,
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(UpdateWorkspaceAgentModelSettingsBodySchema, {
        expectedVersion: 3,
        defaultModelId: "01K00000000000000000000002",
        fastModelId: "01K00000000000000000000003",
        reasoningLevel: "high",
        webSearchMode: "auto",
        actionConfirmationRequired: false,
      }),
    ).toBe(true);
  });

  it("registers read and update routes", () => {
    expect(getWorkspaceAgentModelSettingsRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/agent-model-settings",
    });
    expect(updateWorkspaceAgentModelSettingsRoute).toMatchObject({
      method: "PATCH",
      path: "/api/v1/agent-model-settings",
    });
  });
});
