import { defaultAgentWorkspaceProfileV1 } from "../src/modules/agent/application/default-agent-profile.js";
import { describe, expect, it } from "vitest";

import {
  agentManagementIdentityForProfileV1,
  agentRunFoundationContext,
  parseAgentFoundationPackV1,
  parseAgentProfileManifestV1,
  parseAgentSkillMetadataV1,
} from "../src/modules/agent/index.js";

describe("Agent foundation manifests", () => {
  it("accepts concise instructions while rejecting empty or oversized instructions", () => {
    const manifest = defaultAgentWorkspaceProfileV1.manifest;
    expect(
      parseAgentProfileManifestV1({
        ...manifest,
        instructions: "请用中文回答。",
      })?.instructions,
    ).toBe("请用中文回答。");
    expect(
      parseAgentProfileManifestV1({ ...manifest, instructions: "   " }),
    ).toBeUndefined();
    expect(
      parseAgentProfileManifestV1({
        ...manifest,
        instructions: "x".repeat(8001),
      }),
    ).toBeUndefined();
  });

  it("classifies only the registered Workspace default Profile as system managed", () => {
    expect(
      agentManagementIdentityForProfileV1("first-party.main-agent"),
    ).toEqual({
      managementKind: "system",
      systemKey: "workspace-default",
    });
    expect(
      agentManagementIdentityForProfileV1("workspace.agent-example"),
    ).toEqual({
      managementKind: "workspace",
    });
  });

  it("parses profiles, surface bindings and Skill sources from a data pack", () => {
    expect(
      parseAgentFoundationPackV1({
        schemaVersion: 1,
        packKey: "workspace.pack",
        profiles: [
          {
            profileKey: "workspace.profile",
            revision: 1,
            surfaceBindings: ["workspace_home"],
            manifest: {
              schemaVersion: 1,
              displayName: "Workspace assistant",
              modelBindingKey: "workspace-agent-model",
              instructions:
                "Resolve all behavior from the current Profile, SkillView and ToolView.",
              allowedSurfaceKinds: ["workspace_home"],
              allowedToolFamilies: ["query", "workflow"],
              requiredToolFamilies: ["workflow"],
              skillPolicy: {
                maximumCatalogItems: 20,
                maximumActivatedInstructionBytes: 262_144,
                maximumReferenceReadBytes: 262_144,
              },
              runLimits: {
                maximumModelCalls: 8,
                maximumToolCalls: 4,
                timeoutSeconds: 180,
              },
            },
          },
        ],
        skills: [
          {
            manifestPath: "scenario-packs/example/skill/manifest.json",
            instructionRootPath: "scenario-packs/example/skill",
            workflowEntrypoints: [
              {
                entrypointKey: "prepare",
                workflowKey: "workspace.prepare",
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      packKey: "workspace.pack",
      profiles: [
        {
          profileKey: "workspace.profile",
          surfaceBindings: ["workspace_home"],
        },
      ],
      skills: [{ manifestPath: "scenario-packs/example/skill/manifest.json" }],
    });
  });

  it("rejects duplicate surface ownership and escaping pack paths", () => {
    const profile = {
      profileKey: "workspace.profile",
      revision: 1,
      surfaceBindings: ["workspace_home"],
      manifest: {
        schemaVersion: 1,
        displayName: "Workspace assistant",
        modelBindingKey: "workspace-agent-model",
        instructions:
          "Resolve all behavior from the current Profile, SkillView and ToolView.",
        allowedSurfaceKinds: ["workspace_home"],
        allowedToolFamilies: ["workflow"],
        requiredToolFamilies: ["workflow"],
        skillPolicy: {
          maximumCatalogItems: 20,
          maximumActivatedInstructionBytes: 262_144,
          maximumReferenceReadBytes: 262_144,
        },
        runLimits: {
          maximumModelCalls: 8,
          maximumToolCalls: 4,
          timeoutSeconds: 180,
        },
      },
    };
    expect(
      parseAgentFoundationPackV1({
        schemaVersion: 1,
        packKey: "workspace.pack",
        profiles: [profile, { ...profile, profileKey: "workspace.other" }],
        skills: [],
      }),
    ).toBeUndefined();
    expect(
      parseAgentFoundationPackV1({
        schemaVersion: 1,
        packKey: "workspace.pack",
        profiles: [profile],
        skills: [
          {
            manifestPath: "../outside/manifest.json",
            instructionRootPath: "scenario-packs/example/skill",
            workflowEntrypoints: [
              {
                entrypointKey: "prepare",
                workflowKey: "workspace.prepare",
              },
            ],
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("accepts a bounded data-defined profile without business keys", () => {
    expect(
      parseAgentProfileManifestV1({
        schemaVersion: 1,
        displayName: "Workspace assistant",
        modelBindingKey: "workspace-agent-model",
        instructions:
          "Understand the current workspace request and use only the resolved SkillView and ToolView.",
        allowedSurfaceKinds: ["workspace_home", "asset", "workflow_run"],
        allowedToolFamilies: ["query", "workflow", "review_command"],
        requiredToolFamilies: ["workflow"],
        skillPolicy: {
          maximumCatalogItems: 80,
          maximumActivatedInstructionBytes: 262_144,
          maximumReferenceReadBytes: 262_144,
        },
        runLimits: {
          maximumModelCalls: 8,
          maximumToolCalls: 6,
          timeoutSeconds: 180,
        },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      allowedSurfaceKinds: ["workspace_home", "asset", "workflow_run"],
      skillPolicy: {
        maximumActivatedInstructionBytes: 262_144,
        maximumReferenceReadBytes: 262_144,
      },
    });
  });

  it("preserves Markdown and code whitespace when reading Agent instructions", () => {
    const instructions =
      "## Task\n\n- Keep  two spaces\n  - Nested item\n\n```python\nif ready:\n    run()\n```";
    expect(
      parseAgentProfileManifestV1({
        schemaVersion: 1,
        displayName: "Workspace assistant",
        modelBindingKey: "workspace-agent-model",
        instructions: `  ${instructions}  `,
        allowedSurfaceKinds: ["workspace_home", "asset", "workflow_run"],
        allowedToolFamilies: ["query", "workflow", "review_command"],
        requiredToolFamilies: ["workflow"],
        skillPolicy: {
          maximumCatalogItems: 80,
          maximumActivatedInstructionBytes: 262_144,
          maximumReferenceReadBytes: 262_144,
        },
        runLimits: {
          maximumModelCalls: 8,
          maximumToolCalls: 6,
          timeoutSeconds: 180,
        },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      instructions,
      allowedSurfaceKinds: ["workspace_home", "asset", "workflow_run"],
      skillPolicy: {
        maximumActivatedInstructionBytes: 262_144,
        maximumReferenceReadBytes: 262_144,
      },
    });
  });

  it("rejects invalid surfaces, unbounded limits and path traversal", () => {
    expect(
      parseAgentProfileManifestV1({
        schemaVersion: 1,
        displayName: "Bad profile",
        modelBindingKey: "workspace-agent-model",
        instructions: "This instruction is deliberately long enough to parse.",
        allowedSurfaceKinds: ["unknown"],
        allowedToolFamilies: ["query"],
        requiredToolFamilies: ["query"],
        skillPolicy: {
          maximumCatalogItems: 2,
          maximumActivatedInstructionBytes: 0,
          maximumReferenceReadBytes: 262_144,
        },
        runLimits: {
          maximumModelCalls: 1,
          maximumToolCalls: 0,
          timeoutSeconds: 30,
        },
      }),
    ).toBeUndefined();
    expect(
      parseAgentSkillMetadataV1({
        schemaVersion: 1,
        agent: {
          surfaceKinds: ["workspace_home"],
          toolFamilies: ["workflow"],
          summary: "A discoverable visual production skill.",
          exampleRequests: [],
          instructionResourcePath: "../SKILL.md",
        },
      }),
    ).toBeUndefined();
    expect(
      parseAgentProfileManifestV1({
        schemaVersion: 1,
        displayName: "Missing adapter profile",
        modelBindingKey: "workspace-agent-model",
        instructions:
          "This Profile declares a required Tool Family outside its allowed policy.",
        allowedSurfaceKinds: ["workspace_home"],
        allowedToolFamilies: ["query"],
        requiredToolFamilies: ["brand_command"],
        skillPolicy: {
          maximumCatalogItems: 2,
          maximumActivatedInstructionBytes: 262_144,
          maximumReferenceReadBytes: 262_144,
        },
        runLimits: {
          maximumModelCalls: 1,
          maximumToolCalls: 1,
          timeoutSeconds: 30,
        },
      }),
    ).toBeUndefined();
  });

  it("parses Agent metadata from an otherwise unknown Skill manifest", () => {
    expect(
      parseAgentSkillMetadataV1({
        schemaVersion: 1,
        skillKey: "workspace-defined.unknown-at-compile-time",
        displayName: "Unknown at compile time",
        agent: {
          surfaceKinds: ["workspace_home", "canvas"],
          toolFamilies: ["workflow"],
          summary: "Creates a result through a Workspace-published workflow.",
          exampleRequests: ["Prepare a launch visual from these assets."],
          instructionResourcePath: "SKILL.md",
        },
        entrypoints: [],
      }),
    ).toEqual({
      surfaceKinds: ["workspace_home", "canvas"],
      toolFamilies: ["workflow"],
      summary: "Creates a result through a Workspace-published workflow.",
      exampleRequests: ["Prepare a launch visual from these assets."],
      instructionResourcePath: "SKILL.md",
    });
  });

  it("pins immutable Profile and Skill references for an Agent Run", () => {
    expect(
      agentRunFoundationContext({
        profile: {
          id: "01K00000000000000000000001",
          workspaceId: "01K00000000000000000000002",
          agentDefinitionId: "01K00000000000000000000007",
          profileKey: "workspace-profile",
          revision: 1,
          canonicalDigest: `sha256:${"a".repeat(64)}`,
          manifest: {
            schemaVersion: 1,
            displayName: "Workspace profile",
            modelBindingKey: "workspace-agent-model",
            instructions: "Use the resolved runtime views for every request.",
            allowedSurfaceKinds: ["workspace_home"],
            allowedToolFamilies: ["workflow"],
            requiredToolFamilies: ["workflow"],
            skillPolicy: {
              maximumCatalogItems: 20,
              maximumActivatedInstructionBytes: 262_144,
              maximumReferenceReadBytes: 262_144,
            },
            runLimits: {
              maximumModelCalls: 8,
              maximumToolCalls: 4,
              timeoutSeconds: 180,
            },
          },
        },
        skills: [
          {
            skillDefinitionId: "01K00000000000000000000008",
            skillRevisionId: "01K00000000000000000000003",
            skillKey: "workspace.unknown",
            skillName: "workspace-unknown",
            revision: 1,
            bound: true,
            displayName: "Unknown skill",
            summary: "A dynamically discovered Workspace Skill.",
            exampleRequests: [],
            toolFamilies: ["workflow"],
            canonicalDigest: `sha256:${"b".repeat(64)}`,
            instructionResource: {
              resourcePath: "SKILL.md",
              storedObjectId: "01K00000000000000000000004",
              storageProfileId: "01K00000000000000000000006",
              container: "skills",
              objectKey: "workspace.unknown/SKILL.md",
              sha256: "c".repeat(64),
              immutableIdentityHash: `sha256:${"e".repeat(64)}`,
              contentDigest: `sha256:${"c".repeat(64)}`,
              mediaType: "text/markdown",
              byteSize: "128",
            },
            referenceResources: [],
            entrypoints: [
              {
                entrypointKey: "prepare",
                workflowRevisionId: "01K00000000000000000000005",
                displayName: "Prepare",
                description: "Prepare one result through the published flow.",
                inputSchema: { type: "object" },
              },
            ],
          },
        ],
        boundBrands: [],
        boundWorkflows: [],
        skillViewDigest: `sha256:${"d".repeat(64)}`,
      }),
    ).toEqual({
      schemaVersion: 1,
      profileRevisionId: "01K00000000000000000000001",
      profileCanonicalDigest: `sha256:${"a".repeat(64)}`,
      skillViewDigest: `sha256:${"d".repeat(64)}`,
      skills: [
        {
          skillRevisionId: "01K00000000000000000000003",
          canonicalDigest: `sha256:${"b".repeat(64)}`,
          instructionResourceDigest: `sha256:${"c".repeat(64)}`,
          entrypointWorkflowRevisionIds: ["01K00000000000000000000005"],
        },
      ],
    });
  });
});
