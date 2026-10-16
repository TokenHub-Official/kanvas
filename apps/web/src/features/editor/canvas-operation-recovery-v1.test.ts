import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasImageCapabilityTool } from "./canvas-capability-tools.js";
import {
  listCanvasOperationSessionsV1,
  promoteCanvasOperationSessionsV1,
  pruneCanvasOperationSessionsV1,
  removeCanvasOperationSessionV1,
  saveCanvasOperationSessionV1,
} from "./canvas-operation-recovery-v1.js";
import {
  createCanvasOperationSessionV1,
  markCanvasOperationRunningV1,
  requestCanvasOperationCancellationV1,
} from "./canvas-operation-runtime-v1.js";

const workspaceId = "01K00000000000000000000010";
const recoveryId = "draft-1";
const sessionId = "operation-recovery-1";
const fallbackValues = new Map<string, string>();
const fallbackStorage = {
  get length() {
    return fallbackValues.size;
  },
  getItem(key: string) {
    return fallbackValues.get(key) ?? null;
  },
  key(index: number) {
    return [...fallbackValues.keys()][index] ?? null;
  },
  removeItem(key: string) {
    fallbackValues.delete(key);
  },
  setItem(key: string, value: string) {
    fallbackValues.set(key, value);
  },
};

const tool: CanvasImageCapabilityTool = {
  capabilityKey: "image.background.remove",
  category: "图像处理",
  completionBehavior: "review_required",
  id: "01K00000000000000000000011:remove",
  operationId: "image.background.remove",
  interactionBehavior: "form",
  label: "去背景",
  order: 10,
  outputArtifactPath: ["result", "foregroundArtifactId"],
  outputModes: ["add_node", "replace_content"],
  parameterFields: [],
  parametersSchemaId: "kanvas.image-background-remove.v1",
  sourceParameterKey: "source",
  sourceValue: "artifact_id",
  contractRevisionId: "01K00000000000000000000012",
};

beforeEach(() => {
  fallbackValues.clear();
  vi.stubGlobal("localStorage", fallbackStorage);
});

afterEach(async () => {
  await removeCanvasOperationSessionV1(workspaceId, recoveryId, sessionId);
  vi.unstubAllGlobals();
});

describe("Canvas Operation recovery V1", () => {
  it("round-trips the pinned session required to resume polling", async () => {
    const starting = createCanvasOperationSessionV1({
      id: sessionId,
      idempotencyKey: "idempotency-recovery-1",
      workspaceId,
      tool,
      outputDisposition: "replace_content",
      source: {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId: "01K00000000000000000000013",
      },
    });
    const running = requestCanvasOperationCancellationV1(
      markCanvasOperationRunningV1(starting, "01K00000000000000000000014"),
    );

    await saveCanvasOperationSessionV1({
      workspaceId,
      recoveryId,
      session: running,
    });

    await expect(
      listCanvasOperationSessionsV1(workspaceId, recoveryId),
    ).resolves.toEqual([running]);
  });

  it("restores a legacy session without completion behavior as review required", async () => {
    const current = createCanvasOperationSessionV1({
      id: sessionId,
      idempotencyKey: "idempotency-recovery-legacy",
      workspaceId,
      tool: {
        ...tool,
        completionBehavior: "auto_replace_safe",
      },
      outputDisposition: "replace_content",
      source: {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId: "01K00000000000000000000013",
      },
    });
    const legacy = { ...current } as Record<string, unknown>;
    delete legacy.completionBehavior;
    const storageKey = `kanvas:canvas-operation:v1:${workspaceId}:${recoveryId}:${sessionId}`;
    fallbackStorage.setItem(
      storageKey,
      JSON.stringify({
        key: `${workspaceId}:${recoveryId}:${sessionId}`,
        workspaceId,
        recoveryId,
        session: legacy,
      }),
    );

    await expect(
      listCanvasOperationSessionsV1(workspaceId, recoveryId),
    ).resolves.toEqual([
      {
        ...current,
        completionBehavior: "review_required",
      },
    ]);
  });

  it("promotes an unsaved-board recovery key to the durable Draft identity", async () => {
    const starting = createCanvasOperationSessionV1({
      id: sessionId,
      idempotencyKey: "idempotency-recovery-2",
      workspaceId,
      tool,
      outputDisposition: "add_node",
      source: {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId: "01K00000000000000000000013",
      },
    });
    await saveCanvasOperationSessionV1({
      workspaceId,
      recoveryId,
      session: starting,
    });

    await promoteCanvasOperationSessionsV1(
      workspaceId,
      recoveryId,
      "01K00000000000000000000015",
    );

    await expect(
      listCanvasOperationSessionsV1(workspaceId, recoveryId),
    ).resolves.toEqual([]);
    await expect(
      listCanvasOperationSessionsV1(workspaceId, "01K00000000000000000000015"),
    ).resolves.toEqual([starting]);
    await removeCanvasOperationSessionV1(
      workspaceId,
      "01K00000000000000000000015",
      sessionId,
    );
  });

  it("mirrors a non-secret session for reload recovery when IndexedDB is recreated", async () => {
    const running = markCanvasOperationRunningV1(
      createCanvasOperationSessionV1({
        id: sessionId,
        idempotencyKey: "idempotency-recovery-fallback",
        workspaceId,
        tool,
        outputDisposition: "replace_content",
        source: {
          pageId: "page-1",
          nodeId: "image-1",
          artifactId: "01K00000000000000000000013",
        },
      }),
      "01K00000000000000000000014",
    );
    await saveCanvasOperationSessionV1({
      workspaceId,
      recoveryId,
      session: running,
    });

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("kanvas-canvas-operation-v1");
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () =>
        reject(
          request.error ??
            new Error("Canvas operation recovery database deletion failed."),
        ),
      );
    });

    await expect(
      listCanvasOperationSessionsV1(workspaceId, recoveryId),
    ).resolves.toEqual([running]);
  });

  it("prunes superseded sessions so an older operation cannot resurrect", async () => {
    const older = createCanvasOperationSessionV1({
      id: sessionId,
      idempotencyKey: "idempotency-recovery-older",
      workspaceId,
      tool,
      outputDisposition: "replace_content",
      source: {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId: "01K00000000000000000000013",
      },
    });
    const newer = createCanvasOperationSessionV1({
      id: "operation-recovery-2",
      idempotencyKey: "idempotency-recovery-newer",
      workspaceId,
      tool,
      outputDisposition: "replace_content",
      source: {
        pageId: "page-1",
        nodeId: "image-1",
        artifactId: "01K00000000000000000000013",
      },
    });
    await saveCanvasOperationSessionV1({
      workspaceId,
      recoveryId,
      session: older,
    });
    await saveCanvasOperationSessionV1({
      workspaceId,
      recoveryId,
      session: newer,
    });

    await pruneCanvasOperationSessionsV1(workspaceId, recoveryId, newer.id);

    await expect(
      listCanvasOperationSessionsV1(workspaceId, recoveryId),
    ).resolves.toEqual([newer]);
    await removeCanvasOperationSessionV1(workspaceId, recoveryId, newer.id);
  });
});
