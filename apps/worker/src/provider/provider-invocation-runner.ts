import { createHash } from "node:crypto";

import {
  parseProviderReportedCharge,
  type ApplicationRuntime,
} from "@kanvas/application";
import type { ProviderReportedCharge } from "@kanvas/contracts/provider-billing";
import {
  executeCapabilityMappingPlanV1,
  resolveAttemptOutputArtifactReferences,
} from "@kanvas/contracts/capability";
import {
  digestProviderValue,
  ProviderExecutionContextStoreError,
  ProviderValueCanonicalizationError,
} from "@kanvas/database/runtime";
import type {
  BudgetRejectionReason,
  BudgetReservationStore,
  ProviderExecutionContextStore,
  ProviderInvocationExecutionContext,
  ProviderInvocationClaim,
  ProviderInvocationStore,
  ProviderConfirmedResultFacts,
  ProviderObservationResult,
  ProviderObservationSource,
  ProviderObservedStatus,
  AttemptFailureRetryability,
} from "@kanvas/database/runtime";
import type { AttemptCompletionOutput } from "@kanvas/database/runtime";

import {
  ProviderAdapterCallError,
  ProviderAdapterContractError,
  type AuthorizedProviderInvocationRequest,
  type AsyncProviderAdapter,
  type ProviderAdapterRegistry,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderUsageMetric,
} from "./provider-adapter.js";
import { resolveProviderCapturedAmount } from "./provider-pricing-calculator.js";
import {
  ProviderSecretResolutionError,
  type ProviderSecretMaterialResolver,
} from "./provider-secret-resolver.js";
import type { WorkerAttemptOutputMaterializer } from "../storage/worker-attempt-output-materializer.js";
import {
  createUnavailableWorkerInputArtifactAccess,
  type WorkerInputArtifactResolver,
} from "../storage/worker-input-artifact-resolver.js";

const observedStatuses = new Set<ProviderObservedStatus>([
  "accepted",
  "running",
  "unknown",
  "succeeded",
  "failed",
  "cancelled",
  "not_found",
]);
const boundedAscii = /^[\x21-\x7e]+$/u;
const stableErrorCodePattern = /^[a-z0-9][a-z0-9._-]{0,119}$/u;

function isProviderSecretResolutionError(
  error: unknown,
): error is ProviderSecretResolutionError {
  return (
    error instanceof ProviderSecretResolutionError ||
    (error instanceof Error &&
      error.name === "ProviderSecretResolutionError" &&
      "code" in error &&
      error.code === "provider.secret_resolution_failed")
  );
}
const diagnosticKeyPattern = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
const usageMetricKeyPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const usageUnitCodePattern = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const usageNumericPattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function responseDigestFor(output: unknown): string {
  try {
    return digestProviderValue(output);
  } catch (error) {
    if (error instanceof ProviderValueCanonicalizationError) {
      throw new ProviderAdapterContractError(
        `Provider output is not canonical JSON: ${error.message}`,
      );
    }
    throw error;
  }
}

function preparedProviderRequest(
  claim: ProviderInvocationClaim,
  adapter: AsyncProviderAdapter,
  request: ProviderInvocationRequest,
  executionContext?: ProviderInvocationExecutionContext,
): {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly digest: string;
} {
  if (claim.preparedRequestSnapshot && claim.preparedRequestDigest) {
    if (
      digestProviderValue(claim.preparedRequestSnapshot) !==
      claim.preparedRequestDigest
    ) {
      throw new ProviderAdapterContractError(
        "Prepared Provider request differs from its immutable digest.",
      );
    }
    return Object.freeze({
      snapshot: claim.preparedRequestSnapshot,
      digest: claim.preparedRequestDigest,
    });
  }
  const baseRequest = Object.freeze({
    ...request,
    ...(executionContext
      ? {
          executionContext,
        }
      : {}),
  });
  const adapterPrepared = adapter.prepare?.(baseRequest);
  const snapshot =
    adapterPrepared?.snapshot ??
    Object.freeze({
      schemaVersion: 1,
      adapterKey: claim.adapterKey,
      operation: "submit",
      provider: Object.freeze({
        providerKey: claim.route.providerKey,
        providerEndpointId: claim.route.providerEndpointId,
        apiSurface: claim.route.apiSurface,
        ...(executionContext
          ? {
              providerModelId: executionContext.model.providerModelId,
            }
          : {}),
      }),
      stableRequestKey: claim.stableRequestKey,
      input: claim.input,
      ...(claim.effectiveParameters
        ? {
            effectiveParameters: claim.effectiveParameters,
          }
        : {}),
      ...(executionContext
        ? {
            implementationConfigurationDigest: digestProviderValue(
              executionContext.implementationConfiguration,
            ),
          }
        : {}),
    });
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new ProviderAdapterContractError(
      "Prepared Provider request snapshot must be an object.",
    );
  }
  return Object.freeze({
    snapshot,
    digest: digestProviderValue(snapshot),
  });
}

function deterministicUsageId(
  observationId: string,
  metricKey: string,
): string {
  const bytes = createHash("sha256")
    .update(observationId)
    .update("\0usage\0")
    .update(metricKey)
    .digest()
    .subarray(0, 16);
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = (crockfordBase32[Number(value & 31n)] ?? "0") + encoded;
    value >>= 5n;
  }
  return encoded;
}

class ProviderStoragePreflightError extends Error {}

export interface ProviderInvocationRunnerOptions {
  readonly preflight?: (claim: ProviderInvocationClaim) => Promise<void>;
  readonly runtime: ApplicationRuntime;
  readonly store: ProviderInvocationStore;
  readonly executionContexts?: ProviderExecutionContextStore;
  readonly secretResolver?: ProviderSecretMaterialResolver;
  readonly budgets?: BudgetReservationStore;
  readonly inputArtifactResolver?: WorkerInputArtifactResolver;
  readonly outputMaterializer?: WorkerAttemptOutputMaterializer;
  readonly adapters: ProviderAdapterRegistry;
  readonly nextId: () => string;
  readonly now?: () => Date;
  readonly reconcileDelayMs?: number;
}

export class ProviderBudgetReservationRejectedError extends Error {
  readonly code = "provider.budget_reservation_rejected";

  public constructor(readonly reason: BudgetRejectionReason) {
    super(`Provider budget reservation was rejected: ${reason}`);
    this.name = "ProviderBudgetReservationRejectedError";
  }
}

export interface RunProviderInvocationOptions {
  readonly claim: ProviderInvocationClaim;
  readonly leaseTokenHash: string;
  readonly source: Extract<
    ProviderObservationSource,
    "consumer" | "reconciler"
  >;
}

export type ProviderInvocationRunResult =
  | {
      readonly executionStatus: "lease_lost";
      readonly workKind: ProviderInvocationClaim["workKind"];
    }
  | {
      readonly executionStatus: "observed";
      readonly workKind: ProviderInvocationClaim["workKind"];
      readonly status: ProviderObservedStatus;
      readonly result: ProviderObservationResult;
    };

const maximumTimerDelayMs = 2_147_483_647;

function assertPositiveDuration(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) {
    throw new RangeError(
      `${field} must be between 1 and 3600000 milliseconds.`,
    );
  }
}

function assertBoundedAscii(
  value: string,
  maximumLength: number,
  field: string,
): void {
  if (
    value.length < 1 ||
    value.length > maximumLength ||
    !boundedAscii.test(value)
  ) {
    throw new ProviderAdapterContractError(
      `${field} must be bounded printable ASCII.`,
    );
  }
}

function assertStableErrorCode(value: string): void {
  if (!stableErrorCodePattern.test(value)) {
    throw new ProviderAdapterContractError(
      "Provider stable error code is invalid.",
    );
  }
}

function assertAdapterDescriptor(
  adapter: AsyncProviderAdapter,
  claim: ProviderInvocationClaim,
): void {
  if (
    adapter.adapterKey !== claim.adapterKey ||
    adapter.queryMode !== claim.route.queryMode ||
    adapter.notFoundIsAuthoritative !== claim.route.notFoundIsAuthoritative
  ) {
    throw new ProviderAdapterContractError(
      "Provider adapter descriptor does not match the pinned route.",
    );
  }
  if (claim.workKind === "query") {
    if (claim.route.queryMode === "none") {
      throw new ProviderAdapterContractError(
        "The pinned provider route does not support status queries.",
      );
    }
    if (
      claim.route.queryMode === "provider_request_id" &&
      !claim.providerRequestId
    ) {
      throw new ProviderAdapterContractError(
        "The pinned provider route requires a provider request ID for queries.",
      );
    }
  }
}

function normalizeAdapterObservation(
  observation: ProviderObservation,
  claim: ProviderInvocationClaim,
  classifyFailure: (stableErrorCode: string) => AttemptFailureRetryability,
): ProviderObservation & {
  readonly retryability?: AttemptFailureRetryability;
} {
  assertBoundedAscii(
    observation.observationKey,
    160,
    "Provider observation key",
  );
  if (!observedStatuses.has(observation.status)) {
    throw new ProviderAdapterContractError(
      "Provider adapter returned an unsupported observation status.",
    );
  }
  if (observation.providerRequestId !== undefined) {
    assertBoundedAscii(
      observation.providerRequestId,
      512,
      "Provider request ID",
    );
  }
  if (observation.stableErrorCode !== undefined) {
    assertStableErrorCode(observation.stableErrorCode);
  }
  const requiresStableErrorCode =
    observation.status === "failed" ||
    observation.status === "cancelled" ||
    observation.status === "unknown";
  if (requiresStableErrorCode !== (observation.stableErrorCode !== undefined)) {
    throw new ProviderAdapterContractError(
      "Only failed, cancelled, and unknown Provider observations require a stable error code.",
    );
  }
  if (
    (observation.status === "succeeded") !==
    (observation.output !== undefined)
  ) {
    throw new ProviderAdapterContractError(
      "Only succeeded Provider observations require an output.",
    );
  }
  const outputs = observation.outputs ?? [];
  if (
    outputs.length > 64 ||
    (observation.status !== "succeeded" && outputs.length > 0)
  ) {
    throw new ProviderAdapterContractError(
      "Provider image outputs are only valid for success and cannot exceed 64 descriptors.",
    );
  }
  const usage = observation.usage ?? [];
  if (
    usage.length > 32 ||
    (observation.status !== "succeeded" && usage.length > 0)
  ) {
    throw new ProviderAdapterContractError(
      "Provider usage is only valid for success and cannot exceed 32 metrics.",
    );
  }
  const metricKeys = new Set<string>();
  for (const metric of usage) {
    if (
      !usageMetricKeyPattern.test(metric.metricKey) ||
      !usageUnitCodePattern.test(metric.unitCode) ||
      !usageNumericPattern.test(metric.numericValue) ||
      metricKeys.has(metric.metricKey)
    ) {
      throw new ProviderAdapterContractError(
        "Provider usage metric is invalid or duplicated.",
      );
    }
    metricKeys.add(metric.metricKey);
  }
  if (
    observation.reportedCharge !== undefined &&
    observation.status !== "succeeded"
  ) {
    throw new ProviderAdapterContractError(
      "Provider reported charge is only valid for success.",
    );
  }
  let reportedCharge: ProviderReportedCharge | undefined;
  if (observation.reportedCharge !== undefined) {
    try {
      reportedCharge = parseProviderReportedCharge(observation.reportedCharge);
    } catch (error) {
      throw new ProviderAdapterContractError(
        error instanceof Error
          ? `Provider reported charge is invalid: ${error.message}`
          : "Provider reported charge is invalid.",
      );
    }
  }

  if (
    observation.status === "not_found" &&
    !claim.route.notFoundIsAuthoritative
  ) {
    return Object.freeze({
      ...observation,
      status: "unknown",
      stableErrorCode:
        observation.stableErrorCode ?? "provider.not_found_not_authoritative",
    });
  }
  if (observation.status === "failed" || observation.status === "cancelled") {
    if (!observation.stableErrorCode) {
      throw new ProviderAdapterContractError(
        "Terminal Provider failure lost its stable error code.",
      );
    }
    return Object.freeze({
      ...observation,
      retryability: classifyFailure(observation.stableErrorCode),
    });
  }
  return reportedCharge
    ? Object.freeze({
        ...observation,
        reportedCharge,
      })
    : observation;
}

function errorObservation(
  error: ProviderAdapterCallError,
  claim: ProviderInvocationClaim,
  callNotStarted: boolean,
): ProviderObservation {
  assertStableErrorCode(error.stableErrorCode);
  const authoritativeNotFound =
    callNotStarted &&
    claim.route.queryMode !== "none" &&
    claim.route.notFoundIsAuthoritative;
  const errorDigest = createHash("sha256")
    .update(error.stableErrorCode)
    .digest("hex");
  const diagnosticKey =
    typeof error.diagnosticKey === "string" &&
    diagnosticKeyPattern.test(error.diagnosticKey)
      ? error.diagnosticKey
      : undefined;
  const status = authoritativeNotFound ? "not_found" : "unknown";

  return Object.freeze({
    observationKey: `${claim.workKind}:error:${String(
      claim.leaseGeneration,
    )}:${errorDigest}${diagnosticKey ? `:${diagnosticKey}` : ""}`,
    status,
    ...(status === "unknown" ? { stableErrorCode: error.stableErrorCode } : {}),
  });
}

function isProviderAdapterCallError(
  error: unknown,
): error is ProviderAdapterCallError {
  if (!(error instanceof Error) || error.name !== "ProviderAdapterCallError") {
    return false;
  }
  const candidate = error as Partial<ProviderAdapterCallError>;
  return (
    typeof candidate.stableErrorCode === "string" &&
    stableErrorCodePattern.test(candidate.stableErrorCode) &&
    (candidate.effect === "not_started" || candidate.effect === "unknown")
  );
}

function unclassifiedErrorObservation(
  claim: ProviderInvocationClaim,
): ProviderObservation {
  return Object.freeze({
    observationKey: `${claim.workKind}:error:${String(
      claim.leaseGeneration,
    )}:unclassified`,
    status: "unknown",
    stableErrorCode: "provider.adapter_unclassified",
  });
}

function canScheduleQuery(
  claim: ProviderInvocationClaim,
  observation: ProviderObservation,
): boolean {
  if (
    observation.status !== "accepted" &&
    observation.status !== "running" &&
    observation.status !== "unknown"
  ) {
    return false;
  }
  if (claim.route.queryMode === "client_request_id") {
    return true;
  }
  return (
    claim.route.queryMode === "provider_request_id" &&
    Boolean(observation.providerRequestId ?? claim.providerRequestId)
  );
}

/**
 * Runs one already-leased Provider operation. Both queue consumption and
 * reconciliation use this boundary so no Adapter can bypass descriptor
 * pinning, the runtime fence, or observation adoption.
 */
export class ProviderInvocationRunner {
  readonly #preflight: ProviderInvocationRunnerOptions["preflight"];
  readonly #runtime: ApplicationRuntime;
  readonly #store: ProviderInvocationStore;
  readonly #executionContexts: ProviderExecutionContextStore | undefined;
  readonly #secretResolver: ProviderSecretMaterialResolver | undefined;
  readonly #budgets: BudgetReservationStore | undefined;
  readonly #inputArtifactResolver: WorkerInputArtifactResolver | undefined;
  readonly #outputMaterializer: WorkerAttemptOutputMaterializer | undefined;
  readonly #adapters: ProviderAdapterRegistry;
  readonly #nextId: () => string;
  readonly #now: () => Date;
  readonly #reconcileDelayMs: number;

  public constructor(options: ProviderInvocationRunnerOptions) {
    this.#preflight = options.preflight;
    this.#runtime = options.runtime;
    this.#store = options.store;
    this.#executionContexts = options.executionContexts;
    this.#secretResolver = options.secretResolver;
    this.#budgets = options.budgets;
    this.#inputArtifactResolver = options.inputArtifactResolver;
    this.#outputMaterializer = options.outputMaterializer;
    this.#adapters = options.adapters;
    this.#nextId = options.nextId;
    this.#now = options.now ?? (() => new Date());
    this.#reconcileDelayMs = options.reconcileDelayMs ?? 5_000;
    assertPositiveDuration(this.#reconcileDelayMs, "Provider reconcile delay");
  }

  public async run(
    options: RunProviderInvocationOptions,
  ): Promise<ProviderInvocationRunResult> {
    const { claim } = options;
    const controller = new AbortController();
    const now = this.#now();
    const leaseMs = claim.leaseExpiresAt.getTime() - now.getTime();
    if (leaseMs <= 0)
      return { executionStatus: "lease_lost", workKind: claim.workKind };
    const renewable = this.#store.renewLease && claim.executionDeadlineAt;
    const deadlineAt = renewable
      ? (claim.executionDeadlineAt ?? claim.leaseExpiresAt)
      : claim.leaseExpiresAt;
    let stopped = false;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const armExpiry = (at: Date): void => {
      if (expiryTimer) clearTimeout(expiryTimer);
      const remaining = at.getTime() - this.#now().getTime();
      if (remaining <= 0)
        controller.abort(new Error("provider.invocation_lease_expired"));
      else
        expiryTimer = setTimeout(
          () =>
            controller.abort(new Error("provider.invocation_lease_expired")),
          Math.min(remaining, maximumTimerDelayMs),
        );
    };
    const renew = async (): Promise<void> => {
      if (stopped || controller.signal.aborted || !this.#store.renewLease)
        return;
      try {
        const at = this.#now();
        const expiresAt = await this.#store.renewLease({
          invocationId: claim.invocationId,
          capabilityRunId: claim.capabilityRunId,
          attemptId: claim.attemptId,
          leaseTokenHash: options.leaseTokenHash,
          leaseGeneration: claim.leaseGeneration,
          executionGeneration: claim.executionGeneration,
          now: at,
          leaseUntil: new Date(
            Math.min(at.getTime() + leaseMs, deadlineAt.getTime()),
          ),
        });
        if (stopped || controller.signal.aborted) return;
        if (!expiresAt) {
          controller.abort(new Error("provider.invocation_lease_lost"));
          return;
        }
        armExpiry(expiresAt);
        if (!controller.signal.aborted)
          renewalTimer = setTimeout(
            () => {
              void renew();
            },
            Math.max(1, Math.floor(leaseMs / 3)),
          );
      } catch {
        if (!stopped)
          controller.abort(new Error("provider.invocation_lease_lost"));
      }
    };
    armExpiry(claim.leaseExpiresAt);
    const deadlineTimer = setTimeout(
      () => controller.abort(new Error("provider.execution_deadline_expired")),
      Math.min(
        Math.max(1, deadlineAt.getTime() - now.getTime()),
        maximumTimerDelayMs,
      ),
    );
    if (renewable)
      renewalTimer = setTimeout(
        () => {
          void renew();
        },
        Math.max(1, Math.floor(leaseMs / 3)),
      );
    try {
      return await this.#runOwned(options, controller, deadlineAt);
    } finally {
      stopped = true;
      clearTimeout(deadlineTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      if (renewalTimer) clearTimeout(renewalTimer);
    }
  }

  async #runOwned(
    options: RunProviderInvocationOptions,
    controller: AbortController,
    deadlineAt: Date,
  ): Promise<ProviderInvocationRunResult> {
    const { claim } = options;
    const adapter = this.#adapters.require(claim.adapterKey);
    assertAdapterDescriptor(adapter, claim);

    const request = Object.freeze({
      route: claim.route,
      stableRequestKey: claim.stableRequestKey,
      requestFingerprint: claim.requestFingerprint,
      input: claim.input,
      ...(claim.effectiveParameters
        ? {
            effectiveParameters: claim.effectiveParameters,
          }
        : {}),
      ...(claim.preparedRequestSnapshot && claim.preparedRequestDigest
        ? {
            preparedRequestSnapshot: claim.preparedRequestSnapshot,
            preparedRequestDigest: claim.preparedRequestDigest,
          }
        : {}),
      deadlineAt,
      ...(claim.providerRequestId
        ? { providerRequestId: claim.providerRequestId }
        : {}),
    });
    await this.#runtime.runtimeFence.assertAllowed({
      action: "provider-call",
      expectedGeneration: claim.executionGeneration,
    });

    let resultConfirmed = false;
    const confirmResult = async (
      facts: ProviderConfirmedResultFacts & {
        readonly providerRequestId?: string;
      },
    ): Promise<void> => {
      if (!this.#store.recordConfirmedResult) return;
      controller.signal.throwIfAborted();
      resultConfirmed = await this.#store.recordConfirmedResult({
        invocationId: claim.invocationId,
        capabilityRunId: claim.capabilityRunId,
        attemptId: claim.attemptId,
        leaseTokenHash: options.leaseTokenHash,
        leaseGeneration: claim.leaseGeneration,
        executionGeneration: claim.executionGeneration,
        observationId: this.#nextId(),
        operationKind: claim.workKind === "submit" ? "invoke" : "query",
        ...(facts.providerRequestId
          ? { providerRequestId: facts.providerRequestId }
          : {}),
        facts,
        now: this.#now(),
      });
      if (!resultConfirmed) throw new Error("provider.invocation_lease_lost");
    };
    let observation: ProviderObservation | undefined;
    let callError: unknown;
    let providerExecutionContext:
      ProviderInvocationExecutionContext | undefined;
    let storageRejected = false;
    let budgetRejection: ProviderBudgetReservationRejectedError | undefined;
    try {
      const markSubmissionStarted = async (): Promise<boolean> =>
        claim.workKind !== "submit" ||
        this.#store.markSubmissionStarted({
          invocationId: claim.invocationId,
          capabilityRunId: claim.capabilityRunId,
          attemptId: claim.attemptId,
          leaseTokenHash: options.leaseTokenHash,
          leaseGeneration: claim.leaseGeneration,
          executionGeneration: claim.executionGeneration,
          now: this.#now(),
        });
      const recordPreparedRequest = async (
        executionContext?: ProviderInvocationExecutionContext,
      ): Promise<
        | {
            readonly snapshot: Readonly<Record<string, unknown>>;
            readonly digest: string;
          }
        | undefined
      > => {
        if (claim.workKind !== "submit") {
          return undefined;
        }
        const prepared = preparedProviderRequest(
          claim,
          adapter,
          request,
          executionContext,
        );
        if (
          this.#store.recordPreparedRequest &&
          !(await this.#store.recordPreparedRequest({
            invocationId: claim.invocationId,
            capabilityRunId: claim.capabilityRunId,
            attemptId: claim.attemptId,
            leaseTokenHash: options.leaseTokenHash,
            leaseGeneration: claim.leaseGeneration,
            executionGeneration: claim.executionGeneration,
            snapshot: prepared.snapshot,
            digest: prepared.digest,
            now: this.#now(),
          }))
        ) {
          return undefined;
        }
        return prepared;
      };
      if (adapter.credentialMode === "provider-secret") {
        if (!this.#executionContexts || !this.#secretResolver) {
          throw new ProviderAdapterContractError(
            "Real Provider Adapter runtime dependencies are not configured.",
          );
        }
        let executionContext = await this.#executionContexts.resolve({
          claim,
          now: this.#now(),
        });
        providerExecutionContext = executionContext;
        if (claim.workKind === "submit") {
          try {
            await this.#preflight?.(claim);
          } catch (cause) {
            throw new ProviderStoragePreflightError(
              "Provider storage preflight failed.",
              { cause },
            );
          }
          controller.signal.throwIfAborted();
          executionContext = await this.#reserveBudget(claim, executionContext);
        }
        providerExecutionContext = executionContext;
        const prepared = await recordPreparedRequest(executionContext);
        if (claim.workKind === "submit" && !prepared) {
          return Object.freeze({
            executionStatus: "lease_lost",
            workKind: claim.workKind,
          });
        }
        const callResult = await this.#secretResolver.withResolvedMaterial(
          executionContext.secret,
          async (credential) => {
            controller.signal.throwIfAborted();
            if (!(await markSubmissionStarted())) {
              return Object.freeze({
                leaseLost: true as const,
              });
            }
            const authorizedRequest =
              Object.freeze<AuthorizedProviderInvocationRequest>({
                ...request,
                ...(prepared
                  ? {
                      preparedRequestSnapshot: prepared.snapshot,
                      preparedRequestDigest: prepared.digest,
                    }
                  : {}),
                executionContext,
                credential,
                ...(this.#store.recordConfirmedResult
                  ? { onResultConfirmed: confirmResult }
                  : {}),
                inputArtifacts: this.#inputArtifactResolver
                  ? this.#inputArtifactResolver.bind({
                      workspaceId: claim.workspaceId,
                      capabilityRunId: claim.capabilityRunId,
                      input: claim.input,
                      signal: controller.signal,
                    })
                  : createUnavailableWorkerInputArtifactAccess(),
              });
            const value =
              claim.workKind === "submit"
                ? await adapter.submit(authorizedRequest, controller.signal)
                : await adapter.query(
                    {
                      ...authorizedRequest,
                      ...(claim.providerRequestId
                        ? {
                            providerRequestId: claim.providerRequestId,
                          }
                        : {}),
                    },
                    controller.signal,
                  );
            return Object.freeze({
              leaseLost: false as const,
              observation: value,
            });
          },
        );
        if (callResult.leaseLost) {
          return Object.freeze({
            executionStatus: "lease_lost",
            workKind: claim.workKind,
          });
        }
        observation = callResult.observation;
      } else {
        const prepared = await recordPreparedRequest();
        if (claim.workKind === "submit" && !prepared) {
          return Object.freeze({
            executionStatus: "lease_lost",
            workKind: claim.workKind,
          });
        }
        if (!(await markSubmissionStarted())) {
          return Object.freeze({
            executionStatus: "lease_lost",
            workKind: claim.workKind,
          });
        }
        observation =
          claim.workKind === "submit"
            ? await adapter.submit(
                {
                  ...request,
                  ...(prepared
                    ? {
                        preparedRequestSnapshot: prepared.snapshot,
                        preparedRequestDigest: prepared.digest,
                      }
                    : {}),
                },
                controller.signal,
              )
            : await adapter.query(request, controller.signal);
      }
    } catch (error) {
      if (error instanceof ProviderExecutionContextStoreError) {
        throw error;
      }
      if (error instanceof ProviderStoragePreflightError) {
        storageRejected = true;
      } else if (isProviderSecretResolutionError(error)) {
        callError = new ProviderAdapterCallError(
          error.code,
          "unknown",
          error.message,
        );
      } else if (error instanceof ProviderBudgetReservationRejectedError) {
        budgetRejection = error;
      } else {
        callError = error;
      }
    }

    // The result is intentionally left unadopted if the runtime generation
    // changed while the remote call was in flight.
    await this.#runtime.runtimeFence.assertAllowed({
      action: "provider-call",
      expectedGeneration: claim.executionGeneration,
    });

    if (storageRejected) {
      const now = this.#now();
      const result = await this.#store.appendAndAdoptObservation({
        observationId: this.#nextId(),
        observationKey: `submit:storage-preflight:${claim.leaseGeneration}`,
        invocationId: claim.invocationId,
        capabilityRunId: claim.capabilityRunId,
        attemptId: claim.attemptId,
        leaseTokenHash: options.leaseTokenHash,
        leaseGeneration: claim.leaseGeneration,
        executionGeneration: claim.executionGeneration,
        operationKind: "invoke",
        source: options.source,
        requestDigest: claim.requestFingerprint,
        status: "failed",
        stableErrorCode: "provider.storage_preflight_failed",
        callEffect: "not_started",
        retryability: "manual",
        nextAttemptId: this.#nextId(),
        terminalOutboxEventId: this.#nextId(),
        observedAt: now,
        recordedAt: now,
      });
      if (
        result.terminal &&
        result.adoption === "applied" &&
        providerExecutionContext?.budgetReservationId
      ) {
        await this.#settleTerminalBudget(
          claim,
          providerExecutionContext,
          "failed",
          [],
          undefined,
          true,
          now,
        );
      }
      return {
        executionStatus: "observed",
        workKind: claim.workKind,
        status: "failed",
        result,
      };
    }
    if (budgetRejection) {
      const observedAt = this.#now();
      const stableErrorCode = `provider.${budgetRejection.reason}`;
      const result = await this.#store.appendAndAdoptObservation({
        observationId: this.#nextId(),
        observationKey: `submit:budget:${budgetRejection.reason}`,
        invocationId: claim.invocationId,
        capabilityRunId: claim.capabilityRunId,
        attemptId: claim.attemptId,
        leaseTokenHash: options.leaseTokenHash,
        leaseGeneration: claim.leaseGeneration,
        executionGeneration: claim.executionGeneration,
        operationKind: "invoke",
        source: options.source,
        requestDigest: claim.requestFingerprint,
        status: "failed",
        stableErrorCode,
        callEffect: "not_started",
        retryability:
          budgetRejection.reason === "budget_hard_limit_exceeded"
            ? "terminal"
            : "manual",
        nextAttemptId: this.#nextId(),
        terminalOutboxEventId: this.#nextId(),
        observedAt,
        recordedAt: observedAt,
      });
      return Object.freeze({
        executionStatus: "observed",
        workKind: claim.workKind,
        status: "failed",
        result,
      });
    }

    // A result GET or status query not starting says nothing about whether
    // the earlier paid generation succeeded. Never use it as release evidence.
    const callNotStarted =
      claim.workKind === "submit" &&
      !resultConfirmed &&
      isProviderAdapterCallError(callError) &&
      callError.effect === "not_started" &&
      callError.stage !== "result_download";
    if (callError !== undefined) {
      if (
        controller.signal.aborted ||
        callError instanceof ProviderAdapterContractError
      ) {
        if (callError instanceof Error) {
          throw callError;
        }
        throw new ProviderAdapterContractError(
          "Provider adapter threw a non-Error value.",
        );
      }
      observation = isProviderAdapterCallError(callError)
        ? errorObservation(callError, claim, callNotStarted)
        : unclassifiedErrorObservation(claim);
    }
    if (!observation) {
      throw new ProviderAdapterContractError(
        "Provider adapter returned no observation.",
      );
    }
    let normalized = normalizeAdapterObservation(
      observation,
      claim,
      (stableErrorCode) =>
        this.#adapters.classifyFailure(claim.adapterKey, stableErrorCode),
    );
    if (normalized.status === "succeeded") {
      await confirmResult({
        usage: normalized.usage ?? [],
        ...(normalized.reportedCharge
          ? { reportedCharge: normalized.reportedCharge }
          : {}),
        ...(normalized.providerRequestId
          ? { providerRequestId: normalized.providerRequestId }
          : {}),
      });
      let output: unknown;
      try {
        output = executeCapabilityMappingPlanV1(claim.compiledOutputMapping, {
          result: normalized.output,
        });
      } catch (error) {
        throw new ProviderAdapterContractError(
          error instanceof Error
            ? `Provider output mapping failed: ${error.message}`
            : "Provider output mapping failed.",
        );
      }
      normalized = Object.freeze({
        ...normalized,
        output,
      });
    }
    let completionOutputs: readonly AttemptCompletionOutput[] = Object.freeze(
      [],
    );
    if (
      normalized.status === "succeeded" &&
      (normalized.outputs?.length ?? 0) > 0
    ) {
      if (!this.#outputMaterializer) {
        throw new ProviderAdapterContractError(
          "Provider image outputs require a configured trusted Storage runtime.",
        );
      }
      if (!claim.executionDeadlineAt) {
        throw new ProviderAdapterContractError(
          "Provider image output materialization requires the Attempt execution deadline.",
        );
      }
      try {
        completionOutputs = await this.#outputMaterializer.materialize({
          context: {
            workspaceId: claim.workspaceId,
            actorId: claim.actorId,
            attemptId: claim.attemptId,
            executionDeadlineAt: claim.executionDeadlineAt,
            executionTarget: "provider",
          },
          outputs: normalized.outputs ?? [],
          signal: controller.signal,
        });
        normalized = Object.freeze({
          ...normalized,
          output: resolveAttemptOutputArtifactReferences(
            normalized.output,
            completionOutputs,
          ),
          outputs: Object.freeze([]),
        });
      } catch {
        // The remote image side effect has already succeeded. Retrying submit
        // here could create another paid image, especially for Images APIs
        // without a status-query surface. Keep delivery unresolved; confirmed
        // remote billing facts remain available to the existing settlement loop.
        // Queryable tasks can retry the same result without resubmission.
        completionOutputs = Object.freeze([]);
        normalized = Object.freeze({
          observationKey: `${normalized.observationKey}:output-materialization-failed`,
          status: "unknown",
          ...(normalized.providerRequestId
            ? {
                providerRequestId: normalized.providerRequestId,
              }
            : {}),
          stableErrorCode: "provider.output_materialization_failed",
          outputs: Object.freeze([]),
        });
      }
    }
    controller.signal.throwIfAborted();
    const observedAt = this.#now();
    let queryScheduled = canScheduleQuery(claim, normalized);
    if (normalized.status === "unknown" && !queryScheduled) {
      if (!normalized.stableErrorCode) {
        throw new ProviderAdapterContractError(
          "Unqueryable Provider observation lost its stable error code.",
        );
      }
      normalized = Object.freeze({
        observationKey: `${normalized.observationKey}:unqueryable`,
        status: "failed",
        ...(normalized.providerRequestId
          ? {
              providerRequestId: normalized.providerRequestId,
            }
          : {}),
        stableErrorCode: normalized.stableErrorCode,
        retryability: "manual",
      });
      queryScheduled = false;
    }
    const observationId = this.#nextId();
    const commonObservation = {
      ...(normalized.upstreamError
        ? { upstreamError: normalized.upstreamError }
        : {}),
      observationId,
      observationKey: normalized.observationKey,
      invocationId: claim.invocationId,
      capabilityRunId: claim.capabilityRunId,
      attemptId: claim.attemptId,
      leaseTokenHash: options.leaseTokenHash,
      leaseGeneration: claim.leaseGeneration,
      executionGeneration: claim.executionGeneration,
      operationKind: claim.workKind === "submit" ? "invoke" : "query",
      source: options.source,
      ...(normalized.providerRequestId
        ? { providerRequestId: normalized.providerRequestId }
        : {}),
      requestDigest: claim.requestFingerprint,
      observedAt,
      recordedAt: observedAt,
    } as const;
    let result: ProviderObservationResult;
    switch (normalized.status) {
      case "succeeded": {
        if (normalized.output === undefined) {
          throw new ProviderAdapterContractError(
            "Succeeded Provider observation lost its normalized output.",
          );
        }
        const responseDigest = responseDigestFor(normalized.output);
        const reportedChargeEvidenceDigest = normalized.reportedCharge
          ? digestProviderValue({
              responseDigest,
              reportedCharge: normalized.reportedCharge,
            })
          : undefined;
        const initialUsage = [
          ...(normalized.usage?.map((metric) =>
            Object.freeze({
              id: deterministicUsageId(observationId, metric.metricKey),
              entryKey: `provider:${claim.invocationId}:${metric.metricKey}`,
              metricKey: metric.metricKey,
              sourceKind: "provider_reported" as const,
              evidenceDigest: responseDigest,
              providerInvocationId: claim.invocationId,
              ...(claim.route.providerProtocolVersion === 1
                ? {
                    pricingRevisionId: claim.route.pricingRevisionId,
                  }
                : {}),
              observedAt,
              valueDimension: "quantity" as const,
              unitCode: metric.unitCode,
              entryKind: "observation" as const,
              numericValue: metric.numericValue,
            }),
          ) ?? []),
          ...(normalized.reportedCharge
            ? [
                Object.freeze({
                  id: deterministicUsageId(
                    observationId,
                    "provider_reported_charge.money",
                  ),
                  entryKey: `provider:${claim.invocationId}:reported-charge`,
                  metricKey: "provider_reported_charge",
                  sourceKind: "provider_reported" as const,
                  evidenceDigest:
                    reportedChargeEvidenceDigest ?? responseDigest,
                  providerInvocationId: claim.invocationId,
                  ...(claim.route.providerProtocolVersion === 1
                    ? {
                        pricingRevisionId: claim.route.pricingRevisionId,
                      }
                    : {}),
                  observedAt,
                  valueDimension: "money" as const,
                  currencyCode: normalized.reportedCharge.currencyCode,
                  entryKind: "observation" as const,
                  numericValue: normalized.reportedCharge.amount,
                }),
              ]
            : []),
        ];
        const completion = {
          ...commonObservation,
          status: "succeeded" as const,
          output: normalized.output,
          responseDigest,
          completionId: this.#nextId(),
          terminalOutboxEventId: this.#nextId(),
          outputs: completionOutputs,
          initialUsage,
        };
        try {
          result = await this.#store.appendAndAdoptObservation(completion);
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? error.code
              : undefined;
          if (
            typeof code !== "string" ||
            ![
              "ECONNRESET",
              "ETIMEDOUT",
              "PROTOCOL_CONNECTION_LOST",
              "ER_LOCK_DEADLOCK",
              "ER_LOCK_WAIT_TIMEOUT",
            ].includes(code)
          )
            throw error;
          controller.signal.throwIfAborted();
          // Replay the same observation/completion identities after a transient
          // database failure, including an acknowledgement lost after commit.
          result = await this.#store.appendAndAdoptObservation(completion);
        }
        break;
      }
      case "failed":
      case "cancelled": {
        if (!normalized.stableErrorCode || !normalized.retryability) {
          throw new ProviderAdapterContractError(
            "Terminal Provider failure lost its trusted classification.",
          );
        }
        result = await this.#store.appendAndAdoptObservation({
          ...commonObservation,
          status: normalized.status,
          stableErrorCode: normalized.stableErrorCode,
          ...(normalized.upstreamError
            ? { responseDigest: digestProviderValue(normalized.upstreamError) }
            : {}),
          ...(callNotStarted ? { callEffect: "not_started" as const } : {}),
          retryability: normalized.retryability,
          nextAttemptId: this.#nextId(),
          terminalOutboxEventId: this.#nextId(),
        });
        break;
      }
      case "not_found": {
        result = await this.#store.appendAndAdoptObservation({
          ...commonObservation,
          status: "not_found",
          nextAttemptId: this.#nextId(),
          terminalOutboxEventId: this.#nextId(),
        });
        break;
      }
      case "accepted":
      case "running": {
        result = await this.#store.appendAndAdoptObservation({
          ...commonObservation,
          status: normalized.status,
          ...(queryScheduled
            ? {
                nextReconcileAt: new Date(
                  observedAt.getTime() + this.#reconcileDelayMs,
                ),
              }
            : {}),
        });
        break;
      }
      case "unknown": {
        if (!normalized.stableErrorCode) {
          throw new ProviderAdapterContractError(
            "Unknown Provider observation lost its stable error code.",
          );
        }
        result = await this.#store.appendAndAdoptObservation({
          ...commonObservation,
          status: "unknown",
          stableErrorCode: normalized.stableErrorCode,
          ...(queryScheduled
            ? {
                nextReconcileAt: new Date(
                  observedAt.getTime() + this.#reconcileDelayMs,
                ),
              }
            : {}),
        });
        break;
      }
    }

    if (
      !resultConfirmed &&
      result.terminal &&
      result.adoption === "applied" &&
      providerExecutionContext?.budgetReservationId
    ) {
      await this.#settleTerminalBudget(
        claim,
        providerExecutionContext,
        normalized.status,
        normalized.usage ?? [],
        normalized.reportedCharge,
        callNotStarted,
        observedAt,
      );
    }

    return Object.freeze({
      executionStatus: "observed",
      workKind: claim.workKind,
      status: normalized.status,
      result,
    });
  }

  async #reserveBudget(
    claim: ProviderInvocationClaim,
    executionContext: ProviderInvocationExecutionContext,
  ): Promise<ProviderInvocationExecutionContext> {
    if (executionContext.budgetReservationId || claim.budgetReservationId) {
      if (executionContext.budgetReservationId !== claim.budgetReservationId) {
        throw new ProviderAdapterContractError(
          "Provider claim and execution context disagree on the budget reservation.",
        );
      }
      return executionContext;
    }
    if (!this.#budgets || !this.#executionContexts) {
      throw new ProviderAdapterContractError(
        "Real Provider Adapter budget runtime is not configured.",
      );
    }
    const now = this.#now();
    const expiresAt = claim.executionDeadlineAt;
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
      throw new ProviderAdapterContractError(
        "Provider claim has no future execution deadline for its budget hold.",
      );
    }
    const reservation = await this.#budgets.reserve({
      reservationId: this.#nextId(),
      ledgerEntryId: this.#nextId(),
      workspaceId: claim.workspaceId,
      budgetAccountId: executionContext.route.budgetAccountId,
      reservationKey: `provider:${claim.stableRequestKey}`,
      requestDigest: claim.requestFingerprint,
      ...(claim.workflowRunId ? { workflowRunId: claim.workflowRunId } : {}),
      capabilityRunId: claim.capabilityRunId,
      capabilityAttemptId: claim.attemptId,
      pricingRevisionId: executionContext.pricing.revisionId,
      providerInvocationId: claim.invocationId,
      currencyCode: executionContext.route.maximumCharge.currencyCode,
      maximumChargeAmount: executionContext.route.maximumCharge.amount,
      expiresAt,
      now,
      audit: {
        auditEventId: this.#nextId(),
        actorPrincipalId: null,
        actorType: "system",
        authenticationRefType: "none",
        authenticationRefHash: null,
        authorityType: "system",
        authorityId: null,
        authorityVersion: null,
      },
    });
    if (reservation.status === "rejected") {
      throw new ProviderBudgetReservationRejectedError(reservation.reason);
    }
    const resolved = await this.#executionContexts.resolve({
      claim: {
        ...claim,
        budgetReservationId: reservation.reservationId,
      },
      now: this.#now(),
    });
    if (resolved.budgetReservationId !== reservation.reservationId) {
      throw new ProviderAdapterContractError(
        "Provider invocation did not retain its budget reservation binding.",
      );
    }
    return resolved;
  }

  async #settleTerminalBudget(
    claim: ProviderInvocationClaim,
    executionContext: ProviderInvocationExecutionContext,
    status: ProviderObservedStatus,
    usage: readonly ProviderUsageMetric[],
    reportedCharge: ProviderReportedCharge | undefined,
    callNotStarted: boolean,
    now: Date,
  ): Promise<void> {
    const reservationId = executionContext.budgetReservationId;
    if (!reservationId || !this.#budgets) {
      throw new ProviderAdapterContractError(
        "Terminal Provider budget settlement is not configured.",
      );
    }
    const capturedAmount =
      status === "succeeded"
        ? resolveProviderCapturedAmount({
            pricing: executionContext.pricing.pricing,
            usage,
            ...(reportedCharge ? { reportedCharge } : {}),
            currencyCode: executionContext.route.maximumCharge.currencyCode,
            maximumChargeAmount: executionContext.route.maximumCharge.amount,
          })
        : undefined;
    let kind: "capture" | "release" | "unknown_hold" = "unknown_hold";
    if (status === "not_found" || callNotStarted) {
      kind = "release";
    } else if (capturedAmount !== undefined) {
      kind = "capture";
    }
    await this.#budgets.finalize({
      workspaceId: claim.workspaceId,
      budgetAccountId: executionContext.route.budgetAccountId,
      reservationId,
      ledgerEntryId: this.#nextId(),
      ledgerEntryKey: `provider-terminal:${claim.invocationId}`,
      requestDigest: claim.requestFingerprint,
      kind,
      ...(kind === "capture" ? { capturedAmount: capturedAmount ?? "0" } : {}),
      now,
      audit: {
        auditEventId: this.#nextId(),
        actorPrincipalId: null,
        actorType: "system",
        authenticationRefType: "none",
        authenticationRefHash: null,
        authorityType: "system",
        authorityId: null,
        authorityVersion: null,
      },
    });
  }
}
