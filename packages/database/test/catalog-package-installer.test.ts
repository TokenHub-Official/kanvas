import { resolve } from "node:path";

import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  installCatalogPackageV1,
  prepareCatalogPackageV1,
} from "../src/cli/catalog-package-installer.js";
import { loadCatalogPackageV1 } from "../src/cli/catalog-package-loader.js";

const packageRoot = resolve(
  import.meta.dirname,
  "../../../catalog-packages/kanvas-default",
);

describe("Catalog Package installer", () => {
  it("precompiles the representative implementation and fixture suite", async () => {
    const prepared = prepareCatalogPackageV1(
      await loadCatalogPackageV1(packageRoot),
    );
    const implementation = [...prepared.implementations.values()].find(
      (item) =>
        item.document.implementationKey ===
        "first-party.image.upscale.lanczos3.worker",
    );
    expect(implementation).toMatchObject({
      document: {
        implementationKey: "first-party.image.upscale.lanczos3.worker",
      },
      compiledInputMapping: {
        schemaVersion: "kanvas.compiled-capability-mapping/v1",
        direction: "input",
      },
      compiledOutputMapping: {
        schemaVersion: "kanvas.compiled-capability-mapping/v1",
        direction: "output",
      },
    });
    expect(implementation?.compiledInputMappingDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(implementation?.compiledOutputMappingDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
  });

  it("installs every asset through generic table operations in one transaction", async () => {
    const statements: string[] = [];
    const execute = vi.fn((sql: string) => {
      statements.push(sql.replaceAll(/\s+/gu, " ").trim());
      return Promise.resolve([
        sql.trimStart().startsWith("SELECT") ? [] : { affectedRows: 1 },
      ]);
    });
    const beginTransaction = vi.fn(() => Promise.resolve());
    const commit = vi.fn(() => Promise.resolve());
    const rollback = vi.fn(() => Promise.resolve());
    const release = vi.fn();
    const connection = {
      execute,
      beginTransaction,
      commit,
      rollback,
      release,
    } as unknown as PoolConnection;
    const pool = {
      getConnection: vi.fn(() => Promise.resolve(connection)),
    } as unknown as Pool;
    let identity = 0;

    await expect(
      installCatalogPackageV1({
        pool,
        workspaceId: "01K00000000000000000000001",
        actorPrincipalId: "01K00000000000000000000002",
        packageRoot,
        now: new Date("2026-08-31T00:00:00.000Z"),
        nextId: () => `01K${String((identity += 1) + 1).padStart(23, "0")}`,
      }),
    ).resolves.toMatchObject({
      packageKey: "kanvas.default-catalog",
      packageVersion: "2.1.1",
      installedAssets: 75,
    });
    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    for (const table of [
      "capability_contract_revision",
      "capability_definition",
      "capability_declaration_revision",
      "runtime_adapter_definition",
      "runtime_adapter_revision",
      "model_resource_catalog_entry",
      "capability_implementation_revision",
      "capability_binding",
    ]) {
      expect(
        statements.some((statement) =>
          statement.startsWith(`INSERT INTO ${table}`),
        ),
      ).toBe(true);
    }
    expect(
      statements.some(
        (statement) =>
          statement.startsWith("INSERT INTO workflow_") ||
          statement.startsWith("INSERT INTO skill_"),
      ),
    ).toBe(false);
  });
});
