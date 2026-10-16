import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { createSkillLibraryStore } from "../src/runtime/skill-library-store.js";

vi.mock("../src/runtime/authorization-store.js", () => ({
  revalidateTrustedWorkspaceScopeInTransaction: vi.fn(),
}));

const candidateId = "01K00000000000000000000001";
const runId = "01K00000000000000000000002";
const threadId = "01K00000000000000000000003";
const artifactId = "01K00000000000000000000004";
const authority = {
  workspaceId: "01K00000000000000000000000",
  principalId: "01K00000000000000000000005",
} as TrustedWorkspaceScope;
const input = { authority, candidateId, runId, threadId, now: new Date() };

function harness(rows: readonly unknown[][]) {
  const execute = vi.fn();
  for (const result of rows) execute.mockResolvedValueOnce([result, []]);
  const commit = vi.fn();
  const rollback = vi.fn();
  const connection = {
    execute,
    beginTransaction: vi.fn(),
    commit,
    rollback,
    release: vi.fn(),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: () => Promise.resolve(connection),
  } as unknown as Pool;
  return { store: createSkillLibraryStore(pool), execute, commit, rollback };
}

describe("Skill candidate evidence without an output-type requirement", () => {
  it("accepts a successful candidate run with no artifact", async () => {
    const { store, execute, commit } = harness([
      [{ id: candidateId }],
      [{ id: runId }],
    ]);
    await expect(
      store.verifyCandidateTestEvidence(input),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalled();
  });
  it("still rejects a run that did not successfully execute this candidate", async () => {
    const { store, rollback } = harness([[{ id: candidateId }], []]);
    await expect(
      store.verifyCandidateTestEvidence(input),
    ).rejects.toMatchObject({ code: "skill_library.test_evidence_invalid" });
    expect(rollback).toHaveBeenCalled();
  });
  it("accepts an available artifact from the run without a media-type restriction", async () => {
    const { store, execute } = harness([
      [{ id: candidateId }],
      [{ id: runId }],
      [{ id: artifactId }],
    ]);
    await expect(
      store.verifyCandidateTestEvidence({ ...input, artifactId }),
    ).resolves.toBeUndefined();
    const artifactQuery = execute.mock.calls.at(-1)!;
    expect(artifactQuery[0]).not.toContain("image/%");
    expect(artifactQuery[1]).toEqual([
      authority.workspaceId,
      artifactId,
      runId,
    ]);
  });
  it("still rejects an unrelated or unavailable supplied artifact", async () => {
    const { store } = harness([[{ id: candidateId }], [{ id: runId }], []]);
    await expect(
      store.verifyCandidateTestEvidence({ ...input, artifactId }),
    ).rejects.toMatchObject({ code: "skill_library.test_artifact_invalid" });
  });
});
