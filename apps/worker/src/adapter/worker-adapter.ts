import type { WorkerInputArtifactAccess } from "../storage/worker-input-artifact-resolver.js";
import type { WorkerModelResourceAccess } from "../storage/worker-model-resource-resolver.js";
import type { RuntimeAdapterDefinitionRevision } from "@kanvas/contracts/capability";

export interface WorkerAdapterImageOutput {
  readonly outputRole: string;
  readonly outputIndex: number;
  readonly artifactType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly byteSize?: string;
  readonly sha256?: string;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface WorkerAdapterExecutionResult {
  readonly protocol: "kanvas.worker-adapter-result/v1";
  readonly capabilityOutput: unknown;
  readonly outputs: readonly WorkerAdapterImageOutput[];
}

export interface WorkerAdapterExecutionContext {
  readonly workspaceId: string;
  readonly invocationKind?: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly implementationConfiguration?: unknown;
  readonly runtimeAdapterRevisionId?: string;
  readonly runtimeAdapterRevisionDigest?: string;
  readonly runtimeAdapter?: RuntimeAdapterDefinitionRevision;
  readonly inputArtifacts: WorkerInputArtifactAccess;
  readonly modelResource?: WorkerModelResourceAccess;
}

export type WorkerAdapterExecutor = (
  adapterKey: string,
  input: unknown,
  signal: AbortSignal,
  context: WorkerAdapterExecutionContext,
) => Promise<unknown>;

export interface WorkerAdapter {
  readonly adapterKey: string;
  readonly execute: (
    input: unknown,
    signal: AbortSignal,
    context: WorkerAdapterExecutionContext,
  ) => Promise<unknown>;
}

export interface WorkerAdapterRegistry {
  readonly execute: WorkerAdapterExecutor;
  readonly keys: readonly string[];
}

/**
 * Trusted pre-execution signal that this immutable Implementation is not
 * applicable to the requested business intent. It carries no side effects
 * and permits the pinned route to advance through `not_started`.
 */
export class WorkerAdapterNotApplicableError extends Error {
  public constructor(readonly stableErrorCode: string) {
    if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/u.test(stableErrorCode)) {
      throw new TypeError(
        "Worker Adapter not-applicable errors require a stable code.",
      );
    }
    super(stableErrorCode);
    this.name = "WorkerAdapterNotApplicableError";
  }
}

const adapterKeyPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/u;

export function createWorkerAdapterRegistry(
  adapters: readonly WorkerAdapter[],
): WorkerAdapterRegistry {
  const byKey = new Map<string, WorkerAdapter>();
  for (const adapter of adapters) {
    if (
      !adapterKeyPattern.test(adapter.adapterKey) ||
      byKey.has(adapter.adapterKey)
    ) {
      throw new TypeError("Worker Adapter keys must be valid and unique.");
    }
    byKey.set(adapter.adapterKey, Object.freeze({ ...adapter }));
  }
  const keys = Object.freeze([...byKey.keys()].sort());
  return Object.freeze({
    keys,
    execute(
      adapterKey: string,
      input: unknown,
      signal: AbortSignal,
      context: WorkerAdapterExecutionContext,
    ) {
      const adapter = byKey.get(adapterKey);
      if (!adapter) {
        return Promise.reject(
          new Error(`Unsupported worker capability adapter: ${adapterKey}`),
        );
      }
      if (
        !context.runtimeAdapter ||
        context.runtimeAdapter.adapterKey !== adapterKey ||
        context.runtimeAdapter.executionTarget !== "worker" ||
        context.runtimeAdapter.executable.entrypoint !== adapterKey
      ) {
        return Promise.reject(
          new Error(
            "Pinned Runtime Adapter identity is not executable by this Worker.",
          ),
        );
      }
      return adapter.execute(input, signal, context);
    },
  });
}
