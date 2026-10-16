import { DomainError, type TrustedWorkspaceScope } from "@kanvas/application";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";

/** Called inside the existing content commit; the caller still owns the upload. */
export async function requireLibraryUploadTarget(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  libraryId: string,
  now: Date,
): Promise<void> {
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    authority,
    "library.manage",
    now,
  );
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM resource_library WHERE workspace_id = ? AND id = ? AND lifecycle_status = 'active' FOR SHARE`,
    [authority.workspaceId, libraryId],
  );
  if (!rows[0])
    throw new DomainError(
      "resource_library.unavailable",
      "The library is not available for uploads.",
    );
}

/** Adds a library check only to Artifacts committed through the library owner chain. */
export async function revalidateLibraryArtifactAccess(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  artifactId: string,
  now: Date,
): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT library_id FROM resource_library_upload WHERE workspace_id = ? AND artifact_id = ? LIMIT 1`,
    [authority.workspaceId, artifactId],
  );
  if (rows[0])
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      authority,
      "library.read",
      now,
    );
}
