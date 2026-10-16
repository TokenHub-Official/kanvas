import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  CanvasDraftRecord,
  CanvasDraftStore,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { createAgentCanvasCommandExecutors } from "../src/agent/canvas-agent-command-executor.js";
import { AgentThreadResultError } from "../src/agent/thread-agent-query-executor.js";

const now = new Date("2026-08-25T08:00:00.000Z");
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const authority = {
  workspaceId: id(1),
  organizationId: id(2),
  principalId: id(3),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: id(4),
  authorityType: "human_membership",
  authorityId: id(5),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "canvas.read", "canvas.write"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

describe("Agent Canvas Command executor", () => {
  it("creates a real Draft and commits one text batch as a new revision", async () => {
    let draft: CanvasDraftRecord | undefined;
    const update = vi.fn((input: Parameters<CanvasDraftStore["update"]>[0]) => {
      if (!draft || input.expectedVersion !== draft.version) {
        return Promise.reject(new Error("stale"));
      }
      draft = {
        ...draft,
        document: {
          documentId: draft.id,
          workspaceId: draft.workspaceId,
          ...input.document,
        },
        version: draft.version + 1,
        updatedAt: now,
      };
      return Promise.resolve({ draft, replayed: false });
    });
    const store = {
      list: () => Promise.resolve({ items: [], truncated: false }),
      get: () => Promise.resolve(draft),
      create: (input) => {
        expect(input.brandKitRevisionId).toBe(id(90));
        draft = {
          id: input.canvasDraftId,
          workspaceId: authority.workspaceId,
          document: {
            documentId: input.canvasDraftId,
            workspaceId: authority.workspaceId,
            ...input.document,
          },
          version: 1,
          createdByPrincipalId: authority.principalId,
          updatedByPrincipalId: authority.principalId,
          createdAt: now,
          updatedAt: now,
        };
        return Promise.resolve({ draft, replayed: false });
      },
      update,
      getRevision: () => Promise.resolve(undefined),
      recoverMutation: () => Promise.resolve(undefined),
      listRevisions: () => Promise.resolve([]),
      restore: () => Promise.reject(new Error("unused")),
      updateBrand: () => Promise.reject(new Error("unused")),
    } satisfies CanvasDraftStore;
    let next = 10;
    let actionNumber = 0;
    const executeWithReceipt: Parameters<
      typeof createAgentCanvasCommandExecutors
    >[0]["executeWithReceipt"] = (toolKey, _input, operation) => {
      actionNumber += 1;
      return operation({
        id: id(100 + actionNumber),
        workspaceId: authority.workspaceId,
        agentRunId: id(90),
        actionNumber,
        toolCallId: `tool-call-${String(actionNumber)}`,
        toolKey,
        effect: "internal_write",
        approvalMode: "none",
        lifecycleStatus: "running",
        inputDigest: `sha256:${"a".repeat(64)}`,
        version: 2,
        createdAt: now,
        updatedAt: now,
      });
    };
    const resolveResultArtifact = vi.fn(
      (input: {
        readonly skillRevisionId?: string;
        readonly artifactId: string;
      }) =>
        Promise.resolve({
          id: input.artifactId,
          mediaType: "image/png" as const,
          displayFilename: input.skillRevisionId
            ? "vertical-frame.png"
            : "summer-result.png",
        }),
    );
    const executors = createAgentCanvasCommandExecutors({
      authority,
      context: {
        schemaVersion: 1,
        surfaceKind: "agent_workspace",
        brandKitRevisionId: id(90),
        surfaceState: {
          kind: "agent_workspace",
          originSurface: "workspace_home",
          attachmentState: "none",
          attachedResourceIds: [],
          canUndo: false,
          canRedo: false,
        },
      },
      canvasDrafts: store,
      nextId: () => id(next++),
      now: () => now,
      resolveResultArtifact,
      executeWithReceipt,
    });

    const created = await executors.create({
      title: "新品海报",
      width: 1080,
      height: 1080,
    });
    const edited = await executors.editText({
      expectedVersion: 1,
      pageKey: "page-1",
      operations: [
        {
          type: "add_text",
          text: "秋日新品\n限定发布",
          x: 120,
          y: 140,
          width: 840,
          height: 160,
          fontSize: 72,
          color: "#C94A35",
        },
      ],
    });

    expect(draft?.version).toBe(2);
    expect(created.outcomeReference).toMatchObject({
      kind: "canvas_command",
      beforeVersion: 0,
      afterVersion: 1,
    });
    expect(draft?.document.pages[0]).toMatchObject({
      nodes: [
        {
          kind: "text",
          content: {
            paragraphs: [
              {
                runs: [
                  {
                    text: "秋日新品",
                    fontSize: 72,
                    fill: { color: "#C94A35" },
                  },
                ],
              },
              {
                runs: [
                  {
                    text: "限定发布",
                    fontSize: 72,
                    fill: { color: "#C94A35" },
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(edited.outcomeReference).toMatchObject({
      kind: "canvas_command",
      beforeVersion: 1,
      afterVersion: 2,
    });
    const recoveryStore = {
      ...store,
      recoverMutation: () =>
        Promise.resolve({
          kind: "update" as const,
          beforeVersion: 1,
          afterVersion: 2,
          revision: {
            canvasDraftId: draft!.id,
            workspaceId: draft!.workspaceId,
            document: draft!.document,
            version: 2,
            title: draft!.document.title,
            contentDigest: `sha256:${"b".repeat(64)}`,
            kind: "save" as const,
            createdByPrincipalId: authority.principalId,
            createdAt: now,
          },
        }),
    } satisfies CanvasDraftStore;
    const recoveryExecutors = createAgentCanvasCommandExecutors({
      authority,
      context: {
        schemaVersion: 1,
        surfaceKind: "agent_workspace",
        resource: {
          kind: "canvas_draft",
          resourceId: draft!.id,
          version: 1,
        },
      },
      canvasDrafts: recoveryStore,
      nextId: () => id(next++),
      now: () => now,
      resolveResultArtifact: () => Promise.reject(new Error("unused")),
      executeWithReceipt,
    });
    await expect(
      recoveryExecutors.editText({
        expectedVersion: 1,
        pageKey: "page-1",
        operations: [
          {
            type: "update_text",
            elementKey: id(10),
            color: "#000000",
          },
        ],
      }),
    ).resolves.toMatchObject({
      outcomeReference: { beforeVersion: 1, afterVersion: 2 },
    });
    expect(update).toHaveBeenCalledOnce();
    const selectedExecutors = createAgentCanvasCommandExecutors({
      authority,
      context: {
        schemaVersion: 1,
        surfaceKind: "agent_workspace",
        resource: {
          kind: "canvas_draft",
          resourceId: draft!.id,
          version: 2,
        },
        selectedElementKeys: [id(10)],
      },
      canvasDrafts: store,
      nextId: () => id(next++),
      now: () => now,
      resolveResultArtifact: () => Promise.reject(new Error("unused")),
      executeWithReceipt,
    });
    await expect(
      selectedExecutors.editText({
        expectedVersion: 2,
        pageKey: "page-1",
        operations: [
          {
            type: "update_text",
            elementKey: "outside-selection",
            color: "#000000",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "agent.canvas_selection_mismatch" });

    const applied = await executors.addResultImage({
      expectedVersion: 2,
      pageKey: "page-1",
      capabilityRunId: id(70),
      artifactId: id(80),
      x: 100,
      y: 360,
      width: 880,
      height: 560,
      fit: "cover",
      altText: "秋季新品主视觉",
    });
    expect(draft?.version).toBe(3);
    expect(draft?.document.pages[0]).toMatchObject({
      nodes: [
        { kind: "text" },
        {
          kind: "image",
          name: "summer-result.png",
          transform: { x: 100, y: 360, width: 880, height: 560 },
          image: {
            source: { kind: "artifact", artifactId: id(80) },
            mediaType: "image/png",
            fit: "cover",
          },
          altText: "秋季新品主视觉",
        },
      ],
    });
    expect(applied.outcomeReference).toMatchObject({
      kind: "canvas_command",
      beforeVersion: 2,
      afterVersion: 3,
    });
    expect(update).toHaveBeenCalledTimes(2);

    for (const invalidSource of [
      { skillRevisionId: id(72) },
      { libraryId: id(73) },
      { libraryId: id(73), libraryEntryId: id(74), capabilityRunId: id(70) },
      {
        capabilityRunId: id(70),
        skillRevisionId: id(72),
        skillResourcePath: "assets/brand/vertical-frame.png",
      },
    ]) {
      await expect(
        executors.addResultImage({
          expectedVersion: 3,
          pageKey: "page-1",
          ...invalidSource,
          artifactId: id(82),
          x: 0,
          y: 0,
          width: 1080,
          height: 1080,
        }),
      ).rejects.toMatchObject({ code: "agent.canvas_input_invalid" });
    }
    expect(resolveResultArtifact).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);

    const skillApplied = await executors.addResultImage({
      expectedVersion: 3,
      pageKey: "page-1",
      skillRevisionId: id(72),
      skillResourcePath: "assets/brand/vertical-frame.png",
      artifactId: id(82),
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
      fit: "fill",
      altText: "EXAMPLE STUDIO 竖版真实包框",
    });
    expect(resolveResultArtifact).toHaveBeenLastCalledWith({
      skillRevisionId: id(72),
      skillResourcePath: "assets/brand/vertical-frame.png",
      artifactId: id(82),
    });
    expect(draft?.version).toBe(4);
    expect(draft?.document.pages[0]?.nodes.at(-1)).toMatchObject({
      kind: "image",
      name: "vertical-frame.png",
      image: {
        source: { kind: "artifact", artifactId: id(82) },
        mediaType: "image/png",
        fit: "fill",
      },
    });
    expect(skillApplied.outcomeReference).toMatchObject({
      kind: "canvas_command",
      beforeVersion: 3,
      afterVersion: 4,
    });
    expect(update).toHaveBeenCalledTimes(3);

    const unavailableExecutors = createAgentCanvasCommandExecutors({
      authority,
      context: {
        schemaVersion: 1,
        surfaceKind: "agent_workspace",
        resource: {
          kind: "canvas_draft",
          resourceId: draft!.id,
          version: 4,
        },
      },
      canvasDrafts: store,
      nextId: () => id(next++),
      now: () => now,
      resolveResultArtifact: () =>
        Promise.reject(new AgentThreadResultError("agent.result_not_linked")),
      executeWithReceipt,
    });
    await expect(
      unavailableExecutors.addResultImage({
        expectedVersion: 4,
        pageKey: "page-1",
        workflowRunId: id(71),
        artifactId: id(81),
        x: 0,
        y: 0,
        width: 400,
        height: 400,
      }),
    ).rejects.toMatchObject({ code: "agent.canvas_result_unavailable" });
    expect(update).toHaveBeenCalledTimes(3);
    await executors.addResultImage({
      expectedVersion: 4,
      pageKey: "page-1",
      libraryId: id(73),
      libraryEntryId: id(74),
      artifactId: id(83),
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    expect(resolveResultArtifact).toHaveBeenLastCalledWith({
      libraryId: id(73),
      libraryEntryId: id(74),
      artifactId: id(83),
    });
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        libraryInput: {
          actionReceiptId: id(100 + actionNumber),
          artifactId: id(83),
          libraryId: id(73),
          entryId: id(74),
        },
      }),
    );
    expect(draft?.version).toBe(5);
  });
});
