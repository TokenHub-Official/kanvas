import type {
  CanvasExportUploadSession,
  CommittedCanvasExport,
} from "@kanvas/contracts/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadCanvasExportRecovery,
  agentCanvasExportRecoveryMatches,
  recoverCanvasExports,
  removeCanvasExportRecovery,
  saveCanvasExportRecovery,
  type PersistedCanvasExportRecovery,
} from "./canvas-export-recovery.js";

const workspaceId = "01K00000000000000000000000";
const draftId = "01K00000000000000000000001";
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

beforeEach(() => {
  fallbackValues.clear();
  vi.stubGlobal("localStorage", fallbackStorage);
});

afterEach(async () => {
  await removeCanvasExportRecovery(workspaceId, draftId);
  vi.unstubAllGlobals();
});

function recoveryItem(
  pageId: string,
  exportSessionId: string,
): PersistedCanvasExportRecovery {
  return {
    allocationKey: `allocation-${pageId}`,
    exportSessionId,
    filename: `${pageId}.png`,
    pageId,
    pageName: pageId,
    quality: 1,
    request: {
      canvasDraftId: "01K00000000000000000000001",
      documentVersion: 3,
      pageId,
      format: "png",
      width: 1080,
      height: 1080,
      transparentBackground: true,
      displayFilename: `${pageId}.png`,
      expectedSize: "68",
    },
    target: { kind: "artifact_only" },
    uploadCompleted: false,
  };
}

function session(
  exportSessionId: string,
  state: CanvasExportUploadSession["state"],
  result?: CommittedCanvasExport,
): CanvasExportUploadSession {
  return {
    exportSessionId,
    state,
    expiresAt: "2026-07-30T21:00:00.000Z",
    maximumBytes: "1000000",
    replayed: false,
    ...(result ? { result } : {}),
  };
}

describe("recoverCanvasExports", () => {
  it("round-trips the rendered blob and pinned session across reload", async () => {
    const item = {
      ...recoveryItem("page-1", "01K00000000000000000000002"),
      blob: new Blob(["rendered"], { type: "image/png" }),
    };

    await saveCanvasExportRecovery(workspaceId, draftId, [item]);

    const [recovered] = await loadCanvasExportRecovery(workspaceId, draftId);
    expect(recovered).toMatchObject({
      allocationKey: item.allocationKey,
      exportSessionId: item.exportSessionId,
      request: item.request,
      target: item.target,
    });
    await expect(recovered?.blob?.text()).resolves.toBe("rendered");
  });

  it("keeps every page recoverable when one session lookup fails", async () => {
    const first = recoveryItem("page-1", "01K00000000000000000000002");
    const second = recoveryItem("page-2", "01K00000000000000000000003");
    const third = recoveryItem("page-3", "01K00000000000000000000004");
    const result: CommittedCanvasExport = {
      status: "replayed",
      exportSessionId: first.exportSessionId,
      storedObjectId: "01K00000000000000000000005",
      artifactId: "01K00000000000000000000006",
      contentDigest: `sha256:${"1".repeat(64)}`,
      mediaType: "image/png",
      byteSize: "68",
      committedAt: "2026-07-30T20:00:00.000Z",
    };
    const lookup = vi.fn((exportSessionId: string) => {
      if (exportSessionId === first.exportSessionId) {
        return Promise.resolve(session(exportSessionId, "committed", result));
      }
      if (exportSessionId === second.exportSessionId) {
        return Promise.reject(new Error("temporary failure"));
      }
      return Promise.resolve(session(exportSessionId, "open"));
    });

    await expect(
      recoverCanvasExports([first, second, third], lookup),
    ).resolves.toEqual({
      pending: [
        {
          ...first,
          uploadCompleted: true,
          result,
        },
        second,
        third,
      ],
      results: [
        {
          artifactId: result.artifactId,
          filename: first.filename,
          pageName: first.pageName,
        },
      ],
      unavailableCount: 1,
    });
    expect(lookup).toHaveBeenCalledTimes(3);
  });
});
import "fake-indexeddb/auto";

describe("Agent recovery ownership", () => {
  it("reuses a prior Agent export only for the same fixed snapshot", async () => {
    const original = {
      ...recoveryItem("page-1", "session-1"),
      agentActionReceiptId: "01K00000000000000000000009",
      target: { kind: "artifact_only" as const },
    };
    const request = {
      actionReceiptId: "01K00000000000000000000010",
      canvasDraftId: draftId,
      documentVersion: 3,
      pageId: "page-1",
    };
    expect(agentCanvasExportRecoveryMatches(original, request)).toBe(true);
    expect(
      agentCanvasExportRecoveryMatches(
        recoveryItem("page-1", "manual-session"),
        request,
      ),
    ).toBe(false);
    expect(
      agentCanvasExportRecoveryMatches(original, {
        ...request,
        documentVersion: 4,
      }),
    ).toBe(false);
    expect(
      agentCanvasExportRecoveryMatches(original, {
        ...request,
        pageId: "page-2",
      }),
    ).toBe(false);
    await saveCanvasExportRecovery(workspaceId, draftId, [original]);
    expect(
      (await loadCanvasExportRecovery(workspaceId, draftId))[0]
        ?.agentActionReceiptId,
    ).toBe(original.agentActionReceiptId);
  });
});

it("keeps Agent recovery separate from manual export recovery", async () => {
  const manual = recoveryItem("page-1", "manual");
  const agent = recoveryItem("page-1", "agent");
  const scope = { documentVersion: 3, pageId: "page-1" };
  await saveCanvasExportRecovery(workspaceId, draftId, [manual]);
  await saveCanvasExportRecovery(workspaceId, draftId, [agent], scope);
  expect(
    (await loadCanvasExportRecovery(workspaceId, draftId))[0]?.exportSessionId,
  ).toBe("manual");
  expect(
    (await loadCanvasExportRecovery(workspaceId, draftId, scope))[0]
      ?.exportSessionId,
  ).toBe("agent");
  await removeCanvasExportRecovery(workspaceId, draftId, scope);
  expect(
    (await loadCanvasExportRecovery(workspaceId, draftId))[0]?.exportSessionId,
  ).toBe("manual");
});
