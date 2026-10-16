import type {
  ProviderExecutionAdapterKind,
  ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";

import type { ProviderTextHttpAdapterKey } from "../config.js";
import {
  ProviderAdapterContractError,
  type AsyncProviderAdapter,
  type AuthorizedProviderInvocationRequest,
  type AuthorizedProviderQueryRequest,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderQueryRequest,
  type ProviderUsageMetric,
} from "./provider-adapter.js";
import type {
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "./provider-http-transport.js";
import {
  canonicalOpenAiUsageMetrics,
  normalizeOpenAiUsage,
} from "./openai-canonical-usage.js";

const stableCodePartPattern = /[^a-z0-9._-]+/gu;

type ApiSurface = "responses" | "chat-completions";

interface AdapterDescriptor {
  readonly adapterKey: ProviderTextHttpAdapterKey;
  readonly adapterKind: ProviderExecutionAdapterKind;
  readonly surface: ApiSurface;
  readonly queryMode: "none" | "provider_request_id";
  readonly notFoundIsAuthoritative: boolean;
  readonly forceStoredResponse: boolean;
  readonly disableOpenRouterFallbacks: boolean;
}

const descriptors: Readonly<
  Record<ProviderTextHttpAdapterKey, AdapterDescriptor>
> = Object.freeze({
  "openai.responses.v1": Object.freeze({
    adapterKey: "openai.responses.v1",
    adapterKind: "openai_native",
    surface: "responses",
    queryMode: "provider_request_id",
    notFoundIsAuthoritative: true,
    forceStoredResponse: true,
    disableOpenRouterFallbacks: false,
  }),
  "openai.chat-completions.v1": Object.freeze({
    adapterKey: "openai.chat-completions.v1",
    adapterKind: "openai_native",
    surface: "chat-completions",
    queryMode: "none",
    notFoundIsAuthoritative: false,
    forceStoredResponse: false,
    disableOpenRouterFallbacks: false,
  }),
  "openrouter.responses.v1": Object.freeze({
    adapterKey: "openrouter.responses.v1",
    adapterKind: "openrouter_native",
    surface: "responses",
    queryMode: "none",
    notFoundIsAuthoritative: false,
    forceStoredResponse: false,
    disableOpenRouterFallbacks: true,
  }),
  "openrouter.chat-completions.v1": Object.freeze({
    adapterKey: "openrouter.chat-completions.v1",
    adapterKind: "openrouter_native",
    surface: "chat-completions",
    queryMode: "none",
    notFoundIsAuthoritative: false,
    forceStoredResponse: false,
    disableOpenRouterFallbacks: true,
  }),
  "openai-compatible.responses.v1": Object.freeze({
    adapterKey: "openai-compatible.responses.v1",
    adapterKind: "openai_compatible",
    surface: "responses",
    queryMode: "none",
    notFoundIsAuthoritative: false,
    forceStoredResponse: false,
    disableOpenRouterFallbacks: false,
  }),
  "openai-compatible.chat-completions.v1": Object.freeze({
    adapterKey: "openai-compatible.chat-completions.v1",
    adapterKind: "openai_compatible",
    surface: "chat-completions",
    queryMode: "none",
    notFoundIsAuthoritative: false,
    forceStoredResponse: false,
    disableOpenRouterFallbacks: false,
  }),
});

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function authorized(
  request: ProviderInvocationRequest | ProviderQueryRequest,
): asserts request is
  AuthorizedProviderInvocationRequest | AuthorizedProviderQueryRequest {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !(candidate.credential instanceof Uint8Array) ||
    candidate.credential.byteLength < 1
  ) {
    contract(
      "Real Provider Adapter requires a pinned execution context and callback-scoped credential.",
    );
  }
}

function credentialHeader(credential: Uint8Array): string {
  const value = Buffer.from(credential).toString("utf8").trim();
  if (value.length < 1 || value.length > 4_096 || /[^\x21-\x7e]/u.test(value)) {
    return contract("Provider credential is not bounded printable ASCII.");
  }
  return `Bearer ${value}`;
}

function assertContext(
  descriptor: AdapterDescriptor,
  context: ProviderInvocationExecutionContext,
): void {
  const expectedSurfaces =
    descriptor.surface === "responses"
      ? new Set(["responses", "responses.v1"])
      : new Set(["chat.completions", "chat.completions.v1"]);
  if (
    context.endpoint.adapterKind !== descriptor.adapterKind ||
    !expectedSurfaces.has(context.route.apiSurface) ||
    context.route.providerProtocolVersion !== 1
  ) {
    contract(
      "Provider Adapter does not match the pinned endpoint or API surface.",
    );
  }
  if (
    descriptor.adapterKind === "openai_native" &&
    !["none", "openai"].includes(context.endpoint.presetKind)
  ) {
    contract("OpenAI Adapter requires an OpenAI endpoint preset.");
  }
  if (
    descriptor.adapterKind === "openrouter_native" &&
    !["none", "openrouter"].includes(context.endpoint.presetKind)
  ) {
    contract("OpenRouter Adapter requires an OpenRouter endpoint preset.");
  }
  if (
    descriptor.adapterKind === "openai_compatible" &&
    !["none", "newapi", "tokenhub"].includes(context.endpoint.presetKind)
  ) {
    contract(
      "OpenAI-compatible Adapter requires none, NewAPI or TokenHub preset.",
    );
  }
}

function requestBody(
  descriptor: AdapterDescriptor,
  request: AuthorizedProviderInvocationRequest,
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(request.input)) {
    return contract("Provider input must be a plain JSON object.");
  }
  const reserved = new Set([
    "model",
    "models",
    "stream",
    ...(descriptor.disableOpenRouterFallbacks ? ["provider"] : []),
  ]);
  if (Object.keys(request.input).some((field) => reserved.has(field))) {
    return contract(
      "Provider input attempts to override route-controlled fields.",
    );
  }
  return Object.freeze({
    ...request.input,
    model: request.executionContext.model.providerModelId,
    stream: false,
    ...(descriptor.forceStoredResponse ? { store: true } : {}),
    ...(descriptor.disableOpenRouterFallbacks
      ? {
          provider: Object.freeze({
            allow_fallbacks: false,
          }),
        }
      : {}),
  });
}

function pathFor(descriptor: AdapterDescriptor): string {
  return descriptor.surface === "responses"
    ? "/responses"
    : "/chat/completions";
}

function normalizeRemoteCode(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1) {
    return undefined;
  }
  const normalized = value
    .toLowerCase()
    .replace(stableCodePartPattern, "_")
    .replace(/^[_.-]+|[_.-]+$/gu, "")
    .slice(0, 80);
  return normalized || undefined;
}

function errorCodeFromBody(body: unknown): string | undefined {
  if (!isPlainObject(body)) {
    return undefined;
  }
  const error = body.error;
  if (typeof error === "string") {
    return normalizeRemoteCode(error);
  }
  if (isPlainObject(error)) {
    return normalizeRemoteCode(error.code ?? error.type);
  }
  return normalizeRemoteCode(body.code);
}

function failedObservation(
  response: ProviderHttpResponse,
  operation: "submit" | "query",
  notFoundIsAuthoritative: boolean,
): ProviderObservation {
  if (
    operation === "query" &&
    response.statusCode === 404 &&
    notFoundIsAuthoritative
  ) {
    return Object.freeze({
      observationKey: `query:http-404:not-found`,
      status: "not_found",
    });
  }
  const mapping: Readonly<Record<number, string | undefined>> = {
    400: "provider.remote_invalid_request",
    401: "provider.remote_authentication_failed",
    403: "provider.remote_access_denied",
    404: "provider.remote_resource_not_found",
    408: "provider.remote_timeout",
    409: "provider.remote_conflict",
    422: "provider.remote_invalid_request",
    429: "provider.remote_rate_limited",
  };
  const remoteCode = errorCodeFromBody(response.body);
  let stableErrorCode = mapping[response.statusCode];
  if (!stableErrorCode) {
    if (response.statusCode >= 500) {
      stableErrorCode = "provider.remote_unavailable";
    } else if (remoteCode) {
      stableErrorCode = `provider.remote_${remoteCode}`;
    } else {
      stableErrorCode = "provider.remote_rejected";
    }
  }
  return Object.freeze({
    observationKey: `${operation}:http-${String(
      response.statusCode,
    )}:${remoteCode ?? "error"}`,
    status: "failed",
    stableErrorCode,
  });
}

function boundedIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f;
    })
  ) {
    return contract(`${label} is invalid.`);
  }
  return value;
}

function usageMetrics(
  body: Readonly<Record<string, unknown>>,
): readonly ProviderUsageMetric[] {
  return canonicalOpenAiUsageMetrics(
    normalizeOpenAiUsage(body.usage, {
      inputIsText: true,
      outputIsText: true,
    }),
  );
}

function observationFromSuccess(
  descriptor: AdapterDescriptor,
  response: ProviderHttpResponse,
  operation: "submit" | "query",
): ProviderObservation {
  if (!isPlainObject(response.body)) {
    return contract("Provider response body must be a JSON object.");
  }
  const body = response.body;
  const providerRequestId = boundedIdentifier(body.id, "Provider response ID");
  const usage = usageMetrics(body);
  if (descriptor.surface === "chat-completions") {
    if (!providerRequestId) {
      return contract("Chat completion response has no ID.");
    }
    return Object.freeze({
      observationKey: `${operation}:${providerRequestId}:succeeded`,
      status: "succeeded",
      providerRequestId,
      output: body,
      ...(usage.length > 0 ? { usage } : {}),
    });
  }
  const remoteStatus =
    typeof body.status === "string" ? body.status.toLowerCase() : "completed";
  if (!providerRequestId) {
    return contract("Responses API result has no response ID.");
  }
  if (remoteStatus === "queued" || remoteStatus === "in_progress") {
    return Object.freeze({
      observationKey: `${operation}:${providerRequestId}:${remoteStatus}`,
      status: remoteStatus === "queued" ? "accepted" : "running",
      providerRequestId,
    });
  }
  if (remoteStatus === "completed") {
    return Object.freeze({
      observationKey: `${operation}:${providerRequestId}:completed`,
      status: "succeeded",
      providerRequestId,
      output: body,
      ...(usage.length > 0 ? { usage } : {}),
    });
  }
  if (remoteStatus === "cancelled") {
    return Object.freeze({
      observationKey: `${operation}:${providerRequestId}:cancelled`,
      status: "cancelled",
      providerRequestId,
      stableErrorCode: "provider.response_cancelled",
    });
  }
  const errorCode = errorCodeFromBody(body);
  let stableErrorCode = "provider.response_failed";
  if (remoteStatus === "incomplete") {
    stableErrorCode = "provider.response_incomplete";
  } else if (errorCode) {
    stableErrorCode = `provider.remote_${errorCode}`;
  }
  return Object.freeze({
    observationKey: `${operation}:${providerRequestId}:${remoteStatus}`,
    status: "failed",
    providerRequestId,
    stableErrorCode,
  });
}

function failureRetryability(): Readonly<
  Record<string, "retryable" | "terminal" | "manual">
> {
  return Object.freeze({
    "provider.remote_invalid_request": "terminal",
    "provider.remote_authentication_failed": "terminal",
    "provider.remote_access_denied": "terminal",
    "provider.remote_resource_not_found": "terminal",
    "provider.remote_timeout": "retryable",
    "provider.remote_conflict": "retryable",
    "provider.remote_rate_limited": "retryable",
    "provider.remote_unavailable": "retryable",
    "provider.response_cancelled": "terminal",
    "provider.response_incomplete": "terminal",
    "provider.response_failed": "manual",
  });
}

class OpenAiCompatibleProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey: ProviderTextHttpAdapterKey;
  readonly queryMode: AdapterDescriptor["queryMode"];
  readonly notFoundIsAuthoritative: boolean;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = failureRetryability();
  readonly #descriptor: AdapterDescriptor;
  readonly #transport: ProviderHttpTransport;

  public constructor(
    descriptor: AdapterDescriptor,
    transport: ProviderHttpTransport,
  ) {
    this.#descriptor = descriptor;
    this.#transport = transport;
    this.adapterKey = descriptor.adapterKey;
    this.queryMode = descriptor.queryMode;
    this.notFoundIsAuthoritative = descriptor.notFoundIsAuthoritative;
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorized(request);
    assertContext(this.#descriptor, request.executionContext);
    const response = await this.#transport.request({
      baseUrl: request.executionContext.endpoint.baseUrl,
      path: pathFor(this.#descriptor),
      method: "POST",
      headers: {
        authorization: credentialHeader(request.credential),
        "idempotency-key": request.stableRequestKey,
        accept: "application/json",
      },
      body: requestBody(this.#descriptor, request),
      deadlineAt: request.deadlineAt,
      signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failedObservation(
        response,
        "submit",
        this.notFoundIsAuthoritative,
      );
    }
    return observationFromSuccess(this.#descriptor, response, "submit");
  }

  public async query(
    request: ProviderQueryRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    if (
      this.queryMode !== "provider_request_id" ||
      !request.providerRequestId
    ) {
      return contract(
        "Provider Adapter does not support this query operation.",
      );
    }
    authorized(request);
    assertContext(this.#descriptor, request.executionContext);
    const providerRequestId = encodeURIComponent(request.providerRequestId);
    const response = await this.#transport.request({
      baseUrl: request.executionContext.endpoint.baseUrl,
      path: `/responses/${providerRequestId}`,
      method: "GET",
      headers: {
        authorization: credentialHeader(request.credential),
        accept: "application/json",
      },
      deadlineAt: request.deadlineAt,
      signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failedObservation(response, "query", this.notFoundIsAuthoritative);
    }
    return observationFromSuccess(this.#descriptor, response, "query");
  }
}

export function createOpenAiCompatibleProviderAdapters(
  adapterKeys: readonly ProviderTextHttpAdapterKey[],
  transport: ProviderHttpTransport,
): readonly AsyncProviderAdapter[] {
  return Object.freeze(
    adapterKeys.map(
      (adapterKey) =>
        new OpenAiCompatibleProviderAdapter(descriptors[adapterKey], transport),
    ),
  );
}
