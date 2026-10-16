import type {
  AttemptCompletionOutput,
  StorageUploadStore,
} from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";

import type { WorkerAdapterImageOutput } from "../adapter/worker-adapter.js";

export type AttemptImageOutput = WorkerAdapterImageOutput;

const visibleAsciiPattern = /^[\x21-\x7e]+$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const supportedMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface WorkerAttemptOutputContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly attemptId: string;
  readonly executionDeadlineAt: Date;
  readonly executionTarget: "worker" | "provider";
}

export interface MaterializeWorkerAttemptOutputsRequest {
  readonly context: WorkerAttemptOutputContext;
  readonly outputs: readonly WorkerAdapterImageOutput[];
  readonly signal: AbortSignal;
}

export interface WorkerAttemptOutputMaterializer {
  readonly materialize: (
    request: MaterializeWorkerAttemptOutputsRequest,
  ) => Promise<readonly AttemptCompletionOutput[]>;
}

export interface CreateWorkerAttemptOutputMaterializerOptions {
  readonly runtime: TrustedImageStorageRuntime;
  readonly store: StorageUploadStore;
  readonly nextId: () => string;
  readonly now?: () => Date;
}

export class WorkerAttemptOutputMaterializationError extends Error {
  public readonly stage: "validate" | "allocate" | "ingest";

  public constructor(
    stage: WorkerAttemptOutputMaterializationError["stage"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkerAttemptOutputMaterializationError";
    this.stage = stage;
  }
}

function allocationHash(
  context: WorkerAttemptOutputContext,
  output: WorkerAdapterImageOutput,
): string {
  return digestProviderValue({
    contract: "kanvas.attempt-image-output-allocation/v1",
    executionTarget: context.executionTarget,
    workspaceId: context.workspaceId,
    attemptId: context.attemptId,
    outputRole: output.outputRole,
    outputIndex: output.outputIndex,
    artifactType: output.artifactType,
    metadata: output.metadata,
    ...(output.byteSize ? { expectedSize: output.byteSize } : {}),
    expectedMediaType: output.mediaType,
    ...(output.sha256 ? { expectedSha256: output.sha256 } : {}),
  });
}

function allocationRequestKey(
  executionTarget: WorkerAttemptOutputContext["executionTarget"],
  attemptId: string,
  outputRole: string,
  outputIndex: number,
): string {
  return `${executionTarget}-output:${attemptId}:${outputRole}:${String(outputIndex)}`;
}

function objectKey(
  workspaceId: string,
  attemptId: string,
  uploadSessionId: string,
  randomObjectId: string,
): string {
  return `v1/w/${workspaceId}/a/${attemptId}/u/${uploadSessionId}/o/${randomObjectId}`;
}

function assertOutput(
  output: WorkerAdapterImageOutput,
  maximumInputBytes: number,
): void {
  if (
    output.outputRole.length < 1 ||
    output.outputRole.length > 80 ||
    !visibleAsciiPattern.test(output.outputRole) ||
    !Number.isSafeInteger(output.outputIndex) ||
    output.outputIndex < 0 ||
    output.outputIndex > 4_294_967_295 ||
    output.artifactType.length < 1 ||
    output.artifactType.length > 120 ||
    !supportedMediaTypes.has(output.mediaType) ||
    !output.metadata ||
    typeof output.metadata !== "object" ||
    Array.isArray(output.metadata)
  ) {
    throw new WorkerAttemptOutputMaterializationError(
      "validate",
      "Worker image output descriptor is invalid.",
    );
  }
  if (
    output.byteSize !== undefined &&
    (!uint64Pattern.test(output.byteSize) ||
      BigInt(output.byteSize) > BigInt(maximumInputBytes))
  ) {
    throw new WorkerAttemptOutputMaterializationError(
      "validate",
      "Worker image output byte size is invalid or exceeds the configured limit.",
    );
  }
  if (output.sha256 !== undefined && !sha256Pattern.test(output.sha256)) {
    throw new WorkerAttemptOutputMaterializationError(
      "validate",
      "Worker image output SHA-256 is invalid.",
    );
  }
  try {
    digestProviderValue(output.metadata);
  } catch (error) {
    throw new WorkerAttemptOutputMaterializationError(
      "validate",
      "Worker image output metadata must be JSON serializable.",
      { cause: error },
    );
  }
}

async function* abortableBody(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  signal.throwIfAborted();
  for await (const chunk of body) {
    signal.throwIfAborted();
    yield chunk;
  }
  signal.throwIfAborted();
}

export function createWorkerAttemptOutputMaterializer(
  options: CreateWorkerAttemptOutputMaterializerOptions,
): WorkerAttemptOutputMaterializer {
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async materialize(request: MaterializeWorkerAttemptOutputsRequest) {
      if (request.outputs.length > 64) {
        throw new WorkerAttemptOutputMaterializationError(
          "validate",
          "A Worker Attempt cannot materialize more than 64 outputs.",
        );
      }
      const canonical = [...request.outputs].sort((left, right) => {
        if (left.outputRole < right.outputRole) {
          return -1;
        }
        if (left.outputRole > right.outputRole) {
          return 1;
        }
        return left.outputIndex - right.outputIndex;
      });
      const coordinates = new Set<string>();
      for (const output of canonical) {
        assertOutput(output, options.runtime.maximumInputBytes);
        const coordinate = `${output.outputRole}\0${String(output.outputIndex)}`;
        if (coordinates.has(coordinate)) {
          throw new WorkerAttemptOutputMaterializationError(
            "validate",
            `Worker image output ${output.outputRole}:${String(output.outputIndex)} is duplicated.`,
          );
        }
        coordinates.add(coordinate);
      }
      request.signal.throwIfAborted();
      const allocatedAt = now();
      if (request.context.executionDeadlineAt <= allocatedAt) {
        throw new WorkerAttemptOutputMaterializationError(
          "validate",
          "Worker Attempt expired before output materialization.",
        );
      }
      const probe = await options.runtime.ensureCompatibilityProbe(
        request.context.workspaceId,
        options.nextId(),
        allocatedAt,
      );
      const materialized: AttemptCompletionOutput[] = [];
      for (const output of canonical) {
        request.signal.throwIfAborted();
        const uploadSessionId = options.nextId();
        const storedObjectId = options.nextId();
        const artifactId = options.nextId();
        const attemptOutputId = options.nextId();
        const randomObjectId = options.nextId();
        let session;
        try {
          session = await options.store.allocateUploadSession({
            id: uploadSessionId,
            workspaceId: request.context.workspaceId,
            actorId: request.context.actorId,
            allocationRequestKey: allocationRequestKey(
              request.context.executionTarget,
              request.context.attemptId,
              output.outputRole,
              output.outputIndex,
            ),
            allocationRequestHash: allocationHash(request.context, output),
            purpose: "attempt_output",
            attemptId: request.context.attemptId,
            outputRole: output.outputRole,
            outputIndex: output.outputIndex,
            ...(output.byteSize ? { expectedSize: output.byteSize } : {}),
            expectedMediaType: output.mediaType,
            ...(output.sha256 ? { expectedSha256: output.sha256 } : {}),
            storageProfileId: options.runtime.profileId,
            compatibilityProbeId: probe.id,
            profileConfigurationHash: options.runtime.profileConfigurationHash,
            container: options.runtime.container,
            objectKey: objectKey(
              request.context.workspaceId,
              request.context.attemptId,
              uploadSessionId,
              randomObjectId,
            ),
            uploadMode: "server_stream",
            writeProtectionMode: "server_owned",
            verificationProfileVersion:
              options.runtime.verificationProfileVersion,
            now: allocatedAt,
            expiresAt: request.context.executionDeadlineAt,
            cleanupEligibleAt: new Date(
              request.context.executionDeadlineAt.getTime() +
                options.runtime.cleanupGraceMilliseconds,
            ),
          });
        } catch (error) {
          throw new WorkerAttemptOutputMaterializationError(
            "allocate",
            "Worker Attempt output allocation failed.",
            { cause: error },
          );
        }
        if (session.state === "rejected" || session.state === "aborted") {
          throw new WorkerAttemptOutputMaterializationError(
            "allocate",
            "Worker Attempt output allocation is already terminal.",
          );
        }
        try {
          await options.runtime.uploads.ingest({
            session,
            body: abortableBody(output.body, request.signal),
          });
        } catch (error) {
          if (request.signal.aborted) {
            request.signal.throwIfAborted();
          }
          try {
            // A write/verification acknowledgement may be lost. Read the
            // authoritative session and recover only bytes already in storage.
            session = await options.store.readAttemptOutputUploadSession({
              workspaceId: request.context.workspaceId,
              attemptId: request.context.attemptId,
              uploadSessionId: session.id,
              outputRole: output.outputRole,
              outputIndex: output.outputIndex,
            });
            request.signal.throwIfAborted();
            if (now() >= request.context.executionDeadlineAt) throw error;
            await options.runtime.uploads.ingest({
              session,
              body: output.body,
              recoverStoredObjectOnly: true,
            });
          } catch {
            throw new WorkerAttemptOutputMaterializationError(
              "ingest",
              "Worker Attempt output ingestion failed.",
              { cause: error },
            );
          }
        }
        materialized.push(
          Object.freeze({
            uploadSessionId: session.id,
            storedObjectId,
            artifactId,
            attemptOutputId,
            outputRole: output.outputRole,
            outputIndex: output.outputIndex,
            artifactType: output.artifactType,
            metadata: output.metadata,
          }),
        );
      }
      return Object.freeze(materialized);
    },
  });
}

export type AttemptImageOutputMaterializer = WorkerAttemptOutputMaterializer;
export const createAttemptImageOutputMaterializer =
  createWorkerAttemptOutputMaterializer;
