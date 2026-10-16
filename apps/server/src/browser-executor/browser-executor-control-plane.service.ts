import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  BrowserAttemptGrantError,
  type BrowserAttemptGrantDerivation,
  type StorageReadHandle,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  parseRuntimeAdapterDefinitionRevision,
  resolveAttemptOutputArtifactReferences,
} from "@kanvas/contracts/capability";
import type {
  AtomicAttemptCompletionStoreError,
  BrowserModelRuntimeCandidate,
  BrowserControlPlaneStoreError,
  BrowserHumanAuthorityFacts,
} from "@kanvas/database/runtime";
import {
  AtomicAttemptCompletionStoreError as AtomicCompletionError,
  BrowserControlPlaneStoreError as BrowserStoreError,
  StorageUploadStoreError as StorageStoreError,
} from "@kanvas/database/runtime";
import type {
  AcknowledgeBrowserAttemptCancellationBody,
  AllocateBrowserAttemptOutputBody,
  BrowserAttemptCancellationAcknowledgement,
  BrowserAttemptCompletionResponse,
  BrowserAttemptHeartbeatResponse,
  BrowserAttemptOutputIngestion,
  BrowserAttemptOutputUploadSession,
  BrowserExecutorSessionTransition,
  BrowserRuntimeCapability,
  BrowserRuntimeManifest,
  ClaimBrowserAttemptResponse,
  CompleteBrowserAttemptBody,
  HeartbeatBrowserAttemptBody,
  RegisterBrowserExecutorBody,
  RegisteredBrowserExecutor,
} from "@kanvas/contracts/api";
import {
  LocalFilesystemStorageError,
  S3CompatibleStorageError,
  ServerStreamUploadError,
} from "@kanvas/storage";
import { monotonicFactory } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { canonicalDigest } from "../application-adapters.js";
import type { ServerConfig } from "../config.js";
import { createNodeBrowserAttemptGrantCodec } from "../security/browser-attempt-grant-crypto.js";
import type { ServerStorageRuntime } from "../storage/server-storage-runtime.js";
import {
  DATABASE_RUNTIME,
  SERVER_CONFIG,
  SERVER_STORAGE_RUNTIME,
} from "../tokens.js";

const nextUlid = monotonicFactory();
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

export interface PreparedBrowserModelResource {
  readonly headers: Readonly<{
    "cache-control": string;
    "content-length": string;
    "content-type": string;
    etag: string;
    "x-content-type-options": "nosniff";
  }>;
  readonly body: StorageReadHandle["body"];
}

type BrowserModelCandidate = BrowserModelRuntimeCandidate &
  Required<
    Pick<
      BrowserModelRuntimeCandidate,
      | "manifest"
      | "modelResourceRevisionDigest"
      | "modelResourceRevisionId"
      | "storage"
    >
  >;

function hasModel(
  candidate: BrowserModelRuntimeCandidate,
): candidate is BrowserModelCandidate {
  return Boolean(
    candidate.manifest &&
    candidate.modelResourceRevisionId &&
    candidate.modelResourceRevisionDigest &&
    candidate.storage,
  );
}

function browserModelUrl(candidate: BrowserModelCandidate): string | undefined {
  if (
    (candidate.manifest.byteSize === undefined ||
      candidate.manifest.byteSize === candidate.storage.byteSize) &&
    candidate.manifest.sha256 === `sha256:${candidate.storage.sha256}`
  ) {
    return `/api/v1/model-resource-revisions/${encodeURIComponent(candidate.modelResourceRevisionId)}/content`;
  }
  return undefined;
}

function browserRuntimeCapability(
  candidate: BrowserModelRuntimeCandidate,
  runtimeReleaseDigest: string,
): BrowserRuntimeCapability | undefined {
  let adapter;
  try {
    adapter = parseRuntimeAdapterDefinitionRevision(candidate.runtimeAdapter);
  } catch {
    throw new ServiceUnavailableException(
      "The active Browser Runtime Adapter revision is invalid.",
    );
  }
  const profile = adapter.runtimeProfile;
  const runtimeRole = profile?.settings?.role;
  const backend = profile?.settings?.backend;
  if (!profile) return undefined;
  if (
    adapter.adapterKey !== candidate.adapterKey ||
    adapter.executionTarget !== "browser" ||
    typeof runtimeRole !== "string" ||
    !/^[a-z][a-z0-9_]{0,79}$/u.test(runtimeRole) ||
    (backend !== "javascript" && backend !== "wasm" && backend !== "webgpu")
  ) {
    throw new ServiceUnavailableException(
      "The active Browser Runtime Adapter profile is invalid.",
    );
  }
  let modelResource: BrowserRuntimeCapability["modelResource"];
  if (candidate.sourceKind === "model_resource") {
    if (
      !hasModel(candidate) ||
      !adapter.sourceKinds.includes("model_resource") ||
      !adapter.supportedModelFormats.includes(candidate.manifest.format) ||
      !candidate.manifest.executionTargets.includes("browser")
    ) {
      throw new ServiceUnavailableException(
        "The active Browser model resource is not compatible with its Runtime Adapter.",
      );
    }
    const contentUrl = browserModelUrl(candidate);
    if (!contentUrl) {
      throw new ServiceUnavailableException(
        "The active Browser model resource cannot be opened safely.",
      );
    }
    modelResource = Object.freeze({
      revisionId: candidate.modelResourceRevisionId,
      revisionDigest: candidate.modelResourceRevisionDigest,
      contentUrl,
      contentDigest: candidate.manifest.sha256,
      format: candidate.manifest.format,
      family: candidate.manifest.family,
      variant: candidate.manifest.variant,
    });
  }
  return Object.freeze({
    capabilityKey: candidate.capabilityKey,
    implementationRevisionId: candidate.implementationRevisionId,
    implementationDigest: candidate.implementationDigest,
    runtimeAdapterRevisionId: candidate.runtimeAdapterRevisionId,
    runtimeAdapterRevisionDigest: candidate.runtimeAdapterRevisionDigest,
    adapterKey: candidate.adapterKey,
    runtimeRole,
    runtimeProfileKind: profile.kind,
    runtimeProfileVersion: profile.version,
    runtimeProfileSettings: profile.settings ?? {},
    implementationConfiguration: candidate.implementationConfiguration,
    ...(modelResource ? { modelResource } : {}),
    backend,
    probeProfileVersion: 1,
    probeResultDigest: canonicalDigest.of({
      schemaVersion: 1,
      runtimeReleaseDigest,
      implementationRevisionId: candidate.implementationRevisionId,
      implementationDigest: candidate.implementationDigest,
      runtimeAdapterRevisionId: candidate.runtimeAdapterRevisionId,
      runtimeAdapterRevisionDigest: candidate.runtimeAdapterRevisionDigest,
      ...(candidate.modelResourceRevisionId
        ? {
            modelResourceRevisionId: candidate.modelResourceRevisionId,
            modelResourceRevisionDigest: candidate.modelResourceRevisionDigest,
          }
        : {}),
    }),
  });
}

function authenticationReferenceHash(authenticationRefId: string): string {
  return createHash("sha256")
    .update("kanvas:browser-executor-authentication-ref:v1\0")
    .update(authenticationRefId)
    .digest("hex");
}

function humanAuthority(
  scope: TrustedWorkspaceScope,
): BrowserHumanAuthorityFacts {
  if (
    scope.principalType !== "human" ||
    scope.authenticationRefType !== "session" ||
    scope.authorityType !== "human_membership"
  ) {
    throw new ForbiddenException(
      "Browser executors require an interactive human workspace session.",
    );
  }
  return Object.freeze({
    workspaceId: scope.workspaceId,
    createdByPrincipalId: scope.principalId,
    authenticationRefHash: authenticationReferenceHash(
      scope.authenticationRefId,
    ),
    authorityVersion: scope.authorityVersion,
  });
}

function manifestDigest(body: RegisterBrowserExecutorBody): string {
  return canonicalDigest.of({
    capabilityManifestVersion: body.capabilityManifestVersion,
    capabilities: [...body.capabilities].sort((left, right) =>
      left.implementationRevisionId.localeCompare(
        right.implementationRevisionId,
      ),
    ),
  });
}

function requireUlid(value: string | undefined, label: string): string {
  if (!value || !ulidPattern.test(value)) {
    throw new BadRequestException(
      `${label} must be a canonical uppercase ULID.`,
    );
  }
  return value;
}

function translateStoreError(error: BrowserControlPlaneStoreError): never {
  if (error.code === "browser_control.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (
    error.code === "browser_control.claiming_disabled" ||
    error.code === "browser_control.runtime_fenced"
  ) {
    throw new ServiceUnavailableException(error.message);
  }
  if (error.code === "browser_control.authority_mismatch") {
    throw new NotFoundException("Browser executor session was not found.");
  }
  throw new ConflictException(error.message);
}

function translateCompletionError(
  error: AtomicAttemptCompletionStoreError,
): never {
  if (error.code === "attempt_completion.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (error.code === "attempt_completion.runtime_fenced") {
    throw new ServiceUnavailableException(error.message);
  }
  throw new ConflictException(error.message);
}

function translateStorageStoreError(error: StorageStoreError): never {
  if (error.code === "storage_upload.invalid_argument") {
    throw new BadRequestException(error.message);
  }
  if (
    error.code === "storage_upload.not_found" ||
    error.code === "storage_upload.access_denied"
  ) {
    throw new NotFoundException("Output upload session was not found.");
  }
  if (error.code === "storage_upload.compatibility_not_certified") {
    throw new ServiceUnavailableException(
      "The configured storage profile is not currently certified.",
    );
  }
  throw new ConflictException(error.message);
}

function translateUploadError(error: unknown): never {
  if (error instanceof StorageStoreError) {
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

function allocationRequestKey(
  assignmentId: string,
  idempotencyKey: string,
): string {
  const hash = createHash("sha256")
    .update("kanvas:browser-output-allocation-key:v1\0")
    .update(assignmentId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex");
  return `browser-output:v1:${hash}`;
}

function objectKey(
  workspaceId: string,
  attemptId: string,
  uploadSessionId: string,
): string {
  return [
    "workspaces",
    workspaceId,
    "attempts",
    attemptId,
    "uploads",
    uploadSessionId,
  ].join("/");
}

@Injectable()
export class BrowserExecutorControlPlaneService {
  readonly #grantCodec = createNodeBrowserAttemptGrantCodec();

  public constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_STORAGE_RUNTIME)
    private readonly storage: ServerStorageRuntime | undefined = undefined,
  ) {}

  public async runtimeManifest(
    scope: TrustedWorkspaceScope,
  ): Promise<BrowserRuntimeManifest> {
    humanAuthority(scope);
    const browser = this.config.browserExecutor;
    if (
      !browser.enabled ||
      !browser.runtimeReleaseId ||
      !browser.runtimeReleaseDigest
    ) {
      throw new ServiceUnavailableException(
        "Browser execution is disabled for this deployment.",
      );
    }
    const candidates =
      await this.database.modelResources.listBrowserRuntimeCandidates(
        scope,
        new Date(),
      );
    const capabilities = candidates.flatMap((candidate) => {
      const projected = browserRuntimeCapability(
        candidate,
        browser.runtimeReleaseDigest!,
      );
      return projected ? [projected] : [];
    });
    return Object.freeze({
      schemaVersion: "kanvas.browser-runtime-manifest/v1",
      runtimeReleaseId: browser.runtimeReleaseId,
      runtimeReleaseDigest: browser.runtimeReleaseDigest,
      capabilities,
    });
  }

  public async openModelResource(
    scope: TrustedWorkspaceScope,
    modelResourceRevisionId: string,
  ): Promise<PreparedBrowserModelResource> {
    humanAuthority(scope);
    const candidate =
      await this.database.modelResources.getBrowserRuntimeCandidate(
        scope,
        requireUlid(modelResourceRevisionId, "modelResourceRevisionId"),
        new Date(),
      );
    if (
      !candidate ||
      !hasModel(candidate) ||
      (candidate.manifest.byteSize !== undefined &&
        candidate.manifest.byteSize !== candidate.storage.byteSize) ||
      candidate.manifest.sha256 !== `sha256:${candidate.storage.sha256}`
    ) {
      throw new NotFoundException("Browser model resource was not found.");
    }
    const stored = candidate.storage;
    const profile = this.storage?.profiles.resolve(stored.storageProfileId);
    if (
      !profile ||
      profile.adapter.storageProfileId !== stored.storageProfileId ||
      profile.kind !== profile.adapter.kind
    ) {
      throw new ServiceUnavailableException(
        "Browser model storage is unavailable.",
      );
    }
    let read: StorageReadHandle;
    try {
      read = await profile.adapter.openRead({
        identity: {
          storageProfileId: stored.storageProfileId,
          container: stored.container,
          objectKey: stored.objectKey,
          ...(stored.storageVersionId
            ? { storageVersionId: stored.storageVersionId }
            : {}),
        },
        expectedByteSize: stored.byteSize,
        expectedSha256: stored.sha256,
        expectedImmutableIdentityHash: stored.immutableIdentityHash,
      });
    } catch {
      throw new ServiceUnavailableException(
        "Browser model resource could not be opened safely.",
      );
    }
    return Object.freeze({
      headers: Object.freeze({
        "cache-control": "private, max-age=31536000, immutable",
        "content-length": read.contentByteSize,
        "content-type": candidate.manifest.mediaType,
        etag: `"${candidate.manifest.sha256}"`,
        "x-content-type-options": "nosniff" as const,
      }),
      body: read.body,
    });
  }

  public async register(
    scope: TrustedWorkspaceScope,
    body: RegisterBrowserExecutorBody,
  ): Promise<RegisteredBrowserExecutor> {
    const authority = humanAuthority(scope);
    const browser = this.config.browserExecutor;
    if (
      !browser.enabled ||
      !browser.runtimeReleaseId ||
      !browser.runtimeReleaseDigest
    ) {
      throw new ServiceUnavailableException(
        "Browser execution is disabled for this deployment.",
      );
    }
    if (
      body.controlPlaneVersion !== browser.controlPlaneVersion ||
      body.runtimeReleaseId !== browser.runtimeReleaseId ||
      body.runtimeReleaseDigest !== browser.runtimeReleaseDigest
    ) {
      throw new ConflictException(
        "Browser runtime release or control-plane version is not supported.",
      );
    }
    if (manifestDigest(body) !== body.capabilityManifestDigest) {
      throw new BadRequestException(
        "Capability manifest digest does not match its canonical declarations.",
      );
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + browser.sessionTtlSeconds * 1_000,
    );
    try {
      const registered =
        await this.database.browserControlPlane.registerExecutorSession({
          sessionId: nextUlid(),
          authority,
          runtimeReleaseId: body.runtimeReleaseId,
          runtimeReleaseDigest: body.runtimeReleaseDigest,
          capabilityManifestVersion: body.capabilityManifestVersion,
          capabilityManifestDigest: body.capabilityManifestDigest,
          capabilities: body.capabilities.map((capability) => ({
            id: nextUlid(),
            ...capability,
          })),
          now,
          expiresAt,
        });
      return {
        controlPlaneVersion: browser.controlPlaneVersion,
        sessionId: registered.sessionId,
        workspaceId: registered.workspaceId,
        state: registered.state,
        serverTime: now.toISOString(),
        expiresAt: registered.expiresAt.toISOString(),
        capabilityIds: [...registered.capabilityIds],
      };
    } catch (error) {
      if (error instanceof BrowserStoreError) {
        translateStoreError(error);
      }
      throw error;
    }
  }

  public async claim(
    scope: TrustedWorkspaceScope,
    sessionId: string,
    controlPlaneVersion: number,
  ): Promise<ClaimBrowserAttemptResponse> {
    const authority = humanAuthority(scope);
    const browser = this.config.browserExecutor;
    if (!browser.enabled) {
      throw new ServiceUnavailableException(
        "Browser execution is disabled for this deployment.",
      );
    }
    if (controlPlaneVersion !== browser.controlPlaneVersion) {
      throw new ConflictException(
        "Browser control-plane version is not supported.",
      );
    }
    const canonicalSessionId = requireUlid(
      sessionId,
      "browserExecutorSessionId",
    );
    const now = new Date();
    const runtime = await this.database.runtimeStateReader.read();
    const issuedGrant = this.#grantCodec.issue();
    try {
      const claimed = await this.database.browserControlPlane.claimNextAttempt({
        sessionId: canonicalSessionId,
        authority,
        assignmentId: nextUlid(),
        claimedEventId: nextUlid(),
        attemptGrantTokenHash: issuedGrant.attemptGrantTokenHash,
        domainLeaseTokenHash: issuedGrant.domainLeaseTokenHash,
        executionGeneration: runtime.executionGeneration,
        candidateLimit: browser.candidateLimit,
        now,
        leaseUntil: new Date(now.getTime() + browser.attemptLeaseDurationMs),
      });
      return {
        controlPlaneVersion: browser.controlPlaneVersion,
        serverTime: now.toISOString(),
        assignment: claimed
          ? {
              ...claimed,
              leaseExpiresAt: claimed.leaseExpiresAt.toISOString(),
              executionDeadlineAt: claimed.executionDeadlineAt.toISOString(),
              attemptGrant: issuedGrant.rawGrant,
            }
          : null,
      };
    } catch (error) {
      if (error instanceof BrowserStoreError) {
        translateStoreError(error);
      }
      throw error;
    }
  }

  public async heartbeat(
    workspaceId: string,
    sessionId: string,
    assignmentId: string,
    rawGrant: string,
    body: HeartbeatBrowserAttemptBody,
  ): Promise<BrowserAttemptHeartbeatResponse> {
    const canonicalWorkspaceId = requireUlid(
      workspaceId,
      "x-kanvas-workspace-id",
    );
    const canonicalSessionId = requireUlid(
      sessionId,
      "browserExecutorSessionId",
    );
    const canonicalAssignmentId = requireUlid(
      assignmentId,
      "browserAssignmentId",
    );
    const grant = this.deriveGrant(rawGrant);
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + this.config.browserExecutor.attemptLeaseDurationMs,
    );
    try {
      const result = await this.database.browserControlPlane.heartbeatAttempt({
        workspaceId: canonicalWorkspaceId,
        sessionId: canonicalSessionId,
        assignmentId: canonicalAssignmentId,
        attemptId: body.attemptId,
        attemptGrantTokenHash: grant.attemptGrantTokenHash,
        domainLeaseTokenHash: grant.domainLeaseTokenHash,
        attemptLeaseGeneration: body.leaseGeneration,
        executionGeneration: body.executionGeneration,
        transitionEventId: nextUlid(),
        now,
        leaseUntil: leaseExpiresAt,
      });
      return {
        result,
        serverTime: now.toISOString(),
        ...(result === "renewed"
          ? { leaseExpiresAt: leaseExpiresAt.toISOString() }
          : {}),
      };
    } catch (error) {
      if (error instanceof BrowserStoreError) {
        if (error.code === "browser_control.runtime_fenced") {
          return {
            result: "revoked",
            serverTime: now.toISOString(),
          };
        }
        translateStoreError(error);
      }
      throw error;
    }
  }

  public async allocateAttemptOutput(
    workspaceId: string,
    sessionId: string,
    assignmentId: string,
    rawGrant: string,
    idempotencyKey: string,
    body: AllocateBrowserAttemptOutputBody,
  ): Promise<BrowserAttemptOutputUploadSession> {
    if (
      body.controlPlaneVersion !==
      this.config.browserExecutor.controlPlaneVersion
    ) {
      throw new ConflictException(
        "Browser control-plane version is not supported.",
      );
    }
    const storage = this.requireStorage();
    if (
      body.expectedSize !== undefined &&
      BigInt(body.expectedSize) > BigInt(storage.maximumInputBytes)
    ) {
      throw new PayloadTooLargeException(
        "Expected output size exceeds the configured storage limit.",
      );
    }
    const authorization = await this.authorizeOutput(
      workspaceId,
      sessionId,
      assignmentId,
      rawGrant,
      body.attemptId,
      body.leaseGeneration,
      body.executionGeneration,
    );
    const now = new Date();
    const uploadSessionId = nextUlid();
    const probe = await storage.ensureCompatibilityProbe(
      authorization.workspaceId,
      nextUlid(),
      now,
    );
    const allocationHash = canonicalDigest.of({
      contract: "kanvas.browser-output-allocation.v1",
      workspaceId: authorization.workspaceId,
      browserExecutorSessionId: authorization.sessionId,
      browserAssignmentId: authorization.assignmentId,
      idempotencyKey,
      attemptId: body.attemptId,
      leaseGeneration: body.leaseGeneration,
      executionGeneration: body.executionGeneration,
      outputRole: body.outputRole,
      outputIndex: body.outputIndex,
      expectedSize: body.expectedSize,
      expectedMediaType: body.expectedMediaType,
      expectedSha256: body.expectedSha256,
    });
    try {
      const session = await this.database.storageUploads.allocateUploadSession({
        id: uploadSessionId,
        workspaceId: authorization.workspaceId,
        actorId: authorization.actorId,
        allocationRequestKey: allocationRequestKey(
          authorization.assignmentId,
          idempotencyKey,
        ),
        allocationRequestHash: allocationHash,
        purpose: "attempt_output",
        attemptId: body.attemptId,
        outputRole: body.outputRole,
        outputIndex: body.outputIndex,
        ...(body.expectedSize ? { expectedSize: body.expectedSize } : {}),
        expectedMediaType: body.expectedMediaType,
        ...(body.expectedSha256 ? { expectedSha256: body.expectedSha256 } : {}),
        storageProfileId: storage.profileId,
        compatibilityProbeId: probe.id,
        profileConfigurationHash: storage.profileConfigurationHash,
        container: storage.container,
        objectKey: objectKey(
          authorization.workspaceId,
          body.attemptId,
          uploadSessionId,
        ),
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
        verificationProfileVersion: storage.verificationProfileVersion,
        now,
        expiresAt: authorization.expiresAt,
        cleanupEligibleAt: new Date(
          authorization.expiresAt.getTime() + storage.cleanupGraceMilliseconds,
        ),
      });
      if (session.state === "rejected" || session.state === "aborted") {
        throw new ConflictException(
          "The idempotent output allocation is already terminal.",
        );
      }
      const maximumBytes =
        session.expectedSize ?? storage.maximumInputBytes.toString();
      return {
        uploadSessionId: session.id,
        state: session.state,
        expiresAt: session.expiresAt.toISOString(),
        maximumBytes,
        replayed: session.replayed,
      };
    } catch (error) {
      if (error instanceof StorageStoreError) {
        translateStorageStoreError(error);
      }
      throw error;
    }
  }

  public async uploadAttemptOutput(
    workspaceId: string,
    sessionId: string,
    assignmentId: string,
    uploadSessionId: string,
    rawGrant: string,
    attemptId: string,
    leaseGeneration: number,
    executionGeneration: number,
    outputRole: string,
    outputIndex: number,
    body: AsyncIterable<Uint8Array>,
  ): Promise<BrowserAttemptOutputIngestion> {
    const storage = this.requireStorage();
    const authorization = await this.authorizeOutput(
      workspaceId,
      sessionId,
      assignmentId,
      rawGrant,
      attemptId,
      leaseGeneration,
      executionGeneration,
    );
    const canonicalUploadSessionId = requireUlid(
      uploadSessionId,
      "uploadSessionId",
    );
    try {
      const session =
        await this.database.storageUploads.readAttemptOutputUploadSession({
          workspaceId: authorization.workspaceId,
          uploadSessionId: canonicalUploadSessionId,
          attemptId,
          outputRole,
          outputIndex,
        });
      if (
        session.actorId !== authorization.actorId ||
        session.storageProfileId !== storage.profileId ||
        session.profileConfigurationHash !== storage.profileConfigurationHash ||
        session.container !== storage.container
      ) {
        throw new NotFoundException("Output upload session was not found.");
      }
      return await storage.uploads.ingest({
        session,
        body,
      });
    } catch (error) {
      translateUploadError(error);
    }
  }

  public async complete(
    workspaceId: string,
    sessionId: string,
    assignmentId: string,
    rawGrant: string,
    body: CompleteBrowserAttemptBody,
  ): Promise<BrowserAttemptCompletionResponse> {
    const canonicalWorkspaceId = requireUlid(
      workspaceId,
      "x-kanvas-workspace-id",
    );
    const canonicalSessionId = requireUlid(
      sessionId,
      "browserExecutorSessionId",
    );
    const canonicalAssignmentId = requireUlid(
      assignmentId,
      "browserAssignmentId",
    );
    if (
      body.controlPlaneVersion !==
      this.config.browserExecutor.controlPlaneVersion
    ) {
      throw new ConflictException(
        "Browser control-plane version is not supported.",
      );
    }
    const grant = this.deriveGrant(rawGrant);
    const now = new Date();
    try {
      const outputs = body.outputs.map((output) => ({
        ...output,
        storedObjectId: nextUlid(),
        artifactId: nextUlid(),
        attemptOutputId: nextUlid(),
      }));
      const capabilityOutput =
        await this.database.browserControlPlane.mapAttemptOutput({
          workspaceId: canonicalWorkspaceId,
          implementationRevisionId: body.implementationRevisionId,
          implementationDigest: body.implementationDigest,
          adapterKey: body.adapterKey,
          adapterOutput: body.capabilityOutput,
        });
      const result = await this.database.atomicAttemptCompletions.complete({
        workspaceId: canonicalWorkspaceId,
        capabilityRunId: body.capabilityRunId,
        attemptId: body.attemptId,
        completionId: nextUlid(),
        terminalOutboxEventId: nextUlid(),
        executionGeneration: body.executionGeneration,
        target: {
          executionTarget: "browser",
          implementationRevisionId: body.implementationRevisionId,
          implementationDigest: body.implementationDigest,
          adapterKey: body.adapterKey,
          assignmentId: canonicalAssignmentId,
          sessionId: canonicalSessionId,
          completedAssignmentEventId: nextUlid(),
          attemptLeaseGeneration: body.leaseGeneration,
          attemptGrantTokenHash: grant.attemptGrantTokenHash,
          domainLeaseTokenHash: grant.domainLeaseTokenHash,
        },
        capabilityOutput: resolveAttemptOutputArtifactReferences(
          capabilityOutput,
          outputs,
        ),
        outputs,
        initialUsage: body.initialUsage.map((entry) => ({
          ...entry,
          id: nextUlid(),
          sourceKind: "producer_reported" as const,
          observedAt: new Date(entry.observedAt),
        })),
        now,
      });
      return {
        status: result.status,
        completionId: result.completionId,
        completionManifestHash: result.completionManifestHash,
        manifestSchemaVersion: result.manifestSchemaVersion,
        terminalOutboxEventId: result.terminalOutboxEventId,
        completedAt: result.completedAt.toISOString(),
        outputs: result.outputs.map((output) => ({ ...output })),
      };
    } catch (error) {
      if (error instanceof AtomicCompletionError) {
        translateCompletionError(error);
      }
      throw error;
    }
  }

  public async acknowledgeCancellation(
    workspaceId: string,
    sessionId: string,
    assignmentId: string,
    rawGrant: string,
    body: AcknowledgeBrowserAttemptCancellationBody,
  ): Promise<BrowserAttemptCancellationAcknowledgement> {
    const canonicalWorkspaceId = requireUlid(
      workspaceId,
      "x-kanvas-workspace-id",
    );
    const canonicalSessionId = requireUlid(
      sessionId,
      "browserExecutorSessionId",
    );
    const canonicalAssignmentId = requireUlid(
      assignmentId,
      "browserAssignmentId",
    );
    if (
      body.controlPlaneVersion !==
      this.config.browserExecutor.controlPlaneVersion
    ) {
      throw new ConflictException(
        "Browser control-plane version is not supported.",
      );
    }
    const grant = this.deriveGrant(rawGrant);
    const now = new Date();
    try {
      const result =
        await this.database.browserControlPlane.acknowledgeAttemptCancellation({
          workspaceId: canonicalWorkspaceId,
          sessionId: canonicalSessionId,
          assignmentId: canonicalAssignmentId,
          capabilityRunId: body.capabilityRunId,
          attemptId: body.attemptId,
          attemptGrantTokenHash: grant.attemptGrantTokenHash,
          domainLeaseTokenHash: grant.domainLeaseTokenHash,
          attemptLeaseGeneration: body.leaseGeneration,
          executionGeneration: body.executionGeneration,
          cancelledEventId: nextUlid(),
          terminalOutboxEventId: nextUlid(),
          now,
        });
      return {
        result,
        serverTime: now.toISOString(),
      };
    } catch (error) {
      if (error instanceof BrowserStoreError) {
        if (error.code === "browser_control.runtime_fenced") {
          return {
            result: "revoked",
            serverTime: now.toISOString(),
          };
        }
        translateStoreError(error);
      }
      throw error;
    }
  }

  public async drain(
    scope: TrustedWorkspaceScope,
    sessionId: string,
  ): Promise<BrowserExecutorSessionTransition> {
    return this.transition(scope, sessionId, "drain");
  }

  public async revoke(
    scope: TrustedWorkspaceScope,
    sessionId: string,
  ): Promise<BrowserExecutorSessionTransition> {
    return this.transition(scope, sessionId, "revoke");
  }

  private async transition(
    scope: TrustedWorkspaceScope,
    sessionId: string,
    action: "drain" | "revoke",
  ): Promise<BrowserExecutorSessionTransition> {
    const authority = humanAuthority(scope);
    const canonicalSessionId = requireUlid(
      sessionId,
      "browserExecutorSessionId",
    );
    const now = new Date();
    try {
      const result =
        action === "drain"
          ? await this.database.browserControlPlane.drainSession({
              sessionId: canonicalSessionId,
              authority,
              now,
            })
          : await this.database.browserControlPlane.revokeSession({
              sessionId: canonicalSessionId,
              authority,
              now,
            });
      return {
        ...result,
        serverTime: now.toISOString(),
      };
    } catch (error) {
      if (error instanceof BrowserStoreError) {
        translateStoreError(error);
      }
      throw error;
    }
  }

  private deriveGrant(rawGrant: string): BrowserAttemptGrantDerivation {
    try {
      return this.#grantCodec.derive(rawGrant);
    } catch (error) {
      if (error instanceof BrowserAttemptGrantError) {
        throw new UnauthorizedException("Browser attempt grant is invalid.");
      }
      throw error;
    }
  }

  private requireStorage(): ServerStorageRuntime {
    if (!this.storage) {
      throw new ServiceUnavailableException(
        "Server-owned output storage is not configured.",
      );
    }
    return this.storage;
  }

  private async authorizeOutput(
    workspaceId: string,
    sessionId: string,
    assignmentId: string,
    rawGrant: string,
    attemptId: string,
    leaseGeneration: number,
    executionGeneration: number,
  ): Promise<
    Readonly<{
      workspaceId: string;
      sessionId: string;
      assignmentId: string;
      actorId: string;
      expiresAt: Date;
    }>
  > {
    if (!this.config.browserExecutor.enabled) {
      throw new ServiceUnavailableException(
        "Browser execution is disabled for this deployment.",
      );
    }
    const canonicalWorkspaceId = requireUlid(
      workspaceId,
      "x-kanvas-workspace-id",
    );
    const canonicalSessionId = requireUlid(
      sessionId,
      "browserExecutorSessionId",
    );
    const canonicalAssignmentId = requireUlid(
      assignmentId,
      "browserAssignmentId",
    );
    const canonicalAttemptId = requireUlid(attemptId, "attemptId");
    const grant = this.deriveGrant(rawGrant);
    try {
      const result =
        await this.database.browserControlPlane.authorizeAttemptOutput({
          workspaceId: canonicalWorkspaceId,
          sessionId: canonicalSessionId,
          assignmentId: canonicalAssignmentId,
          attemptId: canonicalAttemptId,
          attemptGrantTokenHash: grant.attemptGrantTokenHash,
          domainLeaseTokenHash: grant.domainLeaseTokenHash,
          attemptLeaseGeneration: leaseGeneration,
          executionGeneration,
          now: new Date(),
        });
      if (result.status === "cancel_requested") {
        throw new ConflictException(
          "Browser attempt cancellation has been requested.",
        );
      }
      if (result.status !== "authorized") {
        throw new UnauthorizedException(
          "Browser attempt output authority is no longer valid.",
        );
      }
      return Object.freeze({
        workspaceId: canonicalWorkspaceId,
        sessionId: canonicalSessionId,
        assignmentId: canonicalAssignmentId,
        actorId: result.actorId,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      if (error instanceof BrowserStoreError) {
        translateStoreError(error);
      }
      throw error;
    }
  }
}
