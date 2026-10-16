import { createHash } from "node:crypto";
import { confirmedResultLinks } from "./provider-result-links.js";

import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";

import {
  ProviderAdapterCallError,
  ProviderAdapterContractError,
  type ProviderCallStage,
  type AuthorizedProviderInvocationRequest,
  type AuthorizedProviderQueryRequest,
  type ProviderImageOutput,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderQueryRequest,
} from "./provider-adapter.js";
import { tokenHubAsyncTaskBilling } from "./provider-reported-charge.js";
import type {
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "./provider-http-transport.js";

const visibleAsciiPattern = /^[\x21-\x7e]+$/u;
const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const maximumResults = 8;
const rootDiagnosticFields = Object.freeze([
  ["c", "code"],
  ["d", "data"],
  ["e", "error"],
  ["m", "message"],
  ["t", "task_id"],
  ["s", "status"],
] as const);
const dataDiagnosticFields = Object.freeze([
  ["t", "task_id"],
  ["s", "status"],
  ["r", "result_urls"],
  ["u", "updated_at"],
  ["c", "created_at"],
  ["e", "error"],
  ["m", "message"],
] as const);

export const generationTasksImageProtocolRevision =
  "generation.tasks.images.v2.response-drift.v3";

export interface GenerationTasksImageCommand {
  readonly prompt: string;
  readonly image?: string;
  readonly images?: readonly string[];
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly resolution?: "1k" | "2k" | "4k";
  readonly quality?: "auto" | "low" | "medium" | "high";
  readonly outputFormat?: "png" | "jpeg" | "webp";
  readonly outputCompression?: number;
  readonly seed?: number;
  readonly numberOfImages?: number;
}

export interface GenerationTasksImageOutputDescriptor {
  readonly outputRole: string;
  readonly artifactType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export const generationTasksFailureRetryability = Object.freeze({
  "provider.remote_authentication_failed": "terminal",
  "provider.remote_access_denied": "terminal",
  "provider.remote_invalid_request": "terminal",
  "provider.remote_generation_failed": "terminal",
  "provider.remote_rate_limited": "retryable",
  "provider.remote_unavailable": "retryable",
  "provider.response_invalid": "manual",
  "provider.response_body_invalid": "manual",
  "provider.response_code_unsupported": "manual",
  "provider.response_data_invalid": "manual",
  "provider.response_task_id_invalid": "manual",
  "provider.response_task_id_mismatch": "manual",
  "provider.response_status_unsupported": "manual",
  "provider.response_terminal_on_submit": "manual",
  "provider.response_result_urls_invalid": "manual",
  "provider.response_charge_invalid": "manual",
  "provider.response_failed": "manual",
  "provider.output_download_failed": "manual",
  "provider.output_download_disabled": "manual",
  "provider.output_origin_not_allowed": "manual",
  "provider.output_policy_unavailable": "manual",
  "provider.output_media_type_invalid": "manual",
} as const);

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function responseFailure(
  stableErrorCode: string,
  diagnosticKey?: string,
): never {
  throw new ProviderAdapterCallError(
    stableErrorCode,
    "unknown",
    stableErrorCode,
    diagnosticKey,
  );
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

function diagnosticValueKind(value: unknown): string {
  if (value === undefined) {
    return "u";
  }
  if (value === null) {
    return "n";
  }
  if (Array.isArray(value)) {
    return "a";
  }
  if (isPlainObject(value)) {
    return "o";
  }
  if (typeof value === "string") {
    return "s";
  }
  if (typeof value === "boolean") {
    return "b";
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? "i" : "f";
  }
  return "x";
}

function responseStructureDiagnostic(
  scope: "r" | "d",
  value: unknown,
  fields: readonly (readonly [string, string])[],
): string {
  const kind = diagnosticValueKind(value);
  if (!isPlainObject(value)) {
    return `${scope}-${kind}`;
  }
  const known = new Set(fields.map(([, name]) => name));
  const otherCount = Object.keys(value).filter(
    (name) => !known.has(name),
  ).length;
  return [
    `${scope}-${kind}`,
    ...fields.map(
      ([alias, name]) => `${alias}-${diagnosticValueKind(value[name])}`,
    ),
    `x-${String(Math.min(otherCount, 9))}`,
  ].join(".");
}

function rootStructureDiagnostic(value: unknown): string {
  return responseStructureDiagnostic("r", value, rootDiagnosticFields);
}

function dataStructureDiagnostic(value: unknown): string {
  return responseStructureDiagnostic("d", value, dataDiagnosticFields);
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
      "Generation Tasks requires pinned execution context and callback-scoped credential.",
    );
  }
}

function assertContext(context: ProviderInvocationExecutionContext): void {
  if (
    context.endpoint.adapterKind !== "openai_compatible" ||
    !["newapi", "tokenhub"].includes(context.endpoint.presetKind) ||
    !["generation.tasks", "generation.tasks.v1"].includes(
      context.route.apiSurface,
    ) ||
    context.route.providerProtocolVersion !== 1 ||
    context.route.queryMode !== "provider_request_id"
  ) {
    contract(
      "Generation Tasks Adapter does not match the pinned endpoint, preset, API surface, or query mode.",
    );
  }
}

function credentialHeader(credential: Uint8Array): string {
  const value = Buffer.from(credential).toString("utf8").trim();
  if (
    value.length < 1 ||
    value.length > 4_096 ||
    !visibleAsciiPattern.test(value)
  ) {
    return contract("Provider credential is not bounded printable ASCII.");
  }
  return `Bearer ${value}`;
}

function failureCode(response: ProviderHttpResponse): string {
  if (response.statusCode === 400 || response.statusCode === 422) {
    return "provider.remote_invalid_request";
  }
  if (response.statusCode === 401) {
    return "provider.remote_authentication_failed";
  }
  if (response.statusCode === 403) {
    return "provider.remote_access_denied";
  }
  if (response.statusCode === 429) {
    return "provider.remote_rate_limited";
  }
  if (response.statusCode >= 500) {
    return "provider.remote_unavailable";
  }
  return "provider.response_failed";
}

function upstreamError(
  response: ProviderHttpResponse,
  credential: Uint8Array,
): NonNullable<ProviderObservation["upstreamError"]> {
  const secret = new TextDecoder().decode(credential);
  const body =
    typeof response.body === "string"
      ? response.body
      : JSON.stringify(response.body, (key, value: unknown) =>
          /authorization|api[-_]?key|token|secret|password|cookie/i.test(key)
            ? "<REDACTED>"
            : value,
        );
  const redacted = (body ?? "")
    .split(secret)
    .join("<REDACTED>")
    .replace(/https?:\/\/[^\s"<>]+/g, (url) => url.split("?")[0]!)
    .slice(0, 16000);
  const requestId =
    response.headers["x-oneapi-request-id"] ?? response.headers["x-request-id"];
  return {
    statusCode: response.statusCode,
    ...(requestId ? { requestId: requestId.slice(0, 512) } : {}),
    body: redacted,
  };
}

function failedObservation(
  response: ProviderHttpResponse,
  operation: "submit" | "query",
  requestKey: string,
  credential: Uint8Array,
  providerRequestId?: string,
): ProviderObservation {
  const stableErrorCode = failureCode(response);
  const explicitSubmitRejection =
    operation === "submit" &&
    [400, 401, 403, 422, 429].includes(response.statusCode);
  return Object.freeze({
    observationKey: `${operation}:${createHash("sha256")
      .update(requestKey)
      .update(String(response.statusCode))
      .digest("hex")}`,
    status:
      operation === "query" || !explicitSubmitRejection ? "unknown" : "failed",
    ...(providerRequestId ? { providerRequestId } : {}),
    stableErrorCode,
    upstreamError: upstreamError(response, credential),
  });
}

function responseData(
  response: ProviderHttpResponse,
): Readonly<Record<string, unknown>> {
  const rootDiagnostic = rootStructureDiagnostic(response.body);
  if (!isPlainObject(response.body)) {
    return responseFailure("provider.response_body_invalid", rootDiagnostic);
  }
  if (response.body.code !== "success") {
    return responseFailure(
      "provider.response_code_unsupported",
      rootDiagnostic,
    );
  }
  if (!isPlainObject(response.body.data)) {
    return responseFailure("provider.response_data_invalid", rootDiagnostic);
  }
  return response.body.data;
}

function taskIdFrom(data: Readonly<Record<string, unknown>>): string {
  if (typeof data.task_id !== "string" || !taskIdPattern.test(data.task_id)) {
    return responseFailure(
      "provider.response_task_id_invalid",
      dataStructureDiagnostic(data),
    );
  }
  return data.task_id;
}

function observationKey(
  operation: "submit" | "query",
  taskId: string,
  status: string,
  updatedAt: unknown,
): string {
  const revision =
    typeof updatedAt === "number" &&
    Number.isSafeInteger(updatedAt) &&
    updatedAt >= 0
      ? String(updatedAt)
      : createHash("sha256").update(status).digest("hex").slice(0, 16);
  return `${operation}:${taskId}:${status}:${revision}`;
}

function queryStatus(
  value: unknown,
  diagnosticKey: string,
): "queued" | "processing" | "succeeded" | "failed" {
  if (
    value === "queued" ||
    value === "processing" ||
    value === "succeeded" ||
    value === "failed"
  ) {
    return value;
  }
  return responseFailure("provider.response_status_unsupported", diagnosticKey);
}

function tokenHubBilling(
  data: Readonly<Record<string, unknown>>,
  request: AuthorizedProviderQueryRequest,
) {
  if (request.executionContext.endpoint.presetKind !== "tokenhub") {
    return undefined;
  }
  try {
    return tokenHubAsyncTaskBilling(data);
  } catch {
    return responseFailure(
      "provider.response_charge_invalid",
      dataStructureDiagnostic(data),
    );
  }
}

function mediaTypeFor(
  contentType: string | undefined,
  bytes: Buffer,
): ProviderImageOutput["mediaType"] {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const webp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (normalized === "image/png" && png) {
    return "image/png";
  }
  if ((normalized === "image/jpeg" || normalized === "image/jpg") && jpeg) {
    return "image/jpeg";
  }
  if (normalized === "image/webp" && webp) {
    return "image/webp";
  }
  return contract(
    "Generation Tasks output MIME type and file signature do not match.",
  );
}

function outputTarget(value: string): {
  readonly baseUrl: string;
  readonly path: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return contract("Generation Tasks result URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    return contract(
      "Generation Tasks result URL is not an allowed HTTPS target.",
    );
  }
  return Object.freeze({
    baseUrl: url.origin,
    path: `${url.pathname}${url.search}`,
  });
}

async function providerRequestAtStage<T>(
  stage: ProviderCallStage,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ProviderAdapterCallError) {
      throw new ProviderAdapterCallError(
        error.stableErrorCode,
        error.effect,
        error.stableErrorCode,
        error.diagnosticKey,
        stage,
      );
    }
    throw error;
  }
}

async function downloadOutputs(
  transport: ProviderHttpTransport,
  request: AuthorizedProviderQueryRequest,
  resultUrls: readonly string[],
  descriptor: GenerationTasksImageOutputDescriptor,
  signal: AbortSignal,
): Promise<readonly ProviderImageOutput[]> {
  if (resultUrls.length < 1 || resultUrls.length > maximumResults) {
    return contract("Generation Tasks result URL count is invalid.");
  }
  const outputs: ProviderImageOutput[] = [];
  for (const [index, resultUrl] of resultUrls.entries()) {
    signal.throwIfAborted();
    const target = outputTarget(resultUrl);
    const response = await providerRequestAtStage("result_download", () =>
      transport.request({
        ...target,
        method: "GET",
        headers: {},
        responseMode: "binary",
        targetKind: "provider_result",
        resultPolicyContext: {
          invocationId: request.executionContext.invocationId,
          workspaceId: request.executionContext.workspaceId,
          providerEndpointId: request.executionContext.endpoint.id,
        },
        deadlineAt: request.deadlineAt,
        signal,
      }),
    );
    if (
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      !Buffer.isBuffer(response.body)
    ) {
      return contract("Generation Tasks output download failed.");
    }
    const bytes = response.body;
    const mediaType = mediaTypeFor(response.headers["content-type"], bytes);
    outputs.push(
      Object.freeze({
        outputRole: descriptor.outputRole,
        outputIndex: index,
        artifactType: descriptor.artifactType,
        metadata: Object.freeze({
          ...descriptor.metadata,
          generationTaskId: request.providerRequestId,
        }),
        mediaType,
        byteSize: String(bytes.byteLength),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        body: (async function* () {
          try {
            await Promise.resolve();
            yield bytes;
          } finally {
            bytes.fill(0);
          }
        })(),
      }),
    );
  }
  return Object.freeze(outputs);
}

export class GenerationTasksImageProtocol {
  readonly #transport: ProviderHttpTransport;

  public constructor(transport: ProviderHttpTransport) {
    this.#transport = transport;
  }

  public async submit(
    request: ProviderInvocationRequest,
    command: GenerationTasksImageCommand,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorized(request);
    assertContext(request.executionContext);
    if (command.prompt.length < 1 || command.prompt.length > 32_000) {
      return contract(
        "Generation Tasks prompt is outside its bounded contract.",
      );
    }
    const response = await this.#transport.request({
      baseUrl: request.executionContext.endpoint.baseUrl,
      path: "/generation/tasks",
      method: "POST",
      headers: {
        authorization: credentialHeader(request.credential),
      },
      body: {
        model: request.executionContext.model.providerModelId,
        prompt: command.prompt,
        ...(command.numberOfImages === undefined
          ? {}
          : { n: command.numberOfImages }),
        ...(command.outputFormat
          ? { output_format: command.outputFormat }
          : {}),
        response_format: "url",
        ...(command.image ? { image: command.image } : {}),
        ...(command.images ? { images: command.images } : {}),
        ...(command.size ? { size: command.size } : {}),
        ...(command.aspectRatio ? { aspect_ratio: command.aspectRatio } : {}),
        ...(command.resolution ? { resolution: command.resolution } : {}),
        ...(command.quality ? { quality: command.quality } : {}),
        ...(command.outputCompression === undefined
          ? {}
          : {
              output_compression: command.outputCompression,
            }),
        ...(command.seed === undefined ? {} : { seed: command.seed }),
      },
      deadlineAt: request.deadlineAt,
      signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failedObservation(
        response,
        "submit",
        request.stableRequestKey,
        request.credential,
      );
    }
    const data = responseData(response);
    const dataDiagnostic = dataStructureDiagnostic(data);
    const taskId = taskIdFrom(data);
    const status = queryStatus(data.status, dataDiagnostic);
    if (status === "failed") {
      return Object.freeze({
        observationKey: observationKey(
          "submit",
          taskId,
          status,
          data.updated_at ?? data.created_at,
        ),
        status: "failed",
        providerRequestId: taskId,
        stableErrorCode: "provider.remote_generation_failed",
        upstreamError: upstreamError(response, request.credential),
      });
    }
    if (status === "succeeded") {
      return responseFailure(
        "provider.response_terminal_on_submit",
        dataDiagnostic,
      );
    }
    return Object.freeze({
      observationKey: observationKey(
        "submit",
        taskId,
        status,
        data.updated_at ?? data.created_at,
      ),
      status: status === "processing" ? "running" : "accepted",
      providerRequestId: taskId,
    });
  }

  public async query(
    request: ProviderQueryRequest,
    descriptor: GenerationTasksImageOutputDescriptor,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorized(request);
    assertContext(request.executionContext);
    if (
      !request.providerRequestId ||
      !taskIdPattern.test(request.providerRequestId)
    ) {
      return contract("Generation Tasks query requires a valid task ID.");
    }
    const taskId = request.providerRequestId;
    const response = await providerRequestAtStage("status_query", () =>
      this.#transport.request({
        baseUrl: request.executionContext.endpoint.baseUrl,
        path: `/generation/tasks/${encodeURIComponent(taskId)}`,
        method: "GET",
        headers: {
          authorization: credentialHeader(request.credential),
        },
        deadlineAt: request.deadlineAt,
        signal,
      }),
    );
    if (response.statusCode === 404) {
      return Object.freeze({
        observationKey: `query:${taskId}:not-found`,
        status: "not_found",
        providerRequestId: taskId,
      });
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failedObservation(
        response,
        "query",
        taskId,
        request.credential,
        taskId,
      );
    }
    const data = responseData(response);
    const dataDiagnostic = dataStructureDiagnostic(data);
    if (taskIdFrom(data) !== taskId) {
      return responseFailure(
        "provider.response_task_id_mismatch",
        dataDiagnostic,
      );
    }
    const status = queryStatus(data.status, dataDiagnostic);
    const key = observationKey("query", taskId, status, data.updated_at);
    if (status === "queued" || status === "processing") {
      return Object.freeze({
        observationKey: key,
        status: status === "processing" ? "running" : "accepted",
        providerRequestId: taskId,
      });
    }
    if (status === "failed") {
      return Object.freeze({
        observationKey: key,
        status: "failed",
        providerRequestId: taskId,
        stableErrorCode: "provider.remote_generation_failed",
        upstreamError: upstreamError(response, request.credential),
      });
    }
    const billing = tokenHubBilling(data, request);
    await request.onResultConfirmed?.({
      ...confirmedResultLinks(
        this.#transport,
        Array.isArray(data.result_urls) ? data.result_urls : [],
      ),
      providerRequestId: taskId,
      usage: billing
        ? [
            {
              metricKey: "tokenhub_quota",
              numericValue: billing.quota,
              unitCode: "quota",
            },
          ]
        : [],
      ...(billing
        ? {
            reportedCharge: {
              source: "provider_reported",
              ...billing.reportedCharge,
            },
          }
        : {}),
    });
    if (
      !Array.isArray(data.result_urls) ||
      data.result_urls.some((value) => typeof value !== "string")
    ) {
      return responseFailure(
        "provider.response_result_urls_invalid",
        dataDiagnostic,
      );
    }
    const outputs = await downloadOutputs(
      this.#transport,
      request,
      data.result_urls,
      descriptor,
      signal,
    );
    return Object.freeze({
      observationKey: key,
      status: "succeeded",
      providerRequestId: taskId,
      output: Object.freeze({
        schemaVersion: "kanvas.generation-task-image-result/v1",
        assetCount: outputs.length,
      }),
      outputs,
      ...(billing
        ? {
            reportedCharge: {
              source: "provider_reported" as const,
              ...billing.reportedCharge,
            },
            usage: Object.freeze([
              {
                metricKey: "tokenhub_quota",
                numericValue: billing.quota,
                unitCode: "quota",
              },
            ]),
          }
        : {}),
    });
  }
}
