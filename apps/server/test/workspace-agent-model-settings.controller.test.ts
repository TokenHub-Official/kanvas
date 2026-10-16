import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceAgentModelSettingsController } from "../src/http/workspace-agent-model-settings.controller.js";

const scope: TrustedWorkspaceScope = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000004",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "workspace.manage"],
  trusted: true,
};

function contexts(request: FastifyRequest): RequestAuthorizationContextStore {
  const store = new RequestAuthorizationContextStore();
  store.set(request, {
    authentication: {
      authSubjectId: "agent-model-settings",
      sessionId: scope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return store;
}

describe("WorkspaceAgentModelSettingsController", () => {
  it("returns user-facing model choices without binding keys", async () => {
    const request = { id: "agent-model-settings-get" } as FastifyRequest;
    const getModelSettings = vi.fn().mockResolvedValue({
      profileRevisionId: "01K00000000000000000000006",
      profileRevision: 2,
      version: 3,
      currentDefaultModelId: "01K00000000000000000000007",
      currentFastModelId: "01K00000000000000000000008",
      reasoningLevel: "medium",
      webSearchMode: "off",
      options: [
        {
          id: "01K00000000000000000000007",
          bindingKeys: ["internal-agent-model-key"],
          modelName: "Balanced model",
          ready: true,
        },
      ],
    });
    const controller = new WorkspaceAgentModelSettingsController(
      {
        agentProfilePublications: { getModelSettings },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );

    const result = await controller.get(request);
    expect(result).toEqual({
      version: 3,
      currentDefaultModelId: "01K00000000000000000000007",
      currentFastModelId: "01K00000000000000000000008",
      reasoningLevel: "medium",
      webSearchMode: "off",
      options: [
        {
          id: "01K00000000000000000000007",
          modelName: "Balanced model",
          ready: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("internal-agent-model-key");
  });

  it("updates default and fast model selections", async () => {
    const request = { id: "agent-model-settings-update" } as FastifyRequest;
    const setModelSettings = vi.fn().mockResolvedValue({
      profileRevisionId: "01K00000000000000000000008",
      profileRevision: 3,
      version: 4,
      currentDefaultModelId: "01K00000000000000000000009",
      currentFastModelId: "01K00000000000000000000010",
      reasoningLevel: "high",
      webSearchMode: "auto",
      options: [],
    });
    const controller = new WorkspaceAgentModelSettingsController(
      {
        agentProfilePublications: { setModelSettings },
      } as unknown as ServerDatabaseRuntime,
      contexts(request),
    );

    await expect(
      controller.update(request, {
        expectedVersion: 3,
        defaultModelId: "01K00000000000000000000009",
        fastModelId: "01K00000000000000000000010",
        reasoningLevel: "high",
        webSearchMode: "auto",
        actionConfirmationRequired: false,
      }),
    ).resolves.toMatchObject({
      version: 4,
      currentDefaultModelId: "01K00000000000000000000009",
      currentFastModelId: "01K00000000000000000000010",
      reasoningLevel: "high",
      webSearchMode: "auto",
    });
    expect(setModelSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        expectedVersion: 3,
        defaultModelId: "01K00000000000000000000009",
        fastModelId: "01K00000000000000000000010",
        reasoningLevel: "high",
        webSearchMode: "auto",
      }),
    );
  });
});
