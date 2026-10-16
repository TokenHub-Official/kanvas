import { Value } from "@sinclair/typebox/value";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  AgentHubAgentDetailSchema,
  AgentHubAgentAvatarSchema,
  AgentHubSkillDetailSchema,
  UpdateAgentHubAgentBodySchema,
  getAgentHubAgentRoute,
  getAgentHubSkillRoute,
  routeRegistry,
  updateAgentHubAgentRoute,
} from "../src/api/index.js";

describe("Agent Hub contract", () => {
  it("registers Agent detail and optimistic update routes", () => {
    expect(routeRegistry).toContain(getAgentHubAgentRoute);
    expect(routeRegistry).toContain(getAgentHubSkillRoute);
    expect(routeRegistry).toContain(updateAgentHubAgentRoute);
    expect(updateAgentHubAgentRoute).toMatchObject({
      method: "PATCH",
      idempotency: "none",
      security: ["sessionOrServiceToken"],
    });
  });

  it("keeps Agent configuration and linked resources explicit", () => {
    const base = {
      resourceState: "enabled",
      id: "01K00000000000000000000001",
      agentKey: "workspace.agent",
      managementKind: "workspace",
      isDefault: false,
      displayName: "Seasonal poster Agent",
      summary: "Creates seasonal posters.",

      tags: [],
      ownerPrincipalId: "01K00000000000000000000002",
      visibility: "workspace",
      version: 2,
      profileRevisionId: "01K00000000000000000000003",
      profileRevision: 2,
      boundSkillCount: 1,
      updatedAt: "2026-09-04T12:00:00.000Z",
    } as const;
    const ajv = new Ajv2020({ strict: false });
    const registerFormats = addFormats as unknown as (
      instance: Ajv2020,
    ) => unknown;
    registerFormats(ajv);
    expect(
      ajv.validate(AgentHubAgentDetailSchema, {
        ...base,
        instructions: "请用中文回答。",
        avatar: {
          kind: "icon",
          value: "palette",
          backgroundColor: "#E8F3FF",
        },
        creatorDisplayName: "Example User",
        canEdit: true,
        boundSkills: [
          {
            id: "01K00000000000000000000004",
            displayName: "Seasonal poster",
            workspaceAvailability: "available",
            summary: "Guides seasonal poster creation.",
          },
        ],
        boundBrands: [],
        boundWorkflows: [],
      }),
    ).toBe(true);
    expect(
      Value.Check(UpdateAgentHubAgentBodySchema, {
        expectedVersion: 2,
        displayName: base.displayName,
        summary: base.summary,

        instructions: "Follow the configured SOP and available tools.",
        avatar: {
          kind: "emoji",
          value: "🎨",
          backgroundColor: "#EEF2FF",
        },
        visibility: "workspace",
        tags: [],
        skillDefinitionIds: ["01K00000000000000000000004"],
        brandKitIds: [],
        workflowDefinitionIds: [],
      }),
    ).toBe(true);
    expect(
      ajv.validate(AgentHubSkillDetailSchema, {
        id: "01K00000000000000000000004",
        skillKey: "workspace.seasonal-poster",
        displayName: "Seasonal poster",
        summary: "Guides seasonal poster creation.",
        category: "visual-design",
        tags: ["poster"],
        exampleRequests: ["Create a Qingming poster"],

        ownerPrincipalId: "01K00000000000000000000002",
        visibility: "workspace",
        version: 2,
        skillRevisionId: "01K00000000000000000000005",
        skillRevision: 2,
        runtimeStatus: "enabled",
        activationVersion: 1,
        updatedAt: "2026-09-04T12:00:00.000Z",
        description: "Use for internal seasonal campaign posters.",
        instructions: "# Workflow\n\nCreate the final poster image.",
        resources: [
          {
            path: "SKILL.md",
            resourceKind: "instructions",
            mediaType: "text/markdown",
            byteSize: 128,
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("semantic Agent avatars", () => {
  it("accepts semantic icons and multi-codepoint emoji while rejecting unknown icons", () => {
    for (const value of ["research", "cat", "translate", "palette"]) {
      expect(
        Value.Check(AgentHubAgentAvatarSchema, {
          kind: "icon",
          value,
          backgroundColor: "#EEF2FF",
        }),
      ).toBe(true);
    }
    expect(
      Value.Check(AgentHubAgentAvatarSchema, {
        kind: "emoji",
        value: "👩🏽‍💻",
        backgroundColor: "#EEF2FF",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentHubAgentAvatarSchema, {
        kind: "icon",
        value: "palette",
        backgroundColor: "#EEF2FF",
        foregroundColor: "#3048F5",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentHubAgentAvatarSchema, {
        kind: "icon",
        value: "palette",
        backgroundColor: "#EEF2FF",
        foregroundColor: "red",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentHubAgentAvatarSchema, {
        kind: "icon",
        value: "unregistered",
        backgroundColor: "#EEF2FF",
      }),
    ).toBe(false);
  });
});
