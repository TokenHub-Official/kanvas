import {
  ProviderAdapterCallError,
  ProviderAdapterContractError,
  type AsyncProviderAdapter,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderObservedStatus,
  type ProviderQueryRequest,
} from "./provider-adapter.js";

export type FakeProviderFailurePoint =
  "before_submit" | "after_accept_before_response" | "before_query_response";

export interface FakeProviderRecord {
  readonly requestScopeDigest: string;
  readonly stableRequestKey: string;
  readonly requestFingerprint: string;
  readonly providerRequestId: string;
  readonly status: Exclude<ProviderObservedStatus, "not_found" | "unknown">;
  readonly output?: unknown;
  readonly stableErrorCode?: string;
}

export interface FakeProviderStats {
  readonly remoteCreateCount: number;
  readonly submitCallCount: number;
  readonly queryCallCount: number;
}

export interface FakeAsyncProviderOptions {
  readonly adapterKey?: string;
  readonly nextProviderRequestId?: () => string;
  readonly initialStatus?: FakeProviderRecord["status"];
}

function ledgerKey(
  requestScopeDigest: string,
  stableRequestKey: string,
): string {
  return `${requestScopeDigest}\u0000${stableRequestKey}`;
}

function throwIfAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

export class FakeAsyncProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey: string;
  readonly queryMode = "client_request_id" as const;
  readonly notFoundIsAuthoritative = true;
  readonly failureRetryability = Object.freeze({
    "fake.remote_failed": "retryable" as const,
    "fake.invalid_request": "terminal" as const,
  });
  readonly #nextProviderRequestId: () => string;
  readonly #initialStatus: FakeProviderRecord["status"];
  readonly #ledger = new Map<string, FakeProviderRecord>();
  readonly #failures: FakeProviderFailurePoint[] = [];
  #remoteCreateCount = 0;
  #submitCallCount = 0;
  #queryCallCount = 0;

  public constructor(options: FakeAsyncProviderOptions = {}) {
    this.adapterKey = options.adapterKey ?? "fake.async.provider";
    this.#nextProviderRequestId =
      options.nextProviderRequestId ??
      (() => `fake-request-${String(this.#remoteCreateCount + 1)}`);
    this.#initialStatus = options.initialStatus ?? "running";
  }

  public failNextAt(point: FakeProviderFailurePoint): void {
    this.#failures.push(point);
  }

  public inspect(
    requestScopeDigest: string,
    stableRequestKey: string,
  ): FakeProviderRecord | undefined {
    return this.#ledger.get(ledgerKey(requestScopeDigest, stableRequestKey));
  }

  public setRemoteState(
    requestScopeDigest: string,
    stableRequestKey: string,
    state: {
      readonly status: FakeProviderRecord["status"];
      readonly output?: unknown;
      readonly stableErrorCode?: string;
    },
  ): void {
    const key = ledgerKey(requestScopeDigest, stableRequestKey);
    const current = this.#ledger.get(key);
    if (!current) {
      throw new ProviderAdapterContractError(
        "Cannot mutate a fake provider request that does not exist.",
      );
    }
    this.#ledger.set(
      key,
      Object.freeze({
        ...current,
        status: state.status,
        ...(state.output === undefined ? {} : { output: state.output }),
        ...(state.stableErrorCode === undefined
          ? {}
          : { stableErrorCode: state.stableErrorCode }),
      }),
    );
  }

  public stats(): FakeProviderStats {
    return Object.freeze({
      remoteCreateCount: this.#remoteCreateCount,
      submitCallCount: this.#submitCallCount,
      queryCallCount: this.#queryCallCount,
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    await Promise.resolve();
    throwIfAborted(signal);
    this.#submitCallCount += 1;
    if (this.#consumeFailure("before_submit")) {
      throw new ProviderAdapterCallError("fake.before_submit", "not_started");
    }

    const key = ledgerKey(
      request.route.requestScopeDigest,
      request.stableRequestKey,
    );
    const existing = this.#ledger.get(key);
    if (
      existing &&
      existing.requestFingerprint !== request.requestFingerprint
    ) {
      throw new ProviderAdapterContractError(
        "The stable provider request key is already bound to a different request fingerprint.",
      );
    }

    const record =
      existing ??
      Object.freeze<FakeProviderRecord>({
        requestScopeDigest: request.route.requestScopeDigest,
        stableRequestKey: request.stableRequestKey,
        requestFingerprint: request.requestFingerprint,
        providerRequestId: this.#nextProviderRequestId(),
        status: this.#initialStatus,
      });
    if (!existing) {
      this.#ledger.set(key, record);
      this.#remoteCreateCount += 1;
    }

    if (this.#consumeFailure("after_accept_before_response")) {
      throw new ProviderAdapterCallError(
        "fake.after_accept_before_response",
        "unknown",
      );
    }
    throwIfAborted(signal);
    return observationFrom(record, "submit");
  }

  public async query(
    request: ProviderQueryRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    await Promise.resolve();
    throwIfAborted(signal);
    this.#queryCallCount += 1;
    if (this.#consumeFailure("before_query_response")) {
      throw new ProviderAdapterCallError(
        "fake.before_query_response",
        "unknown",
      );
    }
    const record = this.#ledger.get(
      ledgerKey(request.route.requestScopeDigest, request.stableRequestKey),
    );
    if (!record) {
      return Object.freeze({
        observationKey: `query:not-found:${request.stableRequestKey}`,
        status: "not_found",
      });
    }
    if (
      request.providerRequestId &&
      request.providerRequestId !== record.providerRequestId
    ) {
      throw new ProviderAdapterContractError(
        "Provider request identity does not match the stable request key.",
      );
    }
    throwIfAborted(signal);
    return observationFrom(record, "query");
  }

  #consumeFailure(point: FakeProviderFailurePoint): boolean {
    const index = this.#failures.indexOf(point);
    if (index < 0) {
      return false;
    }
    this.#failures.splice(index, 1);
    return true;
  }
}

function observationFrom(
  record: FakeProviderRecord,
  operation: "submit" | "query",
): ProviderObservation {
  return Object.freeze({
    observationKey: `${operation}:${record.providerRequestId}:${record.status}`,
    status: record.status,
    providerRequestId: record.providerRequestId,
    ...(record.output === undefined ? {} : { output: record.output }),
    ...(record.stableErrorCode === undefined
      ? {}
      : { stableErrorCode: record.stableErrorCode }),
  });
}
