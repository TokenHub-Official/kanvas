import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  createInstanceBootstrapStore,
  digestInstanceSetupBinding,
  digestInstanceSetupToken,
  instanceSetupTokenPrefix,
  InstanceBootstrapStoreError,
  normalizeVerifiedEmail,
} from "../src/runtime/instance-bootstrap-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const now = new Date("2026-07-28T12:00:00.000Z");
const rawToken = "knv_setup_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567";

function result(affectedRows = 1): ResultSetHeader {
  return {
    affectedRows,
    fieldCount: 0,
    info: "",
    insertId: 0,
    serverStatus: 0,
    warningStatus: 0,
    changedRows: 0,
  } as unknown as ResultSetHeader;
}

function harness(
  execute: (
    sql: string,
    parameters: readonly unknown[] | undefined,
  ) => Promise<readonly [unknown, unknown]>,
): {
  readonly pool: Pool;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly rollback: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn(() => Promise.resolve());
  const rollback = vi.fn(() => Promise.resolve());
  const connection = {
    beginTransaction: vi.fn(() => Promise.resolve()),
    commit,
    rollback,
    release: vi.fn(),
    execute: vi.fn(execute),
    query: vi.fn(() => Promise.resolve([[], []])),
  } as unknown as PoolConnection;
  return {
    commit,
    rollback,
    pool: {
      getConnection: () => Promise.resolve(connection),
    } as unknown as Pool,
  };
}

describe("instance bootstrap token primitives", () => {
  it("uses a domain-separated digest, bounded prefix and stable email normalization", () => {
    expect(instanceSetupTokenPrefix(rawToken)).toBe(rawToken.slice(0, 20));
    expect(digestInstanceSetupToken(rawToken)).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(normalizeVerifiedEmail("Owner@Exämple.com")).toBe(
      "owner@xn--exmple-cua.com",
    );
    expect(
      digestInstanceSetupBinding("verified_email_hash", "Owner@Exämple.com"),
    ).toBe(
      digestInstanceSetupBinding(
        "verified_email_hash",
        "owner@xn--exmple-cua.com",
      ),
    );
  });

  it("rejects malformed setup token material", () => {
    expect(() => digestInstanceSetupToken("short")).toThrowError(
      InstanceBootstrapStoreError,
    );
  });
});

describe("InstanceBootstrapStore", () => {
  it("serializes issuance, revokes older grants and writes a secret-free audit event", async () => {
    const executed: string[] = [];
    const transaction = harness((sql) => {
      executed.push(sql);
      if (sql.includes("FROM instance_administrator")) {
        return Promise.resolve([[], []]);
      }
      return Promise.resolve([result(), []]);
    });
    const store = createInstanceBootstrapStore(transaction.pool, {
      instanceId: id(1),
    });

    await expect(
      store.issueSetupToken({
        setupTokenId: id(2),
        tokenPrefix: instanceSetupTokenPrefix(rawToken),
        tokenHash: digestInstanceSetupToken(rawToken),
        hashVersion: 1,
        bindingMode: "auth_subject",
        bindingHash: digestInstanceSetupBinding("auth_subject", "auth-user-1"),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        now,
        auditEventId: id(3),
      }),
    ).resolves.toEqual({
      setupTokenId: id(2),
      tokenPrefix: rawToken.slice(0, 20),
      bindingMode: "auth_subject",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    expect(executed[0]).toContain("UPDATE instance_runtime_state");
    expect(executed.some((sql) => sql.includes("SET revoked_at = ?"))).toBe(
      true,
    );
    expect(
      executed.some((sql) => sql.includes("INSERT INTO audit_event")),
    ).toBe(true);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it("inspects an active setup grant without exposing its persisted binding", async () => {
    const bindingHash = digestInstanceSetupBinding(
      "verified_email_hash",
      "owner@example.com",
    );
    const transaction = harness((sql) => {
      if (sql.includes("FROM instance_administrator")) {
        return Promise.resolve([[], []]);
      }
      if (sql.includes("FROM instance_setup_token")) {
        return Promise.resolve([
          [
            {
              id: id(2),
              bindingMode: "verified_email_hash",
              bindingHash,
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
              usedAt: null,
              revokedAt: null,
            },
          ],
          [],
        ]);
      }
      return Promise.resolve([result(), []]);
    });
    const store = createInstanceBootstrapStore(transaction.pool, {
      instanceId: id(1),
    });

    await expect(
      store.inspectSetupToken({
        tokenHash: digestInstanceSetupToken(rawToken),
        verifiedEmail: "Owner@Example.com",
        now,
      }),
    ).resolves.toEqual({
      bindingMode: "verified_email_hash",
      verifiedEmailMatches: true,
    });
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  it("atomically creates the first administrator, organization, workspace and owners", async () => {
    const bindingHash = digestInstanceSetupBinding(
      "verified_email_hash",
      "owner@example.com",
    );
    const executed: string[] = [];
    const transaction = harness((sql) => {
      executed.push(sql);
      if (sql.includes("FROM instance_administrator")) {
        return Promise.resolve([[], []]);
      }
      if (sql.includes("FROM instance_setup_token")) {
        return Promise.resolve([
          [
            {
              id: id(2),
              bindingMode: "verified_email_hash",
              bindingHash,
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
              usedAt: null,
              revokedAt: null,
            },
          ],
          [],
        ]);
      }
      if (sql.includes("FROM human_principal AS human")) {
        return Promise.resolve([[], []]);
      }
      return Promise.resolve([result(), []]);
    });
    const store = createInstanceBootstrapStore(transaction.pool, {
      instanceId: id(1),
    });

    await expect(
      store.redeemSetupToken({
        tokenHash: digestInstanceSetupToken(rawToken),
        authSubjectId: "auth-user-1",
        verifiedEmail: "Owner@Example.com",
        principalId: id(4),
        organizationId: id(5),
        organizationMembershipId: id(6),
        organizationSlug: "kanvas",
        organizationName: "Kanvas",
        workspaceId: id(7),
        workspaceMembershipId: id(8),
        workspaceSlug: "design",
        workspaceName: "Design",
        now,
        authenticationRefHash: digest("a"),
        requestId: "request-1",
        auditEventId: id(9),
      }),
    ).resolves.toEqual({
      principalId: id(4),
      organizationId: id(5),
      workspaceId: id(7),
      bindingMode: "verified_email_hash",
    });
    for (const table of [
      "principal",
      "human_principal",
      "organization",
      "workspace",
      "instance_administrator",
      "organization_membership",
      "workspace_membership",
      "audit_event",
    ]) {
      expect(executed.some((sql) => sql.includes(`INSERT INTO ${table}`))).toBe(
        true,
      );
    }
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  it("rolls back before creating authority when the session binding mismatches", async () => {
    const transaction = harness((sql) => {
      if (sql.includes("FROM instance_administrator")) {
        return Promise.resolve([[], []]);
      }
      if (sql.includes("FROM instance_setup_token")) {
        return Promise.resolve([
          [
            {
              id: id(2),
              bindingMode: "auth_subject",
              bindingHash: digestInstanceSetupBinding(
                "auth_subject",
                "different-user",
              ),
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
              usedAt: null,
              revokedAt: null,
            },
          ],
          [],
        ]);
      }
      return Promise.resolve([result(), []]);
    });
    const store = createInstanceBootstrapStore(transaction.pool, {
      instanceId: id(1),
    });

    await expect(
      store.redeemSetupToken({
        tokenHash: digestInstanceSetupToken(rawToken),
        authSubjectId: "auth-user-1",
        principalId: id(4),
        organizationId: id(5),
        organizationMembershipId: id(6),
        organizationSlug: "kanvas",
        organizationName: "Kanvas",
        workspaceId: id(7),
        workspaceMembershipId: id(8),
        workspaceSlug: "design",
        workspaceName: "Design",
        now,
        authenticationRefHash: digest("a"),
        auditEventId: id(9),
      }),
    ).rejects.toMatchObject({
      code: "instance_bootstrap.binding_mismatch",
    });
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
