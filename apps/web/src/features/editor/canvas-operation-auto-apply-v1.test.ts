import { describe, expect, it } from "vitest";

import type { CanvasOperationSessionV1 } from "./canvas-operation-runtime-v1.js";
import {
  canvasOperationAutoApplyDecisionV1,
  canvasOperationReplacementSafetyV1,
  canvasOperationReviewVisibleV1,
  normalizeCanvasOperationAutoApplyRecoveryV1,
} from "./canvas-operation-auto-apply-v1.js";
import { createEditorStateV1, editorReducerV1 } from "./editor-state-v1.js";

const sourceArtifactId = "01K00000000000000000000001";
const previewArtifactId = "01K00000000000000000000002";

function session(
  overrides: Partial<CanvasOperationSessionV1> = {},
): CanvasOperationSessionV1 {
  return {
    schemaVersion: "kanvas.canvas-operation-session/v1",
    id: "operation-1",
    workspaceId: "01K00000000000000000000000",
    operationId: "image.denoise",
    toolId: "tool-1",
    label: "Denoise",
    contractRevisionId: "01K00000000000000000000003",
    completionBehavior: "auto_replace_safe",
    resultArtifactPath: ["imageArtifactId"],
    availableOutputDispositions: ["add_node", "replace_content", "asset_only"],
    sourceParameterKey: "sourceArtifactId",
    sourceValue: "artifact_id",
    source: {
      pageId: "page-1",
      nodeId: "image-1",
      artifactId: sourceArtifactId,
      nodeFingerprint: "source",
    },
    parameters: {},
    outputDisposition: "replace_content",
    idempotencyKey: "idempotency-1",
    phase: "preview_ready",
    previewArtifactId,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

function document(input?: {
  readonly artifactId?: string;
  readonly locked?: boolean;
  readonly pageId?: string;
}) {
  return {
    pages: [
      {
        id: input?.pageId ?? "page-1",
        nodes: [
          {
            id: "image-1",
            kind: "image",
            locked: input?.locked ?? false,
            image: {
              source: {
                kind: "artifact",
                artifactId: input?.artifactId ?? sourceArtifactId,
              },
            },
          },
        ],
      },
    ],
  };
}

function decide(input?: {
  readonly canEdit?: boolean;
  readonly document?: ReturnType<typeof document>;
  readonly previewUrlReady?: boolean;
  readonly session?: CanvasOperationSessionV1;
}) {
  return canvasOperationAutoApplyDecisionV1({
    canEdit: input?.canEdit ?? true,
    document: input?.document ?? document(),
    previewUrlReady: input?.previewUrlReady ?? true,
    session: input?.session ?? session(),
  });
}

describe("canvas operation auto apply", () => {
  it("applies only the explicitly pinned safe replacement", () => {
    expect(decide()).toBe("apply");
    expect(
      decide({
        session: session({
          completionBehavior: "review_required",
        }),
      }),
    ).toBe("review");
    expect(
      decide({
        session: {
          ...session(),
          completionBehavior: "unknown",
        } as unknown as CanvasOperationSessionV1,
      }),
    ).toBe("review");
    expect(
      decide({
        session: session({
          outputDisposition: "add_node",
        }),
      }),
    ).toBe("review");
  });

  it("does not consume an attempt before a run reaches a ready preview", () => {
    expect(decide({ session: session({ phase: "starting" }) })).toBe("review");
    expect(decide({ session: session({ phase: "running" }) })).toBe("review");
    expect(
      decide({
        session: session({ phase: "preview_ready" }),
      }),
    ).toBe("apply");
  });

  it("keeps cancelled, unauthorized and unavailable previews in review", () => {
    expect(
      decide({
        session: session({ cancelRequested: true }),
      }),
    ).toBe("review");
    expect(decide({ canEdit: false })).toBe("review");
    expect(decide({ previewUrlReady: false })).toBe("review");
  });

  it("keeps locked, moved, missing and changed sources in review", () => {
    expect(decide({ document: document({ locked: true }) })).toBe("review");
    expect(
      decide({
        document: document({ pageId: "page-2" }),
      }),
    ).toBe("review");
    expect(
      decide({
        document: { pages: [] },
      }),
    ).toBe("review");
    expect(
      decide({
        document: document({
          artifactId: "01K00000000000000000000009",
        }),
      }),
    ).toBe("review");
  });

  it("reconciles a document that already references the preview without applying twice", () => {
    expect(
      decide({
        canEdit: false,
        document: document({
          artifactId: previewArtifactId,
          locked: true,
        }),
        previewUrlReady: false,
      }),
    ).toBe("reconcile_applied");
  });

  it("normalizes all three applied recovery branches without losing runtime facts", () => {
    const applied = session({
      phase: "applied",
      capabilityRunId: "01K00000000000000000000003",
    });
    const alreadyApplied = normalizeCanvasOperationAutoApplyRecoveryV1({
      session: applied,
      document: document({
        artifactId: previewArtifactId,
      }),
      conflictMessage: "Source changed",
      now: new Date("2026-08-12T01:00:00.000Z"),
    });
    expect(alreadyApplied).toBe(applied);

    const replay = normalizeCanvasOperationAutoApplyRecoveryV1({
      session: applied,
      document: document(),
      conflictMessage: "Source changed",
      now: new Date("2026-08-12T01:00:00.000Z"),
    });
    expect(replay).toMatchObject({
      phase: "preview_ready",
      previewArtifactId,
      capabilityRunId: applied.capabilityRunId,
    });

    const conflict = normalizeCanvasOperationAutoApplyRecoveryV1({
      session: applied,
      document: document({
        artifactId: "01K00000000000000000000009",
      }),
      conflictMessage: "Source changed",
      now: new Date("2026-08-12T01:00:00.000Z"),
    });
    expect(conflict).toMatchObject({
      phase: "conflict",
      previewArtifactId,
      capabilityRunId: applied.capabilityRunId,
      failure: {
        code: "canvas_operation_source_conflict",
        message: "Source changed",
      },
    });
    expect(
      normalizeCanvasOperationAutoApplyRecoveryV1({
        session: applied,
        document: document({ pageId: "page-2" }),
        conflictMessage: "Source moved",
        now: new Date("2026-08-12T01:00:00.000Z"),
      }).phase,
    ).toBe("conflict");
  });

  it("rechecks permission and lock state with one pure replacement guard", () => {
    expect(
      canvasOperationReplacementSafetyV1({
        canEdit: false,
        document: document(),
        expectedArtifactId: sourceArtifactId,
        session: session(),
      }),
    ).toBe("forbidden");
    expect(
      canvasOperationReplacementSafetyV1({
        canEdit: true,
        document: document({ locked: true }),
        expectedArtifactId: sourceArtifactId,
        session: session(),
      }),
    ).toBe("locked");
    expect(
      canvasOperationReplacementSafetyV1({
        canEdit: true,
        document: document(),
        expectedArtifactId: sourceArtifactId,
        session: session(),
      }),
    ).toBe("ready");
  });

  it("hides only an applied safe operation from the fixed review layer", () => {
    expect(canvasOperationReviewVisibleV1(session({ phase: "applied" }))).toBe(
      false,
    );
    expect(
      canvasOperationReviewVisibleV1(
        session({
          completionBehavior: "review_required",
          phase: "applied",
        }),
      ),
    ).toBe(true);
    expect(
      canvasOperationReviewVisibleV1(session({ phase: "preview_ready" })),
    ).toBe(true);
  });

  it("uses the existing replacement boundary as one undoable history entry", () => {
    const sourceImage = {
      source: {
        kind: "artifact" as const,
        artifactId: sourceArtifactId,
      },
      intrinsicWidth: 800,
      intrinsicHeight: 600,
      mediaType: "image/png" as const,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      fit: "contain" as const,
      focalPoint: { x: 0.5, y: 0.5 },
    };
    const state = createEditorStateV1({
      schemaVersion: "kanvas.editor-document/v1",
      documentId: "01K00000000000000000000020",
      workspaceId: "01K00000000000000000000000",
      title: "Auto apply",
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          width: 1080,
          height: 1080,
          background: { kind: "transparent" },
          nodes: [
            {
              id: "image-1",
              name: "Image",
              kind: "image",
              transform: {
                x: 0,
                y: 0,
                width: 400,
                height: 300,
                rotation: 0,
                flipX: false,
                flipY: false,
              },
              opacity: 1,
              blendMode: "normal",
              visible: true,
              locked: false,
              cornerRadius: 0,
              image: sourceImage,
            },
          ],
        },
      ],
      metadata: { createdWith: "kanvas-web" },
    });

    const applied = editorReducerV1(state, {
      type: "set_image_content",
      pageId: "page-1",
      nodeId: "image-1",
      image: {
        ...sourceImage,
        source: {
          kind: "artifact",
          artifactId: previewArtifactId,
        },
      },
    });

    expect(applied.past).toHaveLength(1);
    const appliedNode = applied.document.pages[0]?.nodes[0];
    expect(
      appliedNode?.kind === "image" &&
        appliedNode.image.source.kind === "artifact"
        ? appliedNode.image.source.artifactId
        : undefined,
    ).toBe(previewArtifactId);
    const undone = editorReducerV1(applied, {
      type: "undo",
    });
    const undoneNode = undone.document.pages[0]?.nodes[0];
    expect(
      undoneNode?.kind === "image" &&
        undoneNode.image.source.kind === "artifact"
        ? undoneNode.image.source.artifactId
        : undefined,
    ).toBe(sourceArtifactId);
  });
});
