import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { createSkillLibraryStore } from "../src/runtime/skill-library-store.js";

vi.mock("../src/runtime/authorization-store.js", () => ({
  revalidateTrustedWorkspaceScopeInTransaction: vi.fn(),
}));

const input = {
  authority: {
    workspaceId: "01K00000000000000000000000",
    principalId: "01K00000000000000000000001",
  } as TrustedWorkspaceScope,
  runId: "01K00000000000000000000002",
  skillRevisionId: "01K00000000000000000000003",
  artifactId: "01K00000000000000000000004",
  path: "references/logo.png",
  now: new Date("2026-09-08T00:00:00Z"),
};
const resource = {
  storedObjectId: "01K00000000000000000000005",
  mediaType: "image/png",
  contentDigest: `sha256:${"a".repeat(64)}`,
};

function harness(rows: readonly unknown[][]) {
  const execute = vi.fn();
  rows.forEach((result) => execute.mockResolvedValueOnce([result, []]));
  const rollback = vi.fn();
  const connection = {
    execute,
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback,
    release: vi.fn(),
  } as unknown as PoolConnection;
  return {
    store: createSkillLibraryStore({
      getConnection: () => Promise.resolve(connection),
    } as unknown as Pool),
    execute,
    rollback,
  };
}

describe("Skill images become exact governed Artifact references", () => {
  it("rejects access when the Skill is not pinned to the active owned Run", async () => {
    const { store, execute, rollback } = harness([[]]);
    await expect(store.materializeRunImage(input)).rejects.toMatchObject({
      code: "skill_library.not_found",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalled();
  });

  it("reuses the immutable object and preserves its existing classification", async () => {
    const { store, execute } = harness([
      [{ id: input.runId }],
      [resource],
      [{ id: resource.storedObjectId, dataClassification: "confidential" }],
      [],
      [{ id: input.artifactId }],
    ]);
    await expect(store.materializeRunImage(input)).resolves.toBe(
      input.artifactId,
    );
    expect(execute.mock.calls[3]?.[1]).toEqual(
      expect.arrayContaining([
        resource.storedObjectId,
        resource.contentDigest,
        "confidential",
      ]),
    );
    expect(execute.mock.calls[0]?.[0]).toContain("JSON_CONTAINS");
  });

  it("does not create an Artifact for missing or changed stored image bytes", async () => {
    const { store, execute } = harness([[{ id: input.runId }], [resource], []]);
    await expect(store.materializeRunImage(input)).rejects.toMatchObject({
      code: "skill_library.integrity",
    });
    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO artifact"),
      ),
    ).toBe(false);
  });
});
