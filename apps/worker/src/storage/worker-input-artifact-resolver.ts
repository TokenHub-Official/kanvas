import { createHash } from "node:crypto";

import type {
  ArtifactDataClassification,
  AuthorizedCommittedObject,
  StorageUploadStore,
} from "@kanvas/database/runtime";
import { StorageUploadStoreError } from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const supportedMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const supportedDataClassifications = new Set<ArtifactDataClassification>([
  "internal",
  "confidential",
  "restricted",
]);
const maximumPointerLength = 512;
const maximumPointerDepth = 32;
const maximumArtifactOpens = 16;

export interface OpenWorkerInputArtifactRequest {
  /**
   * RFC 6901 JSON Pointer into the immutable Attempt input. The pointed value
   * must be an Artifact ULID. This binds object access to an explicit value in
   * the authoritative execution input instead of accepting an arbitrary ID.
   */
  readonly inputPointer: string;
}

export interface WorkerInputArtifactRead {
  readonly artifactId: string;
  readonly storedObjectId: string;
  readonly artifactType: string;
  readonly dataClassification: ArtifactDataClassification;
  readonly displayFilename?: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  /**
   * Creates a provider-egress-only HTTPS reference. The signed URL is
   * intentionally generated on demand and must not be persisted or logged.
   */
  readonly createProviderReadUrl?: (
    expiresInSeconds: number,
  ) => Promise<string>;
  /**
   * A single-consumer body. Storage profile, container, object key and provider
   * identity are deliberately not exposed across the Adapter boundary.
   */
  readonly body: AsyncIterable<Uint8Array>;
}

export interface WorkerInputArtifactAccess {
  readonly open: (
    request: OpenWorkerInputArtifactRequest,
  ) => Promise<WorkerInputArtifactRead>;
}

export interface BindWorkerInputArtifactAccessRequest {
  readonly capabilityRunId?: string;
  readonly workspaceId: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

export interface WorkerInputArtifactResolver {
  readonly bind: (
    request: BindWorkerInputArtifactAccessRequest,
  ) => WorkerInputArtifactAccess;
}

export interface CreateWorkerInputArtifactResolverOptions {
  readonly authorizeConsumerArtifact?: (request: {
    readonly workspaceId: string;
    readonly capabilityRunId: string;
    readonly artifactId: string;
  }) => Promise<void>;
  readonly runtime: TrustedImageStorageRuntime;
  readonly store: Pick<StorageUploadStore, "readAuthorizedCommittedObject">;
  readonly allowedDataClassifications: readonly ArtifactDataClassification[];
}

export type WorkerInputArtifactResolutionStage =
  "validate" | "lookup" | "authorize" | "open" | "read" | "unavailable";

export class WorkerInputArtifactResolutionError extends Error {
  public constructor(
    readonly stage: WorkerInputArtifactResolutionStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkerInputArtifactResolutionError";
  }
}

function decodePointerSegment(segment: string): string {
  let decoded = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character !== "~") {
      decoded += character;
      continue;
    }
    const escaped = segment[index + 1];
    if (escaped === "0") {
      decoded += "~";
    } else if (escaped === "1") {
      decoded += "/";
    } else {
      throw new WorkerInputArtifactResolutionError(
        "validate",
        "Worker input Artifact pointer contains an invalid escape.",
      );
    }
    index += 1;
  }
  return decoded;
}

function pointerSegments(pointer: string): readonly string[] {
  if (
    pointer.length < 2 ||
    pointer.length > maximumPointerLength ||
    !pointer.startsWith("/")
  ) {
    throw new WorkerInputArtifactResolutionError(
      "validate",
      "Worker input Artifact pointer is invalid.",
    );
  }
  const segments = pointer.slice(1).split("/").map(decodePointerSegment);
  if (
    segments.length > maximumPointerDepth ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "__proto__" ||
        segment === "prototype" ||
        segment === "constructor",
    )
  ) {
    throw new WorkerInputArtifactResolutionError(
      "validate",
      "Worker input Artifact pointer exceeds its safety bounds.",
    );
  }
  return segments;
}

function valueAtPointer(input: unknown, pointer: string): unknown {
  let current = input;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      if (
        !/^(?:0|[1-9][0-9]*)$/u.test(segment) ||
        Number(segment) >= current.length
      ) {
        throw new WorkerInputArtifactResolutionError(
          "validate",
          "Worker input Artifact pointer does not resolve.",
        );
      }
      current = current[Number(segment)];
      continue;
    }
    if (
      !current ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new WorkerInputArtifactResolutionError(
        "validate",
        "Worker input Artifact pointer does not resolve.",
      );
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

function artifactIdAtPointer(input: unknown, pointer: string): string {
  const artifactId = valueAtPointer(input, pointer);
  if (typeof artifactId !== "string" || !ulidPattern.test(artifactId)) {
    throw new WorkerInputArtifactResolutionError(
      "validate",
      "Worker input Artifact pointer must resolve to an Artifact ULID.",
    );
  }
  return artifactId;
}

function authorizedReadFailure(error: unknown): never {
  if (
    error instanceof StorageUploadStoreError &&
    (error.code === "storage_upload.access_denied" ||
      error.code === "storage_upload.not_found" ||
      error.code === "storage_upload.invalid_argument")
  ) {
    throw new WorkerInputArtifactResolutionError(
      "authorize",
      "Worker input Artifact is unavailable or unauthorized.",
      { cause: error },
    );
  }
  throw new WorkerInputArtifactResolutionError(
    "lookup",
    "Worker input Artifact facts could not be read.",
    { cause: error },
  );
}

function assertObjectIsSupported(
  object: AuthorizedCommittedObject,
  maximumInputBytes: number,
): asserts object is AuthorizedCommittedObject & {
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
} {
  if (
    !supportedMediaTypes.has(object.mediaType) ||
    BigInt(object.byteSize) > BigInt(maximumInputBytes)
  ) {
    throw new WorkerInputArtifactResolutionError(
      "validate",
      "Worker input Artifact media type or byte size is unsupported.",
    );
  }
}

function singleConsumerBody(
  openSource: () => Promise<AsyncIterable<Uint8Array>>,
  signal: AbortSignal,
  expectedByteSize: string,
  expectedSha256: string,
): AsyncIterable<Uint8Array> {
  let consumed = false;
  return Object.freeze({
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      if (consumed) {
        throw new WorkerInputArtifactResolutionError(
          "read",
          "Worker input Artifact body can only be consumed once.",
        );
      }
      consumed = true;
      return verifiedBody()[Symbol.asyncIterator]();
    },
  });

  async function* verifiedBody(): AsyncGenerator<Uint8Array> {
    const hash = createHash("sha256");
    let observedBytes = 0n;
    try {
      signal.throwIfAborted();
      let source: AsyncIterable<Uint8Array>;
      try {
        source = await openSource();
      } catch (error) {
        if (error instanceof WorkerInputArtifactResolutionError) throw error;
        throw new WorkerInputArtifactResolutionError(
          "open",
          "Worker input Artifact object could not be opened.",
          { cause: error },
        );
      }
      signal.throwIfAborted();
      for await (const chunk of source) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) {
          throw new WorkerInputArtifactResolutionError(
            "read",
            "Worker input Artifact storage returned an invalid chunk.",
          );
        }
        observedBytes += BigInt(chunk.byteLength);
        if (observedBytes > BigInt(expectedByteSize)) {
          throw new WorkerInputArtifactResolutionError(
            "read",
            "Worker input Artifact body exceeded its committed size.",
          );
        }
        hash.update(chunk);
        yield chunk;
      }
      signal.throwIfAborted();
      if (
        observedBytes.toString() !== expectedByteSize ||
        hash.digest("hex") !== expectedSha256
      ) {
        throw new WorkerInputArtifactResolutionError(
          "read",
          "Worker input Artifact body did not match committed facts.",
        );
      }
    } catch (error) {
      if (
        error instanceof WorkerInputArtifactResolutionError ||
        signal.aborted
      ) {
        throw error;
      }
      throw new WorkerInputArtifactResolutionError(
        "read",
        "Worker input Artifact body could not be read.",
        { cause: error },
      );
    }
  }
}

export function createUnavailableWorkerInputArtifactAccess(): WorkerInputArtifactAccess {
  return Object.freeze({
    open() {
      return Promise.reject(
        new WorkerInputArtifactResolutionError(
          "unavailable",
          "Worker input Artifact access requires a trusted Storage runtime.",
        ),
      );
    },
  });
}

export function createWorkerInputArtifactResolver(
  options: CreateWorkerInputArtifactResolverOptions,
): WorkerInputArtifactResolver {
  const allowedDataClassifications = Object.freeze([
    ...new Set(options.allowedDataClassifications),
  ]);
  if (
    allowedDataClassifications.length === 0 ||
    allowedDataClassifications.some(
      (classification) => !supportedDataClassifications.has(classification),
    )
  ) {
    throw new TypeError(
      "Worker input Artifact resolver requires an explicit data-classification policy.",
    );
  }

  return Object.freeze({
    bind(
      request: BindWorkerInputArtifactAccessRequest,
    ): WorkerInputArtifactAccess {
      let openCount = 0;
      return Object.freeze({
        async open(
          openRequest: OpenWorkerInputArtifactRequest,
        ): Promise<WorkerInputArtifactRead> {
          request.signal.throwIfAborted();
          openCount += 1;
          if (openCount > maximumArtifactOpens) {
            throw new WorkerInputArtifactResolutionError(
              "validate",
              "Worker input Artifact open limit was exceeded.",
            );
          }
          const inputPointer = openRequest?.inputPointer;
          if (typeof inputPointer !== "string") {
            throw new WorkerInputArtifactResolutionError(
              "validate",
              "Worker input Artifact pointer is invalid.",
            );
          }
          const artifactId = artifactIdAtPointer(request.input, inputPointer);
          const authorizeConsumer = async () => {
            if (!request.capabilityRunId) return;
            if (!options.authorizeConsumerArtifact)
              throw new WorkerInputArtifactResolutionError(
                "unavailable",
                "Consumer input authorization is not configured.",
              );
            try {
              await options.authorizeConsumerArtifact({
                workspaceId: request.workspaceId,
                capabilityRunId: request.capabilityRunId,
                artifactId,
              });
            } catch {
              throw new WorkerInputArtifactResolutionError(
                "authorize",
                "The input consumer no longer has permission to read this Artifact.",
              );
            }
          };
          await authorizeConsumer();
          let object: AuthorizedCommittedObject;
          try {
            object = await options.store.readAuthorizedCommittedObject({
              workspaceId: request.workspaceId,
              artifactId,
              allowedDataClassifications,
            });
          } catch (error) {
            authorizedReadFailure(error);
          }
          request.signal.throwIfAborted();
          assertObjectIsSupported(object, options.runtime.maximumInputBytes);
          const profile = options.runtime.profiles.resolve(
            object.storageProfileId,
          );
          if (!profile) {
            throw new WorkerInputArtifactResolutionError(
              "unavailable",
              "Worker input Artifact storage profile is not configured.",
            );
          }
          return Object.freeze({
            artifactId: object.artifactId,
            storedObjectId: object.storedObjectId,
            artifactType: object.artifactType,
            dataClassification: object.dataClassification,
            ...(object.displayFilename
              ? { displayFilename: object.displayFilename }
              : {}),
            byteSize: object.byteSize,
            sha256: object.sha256,
            mediaType: object.mediaType,
            ...(profile.adapter.createProviderReadUrl
              ? {
                  async createProviderReadUrl(
                    expiresInSeconds: number,
                  ): Promise<string> {
                    request.signal.throwIfAborted();
                    await authorizeConsumer();
                    const result = await profile.adapter.createProviderReadUrl!(
                      {
                        identity: {
                          storageProfileId: object.storageProfileId,
                          container: object.container,
                          objectKey: object.objectKey,
                          ...(object.storageVersionId
                            ? {
                                storageVersionId: object.storageVersionId,
                              }
                            : {}),
                        },
                        expectedByteSize: object.byteSize,
                        expectedSha256: object.sha256,
                        expectedImmutableIdentityHash:
                          object.immutableIdentityHash,
                        responseContentType: object.mediaType,
                        expiresInSeconds,
                      },
                    );
                    request.signal.throwIfAborted();
                    return result.url;
                  },
                }
              : {}),
            body: singleConsumerBody(
              async () => {
                await authorizeConsumer();
                const read = await profile.adapter.openRead({
                  identity: {
                    storageProfileId: object.storageProfileId,
                    container: object.container,
                    objectKey: object.objectKey,
                    ...(object.storageVersionId
                      ? {
                          storageVersionId: object.storageVersionId,
                        }
                      : {}),
                  },
                  expectedByteSize: object.byteSize,
                  expectedSha256: object.sha256,
                  expectedImmutableIdentityHash: object.immutableIdentityHash,
                });
                if (
                  read.totalByteSize !== object.byteSize ||
                  read.contentByteSize !== object.byteSize ||
                  read.range !== undefined
                ) {
                  throw new WorkerInputArtifactResolutionError(
                    "open",
                    "Worker input Artifact storage returned inconsistent read facts.",
                  );
                }
                return read.body;
              },
              request.signal,
              object.byteSize,
              object.sha256,
            ),
          });
        },
      });
    },
  });
}
