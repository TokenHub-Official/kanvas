import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  assertContentDomainAuditDetailsSafe,
  createContentDomainStore,
  type ContentDomainAuditPort,
} from "../src/runtime/content-domain-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const now = new Date("2026-07-27T20:00:00.000Z");
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

const authority = Object.freeze({
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
  effectivePermissions: Object.freeze([
    "canvas.write",
    "asset.write",
    "approval.decide",
  ]),
  trusted: true,
} satisfies TrustedWorkspaceScope);

function result(affectedRows = 1): ResultSetHeader {
  return {
    affectedRows,
  } as ResultSetHeader;
}

function poolFor(
  execute: ReturnType<typeof vi.fn>,
  lifecycle?: {
    readonly commit?: ReturnType<typeof vi.fn>;
    readonly rollback?: ReturnType<typeof vi.fn>;
  },
): {
  readonly pool: Pool;
  readonly connection: PoolConnection;
} {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: lifecycle?.commit ?? vi.fn().mockResolvedValue(undefined),
    rollback: lifecycle?.rollback ?? vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute,
  } as unknown as PoolConnection;
  return {
    pool: {
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool,
    connection,
  };
}

const noAudit: ContentDomainAuditPort = {
  appendInTransaction: vi.fn().mockResolvedValue(undefined),
};

describe("ContentDomainStore input authority", () => {
  it("rejects accessors without invoking them and before opening a transaction", () => {
    let getterCalls = 0;
    const document: Record<string, unknown> = {};
    Object.defineProperty(document, "title", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must-not-run";
      },
    });
    const getConnection = vi.fn();
    const store = createContentDomainStore(
      { getConnection } as unknown as Pool,
      { auditPort: noAudit },
    );

    expect(() =>
      store.createStructuredArtifact({
        authority,
        artifactId: id(10),
        artifactType: "document",
        structuredContent: document,
        contentDigest: digestProviderValue({
          title: "must-not-run",
        }),
        target: { kind: "workspace" },
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "content_domain.invalid_argument",
      }),
    );
    expect(getterCalls).toBe(0);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("rejects cyclic JSON and secret-like audit detail keys", () => {
    const document: Record<string, unknown> = {};
    document.self = document;
    const getConnection = vi.fn();
    const store = createContentDomainStore(
      { getConnection } as unknown as Pool,
      { auditPort: noAudit },
    );

    expect(() =>
      store.createStructuredArtifact({
        authority,
        artifactId: id(12),
        artifactType: "document",
        structuredContent: document,
        contentDigest: `sha256:${"a".repeat(64)}`,
        target: { kind: "workspace" },
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "content_domain.invalid_argument",
      }),
    );
    expect(() =>
      assertContentDomainAuditDetailsSafe({
        nested: {
          apiToken: "must-never-enter-audit",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "content_domain.invalid_argument",
      }),
    );
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe("ContentDomainStore transactional invariants", () => {
  it("locks the Workspace graph mutex before an all-relation recursive cycle check", async () => {
    const statements: string[] = [];
    let artifactReadCount = 0;
    const execute = vi.fn(async (sqlValue: unknown) => {
      await Promise.resolve();
      const sql = String(sqlValue);
      statements.push(sql);
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [
          [
            {
              principalId: authority.principalId,
              principalStatus: "active",
              membershipId: authority.authorityId,
              membershipRole: "owner",
              membershipStatus: "active",
              membershipVersion: authority.authorityVersion,
              organizationId: authority.organizationId,
              workspaceId: authority.workspaceId,
              workspaceStatus: "active",
            },
          ],
        ];
      }
      if (sql.includes("FROM workspace")) {
        return [
          [
            {
              id: authority.workspaceId,
              organizationId: authority.organizationId,
              status: "active",
            },
          ],
        ];
      }
      if (
        sql.includes("FROM artifact_edge") &&
        !sql.includes("WITH RECURSIVE")
      ) {
        return [[]];
      }
      if (sql.includes("FROM artifact") && !sql.includes("WITH RECURSIVE")) {
        artifactReadCount += 1;
        return [
          [
            {
              id: artifactReadCount === 1 ? id(20) : id(21),
              workspaceId: authority.workspaceId,
              assetId: null,
              availabilityStatus: "available",
            },
          ],
        ];
      }
      if (sql.includes("WITH RECURSIVE")) {
        return [[]];
      }
      if (sql.includes("INSERT INTO artifact_edge")) {
        return [result()];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { pool } = poolFor(execute);
    const store = createContentDomainStore(pool, {
      auditPort: noAudit,
    });

    await expect(
      store.addArtifactEdge({
        authority,
        edgeId: id(22),
        sourceArtifactId: id(20),
        targetArtifactId: id(21),
        relation: "derived_from",
        now,
      }),
    ).resolves.toEqual({
      status: "created",
      id: id(22),
    });
    const workspaceLockIndex = statements.findIndex((sql) =>
      sql.includes("FROM workspace"),
    );
    const recursiveIndex = statements.findIndex((sql) =>
      sql.includes("WITH RECURSIVE"),
    );
    expect(workspaceLockIndex).toBeGreaterThanOrEqual(0);
    expect(recursiveIndex).toBeGreaterThan(workspaceLockIndex);
    expect(statements[recursiveIndex]).not.toContain("edge.relation");
  });

  it("rolls back Editorial Selection when the same-connection Audit append fails", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const rollback = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn(async (sqlValue: unknown) => {
      await Promise.resolve();
      const sql = String(sqlValue);
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [
          [
            {
              principalId: authority.principalId,
              principalStatus: "active",
              membershipId: authority.authorityId,
              membershipRole: "owner",
              membershipStatus: "active",
              membershipVersion: authority.authorityVersion,
              organizationId: authority.organizationId,
              workspaceId: authority.workspaceId,
              workspaceStatus: "active",
            },
          ],
        ];
      }
      if (sql.includes("FROM workspace")) {
        return [
          [
            {
              id: authority.workspaceId,
              organizationId: authority.organizationId,
              status: "active",
            },
          ],
        ];
      }
      if (sql.includes("FROM asset")) {
        return [
          [
            {
              id: id(30),
              workspaceId: authority.workspaceId,
              assetKey: "asset",
              name: "Asset",
              assetType: "image",
              lifecycleStatus: "active",
              currentArtifactId: null,
              version: 1,
              createdByPrincipalId: authority.principalId,
            },
          ],
        ];
      }
      if (sql.includes("FROM artifact")) {
        return [
          [
            {
              id: id(32),
              workspaceId: authority.workspaceId,
              assetId: id(30),
              availabilityStatus: "available",
            },
          ],
        ];
      }
      if (sql.includes("UPDATE asset")) {
        return [result()];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const { pool, connection } = poolFor(execute, {
      commit,
      rollback,
    });
    const appendInTransaction = vi.fn((auditConnection: PoolConnection) => {
      expect(auditConnection).toBe(connection);
      return Promise.reject(new Error("audit unavailable"));
    });
    const store = createContentDomainStore(pool, {
      auditPort: {
        appendInTransaction,
      },
    });

    await expect(
      store.selectCurrentArtifact({
        authority,
        assetId: id(30),
        artifactId: id(32),
        expectedAssetVersion: 1,
        audit: {
          auditEventId: id(33),
          authenticationRefHash: `sha256:${"a".repeat(64)}`,
        },
        now,
      }),
    ).rejects.toThrow("audit unavailable");
    expect(appendInTransaction).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });
});
