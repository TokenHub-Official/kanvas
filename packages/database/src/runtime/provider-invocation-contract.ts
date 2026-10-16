import type { ProviderResultEvidence } from "./provider-result-links.js";
import type { ProviderReportedCharge } from "@kanvas/contracts/provider-billing";
import type { ProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderModelParameterValue } from "@kanvas/contracts/provider-model";
import type { CompiledCapabilityMappingPlanV1 } from "@kanvas/contracts/capability";
import type {
  AttemptFailureTransitionStatus,
  AttemptFailureFacts,
} from "./attempt-failure-store.js";
import type { AttemptFailureRetryability } from "./attempt-transition-policy.js";
import type {
  AttemptCompletionOutput,
  InitialUsageEntry,
} from "./attempt-completion-store.js";

import type { InboxConsumptionResult, InboxDelivery } from "./inbox-receipt.js";

export type ProviderInvocationWorkKind = "submit" | "query";

export type ProviderObservedStatus =
  | "accepted"
  | "running"
  | "unknown"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "not_found";

export type ProviderObservationOperation =
  "invoke" | "query" | "cancel" | "callback";

export type ProviderObservationSource =
  "consumer" | "adapter" | "provider_callback" | "reconciler" | "operator";

export type ProviderObservationAdoption =
  | "applied"
  | "noop_terminal"
  | "noop_cancelled"
  | "noop_stale"
  | "manual"
  | "rejected";

export interface ProviderInvocationClaim {
  readonly workKind: ProviderInvocationWorkKind;
  readonly invocationId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly invocationKind?: "user" | "agent" | "canvas" | "workflow";
  readonly workflowRunId?: string;
  readonly nodeRunId?: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly implementationRevisionId: string;
  readonly implementationDigest: string;
  readonly adapterKey: string;
  readonly route: ProviderRouteSnapshot;
  readonly input: unknown;
  readonly compiledOutputMapping: CompiledCapabilityMappingPlanV1;
  readonly effectiveParameters?: Readonly<
    Record<string, ProviderModelParameterValue>
  >;
  readonly parameterResolutionDigest?: string;
  readonly preparedRequestSnapshot?: Readonly<Record<string, unknown>>;
  readonly preparedRequestDigest?: string;
  readonly stableRequestKey: string;
  readonly requestFingerprint: string;
  readonly providerRequestId?: string;
  readonly budgetReservationId?: string;
  readonly leaseGeneration: number;
  readonly executionGeneration: number;
  readonly leaseExpiresAt: Date;
  /**
   * Absolute attempt deadline used for holds that must survive multiple
   * invocation leases. Store-created production claims always provide it.
   */
  readonly executionDeadlineAt?: Date;
}

export interface ClaimProviderDispatchOptions {
  readonly invocationId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly executionGeneration: number;
  readonly delivery: InboxDelivery;
}

export interface MarkProviderSubmissionStartedOptions {
  readonly invocationId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly leaseGeneration: number;
  readonly executionGeneration: number;
  readonly now: Date;
}

export interface RecordPreparedProviderRequestOptions {
  readonly invocationId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly leaseGeneration: number;
  readonly executionGeneration: number;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly digest: string;
  readonly now: Date;
}

interface AppendProviderObservationBase {
  readonly upstreamError?: AttemptFailureFacts["upstreamError"];
  readonly observationId: string;
  readonly observationKey: string;
  readonly invocationId: string;
  readonly capabilityRunId: string;
  readonly attemptId: string;
  readonly leaseTokenHash: string;
  readonly leaseGeneration: number;
  readonly executionGeneration: number;
  readonly operationKind: ProviderObservationOperation;
  readonly source: ProviderObservationSource;
  readonly providerRequestId?: string;
  readonly requestDigest?: string;
  readonly providerEventDigest?: string;
  readonly nextReconcileAt?: Date;
  readonly observedAt: Date;
  readonly recordedAt: Date;
}

export type AppendProviderObservationOptions =
  | (AppendProviderObservationBase & {
      readonly status: "succeeded";
      readonly stableErrorCode?: never;
      readonly retryability?: never;
      readonly output: unknown;
      readonly responseDigest: string;
      readonly completionId: string;
      readonly terminalOutboxEventId: string;
      readonly outputs?: readonly AttemptCompletionOutput[];
      readonly initialUsage?: readonly InitialUsageEntry[];
    })
  | (AppendProviderObservationBase & {
      readonly status: "failed" | "cancelled";
      readonly stableErrorCode: string;
      /**
       * `not_started` is reserved for trusted Kanvas preflight gates such as
       * a rejected budget reservation. Adapter failures default to started.
       */
      readonly callEffect?: "started" | "not_started";
      /**
       * Derived by the runtime from the selected Adapter's startup-time
       * allowlist. Unknown codes fail closed to manual.
       */
      readonly retryability: AttemptFailureRetryability;
      readonly output?: never;
      readonly responseDigest?: string;
      readonly completionId?: never;
      readonly nextAttemptId: string;
      readonly terminalOutboxEventId: string;
    })
  | (AppendProviderObservationBase & {
      readonly status: "not_found";
      readonly stableErrorCode?: never;
      readonly retryability?: never;
      readonly output?: never;
      readonly responseDigest?: string;
      readonly completionId?: never;
      readonly nextAttemptId: string;
      readonly terminalOutboxEventId: string;
    })
  | (AppendProviderObservationBase & {
      readonly status: "unknown";
      readonly stableErrorCode: string;
      readonly retryability?: never;
      readonly output?: never;
      readonly responseDigest?: string;
      readonly completionId?: never;
      readonly nextAttemptId?: never;
      readonly terminalOutboxEventId?: never;
    })
  | (AppendProviderObservationBase & {
      readonly status: "accepted" | "running";
      readonly stableErrorCode?: never;
      readonly retryability?: never;
      readonly output?: never;
      readonly responseDigest?: string;
      readonly completionId?: never;
      readonly nextAttemptId?: never;
      readonly terminalOutboxEventId?: never;
    });

export interface ProviderObservationResult {
  readonly recorded: boolean;
  readonly adoption: ProviderObservationAdoption;
  readonly terminal: boolean;
  readonly failureTransition?: AttemptFailureTransitionStatus;
}

export interface ScanProviderRecoveryOptions {
  readonly now: Date;
  readonly batchSize: number;
}

export type ProviderRecoveryReason =
  | "expired_submit_lease"
  | "expired_query_lease"
  | "due_query"
  | "execution_deadline"
  | "cancel_deadline";

export interface ProviderRecoveryCandidate {
  readonly invocationId: string;
  readonly reason: ProviderRecoveryReason;
}

export interface ClaimProviderRecoveryOptions {
  readonly invocationId: string;
  readonly leaseTokenHash: string;
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly executionGeneration: number;
  readonly terminalOutboxEventId?: string;
}

export interface ProviderConfirmedResultFacts {
  /** Private upstream evidence retained before result policy checks or materialization. */
  readonly resultEvidence?: ProviderResultEvidence;
  /** Validated remote output links; private to the original run's readers. */
  readonly resultUrls?: readonly string[];
  readonly usage: readonly {
    readonly metricKey: string;
    readonly numericValue: string;
    readonly unitCode: string;
  }[];
  readonly reportedCharge?: ProviderReportedCharge;
}

export interface ProviderInvocationStore {
  recordConfirmedResult?(
    options: MarkProviderSubmissionStartedOptions & {
      readonly observationId: string;
      readonly providerRequestId?: string;
      readonly operationKind: "invoke" | "query";
      readonly facts: ProviderConfirmedResultFacts;
    },
  ): Promise<boolean>;
  /** Renew existing ownership, bounded by the Attempt's original deadline. */
  renewLease?(
    options: MarkProviderSubmissionStartedOptions & {
      readonly leaseUntil: Date;
    },
  ): Promise<Date | undefined>;
  claimDispatch(
    options: ClaimProviderDispatchOptions,
  ): Promise<InboxConsumptionResult<ProviderInvocationClaim | undefined>>;
  markSubmissionStarted(
    options: MarkProviderSubmissionStartedOptions,
  ): Promise<boolean>;
  recordPreparedRequest?(
    options: RecordPreparedProviderRequestOptions,
  ): Promise<boolean>;
  appendAndAdoptObservation(
    options: AppendProviderObservationOptions,
  ): Promise<ProviderObservationResult>;
  scanRecoveryCandidates(
    options: ScanProviderRecoveryOptions,
  ): Promise<readonly ProviderRecoveryCandidate[]>;
  claimRecovery(
    options: ClaimProviderRecoveryOptions,
  ): Promise<ProviderInvocationClaim | undefined>;
}

export type ProviderInvocationStoreErrorCode =
  | "provider_invocation.invalid_argument"
  | "provider_invocation.claiming_disabled"
  | "provider_invocation.identity_conflict"
  | "provider_invocation.snapshot_invalid";

export class ProviderInvocationStoreError extends Error {
  constructor(
    readonly code: ProviderInvocationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderInvocationStoreError";
  }
}
