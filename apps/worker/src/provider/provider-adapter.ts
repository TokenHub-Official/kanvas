import type {
  ProviderQueryMode,
  ProviderRouteSnapshot,
} from "@kanvas/application";
import type { ProviderReportedCharge } from "@kanvas/contracts/provider-billing";
import type {
  AttemptFailureFacts,
  ProviderConfirmedResultFacts,
  ProviderInvocationExecutionContext,
  AttemptFailureRetryability,
} from "@kanvas/database/runtime";

import type { WorkerInputArtifactAccess } from "../storage/worker-input-artifact-resolver.js";

export type ProviderObservedStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "not_found"
  | "unknown";

export interface ProviderInvocationRequest {
  readonly route: ProviderRouteSnapshot;
  readonly stableRequestKey: string;
  readonly requestFingerprint: string;
  readonly input: unknown;
  readonly effectiveParameters?: Readonly<
    Record<string, string | number | boolean>
  >;
  readonly preparedRequestSnapshot?: Readonly<Record<string, unknown>>;
  readonly preparedRequestDigest?: string;
  /**
   * Hard upper bound for starting or continuing remote I/O. Adapters must
   * bind their transport timeout to this deadline and must not initiate a
   * request after the accompanying AbortSignal has fired.
   */
  readonly deadlineAt: Date;
}

export interface ProviderQueryRequest extends ProviderInvocationRequest {
  readonly providerRequestId?: string;
}

/**
 * Secret-bearing execution envelope. The runner constructs this object only
 * inside ProviderSecretMaterialResolver.withResolvedMaterial(). Adapters must
 * not retain either the envelope or credential beyond one transport call.
 */
export interface AuthorizedProviderInvocationRequest extends ProviderInvocationRequest {
  readonly executionContext: ProviderInvocationExecutionContext;
  readonly credential: Uint8Array;
  readonly onResultConfirmed?: (
    facts: ProviderConfirmedResultFacts & {
      readonly providerRequestId?: string;
    },
  ) => Promise<void>;
  readonly inputArtifacts?: WorkerInputArtifactAccess;
}

export interface AuthorizedProviderQueryRequest extends AuthorizedProviderInvocationRequest {
  readonly providerRequestId?: string;
}

export interface PreparedProviderRequest {
  /**
   * Canonical, secret-free description of the exact Provider request mapping.
   * Artifact IDs may be retained for lineage, but credentials, signed URLs,
   * file bytes, and base64 payloads must never be included.
   */
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export interface ProviderRequestPreparationRequest extends ProviderInvocationRequest {
  /**
   * Secret-free immutable execution facts. No credential or Artifact body
   * access is available while preparing the persisted request snapshot.
   */
  readonly executionContext?: ProviderInvocationExecutionContext;
}

export interface ProviderUsageMetric {
  readonly metricKey: string;
  readonly numericValue: string;
  readonly unitCode: string;
}

export interface ProviderImageOutput {
  readonly outputRole: string;
  readonly outputIndex: number;
  readonly artifactType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly byteSize?: string;
  readonly sha256?: string;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface ProviderObservation {
  readonly upstreamError?: AttemptFailureFacts["upstreamError"];
  readonly observationKey: string;
  readonly status: ProviderObservedStatus;
  readonly providerRequestId?: string;
  readonly output?: unknown;
  readonly outputs?: readonly ProviderImageOutput[];
  readonly stableErrorCode?: string;
  readonly usage?: readonly ProviderUsageMetric[];
  /**
   * An independent money fact explicitly normalized from a documented
   * Provider response field. Adapters must not derive this from generic usage
   * quantities or an unverified rate table.
   */
  readonly reportedCharge?: ProviderReportedCharge;
}

export interface AsyncProviderAdapter {
  readonly adapterKey: string;
  readonly queryMode: ProviderQueryMode;
  readonly notFoundIsAuthoritative: boolean;
  /**
   * Real Provider Adapters require an immutable execution context plus
   * callback-scoped secret material. Deterministic local adapters default to
   * `none` and remain usable in isolated tests.
   */
  readonly credentialMode?: "none" | "provider-secret";
  /**
   * Adapter-owned normalization allowlist captured when the Registry starts.
   * Any stable code absent from this map fails closed to `manual`.
   */
  readonly failureRetryability?: Readonly<
    Record<string, AttemptFailureRetryability>
  >;
  /**
   * Prepare the exact, sanitized Provider request before the submission fence
   * is crossed. The runner persists this immutable snapshot and passes it back
   * to submit(); retries must consume the same snapshot.
   */
  prepare?(request: ProviderRequestPreparationRequest): PreparedProviderRequest;
  submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation>;
  query(
    request: ProviderQueryRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation>;
}

export type ProviderCallEffect = "not_started" | "unknown";
export type ProviderCallStage = "status_query" | "result_download";

export class ProviderAdapterCallError extends Error {
  public constructor(
    readonly stableErrorCode: string,
    readonly effect: ProviderCallEffect,
    message = stableErrorCode,
    readonly diagnosticKey?: string,
    readonly stage?: ProviderCallStage,
  ) {
    super(message);
    this.name = "ProviderAdapterCallError";
  }
}

export class ProviderAdapterContractError extends Error {
  readonly code = "provider.adapter_contract_invalid";

  public constructor(message: string) {
    super(message);
    this.name = "ProviderAdapterContractError";
  }
}

export interface ProviderAdapterRegistry {
  require(adapterKey: string): AsyncProviderAdapter;
  has(adapterKey: string): boolean;
  classifyFailure(
    adapterKey: string,
    stableErrorCode: string,
  ): AttemptFailureRetryability;
}

export function createProviderAdapterRegistry(
  adapters: readonly AsyncProviderAdapter[],
): ProviderAdapterRegistry {
  const byKey = new Map<string, AsyncProviderAdapter>();
  const retryabilityByKey = new Map<
    string,
    ReadonlyMap<string, AttemptFailureRetryability>
  >();
  const stableErrorCodePattern = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
  for (const adapter of adapters) {
    if (adapter.adapterKey.length < 1 || adapter.adapterKey.length > 160) {
      throw new ProviderAdapterContractError(
        "Provider adapter key must contain between 1 and 160 characters.",
      );
    }
    if (byKey.has(adapter.adapterKey)) {
      throw new ProviderAdapterContractError(
        `Duplicate provider adapter key: ${adapter.adapterKey}`,
      );
    }
    if (adapter.queryMode === "none" && adapter.notFoundIsAuthoritative) {
      throw new ProviderAdapterContractError(
        "A provider adapter without query support cannot declare not-found authoritative.",
      );
    }
    const retryability = new Map<string, AttemptFailureRetryability>();
    for (const [stableErrorCode, classification] of Object.entries(
      adapter.failureRetryability ?? {},
    )) {
      if (
        !stableErrorCodePattern.test(stableErrorCode) ||
        !["retryable", "terminal", "manual"].includes(classification)
      ) {
        throw new ProviderAdapterContractError(
          `Provider Adapter ${adapter.adapterKey} has an invalid failure retryability entry.`,
        );
      }
      retryability.set(stableErrorCode, classification);
    }
    byKey.set(adapter.adapterKey, adapter);
    retryabilityByKey.set(adapter.adapterKey, retryability);
  }

  return Object.freeze({
    require(adapterKey: string): AsyncProviderAdapter {
      const adapter = byKey.get(adapterKey);
      if (!adapter) {
        throw new ProviderAdapterContractError(
          `Provider adapter is not registered: ${adapterKey}`,
        );
      }
      return adapter;
    },
    has(adapterKey: string): boolean {
      return byKey.has(adapterKey);
    },
    classifyFailure(
      adapterKey: string,
      stableErrorCode: string,
    ): AttemptFailureRetryability {
      if (!byKey.has(adapterKey)) {
        throw new ProviderAdapterContractError(
          `Provider adapter is not registered: ${adapterKey}`,
        );
      }
      return (
        retryabilityByKey.get(adapterKey)?.get(stableErrorCode) ?? "manual"
      );
    },
  });
}
