import { createHash } from "node:crypto";
import { confirmedResultLinks } from "./provider-result-links.js";

import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";

import {
  ProviderAdapterCallError,
  ProviderAdapterContractError,
  type AuthorizedProviderInvocationRequest,
  type PreparedProviderRequest,
  type ProviderImageOutput,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderRequestPreparationRequest,
  type ProviderUsageMetric,
} from "./provider-adapter.js";
import { configuredPrompt } from "./image-implementation-configuration.js";
import type {
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "./provider-http-transport.js";
import type {
  WorkerInputArtifactAccess,
  WorkerInputArtifactRead,
} from "../storage/worker-input-artifact-resolver.js";

export const xaiImageEditAdapterKey = "xai.images.edits.v1";

const snapshotSchemaVersion = "kanvas.xai-image-edit-request/v1";
const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const visibleAsciiPattern = /^[\x21-\x7e]+$/u;
const providerModelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const maximumPromptLength = 32_000;
const maximumInputImages = 3;
const maximumInputArtifactBytes = 20 * 1_024 * 1_024;
const maximumAggregateInputBytes = 45 * 1_024 * 1_024;
const maximumOutputBytes = 25_165_824;
const maximumAggregateOutputBytes = 50_331_648;
const providerReadUrlLifetimeSeconds = 900;
const maximumProviderCostTicks = 9_999_999_999_999_999n;
const xaiOutputOrigin = "https://imgen.x.ai";
const supportedMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const xaiAspectRatios = new Set([
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
]);

interface PreparedArtifact {
  readonly artifactId: string;
  readonly inputPointer: string;
}

interface XaiImageEditPreparedSnapshot extends Readonly<
  Record<string, unknown>
> {
  readonly schemaVersion: typeof snapshotSchemaVersion;
  readonly adapterKey: typeof xaiImageEditAdapterKey;
  readonly method: "POST";
  readonly path: "/images/edits";
  readonly requestFingerprint: string;
  readonly provider: {
    readonly endpointId: string;
    readonly preset: "xai";
    readonly apiSurface: "images.edits.v1";
    readonly providerModelId: string;
  };
  readonly body: {
    readonly model: string;
    readonly prompt: string;
    readonly aspect_ratio?: string;
  };
  readonly inputArtifacts: readonly PreparedArtifact[];
  readonly result: {
    readonly outputRole: "edited";
    readonly artifactType: "image.edited";
    readonly sourceArtifactId: string;
  };
}

interface MaterializedReferences {
  readonly values: readonly string[];
  readonly dispose: () => void;
}

interface DecodedOutput {
  readonly bytes: Buffer;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly sha256: string;
}

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function responseFailure(stableErrorCode: string): never {
  throw new ProviderAdapterCallError(stableErrorCode, "unknown");
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

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function contextFor(
  request: ProviderRequestPreparationRequest,
): ProviderInvocationExecutionContext {
  if (!request.executionContext) {
    return contract(
      "xAI image edit preparation requires a pinned execution context.",
    );
  }
  return request.executionContext;
}

function assertContext(
  request: Pick<ProviderInvocationRequest, "route">,
  context: ProviderInvocationExecutionContext,
): void {
  let endpointOrigin: string;
  try {
    endpointOrigin = new URL(context.endpoint.baseUrl).origin;
  } catch {
    return contract("xAI image edit endpoint URL is invalid.");
  }
  if (
    context.endpoint.presetKind !== "xai" ||
    context.endpoint.adapterKind !== "openai_compatible" ||
    context.endpoint.canonicalOrigin !== "https://api.x.ai" ||
    endpointOrigin !== "https://api.x.ai" ||
    context.route.providerProtocolVersion !== 1 ||
    context.route.apiSurface !== "images.edits.v1" ||
    context.route.modelOperation !== "image.edit" ||
    context.route.queryMode !== "none" ||
    context.route.notFoundIsAuthoritative ||
    request.route.providerProtocolVersion !== 1 ||
    request.route.apiSurface !== "images.edits.v1" ||
    request.route.modelOperation !== "image.edit" ||
    request.route.providerEndpointId !== context.route.providerEndpointId ||
    request.route.modelDeploymentId !== context.route.modelDeploymentId ||
    !request.route.parameterPolicies ||
    !request.route.parameterPolicyDigest ||
    !providerModelPattern.test(context.model.providerModelId)
  ) {
    return contract(
      "xAI image edit does not match the pinned endpoint, operation, or API surface.",
    );
  }
}

function authorized(
  request: ProviderInvocationRequest,
): asserts request is AuthorizedProviderInvocationRequest & {
  readonly inputArtifacts: WorkerInputArtifactAccess;
} {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !(candidate.credential instanceof Uint8Array) ||
    candidate.credential.byteLength < 1 ||
    !candidate.inputArtifacts
  ) {
    return contract(
      "xAI image edit requires pinned execution context, callback-scoped credential, and Artifact access.",
    );
  }
}

function artifactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !artifactIdPattern.test(value)) {
    return contract(`xAI image edit ${label} must be an Artifact ULID.`);
  }
  return value;
}

function inputArtifacts(value: unknown): {
  readonly prompt: string;
  readonly artifacts: readonly PreparedArtifact[];
} {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(
      value,
      new Set([
        "sourceArtifactId",
        "referenceArtifactIds",
        "prompt",
        "aspectRatio",
      ]),
    ) ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length < 1 ||
    value.prompt.length > maximumPromptLength
  ) {
    return contract(
      "xAI image edit input does not match its bounded Adapter contract.",
    );
  }
  const sourceArtifactId = artifactId(
    value.sourceArtifactId,
    "sourceArtifactId",
  );
  const artifacts: PreparedArtifact[] = [
    Object.freeze({
      artifactId: sourceArtifactId,
      inputPointer: "/sourceArtifactId",
    }),
  ];
  if (value.referenceArtifactIds !== undefined) {
    if (
      !Array.isArray(value.referenceArtifactIds) ||
      value.referenceArtifactIds.length < 1 ||
      value.referenceArtifactIds.length >= maximumInputImages
    ) {
      return contract(
        "xAI image edit referenceArtifactIds must contain one or two Artifact IDs.",
      );
    }
    value.referenceArtifactIds.forEach((candidate, index) => {
      artifacts.push(
        Object.freeze({
          artifactId: artifactId(
            candidate,
            `referenceArtifactIds[${String(index)}]`,
          ),
          inputPointer: `/referenceArtifactIds/${String(index)}`,
        }),
      );
    });
  }
  if (
    artifacts.length > maximumInputImages ||
    new Set(artifacts.map((item) => item.artifactId)).size !== artifacts.length
  ) {
    return contract(
      "xAI image edit input Artifacts must be unique and cannot exceed three images.",
    );
  }
  return Object.freeze({
    prompt: value.prompt.trim(),
    artifacts: Object.freeze(artifacts),
  });
}

function aspectRatioFor(
  request: ProviderRequestPreparationRequest,
): string | undefined {
  if (
    request.route.providerProtocolVersion !== 1 ||
    !request.route.parameterPolicies ||
    !request.route.parameterPolicyDigest
  ) {
    return contract("xAI image edit requires a pinned v2 parameter policy.");
  }
  const policies = request.route.parameterPolicies;
  const values = request.effectiveParameters ?? {};
  if (
    Object.keys(values).some(
      (key) => key !== "aspectRatio" || !Object.hasOwn(policies, key),
    )
  ) {
    return contract(
      "Resolved xAI image edit parameters contain an unknown or unpinned field.",
    );
  }
  const value = values.aspectRatio;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !xaiAspectRatios.has(value)) {
    return contract(
      "Resolved xAI image edit aspectRatio is outside the Adapter protocol.",
    );
  }
  return value === "auto" ? undefined : value;
}

function snapshotFor(
  request: ProviderRequestPreparationRequest,
  prompt: string,
  artifacts: readonly PreparedArtifact[],
): XaiImageEditPreparedSnapshot {
  const context = contextFor(request);
  assertContext(request, context);
  const aspectRatio = aspectRatioFor(request);
  const configured = configuredPrompt(request, { prompt });
  return Object.freeze({
    schemaVersion: snapshotSchemaVersion,
    adapterKey: xaiImageEditAdapterKey,
    method: "POST",
    path: "/images/edits",
    requestFingerprint: request.requestFingerprint,
    provider: Object.freeze({
      endpointId: context.endpoint.id,
      preset: "xai",
      apiSurface: "images.edits.v1",
      providerModelId: context.model.providerModelId,
    }),
    body: Object.freeze({
      model: context.model.providerModelId,
      prompt: configured,
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    }),
    inputArtifacts: Object.freeze([...artifacts]),
    result: Object.freeze({
      outputRole: "edited",
      artifactType: "image.edited",
      sourceArtifactId: artifacts[0]!.artifactId,
    }),
  });
}

function parsePreparedArtifact(
  value: unknown,
  index: number,
): PreparedArtifact {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.inputPointer !== "string" ||
    value.inputPointer !==
      (index === 0
        ? "/sourceArtifactId"
        : `/referenceArtifactIds/${String(index - 1)}`)
  ) {
    return contract("Persisted xAI image edit Artifact lineage is invalid.");
  }
  return Object.freeze({
    artifactId: artifactId(value.artifactId, "prepared Artifact"),
    inputPointer: value.inputPointer,
  });
}

function parseSnapshot(
  request: AuthorizedProviderInvocationRequest,
): XaiImageEditPreparedSnapshot {
  const value = request.preparedRequestSnapshot;
  if (
    !isPlainObject(value) ||
    typeof request.preparedRequestDigest !== "string" ||
    digestProviderValue(value) !== request.preparedRequestDigest ||
    !hasOnlyKeys(
      value,
      new Set([
        "schemaVersion",
        "adapterKey",
        "method",
        "path",
        "requestFingerprint",
        "provider",
        "body",
        "inputArtifacts",
        "result",
      ]),
    ) ||
    value.schemaVersion !== snapshotSchemaVersion ||
    value.adapterKey !== xaiImageEditAdapterKey ||
    value.method !== "POST" ||
    value.path !== "/images/edits" ||
    value.requestFingerprint !== request.requestFingerprint ||
    !isPlainObject(value.provider) ||
    !isPlainObject(value.body) ||
    !Array.isArray(value.inputArtifacts) ||
    value.inputArtifacts.length < 1 ||
    value.inputArtifacts.length > maximumInputImages ||
    !isPlainObject(value.result)
  ) {
    return contract(
      "Persisted xAI image edit request snapshot is missing or invalid.",
    );
  }
  assertContext(request, request.executionContext);
  const artifacts = Object.freeze(
    value.inputArtifacts.map(parsePreparedArtifact),
  );
  if (
    new Set(artifacts.map((item) => item.artifactId)).size !==
      artifacts.length ||
    value.provider.endpointId !== request.executionContext.endpoint.id ||
    value.provider.preset !== "xai" ||
    value.provider.apiSurface !== "images.edits.v1" ||
    value.provider.providerModelId !==
      request.executionContext.model.providerModelId ||
    value.body.model !== request.executionContext.model.providerModelId ||
    typeof value.body.prompt !== "string" ||
    value.body.prompt.trim().length < 1 ||
    value.body.prompt.length > maximumPromptLength ||
    !hasOnlyKeys(value.body, new Set(["model", "prompt", "aspect_ratio"])) ||
    (value.body.aspect_ratio !== undefined &&
      (typeof value.body.aspect_ratio !== "string" ||
        value.body.aspect_ratio === "auto" ||
        !xaiAspectRatios.has(value.body.aspect_ratio))) ||
    value.result.outputRole !== "edited" ||
    value.result.artifactType !== "image.edited" ||
    value.result.sourceArtifactId !== artifacts[0]!.artifactId
  ) {
    return contract(
      "Persisted xAI image edit request differs from its pinned execution context.",
    );
  }
  return value as unknown as XaiImageEditPreparedSnapshot;
}

function credentialHeader(credential: Uint8Array): string {
  const value = Buffer.from(credential).toString("utf8");
  if (
    value.length < 1 ||
    value.length > 4_096 ||
    value !== value.trim() ||
    !visibleAsciiPattern.test(value)
  ) {
    return contract("xAI credential is not bounded printable ASCII.");
  }
  return `Bearer ${value}`;
}

function boundedArtifactSize(artifact: WorkerInputArtifactRead): number {
  if (
    !/^(?:0|[1-9][0-9]{0,19})$/u.test(artifact.byteSize) ||
    !sha256Pattern.test(artifact.sha256) ||
    !supportedMediaTypes.has(artifact.mediaType)
  ) {
    return contract("xAI input Artifact facts are invalid.");
  }
  const size = BigInt(artifact.byteSize);
  if (size < 1n || size > BigInt(maximumInputArtifactBytes)) {
    return contract("xAI input Artifact exceeds the per-image limit.");
  }
  return Number(size);
}

function providerHttpsReference(value: string): string {
  if (value.length < 1 || value.length > 8_192) {
    return contract("xAI input Artifact URL is outside its bounded contract.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return contract("xAI input Artifact URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    return contract(
      "xAI input Artifact URL must be credential-free HTTPS without a fragment.",
    );
  }
  return parsed.toString();
}

async function readArtifactDataUrl(
  artifact: WorkerInputArtifactRead,
  declaredSize: number,
  signal: AbortSignal,
): Promise<{
  readonly value: string;
  readonly bytes: Buffer;
}> {
  const chunks: Buffer[] = [];
  let total = 0;
  const hash = createHash("sha256");
  try {
    for await (const chunk of artifact.body) {
      signal.throwIfAborted();
      total += chunk.byteLength;
      if (total > declaredSize) {
        return contract("xAI input Artifact exceeded its committed size.");
      }
      const copy = Buffer.from(chunk);
      chunks.push(copy);
      hash.update(copy);
    }
    if (total !== declaredSize || hash.digest("hex") !== artifact.sha256) {
      return contract(
        "xAI input Artifact body differs from its committed facts.",
      );
    }
    const bytes = Buffer.concat(chunks, total);
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    return Object.freeze({
      value: `data:${artifact.mediaType};base64,${bytes.toString("base64")}`,
      bytes,
    });
  } catch (error) {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    throw error;
  }
}

async function materializeReferences(
  request: AuthorizedProviderInvocationRequest & {
    readonly inputArtifacts: WorkerInputArtifactAccess;
  },
  snapshot: XaiImageEditPreparedSnapshot,
  signal: AbortSignal,
): Promise<MaterializedReferences> {
  const values: string[] = [];
  const sensitiveBuffers: Buffer[] = [];
  let aggregateBytes = 0;
  try {
    for (const expected of snapshot.inputArtifacts) {
      signal.throwIfAborted();
      const artifact = await request.inputArtifacts.open({
        inputPointer: expected.inputPointer,
      });
      if (artifact.artifactId !== expected.artifactId) {
        return contract(
          "xAI input Artifact identity differs from the persisted request snapshot.",
        );
      }
      aggregateBytes += boundedArtifactSize(artifact);
      if (aggregateBytes > maximumAggregateInputBytes) {
        return contract(
          "xAI input Artifacts exceed the aggregate request limit.",
        );
      }
      const providerUrl = await artifact.createProviderReadUrl?.(
        providerReadUrlLifetimeSeconds,
      );
      if (providerUrl) {
        values.push(providerHttpsReference(providerUrl));
        continue;
      }
      const data = await readArtifactDataUrl(
        artifact,
        Number(artifact.byteSize),
        signal,
      );
      sensitiveBuffers.push(data.bytes);
      values.push(data.value);
    }
    return Object.freeze({
      values: Object.freeze(values),
      dispose() {
        for (const buffer of sensitiveBuffers) {
          buffer.fill(0);
        }
      },
    });
  } catch (error) {
    for (const buffer of sensitiveBuffers) {
      buffer.fill(0);
    }
    throw error;
  }
}

function failureCode(response: ProviderHttpResponse): string {
  if ([400, 404, 422].includes(response.statusCode)) {
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

function failedObservation(
  response: ProviderHttpResponse,
  requestKey: string,
): ProviderObservation {
  const stableErrorCode = failureCode(response);
  return Object.freeze({
    observationKey: `submit:${createHash("sha256")
      .update(requestKey)
      .update(String(response.statusCode))
      .digest("hex")}`,
    status: [400, 401, 403, 404, 422, 429].includes(response.statusCode)
      ? "failed"
      : "unknown",
    stableErrorCode,
  });
}

function outputTarget(value: unknown): {
  readonly baseUrl: string;
  readonly path: string;
} {
  if (typeof value !== "string" || value.length > 8_192) {
    return responseFailure("provider.response_url_invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return responseFailure("provider.response_url_invalid");
  }
  if (
    parsed.origin !== xaiOutputOrigin ||
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    return responseFailure("provider.response_url_invalid");
  }
  return Object.freeze({
    baseUrl: parsed.origin,
    path: `${parsed.pathname}${parsed.search}`,
  });
}

function declaredMediaType(
  value: unknown,
): "image/jpeg" | "image/png" | "image/webp" {
  if (
    value !== "image/jpeg" &&
    value !== "image/png" &&
    value !== "image/webp"
  ) {
    return responseFailure("provider.output_media_type_invalid");
  }
  return value;
}

function detectedMediaType(
  bytes: Buffer,
): "image/jpeg" | "image/png" | "image/webp" {
  if (
    bytes.byteLength >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return responseFailure("provider.output_media_type_invalid");
}

async function downloadOutput(
  transport: ProviderHttpTransport,
  request: AuthorizedProviderInvocationRequest,
  item: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<DecodedOutput> {
  const expected = declaredMediaType(item.mime_type);
  const response = await transport.request({
    ...outputTarget(item.url),
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
  });
  if (
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    !Buffer.isBuffer(response.body) ||
    response.body.byteLength < 3 ||
    response.body.byteLength > maximumOutputBytes
  ) {
    return responseFailure("provider.output_download_failed");
  }
  const bytes = response.body;
  const detected = detectedMediaType(bytes);
  const header = response.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase()
    .replace("image/jpg", "image/jpeg");
  if (
    detected !== expected ||
    (header !== undefined &&
      header !== "" &&
      header !== "application/octet-stream" &&
      header !== detected)
  ) {
    bytes.fill(0);
    return responseFailure("provider.output_media_type_invalid");
  }
  return Object.freeze({
    bytes,
    mediaType: detected,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function providerCostTicks(
  body: Readonly<Record<string, unknown>>,
): string | undefined {
  if (body.usage === undefined) {
    return undefined;
  }
  if (!isPlainObject(body.usage)) {
    return responseFailure("provider.response_usage_invalid");
  }
  const raw = body.usage.cost_in_usd_ticks;
  if (raw === undefined) {
    return undefined;
  }
  let normalized: string | undefined;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) {
    normalized = String(raw);
  } else if (typeof raw === "string" && /^(?:0|[1-9][0-9]{0,15})$/u.test(raw)) {
    normalized = raw;
  }
  if (
    normalized === undefined ||
    BigInt(normalized) > maximumProviderCostTicks
  ) {
    return responseFailure("provider.response_usage_invalid");
  }
  return normalized;
}

function providerRequestId(response: ProviderHttpResponse): string | undefined {
  const value =
    response.headers["x-request-id"] ?? response.headers["x-grok-request-id"];
  if (value === undefined) {
    return undefined;
  }
  if (
    value.length < 1 ||
    value.length > 512 ||
    !visibleAsciiPattern.test(value)
  ) {
    return responseFailure("provider.response_request_id_invalid");
  }
  return value;
}

function outputReference(index: number) {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "edited",
    outputIndex: index,
  });
}

async function successObservation(
  transport: ProviderHttpTransport,
  response: ProviderHttpResponse,
  request: AuthorizedProviderInvocationRequest,
  snapshot: XaiImageEditPreparedSnapshot,
  signal: AbortSignal,
): Promise<ProviderObservation> {
  if (
    !isPlainObject(response.body) ||
    !Array.isArray(response.body.data) ||
    response.body.data.length < 1 ||
    response.body.data.length > 4 ||
    response.body.data.some(
      (item) => !isPlainObject(item) || typeof item.url !== "string",
    )
  ) {
    return responseFailure("provider.response_data_invalid");
  }
  const costTicks = providerCostTicks(response.body);
  const requestId = providerRequestId(response);
  const usage: ProviderUsageMetric[] = [
    Object.freeze({
      metricKey: "output_images",
      numericValue: String(response.body.data.length),
      unitCode: "image",
    }),
    ...(costTicks === undefined
      ? []
      : [
          Object.freeze({
            metricKey: "xai_cost_in_usd_ticks",
            numericValue: costTicks,
            unitCode: "usd_tick",
          }),
        ]),
  ];
  await request.onResultConfirmed?.({
    ...confirmedResultLinks(
      transport,
      response.body.data.map((item) => (item as Record<string, unknown>).url),
    ),
    usage,
    ...(requestId ? { providerRequestId: requestId } : {}),
  });
  const decoded: DecodedOutput[] = [];
  let aggregateBytes = 0;
  try {
    for (const item of response.body.data) {
      const output = await downloadOutput(
        transport,
        request,
        item as Readonly<Record<string, unknown>>,
        signal,
      );
      decoded.push(output);
      aggregateBytes += output.bytes.byteLength;
      if (aggregateBytes > maximumAggregateOutputBytes) {
        return responseFailure("provider.response_outputs_oversized");
      }
    }
    const outputs = Object.freeze(
      decoded.map((output, index): ProviderImageOutput =>
        Object.freeze({
          outputRole: "edited",
          outputIndex: index,
          artifactType: "image.edited",
          metadata: Object.freeze({
            providerPreset: "xai",
            providerModelId: snapshot.provider.providerModelId,
            operation: "image.edit",
            generative: true,
            providerUsageEvidence: "provider_reported",
            ...(requestId ? { providerRequestId: requestId } : {}),
          }),
          mediaType: output.mediaType,
          byteSize: String(output.bytes.byteLength),
          sha256: output.sha256,
          body: (async function* () {
            try {
              await Promise.resolve();
              yield output.bytes;
            } finally {
              output.bytes.fill(0);
            }
          })(),
        }),
      ),
    );
    const outputDigest = createHash("sha256");
    for (const item of decoded) {
      outputDigest.update(item.sha256);
    }
    return Object.freeze({
      observationKey: `submit:${createHash("sha256")
        .update(request.stableRequestKey)
        .update(outputDigest.digest("hex"))
        .digest("hex")}`,
      status: "succeeded",
      ...(requestId ? { providerRequestId: requestId } : {}),
      output: Object.freeze({
        schemaVersion: "kanvas.image-edit-result/v1",
        imageArtifactId: outputReference(0),
        sourceArtifactId: snapshot.result.sourceArtifactId,
      }),
      outputs,
      usage: Object.freeze(usage),
    });
  } catch (error) {
    for (const output of decoded) {
      output.bytes.fill(0);
    }
    throw error;
  }
}

export const xaiImageEditFailureRetryability = Object.freeze({
  "provider.remote_invalid_request": "terminal",
  "provider.remote_authentication_failed": "terminal",
  "provider.remote_access_denied": "terminal",
  "provider.remote_rate_limited": "retryable",
  "provider.remote_unavailable": "manual",
  "provider.response_failed": "manual",
  "provider.response_request_id_invalid": "manual",
  "provider.response_data_invalid": "manual",
  "provider.response_url_invalid": "manual",
  "provider.response_usage_invalid": "manual",
  "provider.response_outputs_oversized": "manual",
  "provider.output_download_failed": "manual",
  "provider.output_download_disabled": "manual",
  "provider.output_origin_not_allowed": "manual",
  "provider.output_policy_unavailable": "manual",
  "provider.output_media_type_invalid": "manual",
} as const);

export class XaiImageEditProtocol {
  readonly #transport: ProviderHttpTransport;

  public constructor(transport: ProviderHttpTransport) {
    this.#transport = transport;
  }

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    const input = inputArtifacts(request.input);
    return Object.freeze({
      snapshot: snapshotFor(request, input.prompt, input.artifacts),
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorized(request);
    const snapshot = parseSnapshot(request);
    const references = await materializeReferences(request, snapshot, signal);
    const imageObjects = references.values.map((url) =>
      Object.freeze({
        type: "image_url",
        url,
      }),
    );
    const body = Object.freeze({
      ...snapshot.body,
      ...(imageObjects.length === 1
        ? { image: imageObjects[0] }
        : { images: Object.freeze(imageObjects) }),
    });
    try {
      const response = await this.#transport.request({
        baseUrl: request.executionContext.endpoint.baseUrl,
        path: snapshot.path,
        method: "POST",
        headers: {
          authorization: credentialHeader(request.credential),
          accept: "application/json",
        },
        body,
        deadlineAt: request.deadlineAt,
        signal,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return failedObservation(response, request.stableRequestKey);
      }
      return await successObservation(
        this.#transport,
        response,
        request,
        snapshot,
        signal,
      );
    } finally {
      references.dispose();
    }
  }
}
