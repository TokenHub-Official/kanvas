import type {
  CapabilityRunDetails,
  CurrentHumanContext,
} from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import type { CanvasImageCapabilityTool } from "./canvas-capability-tools.js";
import {
  canvasOperationApplyFailureV1,
  canvasOperationApplicationAuthorizedV1,
  canvasOperationBlocksNewRunV1,
  canvasOperationMessageAfterRunReconcileV1,
  canvasOperationSessionRecoverableV1,
  canvasOperationSourceCompatibilityV1,
  canvasOperationStartFailureMessageV1,
  canvasOperationStatusFailureMessageV1,
  chooseCanvasOperationOutputDispositionV1,
  createCanvasOperationSessionV1,
  currentCanvasOperationSourceV1,
  isCanvasOperationFinalizationPhaseV1,
  isCanvasOperationSessionV1,
  markCanvasOperationApplyFailedV1,
  markCanvasOperationAppliedV1,
  markCanvasOperationAssetSavedV1,
  markCanvasOperationConflictV1,
  markCanvasOperationDiscardedV1,
  markCanvasOperationRunningV1,
  normalizeCanvasOperationSessionV1,
  pinCanvasOperationAssetAdoptionV1,
  requestCanvasOperationCancellationV1,
  retryCanvasOperationStartV1,
  reconcileCanvasOperationRunV1,
} from "./canvas-operation-runtime-v1.js";

const workspaceId = "01K00000000000000000000000";
const artifactId = "01K00000000000000000000001";
const resultArtifactId = "01K00000000000000000000002";
const maskArtifactId = "01K00000000000000000000006";
const capabilityRunId = "01K00000000000000000000003";

describe("canvas operation finalization phases", () => {
  it.each([
    ["applied", true],
    ["discarded", true],
    ["cancelled", false],
    ["conflict", false],
    ["failed", false],
    ["preview_ready", false],
    ["running", false],
    ["starting", false],
  ] as const)("classifies %s as %s", (phase, expected) => {
    expect(isCanvasOperationFinalizationPhaseV1(phase)).toBe(expected);
  });
});

describe("canvas operation new-run blocking", () => {
  it.each([
    ["starting", true],
    ["running", true],
    ["preview_ready", true],
    ["conflict", true],
    ["failed", false],
    ["cancelled", false],
    ["applied", false],
    ["discarded", false],
  ] as const)("classifies %s as %s", (phase, expected) => {
    expect(canvasOperationBlocksNewRunV1(phase)).toBe(expected);
  });
});

const tool: CanvasImageCapabilityTool = {
  capabilityKey: "image.background.remove",
  category: "图像处理",
  completionBehavior: "review_required",
  id: "01K00000000000000000000004:remove",
  operationId: "image.background.remove",
  interactionBehavior: "form",
  label: "去背景",
  order: 10,
  outputArtifactPath: ["result", "foregroundArtifactId"],
  maskArtifactPath: ["result", "maskArtifactId"],
  outputModes: ["add_node", "replace_content", "asset_only"],
  parameterFields: [],
  parametersSchemaId: "kanvas.image-background-remove.v1",
  sourceParameterKey: "source",
  sourceValue: "artifact_id",
  contractRevisionId: "01K00000000000000000000005",
};

function run(
  lifecycleStatus: CapabilityRunDetails["lifecycleStatus"],
  output: unknown = undefined,
): CapabilityRunDetails {
  return {
    id: capabilityRunId,
    contractRevisionId: tool.contractRevisionId,
    invocationKind: "canvas",
    lifecycleStatus,
    input: {},
    ...(output === undefined ? {} : { output }),
    version: 1,
    executionDeadlineAt: "2026-08-03T00:05:00.000Z",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

function session() {
  return createCanvasOperationSessionV1({
    id: "operation-1",
    idempotencyKey: "idempotency-1",
    now: new Date("2026-08-03T00:00:00.000Z"),
    workspaceId,
    tool,
    outputDisposition: "replace_content",
    parameters: {
      refinement: "fine",
    },
    source: {
      pageId: "page-1",
      nodeId: "image-1",
      artifactId,
    },
  });
}

describe("Canvas Operation Runtime V1", () => {
  it("requires fresh edit and Artifact authority before applying a cached preview", () => {
    const context: CurrentHumanContext = {
      authenticated: true,
      csrfToken: "a".repeat(43),
      human: {
        principalId: "01K00000000000000000000008",
        status: "active",
        displayName: "Designer",
      },
      workspaces: [
        {
          id: workspaceId,
          slug: "studio",
          name: "Studio",
          organization: {
            id: "01K00000000000000000000009",
            name: "Kanvas",
          },
          membership: {
            id: "01K0000000000000000000000A",
            role: "editor",
            version: 1,
          },
          permissions: ["canvas.write", "asset.write", "artifact.download"],
        },
      ],
      authorizationModelVersion: 1,
      contextVersion: `sha256:${"b".repeat(64)}`,
    };
    expect(canvasOperationApplicationAuthorizedV1(context, workspaceId)).toBe(
      true,
    );
    expect(
      canvasOperationApplicationAuthorizedV1(
        {
          ...context,
          workspaces: [
            {
              ...context.workspaces[0]!,
              permissions: ["canvas.write", "artifact.download"],
            },
          ],
        },
        workspaceId,
      ),
    ).toBe(false);
    expect(
      canvasOperationApplicationAuthorizedV1(
        {
          ...context,
          workspaces: [
            {
              ...context.workspaces[0]!,
              permissions: ["canvas.read"],
            },
          ],
        },
        workspaceId,
      ),
    ).toBe(false);
  });

  it("pins source, parameters, disposition and idempotency before dispatch", () => {
    expect(session()).toMatchObject({
      schemaVersion: "kanvas.canvas-operation-session/v1",
      completionBehavior: "review_required",
      phase: "starting",
      operationId: "image.background.remove",
      outputDisposition: "replace_content",
      parameters: {
        refinement: "fine",
      },
      source: {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId,
      },
    });
  });

  it("restores legacy or invalid completion behavior as review required", () => {
    const current = session();
    const legacy = { ...current } as Record<string, unknown>;
    delete legacy.completionBehavior;
    expect(normalizeCanvasOperationSessionV1(legacy)?.completionBehavior).toBe(
      "review_required",
    );
    expect(
      normalizeCanvasOperationSessionV1({
        ...current,
        completionBehavior: "automatic",
      })?.completionBehavior,
    ).toBe("review_required");
  });

  it("replays a lost create response with the same session and idempotency key", () => {
    const starting = session();
    const failed = {
      ...starting,
      phase: "failed" as const,
      failure: {
        code: "canvas_operation_start_failed",
        message: "Connection lost.",
        retryable: true,
      },
    };

    expect(retryCanvasOperationStartV1(failed)).toMatchObject({
      id: starting.id,
      idempotencyKey: starting.idempotencyKey,
      phase: "starting",
    });
  });

  it("persists cancellation intent before a Workflow Run identity is available", () => {
    const starting = session();
    const cancelling = requestCanvasOperationCancellationV1(starting);

    expect(cancelling).toMatchObject({
      id: starting.id,
      idempotencyKey: starting.idempotencyKey,
      phase: "starting",
      cancelRequested: true,
    });
    expect(
      markCanvasOperationRunningV1(cancelling, capabilityRunId),
    ).toMatchObject({
      capabilityRunId,
      phase: "running",
      cancelRequested: true,
    });
  });

  it("turns an uncertain Start response into same-task recovery copy", () => {
    expect(
      canvasOperationStartFailureMessageV1(
        new TypeError("Failed to fetch"),
        true,
      ),
    ).toBe(
      "启动结果暂时无法确认。任务可能已经开始；请重试以恢复同一处理任务。",
    );
    expect(
      canvasOperationStartFailureMessageV1({
        status: 403,
      }),
    ).toBe(
      "当前权限已变化，无法启动处理。请联系 Workspace 管理员恢复制作权限后重试。",
    );
    expect(
      canvasOperationStartFailureMessageV1(
        new Error("internal executor detail"),
        true,
      ),
    ).toBe("暂时无法启动处理。请稍后重试。");
  });

  it("keeps a running task recoverable when authority changes", () => {
    expect(canvasOperationStatusFailureMessageV1({ status: 403 }, "run")).toBe(
      "当前权限已变化，无法继续读取处理进度。后台任务可能仍在继续；恢复权限后可重新连接。",
    );
    expect(
      canvasOperationStatusFailureMessageV1(
        new Error("internal timeline detail"),
        "timeline",
      ),
    ).toBe("处理仍在继续，但暂时无法读取执行位置与回退信息。");
    const translations: Record<string, string> = {
      "canvas.operationStatus.errors.forbidden": "Access changed.",
      "canvas.operationStatus.errors.runUnavailable": "Status unavailable.",
      "canvas.operationStatus.errors.timelineUnavailable":
        "Execution details unavailable.",
    };
    expect(
      canvasOperationStatusFailureMessageV1(
        { status: 403 },
        "run",
        (key) => translations[key] ?? key,
      ),
    ).toBe("Access changed.");
    expect(
      canvasOperationStatusFailureMessageV1(
        new Error("internal run detail"),
        "run",
        (key) => translations[key] ?? key,
      ),
    ).toBe("Status unavailable.");
    expect(
      canvasOperationStatusFailureMessageV1(
        new Error("internal timeline detail"),
        "timeline",
        (key) => translations[key] ?? key,
      ),
    ).toBe("Execution details unavailable.");
  });

  it("clears only transient cancellation copy after an authoritative terminal state", () => {
    expect(
      canvasOperationMessageAfterRunReconcileV1(
        "取消请求的结果暂时无法确认。任务可能仍在处理；系统会继续读取服务端状态。",
        "cancelled",
      ),
    ).toBeUndefined();
    expect(
      canvasOperationMessageAfterRunReconcileV1(
        "结果已完成，但暂时无法保存恢复进度。",
        "cancelled",
      ),
    ).toBe("结果已完成，但暂时无法保存恢复进度。");
    expect(
      canvasOperationMessageAfterRunReconcileV1(
        "取消请求的结果暂时无法确认。任务可能仍在处理；系统会继续读取服务端状态。",
        "running",
      ),
    ).toContain("暂时无法确认");
    expect(
      canvasOperationMessageAfterRunReconcileV1(
        "已自动切换到云端继续处理。",
        "preview_ready",
      ),
    ).toBeUndefined();
  });

  it("binds exactly one Workflow Run and projects its result as a preview", () => {
    const running = markCanvasOperationRunningV1(session(), capabilityRunId);
    const completed = reconcileCanvasOperationRunV1(
      running,
      run("completed", {
        result: {
          foregroundArtifactId: resultArtifactId,
          maskArtifactId,
        },
      }),
    );

    expect(completed).toMatchObject({
      phase: "preview_ready",
      previewArtifactId: resultArtifactId,
      previewMaskArtifactId: maskArtifactId,
      capabilityRunId,
    });
    expect(markCanvasOperationAppliedV1(completed).phase).toBe("applied");
  });

  it("pins one replay-safe Asset identity before adopting a preview result", () => {
    const completed = reconcileCanvasOperationRunV1(
      markCanvasOperationRunningV1(session(), capabilityRunId),
      run("completed", {
        result: {
          foregroundArtifactId: resultArtifactId,
          maskArtifactId,
        },
      }),
    );
    const assetId = "01K00000000000000000000007";
    const pinned = pinCanvasOperationAssetAdoptionV1(completed, assetId);

    expect(
      pinCanvasOperationAssetAdoptionV1(pinned, assetId).assetAdoptionId,
    ).toBe(assetId);
    expect(markCanvasOperationAssetSavedV1(pinned, assetId)).toMatchObject({
      phase: "preview_ready",
      assetAdoptionId: assetId,
      savedAssetId: assetId,
    });

    const applied = markCanvasOperationAppliedV1(completed);
    const appliedPinned = pinCanvasOperationAssetAdoptionV1(applied, assetId);
    expect(
      markCanvasOperationAssetSavedV1(appliedPinned, assetId),
    ).toMatchObject({
      phase: "applied",
      assetAdoptionId: assetId,
      savedAssetId: assetId,
    });
  });

  it("keeps Applied and saved outcomes recoverable until explicit dismissal", () => {
    const completed = reconcileCanvasOperationRunV1(
      markCanvasOperationRunningV1(session(), capabilityRunId),
      run("completed", {
        result: {
          foregroundArtifactId: resultArtifactId,
        },
      }),
    );
    const applied = markCanvasOperationAppliedV1(completed);
    const assetId = "01K00000000000000000000007";
    const saved = markCanvasOperationAssetSavedV1(
      pinCanvasOperationAssetAdoptionV1(applied, assetId),
      assetId,
    );

    expect(canvasOperationSessionRecoverableV1(applied)).toBe(true);
    expect(canvasOperationSessionRecoverableV1(saved)).toBe(true);
    expect(
      canvasOperationSessionRecoverableV1(
        markCanvasOperationDiscardedV1(completed),
      ),
    ).toBe(false);
    expect(
      canvasOperationSessionRecoverableV1({
        ...completed,
        phase: "cancelled",
      }),
    ).toBe(false);
  });

  it("does not treat a completed Run without the declared Artifact as usable", () => {
    const completed = reconcileCanvasOperationRunV1(
      markCanvasOperationRunningV1(session(), capabilityRunId),
      run("completed", { result: {} }),
    );

    expect(completed).toMatchObject({
      phase: "failed",
      failure: {
        code: "canvas_operation_result_missing",
        retryable: false,
      },
    });
  });

  it("detects deletion and source replacement without rejecting unrelated edits", () => {
    const value = session();
    const document = {
      schemaVersion: "kanvas.editor-document/v1",
      documentId: "01K00000000000000000000007",
      workspaceId,
      title: "Conflict proof",
      activePageId: "page-1",
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          width: 1080,
          height: 1080,
          background: {
            kind: "paint",
            paint: {
              kind: "solid",
              color: "#ffffff",
            },
          },
          nodes: [
            {
              id: "image-1",
              kind: "image",
              name: "Source",
              opacity: 1,
              blendMode: "normal",
              locked: false,
              visible: true,
              cornerRadius: 0,
              transform: {
                x: 0,
                y: 0,
                width: 500,
                height: 500,
                rotation: 0,
                flipX: false,
                flipY: false,
              },
              image: {
                source: {
                  kind: "artifact",
                  artifactId,
                },
                intrinsicWidth: 500,
                intrinsicHeight: 500,
                mediaType: "image/png",
                crop: {
                  x: 0,
                  y: 0,
                  width: 1,
                  height: 1,
                },
                fit: "cover",
                focalPoint: {
                  x: 0.5,
                  y: 0.5,
                },
                adjustments: {
                  brightness: 0,
                  contrast: 0,
                  saturation: 0,
                  temperature: 0,
                  tint: 0,
                  highlights: 0,
                  shadows: 0,
                  blur: 0,
                  sharpen: 0,
                },
              },
            },
          ],
        },
      ],
      metadata: {
        createdWith: "kanvas-web",
      },
    } as const;
    expect(currentCanvasOperationSourceV1(document, value)).toEqual({
      pageId: "page-1",
      nodeId: "image-1",
      artifactId,
    });
    expect(
      canvasOperationSourceCompatibilityV1(value, {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId,
      }),
    ).toBe("compatible");
    expect(
      canvasOperationSourceCompatibilityV1(value, {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId: resultArtifactId,
      }),
    ).toBe("source_changed");
    expect(canvasOperationSourceCompatibilityV1(value, undefined)).toBe(
      "missing",
    );
  });

  it("keeps conflicts and discard explicit and terminal", () => {
    const conflict = markCanvasOperationConflictV1(
      markCanvasOperationRunningV1(session(), capabilityRunId),
      "源图片已经变化。",
    );
    expect(conflict).toMatchObject({
      phase: "conflict",
      failure: {
        code: "canvas_operation_source_conflict",
      },
    });

    const discarded = markCanvasOperationDiscardedV1(conflict);
    expect(discarded.phase).toBe("discarded");
    expect(() =>
      markCanvasOperationRunningV1(discarded, capabilityRunId),
    ).toThrow("already discarded");
  });

  it("keeps the completed candidate after an Apply permission or network failure", () => {
    const completed = reconcileCanvasOperationRunV1(
      markCanvasOperationRunningV1(session(), capabilityRunId),
      run("completed", {
        result: {
          foregroundArtifactId: resultArtifactId,
          maskArtifactId,
        },
      }),
    );
    const forbidden = markCanvasOperationApplyFailedV1(
      completed,
      canvasOperationApplyFailureV1({ status: 403 }),
    );

    expect(forbidden).toMatchObject({
      phase: "preview_ready",
      previewArtifactId: resultArtifactId,
      capabilityRunId,
      failure: {
        code: "canvas_operation_apply_forbidden",
        retryable: true,
      },
    });
    expect(forbidden.failure?.message).toContain("无需重新处理");

    const retrying = chooseCanvasOperationOutputDispositionV1(
      forbidden,
      "add_node",
    );
    expect(retrying.phase).toBe("preview_ready");
    expect(retrying.failure).toBeUndefined();
    expect(markCanvasOperationAppliedV1(retrying)).toMatchObject({
      phase: "applied",
      capabilityRunId,
      previewArtifactId: resultArtifactId,
    });

    expect(
      canvasOperationApplyFailureV1(new TypeError("private network detail")),
    ).toEqual({
      code: "canvas_operation_apply_check_failed",
      message:
        "暂时无法完成应用前检查，结果没有应用。候选仍会保留，可直接重试应用。",
      retryable: true,
    });
  });

  it("keeps a conflicted candidate available for a safe fallback disposition", () => {
    const completed = reconcileCanvasOperationRunV1(
      markCanvasOperationRunningV1(session(), capabilityRunId),
      run("completed", {
        result: {
          foregroundArtifactId: resultArtifactId,
          maskArtifactId,
        },
      }),
    );
    const conflict = markCanvasOperationConflictV1(
      completed,
      "原图已更新，结果未覆盖当前画板。",
    );
    const fallback = chooseCanvasOperationOutputDispositionV1(
      conflict,
      "add_node",
    );

    expect(fallback).toMatchObject({
      phase: "preview_ready",
      outputDisposition: "add_node",
      previewArtifactId: resultArtifactId,
    });
    expect(fallback.failure).toBeUndefined();
  });

  it("rejects unbounded persisted failure copy", () => {
    expect(
      isCanvasOperationSessionV1({
        ...session(),
        failure: {
          code: "canvas_operation_apply_failed",
          message: "x".repeat(601),
          retryable: true,
        },
      }),
    ).toBe(false);
  });

  it("changes only to an output disposition declared by the tool", () => {
    expect(
      chooseCanvasOperationOutputDispositionV1(session(), "add_node")
        .outputDisposition,
    ).toBe("add_node");
    expect(() =>
      chooseCanvasOperationOutputDispositionV1(session(), "set_background"),
    ).toThrow("does not support set_background");
  });
});
