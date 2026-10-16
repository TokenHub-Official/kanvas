import type { AgentSurfaceView } from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import { createDynamicAgentToolView } from "../src/dynamic-tool-view.js";
import { createKanvasMastraTools } from "../src/tool-view.js";
import {
  createWorkflowResourceToolProjection,
  type PrepareAgentWorkflowOptions,
} from "../src/workflow-resource-tool-view.js";

const unknownSkillView = {
  profile: {
    id: "01K00000000000000000000001",
    workspaceId: "01K00000000000000000000002",
    agentDefinitionId: "01K00000000000000000000007",
    profileKey: "runtime-profile",
    revision: 1,
    canonicalDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    manifest: {
      schemaVersion: 1,
      displayName: "Runtime profile",
      modelBindingKey: "workspace-agent-model",
      instructions: "Use only the current dynamic runtime views and policies.",
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
      skillKey: "workspace.unknown-at-compile-time",
      skillName: "workspace-unknown-at-compile-time",
      revision: 1,
      bound: true,
      displayName: "Unknown Skill",
      summary: "A Workspace-defined Skill unknown to the application build.",
      exampleRequests: [],
      toolFamilies: ["workflow"],
      canonicalDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      instructionResource: {
        resourcePath: "SKILL.md",
        storedObjectId: "01K00000000000000000000004",
        storageProfileId: "01K00000000000000000000006",
        container: "skills",
        objectKey: "workspace.unknown/SKILL.md",
        sha256: "c".repeat(64),
        immutableIdentityHash: `sha256:${"e".repeat(64)}`,
        contentDigest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        mediaType: "text/markdown",
        byteSize: "128",
      },
      referenceResources: [],
      entrypoints: [
        {
          entrypointKey: "prepare-unknown-result",
          workflowRevisionId: "01K00000000000000000000005",
          displayName: "Prepare unknown result",
          description:
            "Prepare one result using the dynamically published Workflow.",
          inputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            $id: "kanvas.test-input.v1",
            type: "object",
            additionalProperties: false,
            required: ["brief"],
            properties: { brief: { type: "string" } },
          },
        },
      ],
    },
  ],
  boundBrands: [],
  boundWorkflows: [],
  skillViewDigest:
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
} as const satisfies AgentSurfaceView;

describe("createDynamicAgentToolView", () => {
  it("routes catalog and Skill Entrypoint proposals through one Workflow projector", async () => {
    const prepareWorkflow = vi.fn<
      (options: PrepareAgentWorkflowOptions) => Promise<{
        readonly modelOutput: {
          readonly prepared: true;
          readonly input: Readonly<Record<string, unknown>>;
        };
      }>
    >((options) =>
      Promise.resolve({
        modelOutput: { prepared: true, input: options.input },
      }),
    );
    const workflowProjection = createWorkflowResourceToolProjection({
      surfaceView: unknownSkillView,
      eligibleWorkflowRevisionIds: new Set(["01K00000000000000000000005"]),
      executor: {
        search: () => Promise.resolve({ modelOutput: { workflows: [] } }),
        inspect: () => Promise.resolve({ modelOutput: { workflow: {} } }),
        propose: prepareWorkflow,
      },
    });
    const view = createDynamicAgentToolView({
      surfaceView: unknownSkillView,
      projections: [workflowProjection],
      digest: () =>
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });

    expect(view.descriptors).toHaveLength(4);
    const entrypointDescriptor = view.descriptors.find(
      (descriptor) => descriptor.key === "workflow.propose.entrypoint-1",
    );
    expect(entrypointDescriptor).toMatchObject({
      key: "workflow.propose.entrypoint-1",
      effect: "compute",
      approvalMode: "before-commit",
    });
    expect(entrypointDescriptor?.inputSchema).not.toHaveProperty("$id");
    expect(entrypointDescriptor?.inputSchema).not.toHaveProperty("$schema");
    expect(entrypointDescriptor?.key).not.toContain("unknown-at-compile-time");
    expect(view.workflowEntrypoints.get(entrypointDescriptor!.key)).toEqual({
      actionRef: "workflow-entrypoint-1",
      toolKey: "workflow.propose.entrypoint-1",
      skillRevisionId: "01K00000000000000000000003",
      entrypointKey: "prepare-unknown-result",
      workflowRevisionId: "01K00000000000000000000005",
    });
    await expect(
      view.descriptors
        .find((descriptor) => descriptor.key === "workflow.propose")!
        .executeCanonical({
          workflowRevisionId: "01K0000000000000000000000A",
          input: { brief: "Catalog launch" },
        }),
    ).resolves.toMatchObject({ modelOutput: { prepared: true } });
    await expect(
      entrypointDescriptor!.executeCanonical({ brief: "Skill launch" }),
    ).resolves.toMatchObject({ modelOutput: { prepared: true } });
    expect(prepareWorkflow.mock.calls[0]?.[0]).toEqual({
      binding: {
        source: "catalog",
        actionRef: "workflow-catalog",
        toolKey: "workflow.propose",
        workflowRevisionId: "01K0000000000000000000000A",
      },
      input: { brief: "Catalog launch" },
    });
    expect(prepareWorkflow.mock.calls[1]?.[0]).toEqual({
      binding: {
        source: "skill_entrypoint",
        actionRef: "workflow-entrypoint-1",
        toolKey: "workflow.propose.entrypoint-1",
        skillRevisionId: "01K00000000000000000000003",
        entrypointKey: "prepare-unknown-result",
        workflowRevisionId: "01K00000000000000000000005",
      },
      input: { brief: "Skill launch" },
    });
    expect(Object.keys(createKanvasMastraTools(view.descriptors))).toEqual([
      "workflow.search",
      "workflow.inspect",
      "workflow.propose",
      "workflow.propose.entrypoint-1",
    ]);
  });

  it("omits a Skill wrapper when its immutable Workflow revision is not eligible", () => {
    const workflowProjection = createWorkflowResourceToolProjection({
      surfaceView: unknownSkillView,
      eligibleWorkflowRevisionIds: new Set(),
      executor: {
        search: () => Promise.resolve({ modelOutput: { workflows: [] } }),
        inspect: () => Promise.resolve({ modelOutput: { workflow: {} } }),
        propose: () => Promise.resolve({ modelOutput: {} }),
      },
    });
    const view = createDynamicAgentToolView({
      surfaceView: unknownSkillView,
      projections: [workflowProjection],
      digest: () =>
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(view.descriptors.map((descriptor) => descriptor.key)).toEqual([
      "workflow.search",
      "workflow.inspect",
      "workflow.propose",
    ]);
    expect(view.workflowEntrypoints.size).toBe(0);
  });

  it("keeps Workflow discovery read-only when proposal authority is absent", () => {
    const projection = createWorkflowResourceToolProjection({
      surfaceView: unknownSkillView,
      eligibleWorkflowRevisionIds: new Set(["01K00000000000000000000005"]),
      executor: {
        search: () => Promise.resolve({ modelOutput: { workflows: [] } }),
        inspect: () => Promise.resolve({ modelOutput: { workflow: {} } }),
      },
    });

    expect(projection.descriptors.map((descriptor) => descriptor.key)).toEqual([
      "workflow.search",
      "workflow.inspect",
    ]);
    expect(projection.workflowEntrypoints).toBeUndefined();
  });

  it("fails before model use when a Profile requires an unregistered Tool Family", () => {
    const canvasView = {
      ...unknownSkillView,
      profile: {
        ...unknownSkillView.profile,
        manifest: {
          ...unknownSkillView.profile.manifest,
          allowedSurfaceKinds: ["canvas"],
          allowedToolFamilies: ["canvas_command"],
          requiredToolFamilies: ["canvas_command"],
        },
      },
      skills: [],
    } as const satisfies AgentSurfaceView;
    expect(() =>
      createDynamicAgentToolView({
        surfaceView: canvasView,
        digest: () =>
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      }),
    ).toThrow(/canvas_command/u);
  });

  it("admits a required Tool Family only through an explicit projection", () => {
    const canvasView = {
      ...unknownSkillView,
      profile: {
        ...unknownSkillView.profile,
        manifest: {
          ...unknownSkillView.profile.manifest,
          allowedSurfaceKinds: ["canvas"],
          allowedToolFamilies: ["canvas_command"],
          requiredToolFamilies: ["canvas_command"],
        },
      },
      skills: [],
    } as const satisfies AgentSurfaceView;
    const descriptor = {
      key: "canvas.command.apply",
      description: "Apply one version-protected and undoable Canvas command.",
      inputSchema: { type: "object" as const },
      effect: "internal-write" as const,
      approvalMode: "before-commit" as const,
      executeCanonical: () => Promise.resolve({ applied: true }),
    };
    const view = createDynamicAgentToolView({
      surfaceView: canvasView,
      projections: [
        {
          family: "canvas_command",
          descriptors: [descriptor],
          digestMaterial: { adapterRevision: 1 },
        },
      ],
      digest: () =>
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(view.projectedToolFamilies).toEqual(["canvas_command"]);
    expect(view.descriptors).toEqual([descriptor]);
  });
});
