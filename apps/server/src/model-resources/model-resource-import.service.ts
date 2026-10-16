import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  ModelResourceImportIngestion,
  ModelResourceImportSummary,
  ModelResourceMutationResult,
  PublishModelResourceImportBody,
  StartModelResourceImportBody,
} from "@kanvas/contracts/api";
import {
  assertBoundedCapabilityJsonSchema,
  CapabilityMappingError,
} from "@kanvas/contracts/capability";
import {
  digestProviderValue,
  ModelResourceAdminStoreError,
  ModelResourceImportStoreError,
  StorageUploadStoreError,
  type ControlPlaneAuditContext,
} from "@kanvas/database/runtime";
import { ServerStreamUploadError } from "@kanvas/storage";
import { monotonicFactory } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { canonicalDigest } from "../application-adapters.js";
import type { ServerStorageRuntime } from "../storage/server-storage-runtime.js";
import { DATABASE_RUNTIME, SERVER_STORAGE_RUNTIME } from "../tokens.js";
import {
  ModelResourceValidationError,
  validateModelResourcePublication,
  verifyModelResourceStorage,
} from "../http/model-resource-validation.js";
import {
  modelResourceImportSummaryFrom,
  modelResourceMutationFrom,
} from "./model-resource-presenter.js";

const nextUlid = monotonicFactory();
const temporarySignatureKeys = new Set([
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "signature",
  "token",
]);

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:model-resource-import-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function auditFor(
  scope: TrustedWorkspaceScope,
  requestId: string | undefined,
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId: nextUlid(),
    actorPrincipalId: scope.principalId,
    actorType: scope.principalType,
    authenticationRefType: scope.authenticationRefType,
    authenticationRefHash: authenticationReferenceHash(
      scope.authenticationRefId,
    ),
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    ...(requestId ? { requestId } : {}),
  });
}

function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException("A valid Idempotency-Key is required.");
  }
  return normalized;
}

function stableHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException("Model resource URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    [...parsed.searchParams.keys()].some((key) =>
      temporarySignatureKeys.has(key.toLowerCase()),
    )
  ) {
    throw new BadRequestException(
      "Use a stable HTTPS model URL without credentials or temporary signatures.",
    );
  }
  return parsed.toString();
}

function safeFileName(value: string): string {
  const name = value.split(/[\\/]/u).at(-1)?.trim() ?? "";
  const controlCharacter = [...name].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
  if (!name || name === "." || name === ".." || controlCharacter) {
    throw new BadRequestException("Model resource file name is invalid.");
  }
  return name;
}

function allocationRequestKey(
  scope: TrustedWorkspaceScope,
  idempotencyKey: string,
): string {
  return `model-import:v1:${createHash("sha256")
    .update("kanvas:model-resource-import-allocation:v1\0")
    .update(scope.workspaceId)
    .update("\0")
    .update(scope.principalId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")}`;
}

function objectKey(workspaceId: string, allocationKey: string): string {
  return [
    "workspaces",
    workspaceId,
    "model-resources",
    "imports",
    allocationKey.slice(-64),
  ].join("/");
}

function mapError(error: unknown): never {
  if (
    error instanceof ModelResourceValidationError ||
    error instanceof CapabilityMappingError
  ) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof ModelResourceAdminStoreError) {
    if (error.code === "model_resource.not_found") {
      throw new NotFoundException(error.message);
    }
    if (
      error.code === "model_resource.version_conflict" ||
      error.code === "model_resource.lifecycle_conflict"
    ) {
      throw new ConflictException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  if (error instanceof ModelResourceImportStoreError) {
    if (error.code === "model_resource_import.not_found") {
      throw new NotFoundException(error.message);
    }
    if (
      error.code === "model_resource_import.idempotency_conflict" ||
      error.code === "model_resource_import.state_conflict" ||
      error.code === "model_resource_import.lease_conflict"
    ) {
      throw new ConflictException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  if (error instanceof StorageUploadStoreError) {
    if (
      error.code === "storage_upload.not_found" ||
      error.code === "storage_upload.access_denied"
    ) {
      throw new NotFoundException("Model resource upload was not found.");
    }
    if (error.code === "storage_upload.compatibility_not_certified") {
      throw new ServiceUnavailableException(
        "Model storage is not available on this deployment.",
      );
    }
    throw new ConflictException(error.message);
  }
  if (error instanceof ServerStreamUploadError) {
    if (error.code === "server_stream_upload.verification_rejected") {
      throw new PayloadTooLargeException(error.message);
    }
    if (
      error.code === "server_stream_upload.profile_unavailable" ||
      error.code === "server_stream_upload.object_unavailable"
    ) {
      throw new ServiceUnavailableException(error.message);
    }
    throw new ConflictException(error.message);
  }
  throw error;
}

@Injectable()
export class ModelResourceImportService {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_STORAGE_RUNTIME)
    private readonly storage: ServerStorageRuntime | undefined,
  ) {}

  private requireStorage(): ServerStorageRuntime {
    if (!this.storage) {
      throw new ServiceUnavailableException(
        "Model storage is not configured for this deployment.",
      );
    }
    return this.storage;
  }

  public async start(
    scope: TrustedWorkspaceScope,
    idempotencyKeyValue: string,
    body: StartModelResourceImportBody,
    requestId?: string,
  ): Promise<ModelResourceImportSummary> {
    const storage = this.requireStorage();
    const idempotencyKey = requireIdempotencyKey(idempotencyKeyValue);
    const catalogEntry =
      body.source.kind === "catalog"
        ? await this.database.modelResources.getCatalogEntry(
            scope,
            body.source.catalogEntryId,
            new Date(),
          )
        : undefined;
    if (body.source.kind === "catalog" && !catalogEntry) {
      throw new NotFoundException(
        "Model resource recommendation was not found.",
      );
    }
    let source:
      | Readonly<{ kind: "https"; url: string }>
      | Readonly<{ kind: "upload"; fileName: string }>;
    if (body.source.kind === "url") {
      source = { kind: "https", url: stableHttpsUrl(body.source.url) };
    } else if (body.source.kind === "catalog") {
      source = {
        kind: "https",
        url: stableHttpsUrl(catalogEntry!.document.sourceUrl),
      };
    } else {
      source = {
        kind: "upload",
        fileName: safeFileName(body.source.fileName),
      };
    }
    const sourceKind = body.source.kind === "upload" ? "upload" : "url";
    const expectedSha256 = catalogEntry?.document.expectedSha256.slice(
      "sha256:".length,
    );
    const expectedByteSize = catalogEntry?.document.expectedByteSize;
    const requestHash = canonicalDigest.of({
      contract: "kanvas.model-resource-import.start.v1",
      workspaceId: scope.workspaceId,
      principalId: scope.principalId,
      source,
      catalogEntryDigest: catalogEntry?.canonicalDigest ?? null,
    });
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + storage.modelResourceImportSessionTtlMilliseconds,
    );
    const importId = nextUlid();
    const probe = await storage.ensureCompatibilityProbe(
      scope.workspaceId,
      nextUlid(),
      now,
    );
    const allocationKey = allocationRequestKey(scope, idempotencyKey);
    try {
      const session = await this.database.storageUploads.allocateUploadSession({
        id: nextUlid(),
        workspaceId: scope.workspaceId,
        actorId: scope.principalId,
        authority: scope,
        allocationRequestKey: allocationKey,
        allocationRequestHash: requestHash,
        purpose: "model_resource",
        storageProfileId: storage.profileId,
        compatibilityProbeId: probe.id,
        profileConfigurationHash: storage.profileConfigurationHash,
        container: storage.container,
        objectKey: objectKey(scope.workspaceId, allocationKey),
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
        verificationProfileVersion: "model-resource-opaque-v1",
        ...(expectedSha256 ? { expectedSha256 } : {}),
        ...(expectedByteSize ? { expectedSize: expectedByteSize } : {}),
        now,
        expiresAt,
        cleanupEligibleAt: new Date(
          expiresAt.getTime() + storage.cleanupGraceMilliseconds,
        ),
      });
      const started = await this.database.modelResourceImports.start({
        scope,
        importId,
        uploadSessionId: session.id,
        idempotencyKey,
        requestHash,
        sourceKind,
        source,
        ...(catalogEntry
          ? {
              catalogEntryId: catalogEntry.id,
              expectedSha256: expectedSha256!,
              ...(expectedByteSize ? { expectedByteSize } : {}),
            }
          : {}),
        now,
        audit: auditFor(scope, requestId),
      });
      return modelResourceImportSummaryFrom(
        started.value,
        storage.modelResourceMaximumInputBytes,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async get(
    scope: TrustedWorkspaceScope,
    importId: string,
  ): Promise<ModelResourceImportSummary> {
    const storage = this.requireStorage();
    try {
      const record = await this.database.modelResourceImports.read({
        scope,
        importId,
        now: new Date(),
      });
      return modelResourceImportSummaryFrom(
        record,
        storage.modelResourceMaximumInputBytes,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async cancel(
    scope: TrustedWorkspaceScope,
    importId: string,
    requestId?: string,
  ): Promise<ModelResourceImportSummary> {
    const storage = this.requireStorage();
    try {
      const record =
        await this.database.modelResourceImports.requestCancellation({
          scope,
          importId,
          now: new Date(),
          audit: auditFor(scope, requestId),
        });
      return modelResourceImportSummaryFrom(
        record,
        storage.modelResourceMaximumInputBytes,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async upload(
    scope: TrustedWorkspaceScope,
    importId: string,
    body: AsyncIterable<Uint8Array>,
  ): Promise<ModelResourceImportIngestion> {
    const storage = this.requireStorage();
    const now = new Date();
    try {
      const target = await this.database.modelResourceImports.readForUpload({
        scope,
        importId,
        now,
      });
      const session =
        await this.database.storageUploads.readModelResourceUploadSession({
          authority: scope,
          uploadSessionId: target.uploadSessionId,
          now,
        });
      await storage.modelUploads.ingest({ session, body });
      const record =
        target.record.files.length > 0
          ? target.record
          : await this.database.modelResourceImports.commitUploaded({
              scope,
              importId,
              storedObjectId: nextUlid(),
              path:
                target.record.source.kind === "upload"
                  ? target.record.source.fileName
                  : "model.bin",
              sourceMetadata: target.record.source,
              now: new Date(),
            });
      return {
        id: record.id,
        status:
          record.status === "waiting_upload" ||
          record.status === "fetching" ||
          record.status === "cancelled"
            ? "analyzing"
            : record.status,
        version: record.version,
      };
    } catch (error) {
      return mapError(error);
    }
  }

  public async publish(
    scope: TrustedWorkspaceScope,
    importId: string,
    idempotencyKeyValue: string,
    body: PublishModelResourceImportBody,
    requestId?: string,
  ): Promise<ModelResourceMutationResult> {
    const storage = this.requireStorage();
    const idempotencyKey = requireIdempotencyKey(idempotencyKeyValue);
    try {
      if (body.nativeInterface) {
        assertBoundedCapabilityJsonSchema(body.nativeInterface.inputSchema);
        assertBoundedCapabilityJsonSchema(body.nativeInterface.outputSchema);
      }
      const now = new Date();
      const imported = await this.database.modelResourceImports.read({
        scope,
        importId,
        now,
      });
      if (imported.status === "published") {
        const published = (
          await this.database.modelResources.list(scope, now)
        ).find(
          (resource) =>
            resource.revisionId === imported.publishedModelResourceRevisionId,
        );
        if (!published) {
          throw new ConflictException(
            "Published model revision is no longer the current resource revision.",
          );
        }
        await this.database.capabilityInstallations.resumeForModelResourceImport(
          {
            scope,
            modelResourceImportId: importId,
            now,
            nextId: nextUlid,
            nextAudit: () => auditFor(scope, requestId),
          },
        );
        return modelResourceMutationFrom({ value: published, replayed: true });
      }
      if (imported.version !== body.expectedVersion) {
        throw new ConflictException("Model import changed before publication.");
      }
      const primary = imported.files[0];
      if (!primary) {
        throw new ConflictException(
          "Model import has no verified file to publish.",
        );
      }
      const target = body.target;
      const catalog = imported.catalogDocument;
      let key: string;
      if (target.kind === "new") {
        key = target.key;
      } else {
        const current = (
          await this.database.modelResources.list(scope, now)
        ).find((resource) => resource.id === target.modelResourceId);
        if (!current) {
          throw new NotFoundException("Model resource was not found.");
        }
        key = current.key;
      }
      if (
        catalog &&
        (key !== catalog.resourceKey ||
          body.format !== catalog.format ||
          body.license.spdxId !== catalog.license.spdxId ||
          !body.nativeInterface ||
          JSON.stringify(body.nativeInterface) !==
            JSON.stringify(catalog.nativeInterface))
      ) {
        throw new ConflictException(
          "Published fields must match the selected Catalog model release.",
        );
      }
      if (
        imported.nativeInterface &&
        (!body.nativeInterface ||
          digestProviderValue(body.nativeInterface) !==
            digestProviderValue(imported.nativeInterface))
      ) {
        throw new ConflictException(
          "Published interface must match the analyzed model interface.",
        );
      }
      const keyParts = key.split(/[._-]/u).filter(Boolean);
      const variant = catalog?.variant ?? keyParts.at(-1) ?? "model";
      const family =
        catalog?.family ?? (keyParts.slice(0, -1).join("-") || "model");
      const executionTargets = catalog
        ? [...catalog.executionTargets].toSorted()
        : [
            ...new Set(
              (
                await this.database.modelResourceImports.listPublishedRuntimeAdapters(
                  scope.workspaceId,
                )
              ).flatMap((adapter) =>
                adapter.document.sourceKinds.includes("model_resource") &&
                adapter.document.supportedModelFormats.includes(body.format) &&
                body.nativeInterface &&
                adapter.document.modelResourceInterfaceDigest ===
                  digestProviderValue(body.nativeInterface) &&
                (adapter.document.executionTarget === "browser" ||
                  adapter.document.executionTarget === "worker")
                  ? [adapter.document.executionTarget]
                  : [],
              ),
            ),
          ].toSorted();
      const publication = validateModelResourcePublication(
        await verifyModelResourceStorage(
          {
            key,
            displayName: body.displayName,
            ...(body.description ? { description: body.description } : {}),
            manifest: {
              schemaVersion: "kanvas.model-resource/v1",
              family,
              variant,
              format: body.format,
              executionTargets,
              sha256: `sha256:${primary.sha256}`,
              ...(!catalog || catalog.expectedByteSize
                ? { byteSize: primary.byteSize }
                : {}),
              mediaType: primary.mediaType,
              license: {
                spdxId: body.license.spdxId,
                ...(body.license.sourceUrl
                  ? { sourceUrl: body.license.sourceUrl }
                  : {}),
              },
              source: imported.source,
              ...(body.nativeInterface
                ? { nativeInterface: body.nativeInterface }
                : {}),
              runtime: {},
            },
          },
          primary,
          storage.profiles,
        ),
      );
      if (catalog && publication.revisionDigest !== catalog.revisionDigest) {
        throw new ConflictException(
          "Published model identity does not match the selected Catalog release.",
        );
      }
      const resourceId =
        target.kind === "new" ? nextUlid() : target.modelResourceId;
      const revisionId = nextUlid();
      const finalized =
        await this.database.modelResourceImports.finalizePublished({
          scope,
          importId,
          expectedVersion: body.expectedVersion,
          resourceId,
          revisionId,
          target:
            target.kind === "new"
              ? {
                  kind: "new",
                  key,
                  ...(catalog ? { revision: catalog.revision } : {}),
                }
              : {
                  kind: "new_revision",
                  expectedResourceVersion: target.expectedResourceVersion,
                  key,
                },
          displayName: publication.displayName,
          ...(publication.description
            ? { description: publication.description }
            : {}),
          manifest: publication.manifest,
          revisionDigest: publication.revisionDigest,
          idempotencyKey,
          requestHash: publication.publicationDigest,
          audit: auditFor(scope, requestId),
          now,
        });
      const published = (
        await this.database.modelResources.list(scope, now)
      ).find(
        (resource) =>
          resource.id === finalized.resourceId &&
          resource.revisionId === finalized.revisionId,
      );
      if (!published) {
        throw new ConflictException(
          "Published model resource could not be read back.",
        );
      }
      await this.database.capabilityInstallations.resumeForModelResourceImport({
        scope,
        modelResourceImportId: importId,
        now,
        nextId: nextUlid,
        nextAudit: () => auditFor(scope, requestId),
      });
      return modelResourceMutationFrom({
        value: published,
        replayed: finalized.replayed,
      });
    } catch (error) {
      return mapError(error);
    }
  }
}
