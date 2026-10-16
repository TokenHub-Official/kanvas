import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { monotonicFactory } from "ulid";

import {
  installPreparedCatalogRuntimeAdaptersInTransaction,
  type PreparedCatalogPackageV1,
} from "../cli/catalog-package-installer.js";
import { registerPreparedCatalogPackageInTransaction } from "../cli/catalog-package-registrar.js";

/** System execution prerequisites, without installing demo/business resources. */
export async function ensureWorkspaceSystemCatalogInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly prepared: PreparedCatalogPackageV1;
    readonly now: Date;
    readonly nextId: () => string;
  },
): Promise<void> {
  await installPreparedCatalogRuntimeAdaptersInTransaction(connection, {
    ...options,
    preserveCurrentRevision: true,
  });
  await registerPreparedCatalogPackageInTransaction(connection, options);
}

/** Runs under the migrator lock; each Workspace is repaired atomically. */
export async function backfillWorkspaceSystemCatalog(
  connection: PoolConnection,
  prepared: PreparedCatalogPackageV1,
): Promise<void> {
  const [workspaces] = await connection.query<
    (RowDataPacket & { id: string })[]
  >("SELECT id FROM workspace WHERE status = 'active' ORDER BY id");
  const nextId = monotonicFactory();
  for (const workspace of workspaces) {
    await connection.beginTransaction();
    try {
      const [active] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM workspace WHERE id = ? AND status = 'active' FOR UPDATE",
        [workspace.id],
      );
      if (active.length) {
        await ensureWorkspaceSystemCatalogInTransaction(connection, {
          workspaceId: workspace.id,
          prepared,
          now: new Date(),
          nextId,
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}
