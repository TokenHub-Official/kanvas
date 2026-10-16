import type {
  ApplicationRuntime,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import type { DatabaseRuntime } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAgentService } from "../src/agent/workspace-agent.service.js";
import type { CapabilityRunService } from "../src/capabilities/capability-run.service.js";
const now = new Date("2026-09-14T12:00:00.000Z");
const authority = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "asset.read"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;
const surfaceView = {
  profile: {
    agentDefinitionId: "01K0000000000000000000000M",
    id: "01K00000000000000000000005",
  },
};
function workspaceAgentService(
  database: DatabaseRuntime,
  runtime: ApplicationRuntime,
) {
  return new WorkspaceAgentService(
    database,
    runtime,
    {} as CapabilityRunService,
  );
}
describe("Retained resource history", () => {
  it("keeps a deleted Agent identifiable when reading retained conversation history", async () => {
    const historicalAuthority = {
      ...authority,
      effectivePermissions: [
        ...authority.effectivePermissions,
        "agent.read" as const,
      ],
    };
    const agentId = surfaceView.profile.agentDefinitionId;
    const listResourceStates = vi
      .fn()
      .mockResolvedValue([
        { id: agentId, displayName: "Retained Agent", state: "deleted" },
      ]);
    const service = workspaceAgentService(
      {
        agentRuntime: {
          getThread: vi.fn().mockResolvedValue({
            id: "01K0000000000000000000000N",
            agentDefinitionId: agentId,
            agentProfileRevisionId: surfaceView.profile.id,
            lifecycleStatus: "active",
            version: 1,
            createdAt: now,
            updatedAt: now,
          }),
          listThreadMessages: vi.fn().mockResolvedValue([]),
          getLatestThreadRun: vi.fn().mockResolvedValue(undefined),
          listThreadActions: vi.fn().mockResolvedValue([]),
          listThreadInteractions: vi.fn().mockResolvedValue([]),
        },
        agentProfilePublications: {
          getModelSettings: vi
            .fn()
            .mockResolvedValue({ actionConfirmationRequired: false }),
        },
        agentFoundation: {
          resolveSurfaceView: vi.fn().mockResolvedValue(undefined),
        },
        agentHub: { listResourceStates },
      } as unknown as DatabaseRuntime,
      {} as ApplicationRuntime,
    );
    const view = await service.getThread({
      authority: historicalAuthority,
      threadId: "01K0000000000000000000000N",
      now,
    });
    expect(view.agent).toEqual({ id: agentId, displayName: "Retained Agent" });
    expect(view.messages).toEqual([]);
    expect(listResourceStates).toHaveBeenCalledWith(
      historicalAuthority,
      "agent",
      now,
    );
  });
});
