import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceDefaultAgentStore,
  ensureWorkspaceDefaultAgentInTransaction,
} from "../src/runtime/workspace-default-agent-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-16T12:00:00.000Z");

function result(): ResultSetHeader {
  return {
    affectedRows: 1,
    fieldCount: 0,
    info: "",
    insertId: 0,
    serverStatus: 0,
    warningStatus: 0,
    changedRows: 0,
  } as unknown as ResultSetHeader;
}

function connectionHarness(
  execute: (
    sql: string,
    parameters: readonly unknown[],
  ) => readonly [unknown, unknown] | Promise<readonly [unknown, unknown]>,
) {
  const statements: string[] = [];
  const transactions: string[] = [];
  const connection = {
    execute: vi.fn(
      async (
        sqlValue: string | { readonly sql: string },
        parameters: readonly unknown[] = [],
      ) => {
        const sql = typeof sqlValue === "string" ? sqlValue : sqlValue.sql;
        const normalized = sql.replaceAll(/\s+/gu, " ").trim();
        statements.push(normalized);
        return execute(normalized, parameters);
      },
    ),
    beginTransaction: () => {
      transactions.push("begin");
      return Promise.resolve();
    },
    commit: () => {
      transactions.push("commit");
      return Promise.resolve();
    },
    rollback: () => {
      transactions.push("rollback");
      return Promise.resolve();
    },
    release: () => {
      transactions.push("release");
    },
  } as unknown as PoolConnection;
  const pool = {
    getConnection: () => Promise.resolve(connection),
  } as unknown as Pool;
  return { connection, pool, statements, transactions };
}

describe("WorkspaceDefaultAgentStore", () => {
  it("creates the system default Agent without copying model or credential state", async () => {
    const workspaceId = id(1);
    const ownerPrincipalId = id(2);
    const generatedIds = [id(3), id(4), id(5)];
    const test = connectionHarness((sql) => {
      if (sql.includes("FROM workspace") && sql.includes("FOR UPDATE")) {
        return [[{ organizationId: id(6) }], []];
      }
      if (sql.includes("FROM agent_definition")) return [[], []];
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [[{ principalId: ownerPrincipalId }], []];
      }
      if (
        sql.includes("FROM agent_presentation") ||
        sql.includes("FROM agent_profile_revision") ||
        sql.includes("FROM agent_profile_activation") ||
        sql.includes("FROM agent_surface_profile_binding")
      ) {
        return [[], []];
      }
      return [result(), []];
    });
    const store = createWorkspaceDefaultAgentStore(test.pool, {
      nextId: () => generatedIds.shift() ?? id(99),
    });

    await expect(store.ensure({ workspaceId, now })).resolves.toEqual({
      agentDefinitionId: id(3),
      profileRevisionId: id(4),
      changed: true,
      surfaceBound: true,
    });

    expect(test.transactions).toEqual(["begin", "commit", "release"]);
    expect(
      test.statements.some((sql) => sql.startsWith("INSERT INTO audit_event")),
    ).toBe(true);
    expect(
      test.statements.filter((sql) => sql.startsWith("INSERT INTO ")),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSERT INTO agent_definition"),
        expect.stringContaining("INSERT INTO agent_profile_revision"),
        expect.stringContaining("INSERT INTO agent_surface_profile_binding"),
      ]),
    );
    expect(
      test.statements.some((sql) =>
        /credential|provider_endpoint|agent_model_binding|workspace_agent_model_settings/u.test(
          sql,
        ),
      ),
    ).toBe(false);
  });

  it("leaves an existing system default Agent and its selected Profile unchanged", async () => {
    const workspaceId = id(10);
    const agentDefinitionId = id(11);
    const profileRevisionId = id(12);
    const nextId = vi.fn(() => id(99));
    const test = connectionHarness((sql) => {
      if (sql.includes("FROM workspace") && sql.includes("FOR UPDATE")) {
        return [[{ organizationId: id(13) }], []];
      }
      if (sql.includes("FROM agent_definition")) {
        return [
          [
            {
              id: agentDefinitionId,
              agentKey: "first-party.main-agent",
              managementKind: "system",
              systemKey: "workspace-default",
              ownerPrincipalId: id(14),
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM agent_profile_revision")) {
        return [
          [
            {
              id: profileRevisionId,
              agentDefinitionId,
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM agent_surface_profile_binding")) {
        return [[{ profileRevisionId }], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      ensureWorkspaceDefaultAgentInTransaction(test.connection, {
        workspaceId,
        now,
        nextId,
      }),
    ).resolves.toEqual({
      agentDefinitionId,
      profileRevisionId,
      changed: false,
      surfaceBound: true,
    });

    expect(nextId).not.toHaveBeenCalled();
    expect(test.statements.some((sql) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("does not replace an existing custom agent_workspace binding", async () => {
    const workspaceId = id(20);
    const customProfileRevisionId = id(21);
    const generatedIds = [id(22), id(23), id(24)];
    const test = connectionHarness((sql) => {
      if (sql.includes("FROM workspace") && sql.includes("FOR UPDATE")) {
        return [[{ organizationId: id(25) }], []];
      }
      if (sql.includes("FROM agent_definition")) return [[], []];
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [[{ principalId: id(26) }], []];
      }
      if (
        sql.includes("FROM agent_presentation") ||
        sql.includes("FROM agent_profile_revision") ||
        sql.includes("FROM agent_profile_activation")
      ) {
        return [[], []];
      }
      if (sql.includes("FROM agent_surface_profile_binding")) {
        return [[{ profileRevisionId: customProfileRevisionId }], []];
      }
      return [result(), []];
    });

    await expect(
      ensureWorkspaceDefaultAgentInTransaction(test.connection, {
        workspaceId,
        now,
        nextId: () => generatedIds.shift() ?? id(99),
      }),
    ).resolves.toMatchObject({ changed: true, surfaceBound: false });

    expect(
      test.statements.some((sql) =>
        sql.startsWith("INSERT INTO agent_surface_profile_binding"),
      ),
    ).toBe(false);
  });
});
