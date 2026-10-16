import type {
  AgentSurfaceView,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import type { DatabaseRuntime } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { AgentHubService } from "../src/agent/agent-hub.service.js";
import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";

const now = new Date("2026-09-03T12:00:00.000Z");
const authority = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "agent-hub-test",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: [
    "agent.read",
    "agent.run",
    "agent.manage",
    "agent.publish",
    "skill.read",
  ],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

const base = {
  profile: {
    id: "01K00000000000000000000005",
    workspaceId: authority.workspaceId,
    agentDefinitionId: "01K00000000000000000000006",
    profileKey: "first-party.main-agent",
    revision: 1,
    canonicalDigest: `sha256:${"a".repeat(64)}`,
    manifest: {
      schemaVersion: 1,
      displayName: "Kanvas Agent",
      modelBindingKey: "workspace-default-text",
      instructions: "Use the available Skills and Tools to complete real work.",
      allowedSurfaceKinds: ["agent_workspace"],
      allowedToolFamilies: ["query", "workflow"],
      requiredToolFamilies: ["workflow"],
      skillPolicy: {
        maximumCatalogItems: 40,
        maximumActivatedInstructionBytes: 262_144,
        maximumReferenceReadBytes: 262_144,
      },
      runLimits: {
        maximumModelCalls: 8,
        maximumToolCalls: 12,
        timeoutSeconds: 180,
      },
    },
  },
  skills: [],
  boundBrands: [],
  boundWorkflows: [],
  skillViewDigest: `sha256:${"b".repeat(64)}`,
} as const satisfies AgentSurfaceView;

const authentication = {
  getHumanProfile: vi.fn(() =>
    Promise.resolve({ displayName: "Example User" }),
  ),
} as unknown as AuthenticationGateway;

describe("AgentHubService", () => {
  it("publishes an Agent with stable Skill, Brand and Workflow bindings", async () => {
    let publishedAgentId = "";
    const publish = vi.fn<
      DatabaseRuntime["agentProfilePublications"]["publish"]
    >((options) => {
      publishedAgentId = options.agentDefinitionId;
      return Promise.resolve({
        ...base.profile,
        id: options.profileRevisionId,
        agentDefinitionId: options.agentDefinitionId,
        profileKey: options.profile.profileKey,
        manifest: options.profile.manifest,
      });
    });
    const listAgents = vi.fn(() =>
      Promise.resolve([
        {
          id: publishedAgentId,
          agentKey: "workspace.agent-test",
          managementKind: "workspace" as const,
          displayName: "Seasonal campaign Agent",
          summary: "Creates internal campaign posters.",

          tags: [],
          ownerPrincipalId: authority.principalId,
          visibility: "private" as const,
          version: 1,
          profileRevisionId: "01K10000000000000000000002",
          profileRevision: 1,
          boundSkillCount: 1,
          updatedAt: now,
        },
      ]),
    );
    const database = {
      agentFoundation: {
        resolveSurfaceView: () => Promise.resolve(base),
      },
      agentProfilePublications: { publish },
      agentHub: { listAgents },
    } as unknown as DatabaseRuntime;
    const service = new AgentHubService(database, authentication);
    const skillDefinitionId = "01K20000000000000000000001";
    const brandKitId = "01K20000000000000000000002";
    const workflowDefinitionId = "01K20000000000000000000003";

    await service.createAgent({
      authority,
      body: {
        displayName: "Seasonal campaign Agent",
        summary: "Creates internal campaign posters.",

        avatar: {
          kind: "emoji",
          value: "🎨",
          backgroundColor: "#EEF2FF",
        },
        instructions:
          "Create internal seasonal campaign posters using the bound resources.",
        visibility: "private",
        tags: [],
        skillDefinitionIds: [skillDefinitionId],
        brandKitIds: [brandKitId],
        workflowDefinitionIds: [workflowDefinitionId],
      },
      idempotencyKey: "agent-create:test",
      now,
    });

    const published = publish.mock.calls[0]?.[0];
    expect(published?.visibility).toBe("private");
    expect(published?.presentation?.avatar).toEqual({
      kind: "emoji",
      value: "🎨",
      backgroundColor: "#EEF2FF",
    });
    expect(published?.boundSkillDefinitionIds).toEqual([skillDefinitionId]);
    expect(published?.boundBrandKitIds).toEqual([brandKitId]);
    expect(published?.boundWorkflowDefinitionIds).toEqual([
      workflowDefinitionId,
    ]);
    expect(published?.profile.manifest.allowedToolFamilies).toContain(
      "capability",
    );
    expect(published?.profile.surfaceBindings).toEqual([]);
    expect(published?.profile.manifest.allowedSurfaceKinds).toEqual([
      "agent_workspace",
    ]);
  });

  it("reads and publishes an editable Agent configuration revision", async () => {
    const current = {
      id: base.profile.agentDefinitionId,
      agentKey: "workspace.seasonal-agent",
      managementKind: "workspace" as const,
      displayName: "Seasonal campaign Agent",
      summary: "Creates internal campaign posters.",

      avatar: {
        kind: "icon" as const,
        value: "palette" as const,
        backgroundColor: "#E8F3FF",
      },
      tags: [],
      ownerPrincipalId: authority.principalId,
      ownerAuthSubjectId: "agent-hub-owner",
      visibility: "private" as const,
      version: 1,
      profileRevisionId: base.profile.id,
      profileRevision: 1,
      boundSkillCount: 1,
      updatedAt: now,
      profile: base.profile,
      boundSkills: [
        {
          id: "01K20000000000000000000001",
          displayName: "Seasonal poster SOP",
          summary: "Guides seasonal poster creation.",
          workspaceAvailability: "available",
        },
      ],
      boundLibraries: [
        { id: "01K20000000000000000000004", displayName: "Product facts" },
      ],
      boundBrands: [
        {
          id: "01K20000000000000000000002",
          displayName: "Example Studio",
        },
      ],
      boundWorkflows: [
        {
          id: "01K20000000000000000000003",
          displayName: "Generate image",
        },
      ],
    };
    const updated = {
      ...current,
      displayName: "Seasonal communication Agent",
      version: 2,
      profileRevision: 2,
      profile: {
        ...current.profile,
        revision: 2,
        manifest: {
          ...current.profile.manifest,
          displayName: "Seasonal communication Agent",
          instructions:
            "Use the selected SOP and tools to prepare seasonal communication.",
        },
      },
    };
    const getAgent = vi
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(updated);
    const publish = vi.fn<
      DatabaseRuntime["agentProfilePublications"]["publish"]
    >(() => Promise.resolve(updated.profile));
    const service = new AgentHubService(
      {
        agentHub: { getAgent },
        agentProfilePublications: { publish },
      } as unknown as DatabaseRuntime,
      authentication,
    );

    await expect(
      service.getAgent({
        authority,
        agentDefinitionId: current.id,
        now,
      }),
    ).resolves.toMatchObject({
      displayName: current.displayName,
      instructions: current.profile.manifest.instructions,
      creatorDisplayName: "Example User",
      canEdit: true,
      boundSkills: [{ displayName: "Seasonal poster SOP" }],
    });

    await expect(
      service.updateAgent({
        authority,
        agentDefinitionId: current.id,
        body: {
          expectedVersion: 1,
          displayName: updated.displayName,
          summary: updated.summary,

          instructions: updated.profile.manifest.instructions,
          avatar: current.avatar,
          visibility: "private",
          tags: [],
          skillDefinitionIds: current.boundSkills.map((skill) => skill.id),
          brandKitIds: current.boundBrands.map((brand) => brand.id),
          workflowDefinitionIds: current.boundWorkflows.map(
            (workflow) => workflow.id,
          ),
        },
        now,
      }),
    ).resolves.toMatchObject({
      displayName: updated.displayName,
      instructions: updated.profile.manifest.instructions,
      canEdit: true,
    });

    const published = publish.mock.calls[0]?.[0];
    expect(published?.boundLibraryIds).toEqual(["01K20000000000000000000004"]);
    expect(published?.agentDefinitionId).toBe(current.id);
    expect(published?.expectedAgentVersion).toBe(1);
    expect(published?.presentation?.avatar).toEqual(current.avatar);
    expect(published?.boundSkillDefinitionIds).toEqual([
      current.boundSkills[0]!.id,
    ]);
    expect(published?.boundBrandKitIds).toEqual([current.boundBrands[0]!.id]);
    expect(published?.boundWorkflowDefinitionIds).toEqual([
      current.boundWorkflows[0]!.id,
    ]);
    expect(published?.profile).toMatchObject({
      profileKey: current.profile.profileKey,
      revision: 2,
      manifest: {
        displayName: updated.displayName,
        instructions: updated.profile.manifest.instructions,
      },
    });
  });

  it("presents the built-in default Agent as system managed and refuses ordinary updates", async () => {
    const current = {
      id: base.profile.agentDefinitionId,
      agentKey: "first-party.main-agent",
      managementKind: "system" as const,
      systemKey: "workspace-default",
      displayName: "Kanvas Agent",
      summary: "General-purpose creative Agent",
      tags: [],
      ownerPrincipalId: authority.principalId,
      ownerAuthSubjectId: "bootstrap-actor",
      visibility: "workspace" as const,
      version: 1,
      profileRevisionId: base.profile.id,
      profileRevision: 1,
      boundSkillCount: 0,
      updatedAt: now,
      profile: base.profile,
      boundSkills: [],
      boundBrands: [],
      boundWorkflows: [],
    };
    const getAgent = vi.fn(() => Promise.resolve(current));
    const service = new AgentHubService(
      {
        agentHub: { getAgent },
        agentProfilePublications: { publish: vi.fn() },
      } as unknown as DatabaseRuntime,
      authentication,
    );

    await expect(
      service.getAgent({
        authority,
        agentDefinitionId: current.id,
        now,
      }),
    ).resolves.toMatchObject({
      managementKind: "system",
      systemKey: "workspace-default",
      isDefault: true,
      canEdit: false,
    });
    await expect(
      service.updateAgent({
        authority,
        agentDefinitionId: current.id,
        body: {
          expectedVersion: 1,
          displayName: current.displayName,
          summary: current.summary,
          instructions: current.profile.manifest.instructions,
          visibility: "workspace",
          tags: [],
          skillDefinitionIds: [],
          brandKitIds: [],
          workflowDefinitionIds: [],
        },
        now,
      }),
    ).rejects.toMatchObject({ code: "agent_hub.system_managed" });
  });
});
