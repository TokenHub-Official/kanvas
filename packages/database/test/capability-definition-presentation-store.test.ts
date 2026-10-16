import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createCapabilityDefinitionAdminStore } from "../src/runtime/capability-definition-admin-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const now = new Date("2026-09-15T12:00:00.000Z");
const scope = Object.freeze({
  workspaceId: id(1),
  organizationId: id(2),
  principalId: id(3),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "capability-presentation-session",
  authorityType: "human_membership",
  authorityId: id(4),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["agent.run", "capability.run"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope);

function authorityRow(role: "operator" | "reviewer") {
  return {
    principalId: scope.principalId,
    principalStatus: "active",
    membershipId: scope.authorityId,
    membershipRole: role,
    membershipStatus: "active",
    membershipVersion: scope.authorityVersion,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    workspaceStatus: "active",
  };
}

function harness(
  handler: (
    sql: string,
    parameters: readonly unknown[],
  ) => readonly [unknown, unknown],
) {
  const statements: string[] = [];
  const parameters: (readonly unknown[])[] = [];
  const execute = vi.fn((sqlValue: string, values: readonly unknown[] = []) => {
    const sql = sqlValue.replaceAll(/\s+/gu, " ").trim();
    statements.push(sql);
    parameters.push(values);
    return Promise.resolve(handler(sql, values));
  });
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const connection = {
    execute,
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit,
    rollback,
    release: vi.fn(),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn().mockResolvedValue(connection),
  } as unknown as Pool;
  return { pool, statements, parameters, commit, rollback };
}

describe("Capability Definition Agent presentation resolver", () => {
  it("maps requested historical contracts to the current visible Agent declaration in one authorized query", async () => {
    const firstContractRevisionId = id(5);
    const secondContractRevisionId = id(6);
    const declaration = {
      catalog: {
        title: { "zh-CN": "图生图", "en-US": "Image to image" },
      },
    };
    const test = harness((sql) => {
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [[authorityRow("operator")], []];
      }
      return [
        [{ contractRevisionId: firstContractRevisionId, declaration }],
        [],
      ];
    });
    const store = createCapabilityDefinitionAdminStore(test.pool);

    await expect(
      store.resolveAgentCatalogPresentations(
        scope,
        [firstContractRevisionId, secondContractRevisionId],
        now,
      ),
    ).resolves.toEqual([
      { contractRevisionId: firstContractRevisionId, declaration },
    ]);

    expect(test.statements).toHaveLength(2);
    expect(test.statements[1]).toContain(
      "requested_declaration.contract_revision_id = requested_contract.id",
    );
    expect(test.statements[1]).toContain(
      "contract.id = definition.current_contract_revision_id",
    );
    expect(test.statements[1]).toContain(
      "declaration.id = definition.current_declaration_revision_id",
    );
    expect(test.statements[1]).toContain(
      "definition.lifecycle_status = 'active'",
    );
    expect(test.statements[1]).toContain("JSON_QUOTE('agent')");
    expect(test.statements[1]).toContain(
      "available_binding.lifecycle_status = 'active'",
    );
    expect(test.statements[1]).toContain("requested_contract.id IN (?, ?)");
    expect(test.parameters[1]).toEqual([
      scope.workspaceId,
      now,
      now,
      firstContractRevisionId,
      secondContractRevisionId,
    ]);
    expect(test.commit).toHaveBeenCalledOnce();
  });

  it("revalidates capability.run before reading presentation metadata", async () => {
    const test = harness((sql) => {
      if (sql.includes("FROM workspace_membership AS membership")) {
        return [[authorityRow("reviewer")], []];
      }
      throw new Error("presentation query must not execute");
    });
    const store = createCapabilityDefinitionAdminStore(test.pool);

    await expect(
      store.resolveAgentCatalogPresentations(scope, [id(5)], now),
    ).rejects.toMatchObject({ code: "authorization.forbidden" });
    expect(test.statements).toHaveLength(1);
    expect(test.rollback).toHaveBeenCalledOnce();
  });
});
