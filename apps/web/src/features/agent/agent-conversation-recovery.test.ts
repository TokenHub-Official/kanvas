import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composerDraftStorageKey,
  agentComposerSubmissionAttempt,
  clearAgentComposerSubmission,
  persistAgentDraftContext,
  persistAgentComposerSubmission,
  readAgentDraftContext,
  readAgentComposerSubmission,
} from "./agent-composer-draft.js";
import { agentQueueWaitIsLong } from "./agent-run-status.js";
import { agentTaskFailureKind } from "./agent-task-failure.js";
import { taskArtifactFilename } from "./agent-result-actions.js";

describe("conversation continuity and recovery", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("keeps fresh default drafts separate while preserving earlier explicit choices", () => {
    const previous = composerDraftStorageKey("workspace", undefined, "first");
    const fresh = composerDraftStorageKey("workspace", undefined, "second");
    persistAgentDraftContext(previous, {
      references: [],
      agentDefinitionId: "custom-agent",
    });
    expect(readAgentDraftContext(fresh).agentDefinitionId).toBeUndefined();
    expect(
      readAgentDraftContext(
        composerDraftStorageKey("workspace", undefined, "first"),
      ).agentDefinitionId,
    ).toBe("custom-agent");
    expect(composerDraftStorageKey("workspace", "thread", "first")).toBe(
      composerDraftStorageKey("workspace", "thread", "second"),
    );
  });
  it("restores the entire reference context after leaving and reopening a conversation", () => {
    const context = {
      references: [
        {
          kind: "skill" as const,
          id: "skill:one",
          title: "Poster",
          skillRevisionId: "revision",
        },
        {
          kind: "asset" as const,
          id: "asset:one",
          title: "Logo",
          assetId: "asset",
          artifactId: "artifact",
        },
      ],
      agentDefinitionId: "agent",
      entrySkillRemoved: true,
      entryBrandRemoved: false,
      brandCleared: true,
    };
    persistAgentDraftContext("workspace:thread-a", context);
    persistAgentDraftContext("workspace:thread-b", { references: [] });
    expect(readAgentDraftContext("workspace:thread-a")).toEqual(context);
    expect(readAgentDraftContext("workspace:thread-b").references).toEqual([]);
    persistAgentDraftContext("workspace:thread-a", {
      references: [],
      entrySkillRemoved: true,
      entryBrandRemoved: true,
    });
    expect(readAgentDraftContext("workspace:thread-a").references).toEqual([]);
    expect(
      readAgentDraftContext("other-workspace:thread-a").references,
    ).toEqual([]);
  });
  it("ignores invalid cached references and tolerates blocked storage", () => {
    sessionStorage.setItem(
      "draft:context",
      '{"references":[{"kind":"skill","title":"broken"}]}',
    );
    expect(readAgentDraftContext("draft").references).toEqual([]);
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readAgentDraftContext("draft").references).toEqual([]);
    expect(() =>
      persistAgentDraftContext("draft", { references: [] }),
    ).not.toThrow();
  });
  it("reuses one idempotency key while the same message submission is unresolved", () => {
    const first = agentComposerSubmissionAttempt(
      undefined,
      '{"message":"确定"}',
      () => "first",
    );
    persistAgentComposerSubmission("draft", first);
    const retry = agentComposerSubmissionAttempt(
      readAgentComposerSubmission("draft"),
      '{"message":"确定"}',
      () => "second",
    );
    expect(retry).toEqual(first);

    const edited = agentComposerSubmissionAttempt(
      retry,
      '{"message":"调整标题"}',
      () => "edited",
    );
    expect(edited.idempotencyKey).toBe("agent-message:edited");
    persistAgentComposerSubmission("draft", edited);
    clearAgentComposerSubmission("draft", first.idempotencyKey);
    expect(readAgentComposerSubmission("draft")).toEqual(edited);
    clearAgentComposerSubmission("draft", edited.idempotencyKey);
    expect(readAgentComposerSubmission("draft")).toBeUndefined();
  });
  it("shows a long queue wait only after the real threshold", () => {
    const start = "2026-09-07T09:18:00Z";
    expect(agentQueueWaitIsLong(start, Date.parse(start) + 59_000)).toBe(false);
    expect(agentQueueWaitIsLong(start, Date.parse(start) + 60_000)).toBe(true);
    expect(agentQueueWaitIsLong(undefined, Date.now())).toBe(false);
    expect(agentQueueWaitIsLong("invalid", Date.now())).toBe(false);
  });
  it.each([
    ["provider.remote_access_denied", "access"],
    ["provider.remote_invalid_request", "input"],
    ["attempt.execution_deadline_expired", "timeout"],
    ["provider.remote_rate_limited", "busy"],
    ["provider.budget_exhausted", "budget"],
    ["capability.failed", "unknown"],
  ])(
    "translates actual failure code %s without exposing raw messages",
    (code, expected) => {
      expect(
        agentTaskFailureKind({
          code,
          message: "Internal implementation detail",
        }),
      ).toBe(expected);
    },
  );
  it("downloads named image files with the real media extension", () => {
    expect(
      taskArtifactFilename(new Blob([], { type: "image/png" }), "秋分海报"),
    ).toBe("秋分海报.png");
    expect(
      taskArtifactFilename(new Blob([], { type: "image/webp" }), "poster.webp"),
    ).toBe("poster.webp");
  });
});
