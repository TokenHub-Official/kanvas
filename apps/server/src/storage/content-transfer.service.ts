import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  CanvasExportStoreError,
  ContentTransferStoreError,
  StorageUploadStoreError,
} from "@kanvas/database/runtime";
import type {
  AllocateCanvasExportBody,
  AllocateUserImportBody,
  CanvasExportIngestion,
  CanvasExportUploadSession,
  CommitCanvasExportBody,
  CommitUserImportBody,
  CommittedCanvasExport,
  CommittedUserImport,
  UserImportIngestion,
  UserImportUploadSession,
} from "@kanvas/contracts/api";
import {
  ArtifactDownloadError,
  createArtifactDownloadCoordinator,
  loadArtifactPreviewConfig,
  LocalFilesystemStorageError,
  S3CompatibleStorageError,
  ServerStreamUploadError,
  type PreparedArtifactDownload,
} from "@kanvas/storage";
import { monotonicFactory } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import type { ServerConfig } from "../config.js";
import { canonicalDigest } from "../application-adapters.js";
import {
  DATABASE_RUNTIME,
  SERVER_CONFIG,
  SERVER_STORAGE_RUNTIME,
} from "../tokens.js";
import type { ServerStorageRuntime } from "./server-storage-runtime.js";

const nextUlid = monotonicFactory();

export interface PreparedPersistedArtifactPreview {
  readonly headers: Readonly<{
    "cache-control": string;
    "content-length": string;
    "content-type": "image/webp";
    "x-content-type-options": "nosniff";
  }>;
  readonly body: AsyncIterable<Uint8Array>;
}

function authenticationReferenceHash(authenticationRefId: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:content-transfer-authentication-ref:v1\0")
    .update(authenticationRefId)
    .digest("hex")}`;
}

function allocationRequestKey(
  scope: TrustedWorkspaceScope,
  idempotencyKey: string,
): string {
  return `user-import:v1:${createHash("sha256")
    .update("kanvas:user-import-allocation-key:v1\0")
    .update(scope.workspaceId)
    .update("\0")
    .update(scope.principalId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")}`;
}

function externalFileAllocationRequestKey(
  scope: TrustedWorkspaceScope,
  idempotencyKey: string,
  kind: "font" | "vector",
): string {
  return `external-${kind}:v1:${createHash("sha256")
    .update(`kanvas:external-${kind}-allocation-key:v1\0`)
    .update(scope.workspaceId)
    .update("\0")
    .update(scope.principalId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")}`;
}

function canvasExportAllocationRequestKey(
  scope: TrustedWorkspaceScope,
  idempotencyKey: string,
): string {
  return `canvas-export:v1:${createHash("sha256")
    .update("kanvas:canvas-export-allocation-key:v1\0")
    .update(scope.workspaceId)
    .update("\0")
    .update(scope.principalId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")}`;
}

function canvasExportObjectKey(
  workspaceId: string,
  exportSessionId: string,
): string {
  return ["workspaces", workspaceId, "canvas-exports", exportSessionId].join(
    "/",
  );
}

function canvasExportRequestHash(
  scope: TrustedWorkspaceScope,
  body: AllocateCanvasExportBody,
): string {
  return canonicalDigest.of({
    contract: "kanvas.canvas-export-allocation.v1",
    workspaceId: scope.workspaceId,
    principalId: scope.principalId,
    request: body,
  });
}

function objectKey(
  workspaceId: string,
  uploadSessionId: string,
  mediaType: AllocateUserImportBody["expectedMediaType"],
): string {
  let extension = "webp";
  if (mediaType === "image/jpeg") {
    extension = "jpg";
  } else if (mediaType === "image/png") {
    extension = "png";
  }
  return [
    "workspaces",
    workspaceId,
    "user-imports",
    `${uploadSessionId}.${extension}`,
  ].join("/");
}

function externalFileObjectKey(
  workspaceId: string,
  uploadSessionId: string,
  mediaType: "font/otf" | "font/ttf" | "image/svg+xml",
): string {
  let extension = "svg";
  if (mediaType === "font/otf") extension = "otf";
  if (mediaType === "font/ttf") extension = "ttf";
  return [
    "workspaces",
    workspaceId,
    mediaType === "image/svg+xml" ? "vectors" : "fonts",
    `${uploadSessionId}.${extension}`,
  ].join("/");
}

function translateStorageStoreError(error: StorageUploadStoreError): never {
  if (error.code === "storage_upload.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (
    error.code === "storage_upload.not_found" ||
    error.code === "storage_upload.access_denied"
  ) {
    throw new NotFoundException("User Import UploadSession was not found.");
  }
  if (error.code === "storage_upload.compatibility_not_certified") {
    throw new ServiceUnavailableException(
      "The configured storage profile is not currently certified.",
    );
  }
  throw new ConflictException(error.message);
}

export function translateContentTransferError(
  error: ContentTransferStoreError,
): never {
  if (error.code === "content_transfer.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (error.code === "content_transfer.not_found") {
    throw new NotFoundException("Content transfer resource was not found.");
  }
  if (error.code === "content_transfer.forbidden") {
    throw new ForbiddenException(error.message);
  }
  if (error.code === "content_transfer.runtime_fenced") {
    throw new ServiceUnavailableException(error.message);
  }
  throw new ConflictException(error.message);
}

function translateCanvasExportError(error: CanvasExportStoreError): never {
  if (error.code === "canvas_export.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (error.code === "canvas_export.not_found") {
    throw new NotFoundException("Canvas Export was not found.");
  }
  if (error.code === "canvas_export.forbidden") {
    throw new ForbiddenException(error.message);
  }
  if (error.code === "canvas_export.runtime_fenced") {
    throw new ServiceUnavailableException(error.message);
  }
  throw new ConflictException(error.message);
}

export function translateUploadError(error: unknown): never {
  if (error instanceof StorageUploadStoreError) {
    translateStorageStoreError(error);
  }
  if (error instanceof ServerStreamUploadError) {
    if (
      error.code === "server_stream_upload.profile_unavailable" ||
      error.code === "server_stream_upload.object_unavailable" ||
      error.code === "server_stream_upload.invalid_configuration"
    ) {
      throw new ServiceUnavailableException(error.message);
    }
    if (error.code === "server_stream_upload.verification_rejected") {
      throw new BadRequestException(error.message);
    }
    throw new ConflictException(error.message);
  }
  if (error instanceof LocalFilesystemStorageError) {
    if (error.code === "local_storage.size_limit_exceeded") {
      throw new PayloadTooLargeException(error.message);
    }
    if (
      error.code === "local_storage.io_failure" ||
      error.code === "local_storage.invalid_configuration"
    ) {
      throw new ServiceUnavailableException(error.message);
    }
    throw new ConflictException(error.message);
  }
  if (error instanceof S3CompatibleStorageError) {
    if (error.code === "s3_storage.size_limit_exceeded") {
      throw new PayloadTooLargeException(error.message);
    }
    if (
      error.code === "s3_storage.provider_failure" ||
      error.code === "s3_storage.invalid_configuration"
    ) {
      throw new ServiceUnavailableException(error.message);
    }
    throw new ConflictException(error.message);
  }
  throw error;
}

function translateDownloadError(error: ArtifactDownloadError): never {
  if (error.code === "artifact_download.range_invalid") {
    throw new BadRequestException(error.message);
  }
  if (error.code === "artifact_download.range_unsatisfiable") {
    throw new HttpException(error.message, 416);
  }
  if (
    error.code === "artifact_download.unavailable" ||
    error.code === "artifact_download.invalid_configuration"
  ) {
    throw new ServiceUnavailableException(error.message);
  }
  throw new NotFoundException("Artifact content was not found.");
}

@Injectable()
export class ContentTransferService {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_STORAGE_RUNTIME)
    private readonly storage: ServerStorageRuntime | undefined = undefined,
    @Inject(SERVER_CONFIG)
    private readonly config: ServerConfig | undefined = undefined,
  ) {}

  public artifactPreviewConfig(): ReturnType<typeof loadArtifactPreviewConfig> {
    return this.config?.artifactPreview ?? loadArtifactPreviewConfig({});
  }

  public async preparePersistedArtifactPreview(
    scope: TrustedWorkspaceScope,
    artifactId: string,
    requestId?: string,
  ): Promise<PreparedPersistedArtifactPreview | undefined> {
    const previewConfig = this.artifactPreviewConfig();
    if (previewConfig.mode !== "async_persisted") {
      return undefined;
    }
    const storage = this.requireStorage();
    const representationStore = this.database.artifactRepresentations;
    if (!representationStore) {
      throw new ServiceUnavailableException(
        "Artifact representation store is unavailable.",
      );
    }
    const now = new Date();
    const decision =
      await this.database.contentTransfers.authorizeArtifactDownload({
        authority: scope,
        artifactId,
        purpose: "artifact-preview",
        decisionId: nextUlid(),
        audit: {
          auditEventId: nextUlid(),
          authenticationRefHash: authenticationReferenceHash(
            scope.authenticationRefId,
          ),
          ...(requestId ? { requestId } : {}),
        },
        now,
        validUntil: new Date(now.getTime() + 30_000),
      });
    if (decision.decision === "deny") {
      if (decision.disclosure === "forbidden") {
        throw new ForbiddenException("Artifact preview is forbidden.");
      }
      throw new NotFoundException("Artifact preview was not found.");
    }
    const representation = await representationStore.findAvailable({
      workspaceId: scope.workspaceId,
      sourceArtifactId: artifactId,
      variantKey: previewConfig.variantKey,
      profileVersion: previewConfig.profileVersion,
    });
    if (!representation) return undefined;
    const profile = storage.profiles.resolve(representation.storageProfileId);
    if (!profile) {
      throw new ServiceUnavailableException(
        "Artifact preview Storage profile is unavailable.",
      );
    }
    const read = await profile.adapter.openRead({
      identity: {
        storageProfileId: representation.storageProfileId,
        container: representation.container,
        objectKey: representation.objectKey,
      },
      expectedByteSize: representation.byteSize,
      expectedSha256: representation.sha256,
      expectedImmutableIdentityHash: representation.immutableIdentityHash,
    });
    const revalidated =
      await this.database.contentTransfers.revalidateArtifactDownload({
        authority: scope,
        decision,
        now: new Date(),
      });
    if (revalidated.decision === "deny") {
      throw new NotFoundException("Artifact preview authorization changed.");
    }
    return Object.freeze({
      headers: Object.freeze({
        "cache-control": "private, max-age=86400, must-revalidate",
        "content-length": representation.byteSize,
        "content-type": "image/webp" as const,
        "x-content-type-options": "nosniff" as const,
      }),
      body: read.body,
    });
  }

  public async allocateCanvasExport(
    scope: TrustedWorkspaceScope,
    idempotencyKey: string,
    body: AllocateCanvasExportBody,
  ): Promise<CanvasExportUploadSession> {
    const storage = this.requireStorage();
    if (body.format === "jpeg" && body.transparentBackground) {
      throw new BadRequestException(
        "JPEG exports cannot preserve a transparent background.",
      );
    }
    if (
      body.expectedSize !== undefined &&
      BigInt(body.expectedSize) > BigInt(storage.maximumInputBytes)
    ) {
      throw new PayloadTooLargeException(
        "Expected export size exceeds the configured storage limit.",
      );
    }
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + storage.userImportSessionTtlMilliseconds,
    );
    const exportSessionId = nextUlid();
    const probe = await storage.ensureCompatibilityProbe(
      scope.workspaceId,
      nextUlid(),
      now,
    );
    try {
      const session = await this.database.storageUploads.allocateUploadSession({
        id: exportSessionId,
        workspaceId: scope.workspaceId,
        actorId: scope.principalId,
        authority: scope,
        allocationRequestKey: canvasExportAllocationRequestKey(
          scope,
          idempotencyKey,
        ),
        allocationRequestHash: canvasExportRequestHash(scope, body),
        purpose: "canvas_export",
        ...(body.expectedSize ? { expectedSize: body.expectedSize } : {}),
        expectedMediaType: `image/${body.format}`,
        ...(body.expectedSha256 ? { expectedSha256: body.expectedSha256 } : {}),
        storageProfileId: storage.profileId,
        compatibilityProbeId: probe.id,
        profileConfigurationHash: storage.profileConfigurationHash,
        container: storage.container,
        objectKey: canvasExportObjectKey(scope.workspaceId, exportSessionId),
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
        verificationProfileVersion: storage.verificationProfileVersion,
        now,
        expiresAt,
        cleanupEligibleAt: new Date(
          expiresAt.getTime() + storage.cleanupGraceMilliseconds,
        ),
      });
      if (session.state === "rejected" || session.state === "aborted") {
        throw new ConflictException(
          "The idempotent Canvas Export allocation is already terminal.",
        );
      }
      const result =
        session.state === "committed"
          ? (await this.database.canvasExports.get(scope, session.id, now))
              .result
          : undefined;
      return {
        exportSessionId: session.id,
        state: session.state,
        expiresAt: session.expiresAt.toISOString(),
        maximumBytes:
          session.expectedSize ?? storage.maximumInputBytes.toString(),
        replayed: session.replayed,
        ...(result
          ? {
              result: {
                ...result,
                committedAt: result.committedAt.toISOString(),
              },
            }
          : {}),
      };
    } catch (error) {
      if (error instanceof StorageUploadStoreError) {
        translateStorageStoreError(error);
      }
      if (error instanceof CanvasExportStoreError) {
        translateCanvasExportError(error);
      }
      throw error;
    }
  }

  public async getCanvasExport(
    scope: TrustedWorkspaceScope,
    exportSessionId: string,
  ): Promise<CanvasExportUploadSession> {
    const storage = this.requireStorage();
    try {
      const session = await this.database.canvasExports.get(
        scope,
        exportSessionId,
        new Date(),
      );
      return {
        exportSessionId: session.exportSessionId,
        state: session.state,
        expiresAt: session.expiresAt.toISOString(),
        maximumBytes:
          session.expectedSize ?? storage.maximumInputBytes.toString(),
        replayed: session.replayed,
        ...(session.result
          ? {
              result: {
                ...session.result,
                committedAt: session.result.committedAt.toISOString(),
              },
            }
          : {}),
      };
    } catch (error) {
      if (error instanceof CanvasExportStoreError) {
        translateCanvasExportError(error);
      }
      throw error;
    }
  }

  public async uploadCanvasExport(
    scope: TrustedWorkspaceScope,
    exportSessionId: string,
    body: AsyncIterable<Uint8Array>,
  ): Promise<CanvasExportIngestion> {
    const storage = this.requireStorage();
    try {
      const session =
        await this.database.storageUploads.readCanvasExportUploadSession({
          authority: scope,
          uploadSessionId: exportSessionId,
          now: new Date(),
        });
      const result = await storage.uploads.ingest({
        session,
        body,
      });
      return {
        exportSessionId: result.uploadSessionId,
        state: result.state,
        replayed: result.replayed,
      };
    } catch (error) {
      translateUploadError(error);
    }
  }

  public async commitCanvasExport(
    scope: TrustedWorkspaceScope,
    exportSessionId: string,
    body: CommitCanvasExportBody,
    requestId?: string,
  ): Promise<CommittedCanvasExport> {
    try {
      const result = await this.database.canvasExports.commit({
        authority: scope,
        exportSessionId,
        storedObjectId: nextUlid(),
        artifactId: nextUlid(),
        outboxEventId: nextUlid(),
        request: {
          ...body.request,
          requestHash: canvasExportRequestHash(scope, body.request),
        },
        target:
          body.target.kind === "new_asset"
            ? {
                ...body.target,
                assetId: exportSessionId,
              }
            : body.target,
        audit: {
          auditEventId: nextUlid(),
          authenticationRefHash: authenticationReferenceHash(
            scope.authenticationRefId,
          ),
          ...(requestId ? { requestId } : {}),
        },
        now: new Date(),
      });
      return {
        ...result,
        committedAt: result.committedAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof CanvasExportStoreError) {
        translateCanvasExportError(error);
      }
      throw error;
    }
  }

  public async allocateUserImport(
    scope: TrustedWorkspaceScope,
    idempotencyKey: string,
    body: AllocateUserImportBody,
  ): Promise<UserImportUploadSession> {
    const storage = this.requireStorage();
    if (
      body.expectedSize !== undefined &&
      BigInt(body.expectedSize) > BigInt(storage.maximumInputBytes)
    ) {
      throw new PayloadTooLargeException(
        "Expected import size exceeds the configured storage limit.",
      );
    }
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + storage.userImportSessionTtlMilliseconds,
    );
    const uploadSessionId = nextUlid();
    const probe = await storage.ensureCompatibilityProbe(
      scope.workspaceId,
      nextUlid(),
      now,
    );
    const allocationHash = canonicalDigest.of({
      contract: "kanvas.user-import-allocation.v1",
      workspaceId: scope.workspaceId,
      principalId: scope.principalId,
      idempotencyKey,
      expectedSize: body.expectedSize,
      expectedMediaType: body.expectedMediaType,
      expectedSha256: body.expectedSha256,
    });
    try {
      const session = await this.database.storageUploads.allocateUploadSession({
        id: uploadSessionId,
        workspaceId: scope.workspaceId,
        actorId: scope.principalId,
        authority: scope,
        allocationRequestKey: allocationRequestKey(scope, idempotencyKey),
        allocationRequestHash: allocationHash,
        purpose: "user_import",
        ...(body.expectedSize ? { expectedSize: body.expectedSize } : {}),
        expectedMediaType: body.expectedMediaType,
        ...(body.expectedSha256 ? { expectedSha256: body.expectedSha256 } : {}),
        storageProfileId: storage.profileId,
        compatibilityProbeId: probe.id,
        profileConfigurationHash: storage.profileConfigurationHash,
        container: storage.container,
        objectKey: objectKey(
          scope.workspaceId,
          uploadSessionId,
          body.expectedMediaType,
        ),
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
        verificationProfileVersion: storage.verificationProfileVersion,
        now,
        expiresAt,
        cleanupEligibleAt: new Date(
          expiresAt.getTime() + storage.cleanupGraceMilliseconds,
        ),
      });
      if (session.state === "rejected" || session.state === "aborted") {
        throw new ConflictException(
          "The idempotent User Import allocation is already terminal.",
        );
      }
      return {
        uploadSessionId: session.id,
        state: session.state,
        expiresAt: session.expiresAt.toISOString(),
        maximumBytes:
          session.expectedSize ?? storage.maximumInputBytes.toString(),
        replayed: session.replayed,
      };
    } catch (error) {
      if (error instanceof StorageUploadStoreError) {
        translateStorageStoreError(error);
      }
      throw error;
    }
  }

  public async uploadUserImport(
    scope: TrustedWorkspaceScope,
    uploadSessionId: string,
    body: AsyncIterable<Uint8Array>,
  ): Promise<UserImportIngestion> {
    const storage = this.requireStorage();
    try {
      const session =
        await this.database.storageUploads.readUserImportUploadSession({
          authority: scope,
          uploadSessionId,
          now: new Date(),
        });
      return await storage.uploads.ingest({
        session,
        body,
      });
    } catch (error) {
      translateUploadError(error);
    }
  }

  public async adoptExternalFont(options: {
    readonly scope: TrustedWorkspaceScope;
    readonly idempotencyKey: string;
    readonly body: AsyncIterable<Uint8Array>;
    readonly byteSize: number;
    readonly sha256: string;
    readonly mediaType: "font/otf" | "font/ttf";
    readonly displayName: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly createAsset?: boolean;
    readonly requestId?: string;
  }): Promise<CommittedUserImport> {
    return this.adoptExternalTrustedFile({
      ...options,
      kind: "font",
    });
  }

  public async adoptExternalVector(options: {
    readonly scope: TrustedWorkspaceScope;
    readonly idempotencyKey: string;
    readonly body: AsyncIterable<Uint8Array>;
    readonly byteSize: number;
    readonly sha256: string;
    readonly mediaType: "image/svg+xml";
    readonly displayName: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly createAsset?: boolean;
    readonly requestId?: string;
  }): Promise<CommittedUserImport> {
    return this.adoptExternalTrustedFile({
      ...options,
      kind: "vector",
    });
  }

  private async adoptExternalTrustedFile(options: {
    readonly scope: TrustedWorkspaceScope;
    readonly idempotencyKey: string;
    readonly body: AsyncIterable<Uint8Array>;
    readonly byteSize: number;
    readonly sha256: string;
    readonly mediaType: "font/otf" | "font/ttf" | "image/svg+xml";
    readonly displayName: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly createAsset?: boolean;
    readonly requestId?: string;
    readonly kind: "font" | "vector";
  }): Promise<CommittedUserImport> {
    const storage = this.requireStorage();
    if (
      !Number.isSafeInteger(options.byteSize) ||
      options.byteSize < 1 ||
      options.byteSize > storage.maximumInputBytes
    ) {
      throw new PayloadTooLargeException(
        "External file exceeds the configured storage limit.",
      );
    }
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + storage.userImportSessionTtlMilliseconds,
    );
    const uploadSessionId = nextUlid();
    const probe = await storage.ensureCompatibilityProbe(
      options.scope.workspaceId,
      nextUlid(),
      now,
    );
    const session = await this.database.storageUploads.allocateUploadSession({
      id: uploadSessionId,
      workspaceId: options.scope.workspaceId,
      actorId: options.scope.principalId,
      authority: options.scope,
      allocationRequestKey: externalFileAllocationRequestKey(
        options.scope,
        options.idempotencyKey,
        options.kind,
      ),
      allocationRequestHash: canonicalDigest.of({
        contract: `kanvas.external-${options.kind}-allocation.v1`,
        workspaceId: options.scope.workspaceId,
        principalId: options.scope.principalId,
        byteSize: options.byteSize,
        sha256: options.sha256,
        mediaType: options.mediaType,
      }),
      purpose: "user_import",
      expectedSize: String(options.byteSize),
      expectedMediaType: options.mediaType,
      expectedSha256: options.sha256,
      storageProfileId: storage.profileId,
      compatibilityProbeId: probe.id,
      profileConfigurationHash: storage.profileConfigurationHash,
      container: storage.container,
      objectKey: externalFileObjectKey(
        options.scope.workspaceId,
        uploadSessionId,
        options.mediaType,
      ),
      uploadMode: "server_stream",
      writeProtectionMode: "server_owned",
      verificationProfileVersion:
        options.kind === "font" ? "trusted-font-sfnt-v1" : "trusted-svg-v1",
      now,
      expiresAt,
      cleanupEligibleAt: new Date(
        expiresAt.getTime() + storage.cleanupGraceMilliseconds,
      ),
    });
    if (session.state !== "committed") {
      await (
        options.kind === "font" ? storage.fontUploads : storage.vectorUploads
      ).ingest({ session, body: options.body });
    }
    return this.commitUserImport(
      options.scope,
      session.id,
      {
        artifactType: options.kind === "font" ? "font.source" : "vector.source",
        dataClassification: "internal",
        displayFilename: options.displayName,
        metadata: options.metadata,
        ...(options.createAsset === false
          ? {}
          : {
              asset: {
                name: options.displayName,
                assetType:
                  options.kind === "font" ? "font.source" : "vector.source",
              },
            }),
      },
      options.requestId,
    );
  }

  public async commitUserImport(
    scope: TrustedWorkspaceScope,
    uploadSessionId: string,
    body: CommitUserImportBody,
    requestId?: string,
  ): Promise<CommittedUserImport> {
    try {
      const result = await this.database.contentTransfers.commitUserImport({
        authority: scope,
        uploadSessionId,
        storedObjectId: nextUlid(),
        artifactId: nextUlid(),
        outboxEventId: nextUlid(),
        artifactType: body.artifactType,
        dataClassification: body.dataClassification,
        ...(body.displayFilename
          ? { displayFilename: body.displayFilename }
          : {}),
        metadata: body.metadata ?? {},
        ...(body.asset
          ? {
              asset: {
                assetId: nextUlid(),
                name: body.asset.name,
                assetType: body.asset.assetType,
              },
            }
          : {}),
        audit: {
          auditEventId: nextUlid(),
          authenticationRefHash: authenticationReferenceHash(
            scope.authenticationRefId,
          ),
          ...(requestId ? { requestId } : {}),
        },
        now: new Date(),
      });
      return {
        ...result,
        committedAt: result.committedAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof ContentTransferStoreError) {
        translateContentTransferError(error);
      }
      throw error;
    }
  }

  public async prepareArtifactDownload(
    scope: TrustedWorkspaceScope,
    artifactId: string,
    rangeHeader: string | undefined,
    requestId?: string,
  ): Promise<PreparedArtifactDownload> {
    const storage = this.requireStorage();
    const decisionId = nextUlid();
    const auditEventId = nextUlid();
    const authenticationRefHash = authenticationReferenceHash(
      scope.authenticationRefId,
    );
    const coordinator = createArtifactDownloadCoordinator({
      store: this.database.storageUploads,
      profiles: storage.profiles,
      authorization: {
        authorize: async (request) => {
          if (
            request.principalId !== scope.principalId ||
            request.workspaceId !== scope.workspaceId ||
            request.artifactId !== artifactId
          ) {
            return {
              decision: "deny",
              disclosure: "not_found",
              reasonCode: "request_binding_mismatch",
            };
          }
          return this.database.contentTransfers.authorizeArtifactDownload({
            authority: scope,
            artifactId,
            purpose: request.purpose,
            decisionId,
            audit: {
              auditEventId,
              authenticationRefHash,
              ...(requestId ? { requestId } : {}),
            },
            now: request.now,
            validUntil: new Date(request.now.getTime() + 30_000),
          });
        },
        revalidate: (decision, now) =>
          this.database.contentTransfers.revalidateArtifactDownload({
            authority: scope,
            decision,
            now,
          }),
      },
    });
    try {
      return await coordinator.prepare({
        principalId: scope.principalId,
        workspaceId: scope.workspaceId,
        artifactId,
        purpose: "artifact-content",
        ...(rangeHeader ? { rangeHeader } : {}),
      });
    } catch (error) {
      if (error instanceof ArtifactDownloadError) {
        translateDownloadError(error);
      }
      throw error;
    }
  }

  private requireStorage(): ServerStorageRuntime {
    if (!this.storage) {
      throw new ServiceUnavailableException(
        "Server-owned content storage is not configured.",
      );
    }
    return this.storage;
  }
}
