import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";

import type {
  DecodeVerifier,
  StorageObjectIdentity,
  StorageObjectInspection,
  StorageProfileRegistry,
} from "@kanvas/application";
import type {
  StorageUploadStore,
  UploadSessionRecord,
  UploadSessionState,
} from "@kanvas/database";

import {
  MediaVerificationError,
  verifyTrustedImage,
  type TrustedImageMediaType,
  type TrustedImageVerificationLimits,
} from "./media-verifier.js";

export type ServerStreamUploadErrorCode =
  | "server_stream_upload.invalid_configuration"
  | "server_stream_upload.invalid_session"
  | "server_stream_upload.profile_unavailable"
  | "server_stream_upload.object_unavailable"
  | "server_stream_upload.verification_rejected"
  | "server_stream_upload.state_conflict";

export class ServerStreamUploadError extends Error {
  constructor(
    readonly code: ServerStreamUploadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ServerStreamUploadError";
  }
}

export interface ServerStreamUploadStore {
  readonly beginUpload: StorageUploadStore["beginUpload"];
  readonly beginSeal: StorageUploadStore["beginSeal"];
  readonly recordSeal: StorageUploadStore["recordSeal"];
  readonly claimVerification: StorageUploadStore["claimVerification"];
  readonly recordVerified: StorageUploadStore["recordVerified"];
  readonly recordRejected: StorageUploadStore["recordRejected"];
}

export interface CreateServerStreamUploadCoordinatorOptions {
  readonly store: ServerStreamUploadStore;
  readonly profiles: StorageProfileRegistry;
  readonly verificationLimits: TrustedImageVerificationLimits;
  readonly verificationLeaseMilliseconds: number;
  readonly decodeVerifier?: DecodeVerifier;
  readonly mediaVerifier?: ServerStreamMediaVerifier;
  readonly now?: () => Date;
  readonly createLeaseToken?: () => Uint8Array;
}

export interface ServerStreamMediaVerificationResult {
  readonly byteSize: string;
  readonly sha256: string;
  readonly detectedMediaType: string;
  readonly verificationResultHash: string;
}

export type ServerStreamMediaVerifier = (options: {
  readonly body: AsyncIterable<Uint8Array>;
  readonly declaredMediaType?: string;
  readonly maximumInputBytes: number;
  readonly verificationProfileVersion: string;
}) => Promise<ServerStreamMediaVerificationResult>;

export interface IngestServerStreamUploadRequest {
  /**
   * This record must come from the authoritative allocation store after the
   * caller has authenticated the producer and bound its Actor or Attempt.
   */
  readonly session: UploadSessionRecord;
  readonly body: AsyncIterable<Uint8Array>;
  /** Recover a previous write without consuming or writing another body. */
  readonly recoverStoredObjectOnly?: true;
}

export interface IngestedServerStreamUpload {
  readonly uploadSessionId: string;
  readonly state: "verified" | "committed";
  readonly replayed: boolean;
}

export interface ServerStreamUploadCoordinator {
  readonly ingest: (
    request: IngestServerStreamUploadRequest,
  ) => Promise<IngestedServerStreamUpload>;
}

const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const BYTES_PER_MEBIBYTE = 1_048_576n;
// Avoid a second object-store read for interactive uploads without allowing
// large or size-unknown requests to multiply Server memory under concurrency.
const MAXIMUM_CAPTURED_UPLOAD_BYTES = 16n * BYTES_PER_MEBIBYTE;
const supportedMediaTypes = new Set<TrustedImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function fail(
  code: ServerStreamUploadErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new ServerStreamUploadError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertConfiguration(
  options: CreateServerStreamUploadCoordinatorOptions,
): void {
  if (
    !Number.isSafeInteger(options.verificationLeaseMilliseconds) ||
    options.verificationLeaseMilliseconds < 1_000 ||
    options.verificationLeaseMilliseconds > 3_600_000
  ) {
    fail(
      "server_stream_upload.invalid_configuration",
      "Verification lease must be between 1000 and 3600000 milliseconds.",
    );
  }
}

function assertSession(session: UploadSessionRecord): void {
  if (
    session.uploadMode !== "server_stream" ||
    session.writeProtectionMode !== "server_owned" ||
    !uint64Pattern.test(
      session.expectedSize ?? Number.MAX_SAFE_INTEGER.toString(),
    ) ||
    session.cleanupEligibleAt <= session.expiresAt
  ) {
    fail(
      "server_stream_upload.invalid_session",
      "UploadSession is not a valid server-owned stream allocation.",
    );
  }
}

function identityFor(session: UploadSessionRecord): StorageObjectIdentity {
  return Object.freeze({
    storageProfileId: session.storageProfileId,
    container: session.container,
    objectKey: session.objectKey,
  });
}

function maximumWriteBytes(
  session: UploadSessionRecord,
  limits: TrustedImageVerificationLimits,
  adapterMaximum: string,
): string {
  const configured = BigInt(limits.maximumInputBytes);
  const adapter = BigInt(adapterMaximum);
  const expected =
    session.expectedSize === undefined
      ? configured
      : BigInt(session.expectedSize);
  return [configured, adapter, expected]
    .reduce((left, right) => (left < right ? left : right))
    .toString();
}

interface CapturedUploadBody {
  readonly chunks: Buffer[];
  byteSize: bigint;
}

async function* captureUploadBody(
  body: AsyncIterable<Uint8Array>,
  maximumBytes: string,
  captured: CapturedUploadBody,
): AsyncGenerator<Uint8Array> {
  const maximum = BigInt(maximumBytes);
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      return fail(
        "server_stream_upload.invalid_session",
        "Upload body yielded a non-byte chunk.",
      );
    }
    captured.byteSize += BigInt(chunk.byteLength);
    if (captured.byteSize > maximum) {
      return fail(
        "server_stream_upload.verification_rejected",
        "Upload body exceeds its allocated byte limit.",
      );
    }
    captured.chunks.push(Buffer.from(chunk));
    yield chunk;
  }
}

function replayCapturedUploadBody(
  captured: CapturedUploadBody,
): AsyncIterable<Uint8Array> {
  return Readable.from(captured.chunks);
}

function sealManifestHash(inspection: StorageObjectInspection): string {
  const hash = createHash("sha256")
    .update("kanvas:server-stream-seal:v1\0")
    .update(
      JSON.stringify({
        storageProfileId: inspection.identity.storageProfileId,
        container: inspection.identity.container,
        objectKey: inspection.identity.objectKey,
        byteSize: inspection.byteSize,
        sha256: inspection.sha256,
        immutableIdentityHash: inspection.immutableIdentityHash,
      }),
    )
    .digest("hex");
  return `sha256:${hash}`;
}

function rejectionHash(
  session: UploadSessionRecord,
  inspection: StorageObjectInspection,
  reasonCode: string,
): string {
  const hash = createHash("sha256")
    .update("kanvas:server-stream-rejection:v1\0")
    .update(
      JSON.stringify({
        uploadSessionId: session.id,
        verificationProfileVersion: session.verificationProfileVersion,
        immutableIdentityHash: inspection.immutableIdentityHash,
        byteSize: inspection.byteSize,
        sha256: inspection.sha256,
        reasonCode,
      }),
    )
    .digest("hex");
  return `sha256:${hash}`;
}

function leaseTokenHash(token: Uint8Array): string {
  if (token.byteLength < 32) {
    fail(
      "server_stream_upload.invalid_configuration",
      "Verification lease tokens require at least 256 bits of entropy.",
    );
  }
  return createHash("sha256")
    .update("kanvas:upload-verification-lease:v1\0")
    .update(token)
    .digest("hex");
}

function declaredMediaType(
  value: string | undefined,
): TrustedImageMediaType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (supportedMediaTypes.has(value as TrustedImageMediaType)) {
    return value as TrustedImageMediaType;
  }
  throw new MediaVerificationError(
    "media_verification.unsupported_media",
    "Allocated media type is not supported by the trusted image verifier.",
  );
}

function terminalReplay(
  session: UploadSessionRecord,
): IngestedServerStreamUpload | undefined {
  if (session.state === "verified" || session.state === "committed") {
    return Object.freeze({
      uploadSessionId: session.id,
      state: session.state,
      replayed: true,
    });
  }
  return undefined;
}

async function drainTerminalReplayBody(
  body: AsyncIterable<Uint8Array>,
  session: UploadSessionRecord,
  limits: TrustedImageVerificationLimits,
): Promise<void> {
  const maximum = BigInt(session.expectedSize ?? limits.maximumInputBytes);
  let received = 0n;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      return fail(
        "server_stream_upload.invalid_session",
        "Upload replay body yielded a non-byte chunk.",
      );
    }
    received += BigInt(chunk.byteLength);
    if (received > maximum) {
      return fail(
        "server_stream_upload.verification_rejected",
        "Upload replay body exceeds its allocated byte limit.",
      );
    }
  }
}

function stateConflict(state: UploadSessionState): never {
  fail(
    "server_stream_upload.state_conflict",
    `UploadSession cannot ingest bytes while it is ${state}.`,
  );
}

export function createServerStreamUploadCoordinator(
  options: CreateServerStreamUploadCoordinatorOptions,
): ServerStreamUploadCoordinator {
  assertConfiguration(options);
  const now = options.now ?? (() => new Date());
  const createLeaseToken = options.createLeaseToken ?? (() => randomBytes(32));

  return Object.freeze({
    async ingest(request: IngestServerStreamUploadRequest) {
      assertSession(request.session);
      const replay = terminalReplay(request.session);
      if (replay) {
        if (!request.recoverStoredObjectOnly)
          await drainTerminalReplayBody(
            request.body,
            request.session,
            options.verificationLimits,
          );
        return replay;
      }
      if (
        request.session.state === "rejected" ||
        request.session.state === "aborted"
      ) {
        return stateConflict(request.session.state);
      }
      const profile = options.profiles.resolve(
        request.session.storageProfileId,
      );
      if (
        !profile ||
        profile.kind !== profile.adapter.kind ||
        profile.adapter.storageProfileId !== request.session.storageProfileId ||
        !profile.adapter.capabilities.uploadModes.includes("server_stream") ||
        !profile.adapter.capabilities.writeProtectionModes.includes(
          "server_owned",
        )
      ) {
        return fail(
          "server_stream_upload.profile_unavailable",
          "Allocated server-owned Storage profile is unavailable.",
        );
      }
      const identity = identityFor(request.session);
      let state: UploadSessionState = request.session.state;
      let inspection: StorageObjectInspection | undefined;
      let capturedUpload: CapturedUploadBody | undefined;

      if (state === "open") {
        const transition = await options.store.beginUpload({
          workspaceId: request.session.workspaceId,
          uploadSessionId: request.session.id,
          now: now(),
        });
        state = transition.state;
      }

      if (state === "open" || state === "sealing") {
        inspection = await profile.adapter.inspectObject(identity);
        if (!inspection && request.recoverStoredObjectOnly) {
          return fail(
            "server_stream_upload.object_unavailable",
            "No stored object is available to recover.",
          );
        }
        if (!inspection && state === "open") {
          const maximumBytes = maximumWriteBytes(
            request.session,
            options.verificationLimits,
            profile.adapter.capabilities.maximumObjectBytes,
          );
          capturedUpload =
            BigInt(maximumBytes) <= MAXIMUM_CAPTURED_UPLOAD_BYTES
              ? { chunks: [], byteSize: 0n }
              : undefined;
          inspection = await profile.adapter.writeObject({
            identity,
            maximumBytes,
            body: capturedUpload
              ? captureUploadBody(request.body, maximumBytes, capturedUpload)
              : request.body,
          });
        }
        if (!inspection) {
          return fail(
            "server_stream_upload.object_unavailable",
            "UploadSession has no complete immutable object to seal.",
          );
        }
        const manifestHash = sealManifestHash(inspection);
        await options.store.beginSeal({
          workspaceId: request.session.workspaceId,
          uploadSessionId: request.session.id,
          sealManifestHash: manifestHash,
          now: now(),
        });
        const sealed = await profile.adapter.sealObject({
          identity,
          expectedByteSize: inspection.byteSize,
          expectedSha256: inspection.sha256,
        });
        await options.store.recordSeal({
          workspaceId: request.session.workspaceId,
          uploadSessionId: request.session.id,
          sealManifestHash: manifestHash,
          sealedIdentityHash: sealed.immutableIdentityHash,
          now: now(),
        });
        inspection = sealed;
        state = "verifying";
      }

      if (state !== "verifying") {
        return stateConflict(state);
      }
      const claimAt = now();
      const leaseExpiresAt = new Date(
        Math.min(
          request.session.expiresAt.getTime(),
          claimAt.getTime() + options.verificationLeaseMilliseconds,
        ),
      );
      if (leaseExpiresAt <= claimAt) {
        return fail(
          "server_stream_upload.state_conflict",
          "UploadSession expired before trusted verification could start.",
        );
      }
      const tokenHash = leaseTokenHash(createLeaseToken());
      const claim = await options.store.claimVerification({
        workspaceId: request.session.workspaceId,
        uploadSessionId: request.session.id,
        processingLeaseTokenHash: tokenHash,
        now: claimAt,
        leaseExpiresAt,
      });
      const claimedIdentity: StorageObjectIdentity = Object.freeze({
        storageProfileId: claim.storageProfileId,
        container: claim.container,
        objectKey: claim.objectKey,
        ...(claim.storageVersionId
          ? { storageVersionId: claim.storageVersionId }
          : {}),
      });
      const trustedInspection =
        inspection ?? (await profile.adapter.inspectObject(claimedIdentity));
      if (
        !trustedInspection ||
        trustedInspection.immutableIdentityHash !== claim.sealedIdentityHash
      ) {
        return fail(
          "server_stream_upload.object_unavailable",
          "Sealed object identity is unavailable or changed.",
        );
      }
      // Only a newly written, fully consumed body can use the fast path.
      // Recovery and pre-existing-object paths still re-read the sealed object.
      const verificationBody = capturedUpload
        ? replayCapturedUploadBody(capturedUpload)
        : (
            await profile.adapter.openRead({
              identity: claimedIdentity,
              expectedByteSize: trustedInspection.byteSize,
              expectedSha256: trustedInspection.sha256,
              expectedImmutableIdentityHash:
                trustedInspection.immutableIdentityHash,
            })
          ).body;

      try {
        const verified = options.mediaVerifier
          ? await options.mediaVerifier({
              body: verificationBody,
              ...(claim.expectedMediaType
                ? { declaredMediaType: claim.expectedMediaType }
                : {}),
              maximumInputBytes: options.verificationLimits.maximumInputBytes,
              verificationProfileVersion: claim.verificationProfileVersion,
            })
          : await (async () => {
              const expectedMediaType = declaredMediaType(
                claim.expectedMediaType,
              );
              return verifyTrustedImage({
                body: verificationBody,
                ...(expectedMediaType
                  ? { declaredMediaType: expectedMediaType }
                  : {}),
                limits: options.verificationLimits,
                verificationProfileVersion: claim.verificationProfileVersion,
                ...(options.decodeVerifier
                  ? { decodeVerifier: options.decodeVerifier }
                  : {}),
              });
            })();
        const violatesIdentity =
          verified.byteSize !== trustedInspection.byteSize ||
          verified.sha256 !== trustedInspection.sha256 ||
          (claim.expectedSize !== undefined &&
            claim.expectedSize !== verified.byteSize) ||
          (claim.expectedSha256 !== undefined &&
            claim.expectedSha256 !== verified.sha256);
        if (violatesIdentity) {
          const reasonCode = "media_verification.identity_mismatch";
          await options.store.recordRejected({
            workspaceId: request.session.workspaceId,
            uploadSessionId: request.session.id,
            processingLeaseGeneration: claim.processingLeaseGeneration,
            processingLeaseTokenHash: tokenHash,
            reasonCode,
            verificationResultHash: rejectionHash(
              request.session,
              trustedInspection,
              reasonCode,
            ),
            now: now(),
          });
          return fail(
            "server_stream_upload.verification_rejected",
            "Trusted verification does not match the sealed object identity.",
          );
        }
        await options.store.recordVerified({
          workspaceId: request.session.workspaceId,
          uploadSessionId: request.session.id,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: tokenHash,
          verifiedSize: verified.byteSize,
          verifiedSha256: verified.sha256,
          detectedMediaType: verified.detectedMediaType,
          verificationResultHash: verified.verificationResultHash,
          now: now(),
        });
        return Object.freeze({
          uploadSessionId: request.session.id,
          state: "verified" as const,
          replayed: false,
        });
      } catch (error) {
        if (!(error instanceof MediaVerificationError)) {
          throw error;
        }
        await options.store.recordRejected({
          workspaceId: request.session.workspaceId,
          uploadSessionId: request.session.id,
          processingLeaseGeneration: claim.processingLeaseGeneration,
          processingLeaseTokenHash: tokenHash,
          reasonCode: error.code,
          verificationResultHash: rejectionHash(
            request.session,
            trustedInspection,
            error.code,
          ),
          now: now(),
        });
        return fail(
          "server_stream_upload.verification_rejected",
          "Uploaded media failed trusted verification.",
          error,
        );
      }
    },
  });
}
