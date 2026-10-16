import { createHash } from "node:crypto";
import {
  DomainError,
  libraryDocumentMaximumBytes,
  validateLibraryTextExtraction,
  type LibraryTextExtraction,
  type LibraryTextSource,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

export async function readLibraryTextIndex(
  connection: PoolConnection,
  workspaceId: string,
  artifactId: string,
  contentDigest: string,
): Promise<LibraryTextExtraction | undefined> {
  const [rows] = await connection.execute<
    (RowDataPacket & {
      text: string;
      extractorVersion: string;
      pageRanges: unknown;
      extractionDigest: string;
    })[]
  >(
    "SELECT text_content AS text, extractor_version AS extractorVersion, page_ranges AS pageRanges, extraction_digest AS extractionDigest FROM resource_library_text WHERE workspace_id = ? AND artifact_id = ? AND content_digest = ?",
    [workspaceId, artifactId, contentDigest],
  );
  const row = rows[0];
  if (!row) return undefined;
  const extraction = validateLibraryTextExtraction({
    text: row.text,
    extractorVersion: row.extractorVersion,
    pageRanges: (typeof row.pageRanges === "string"
      ? JSON.parse(row.pageRanges)
      : row.pageRanges) as LibraryTextExtraction["pageRanges"],
  });
  if (digestProviderValue(extraction) !== row.extractionDigest)
    throw new DomainError(
      "resource_library.integrity",
      "Text index integrity check failed.",
    );
  return extraction;
}

export async function readLibraryTextSource(
  connection: PoolConnection,
  options: {
    authority: TrustedWorkspaceScope;
    libraryId: string;
    artifactId: string;
    now: Date;
  },
): Promise<LibraryTextSource> {
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    options.authority,
    "library.read",
    options.now,
  );
  const [rows] = await connection.execute<
    (RowDataPacket &
      Omit<LibraryTextSource, "extraction"> & { assetId: string | null })[]
  >(
    `SELECT artifact.id AS artifactId, artifact.asset_id AS assetId, artifact.content_digest AS contentDigest,
      object.media_type AS mediaType, CAST(object.byte_size AS CHAR) AS byteSize, object.storage_profile_id AS storageProfileId,
      object.container, object.object_key AS objectKey, object.sha256, object.immutable_identity_hash AS immutableIdentityHash
     FROM artifact INNER JOIN stored_object AS object ON object.workspace_id = artifact.workspace_id AND object.id = artifact.stored_object_id
     WHERE artifact.workspace_id = ? AND artifact.id = ? AND artifact.availability_status = 'available' AND object.delete_state = 'active'
       AND artifact.content_digest = CONCAT('sha256:', object.sha256)
       AND EXISTS (SELECT 1 FROM resource_library WHERE workspace_id = artifact.workspace_id AND id = ?)
       AND (artifact.asset_id IS NOT NULL OR EXISTS (SELECT 1 FROM resource_library_upload WHERE workspace_id = artifact.workspace_id AND artifact_id = artifact.id AND library_id = ?)) FOR SHARE`,
    [
      options.authority.workspaceId,
      options.artifactId,
      options.libraryId,
      options.libraryId,
    ],
  );
  const row = rows[0];
  if (!row)
    throw new DomainError(
      "resource_library.reference_unavailable",
      "Document is unavailable.",
    );
  if (row.assetId)
    await revalidateTrustedWorkspaceScopeInTransaction(
      connection,
      options.authority,
      "asset.read",
      options.now,
    );
  const extraction = await readLibraryTextIndex(
    connection,
    options.authority.workspaceId,
    options.artifactId,
    row.contentDigest,
  );
  return {
    artifactId: row.artifactId,
    contentDigest: row.contentDigest,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    storageProfileId: row.storageProfileId,
    container: row.container,
    objectKey: row.objectKey,
    sha256: row.sha256,
    immutableIdentityHash: row.immutableIdentityHash,
    ...(extraction ? { extraction } : {}),
  };
}

export async function writeLibraryTextIndex(
  connection: PoolConnection,
  options: {
    authority: TrustedWorkspaceScope;
    libraryId: string;
    artifactId: string;
    contentDigest: string;
    text: string;
    sourceBytes?: Uint8Array;
    extraction?: LibraryTextExtraction;
    now: Date;
  },
): Promise<void> {
  const bytes = options.sourceBytes ?? Buffer.from(options.text, "utf8");
  if (
    !bytes.length ||
    bytes.length > libraryDocumentMaximumBytes ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
      options.contentDigest
  )
    throw new DomainError(
      "resource_library.integrity",
      "Index source bytes do not match the artifact.",
    );
  const extraction = validateLibraryTextExtraction(
    options.extraction ?? {
      text: options.text,
      extractorVersion: "utf8-v1",
      pageRanges: [],
    },
  );
  const source = await readLibraryTextSource(connection, options);
  if (
    ![
      "text/plain",
      "text/markdown",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(source.mediaType)
  )
    throw new DomainError(
      "resource_library.document_invalid",
      "Only document content can be indexed.",
    );
  if (Number(source.byteSize) !== bytes.length)
    throw new DomainError(
      "resource_library.integrity",
      "Index source size does not match the artifact.",
    );
  if (
    source.mediaType.startsWith("text/") &&
    (extraction.pageRanges.length ||
      extraction.text !==
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ))
  )
    throw new DomainError(
      "resource_library.integrity",
      "Plain text index must preserve original content.",
    );
  if (source.contentDigest !== options.contentDigest)
    throw new DomainError(
      "resource_library.integrity",
      "Source digest changed.",
    );
  if (!source.mediaType.startsWith("text/") && !options.sourceBytes)
    throw new DomainError(
      "resource_library.integrity",
      "Original document bytes are required.",
    );
  if (source.extraction) return;
  // Immutable first extraction wins; parallel reads may derive the same Artifact.
  await connection.execute(
    "INSERT INTO resource_library_text (workspace_id, artifact_id, content_digest, extractor_version, text_content, page_ranges, extraction_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE artifact_id = artifact_id",
    [
      options.authority.workspaceId,
      options.artifactId,
      options.contentDigest,
      extraction.extractorVersion,
      extraction.text,
      JSON.stringify(extraction.pageRanges),
      digestProviderValue(extraction),
      options.now,
    ],
  );
}
