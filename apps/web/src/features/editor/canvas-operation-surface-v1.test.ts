import { describe, expect, it } from "vitest";

import type { CanvasOperationSessionV1 } from "./canvas-operation-runtime-v1.js";
import {
  canvasOperationReviewOpenV1,
  canvasOperationSurfaceProjectionV1,
  canvasOperationSurfaceV1,
} from "./canvas-operation-surface-v1.js";

function session(
  phase: CanvasOperationSessionV1["phase"],
  completionBehavior: CanvasOperationSessionV1["completionBehavior"] = "review_required",
): CanvasOperationSessionV1 {
  return {
    schemaVersion: "kanvas.canvas-operation-session/v1",
    completionBehavior,
    id: "operation-surface-1",
    workspaceId: "01K00000000000000000000000",
    operationId: "image.background.remove",
    toolId: "tool-1",
    label: "Remove background",
    contractRevisionId: "01K00000000000000000000001",
    resultArtifactPath: ["artifactId"],
    availableOutputDispositions: ["replace_content"],
    sourceParameterKey: "sourceArtifactId",
    sourceValue: "artifact_id",
    source: {
      pageId: "page-1",
      nodeId: "image-1",
      artifactId: "01K00000000000000000000002",
      nodeFingerprint: "source",
    },
    parameters: {},
    outputDisposition: "replace_content",
    idempotencyKey: "surface-1",
    phase,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("Canvas operation surface", () => {
  it("keeps starting and running work in a non-blocking global status", () => {
    expect(canvasOperationSurfaceV1(session("starting"))).toBe("global_status");
    expect(canvasOperationSurfaceV1(session("running"))).toBe("global_status");
  });

  it("keeps only decision and recovery phases in the review surface", () => {
    for (const phase of [
      "preview_ready",
      "conflict",
      "failed",
      "cancelled",
    ] as const) {
      expect(canvasOperationSurfaceV1(session(phase))).toBe("review");
    }
    expect(canvasOperationSurfaceV1(session("applied"))).toBe("silent");
  });

  it("hides discarded and safely auto-applied sessions", () => {
    expect(canvasOperationSurfaceV1(session("discarded"))).toBe("silent");
    expect(
      canvasOperationSurfaceV1(session("applied", "auto_replace_safe")),
    ).toBe("silent");
    expect(canvasOperationSurfaceV1(undefined)).toBe("silent");
  });

  it("projects one decision action and never replaces a conflict", () => {
    expect(
      canvasOperationSurfaceProjectionV1(
        {
          ...session("preview_ready"),
          availableOutputDispositions: ["replace_content", "add_node"],
        },
        "compatible",
      ),
    ).toEqual({
      surface: "review",
      kind: "decision",
      primaryAction: "replace_content",
    });
    expect(
      canvasOperationSurfaceProjectionV1(
        {
          ...session("conflict"),
          availableOutputDispositions: ["replace_content", "add_node"],
        },
        "source_changed",
      ),
    ).toEqual({
      surface: "review",
      kind: "conflict",
      primaryAction: "add_node",
    });
  });

  it("separates retryable recovery from terminal outcomes", () => {
    expect(
      canvasOperationSurfaceProjectionV1({
        ...session("failed"),
        failure: {
          code: "temporary",
          message: "Try again",
          retryable: true,
        },
      }),
    ).toMatchObject({
      kind: "recovery",
      primaryAction: "retry",
    });
    expect(
      canvasOperationSurfaceProjectionV1({
        ...session("failed"),
        failure: {
          code: "terminal",
          message: "Cannot continue",
          retryable: false,
        },
      }),
    ).toMatchObject({
      kind: "terminal",
      primaryAction: "close",
    });
    expect(
      canvasOperationSurfaceProjectionV1(session("cancelled")),
    ).toMatchObject({
      kind: "terminal",
      primaryAction: "close",
    });
  });

  it("dismisses only the current review session and can reopen it", () => {
    const projection = canvasOperationSurfaceProjectionV1(
      session("preview_ready"),
    );
    expect(
      canvasOperationReviewOpenV1(projection, "operation-surface-1", undefined),
    ).toBe(true);
    expect(
      canvasOperationReviewOpenV1(
        projection,
        "operation-surface-1",
        "operation-surface-1",
      ),
    ).toBe(false);
    expect(
      canvasOperationReviewOpenV1(projection, "operation-surface-1", undefined),
    ).toBe(true);
  });
});
