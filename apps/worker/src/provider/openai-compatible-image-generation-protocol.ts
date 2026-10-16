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
import type {
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "./provider-http-transport.js";
import type { WorkerInputArtifactRead } from "../storage/worker-input-artifact-resolver.js";

const adapterKey = "openai-compatible.images.generations.v1";
const preparedSchemaVersion =
  "kanvas.openai-compatible-image-generation-request/v1";
const visibleAsciiPattern = /^[\x21-\x7e]+$/u;
const providerRequestIdMaximumLength = 512;
const maximumReferenceCount = 14;
const maximumReferenceBytes = 8_388_608;
const maximumAggregateReferenceBytes = 10_485_760;
const maximumDecodedOutputBytes = 50_331_648;
const maximumAggregateOutputBytes = 100_663_296;
const maximumOutputCount = 10;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const allowedPresets = new Set(["openai", "openrouter", "xai", "newapi"]);
const allowedSnapshotKeys = new Set([
  "schemaVersion",
  "adapterKey",
  "method",
  "path",
  "provider",
  "stableRequestKey",
  "body",
  "referenceArtifactIds",
]);
const allowedProviderKeys = new Set([
  "endpointId",
  "preset",
  "apiSurface",
  "providerModelId",
]);
const allowedBodyKeys = new Set([
  "model",
  "prompt",
  "size",
  "aspect_ratio",
  "resolution",
  "quality",
  "output_format",
  "background",
  "output_compression",
  "n",
  "seed",
  "stream",
]);

type SupportedPreset = "openai" | "openrouter" | "xai" | "newapi";

type SupportedMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface OpenAiCompatibleImageGenerationCommand {
  readonly prompt: string;
  readonly referenceArtifactIds: readonly string[];
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly resolution?: string;
  readonly quality?: "auto" | "low" | "medium" | "high";
  readonly outputFormat?: "png" | "jpeg" | "webp";
  readonly background?: "auto" | "opaque" | "transparent";
  readonly outputCompression?: number;
  readonly numberOfImages?: number;
  readonly seed?: number;
}

interface PreparedSnapshot {
  readonly schemaVersion: typeof preparedSchemaVersion;
  readonly adapterKey: typeof adapterKey;
  readonly method: "POST";
  readonly path: "/images" | "/images/generations";
  readonly provider: {
    readonly endpointId: string;
    readonly preset: SupportedPreset;
    readonly apiSurface: "images.generations.v1";
    readonly providerModelId: string;
  };
  readonly stableRequestKey: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly referenceArtifactIds: readonly string[];
}

interface DecodedOutput {
  readonly bytes: Buffer;
  readonly mediaType: SupportedMediaType;
  readonly sha256: string;
  readonly responseSource: "base64" | "url";
}

function qualityValue(value: unknown): "auto" | "low" | "medium" | "high" {
  if (
    value !== "auto" &&
    value !== "low" &&
    value !== "medium" &&
    value !== "high"
  ) {
    return contract("Persisted image generation quality is invalid.");
  }
  return value;
}

function outputFormatValue(value: unknown): "png" | "jpeg" | "webp" {
  if (value !== "png" && value !== "jpeg" && value !== "webp") {
    return contract("Persisted image generation output format is invalid.");
  }
  return value;
}

function backgroundValue(value: unknown): "auto" | "opaque" | "transparent" {
  if (value !== "auto" && value !== "opaque" && value !== "transparent") {
    return contract("Persisted image generation background is invalid.");
  }
  return value;
}

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

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function preparationContext(
  request: ProviderRequestPreparationRequest,
): ProviderInvocationExecutionContext {
  if (!request.executionContext) {
    return contract(
      "Image generation request preparation requires a pinned execution context.",
    );
  }
  return request.executionContext;
}

function authorized(
  request: ProviderInvocationRequest,
): asserts request is AuthorizedProviderInvocationRequest & {
  readonly inputArtifacts: NonNullable<
    AuthorizedProviderInvocationRequest["inputArtifacts"]
  >;
} {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !(candidate.credential instanceof Uint8Array) ||
    candidate.credential.byteLength < 1 ||
    !candidate.inputArtifacts
  ) {
    return contract(
      "OpenAI-compatible image generation requires pinned execution context, callback-scoped credential, and Artifact access.",
    );
  }
}

function presetFor(
  context: ProviderInvocationExecutionContext,
): SupportedPreset {
  if (
    !allowedPresets.has(context.endpoint.presetKind) ||
    (context.endpoint.presetKind === "openai" &&
      context.endpoint.adapterKind !== "openai_native") ||
    (context.endpoint.presetKind === "openrouter" &&
      context.endpoint.adapterKind !== "openrouter_native") ||
    ((context.endpoint.presetKind === "xai" ||
      context.endpoint.presetKind === "newapi") &&
      context.endpoint.adapterKind !== "openai_compatible") ||
    context.route.apiSurface !== "images.generations.v1" ||
    context.route.providerProtocolVersion !== 1 ||
    context.route.queryMode !== "none" ||
    context.route.notFoundIsAuthoritative ||
    context.route.modelOperation !== "image.generate"
  ) {
    return contract(
      "OpenAI-compatible image generation does not match the pinned endpoint, operation, or API surface.",
    );
  }
  return context.endpoint.presetKind as SupportedPreset;
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

function validSize(value: string): boolean {
  if (/^(?:auto|[1-4][kK])$/u.test(value)) {
    return true;
  }
  const match = /^([1-9][0-9]{1,4})x([1-9][0-9]{1,4})$/u.exec(value);
  return (
    match !== null && Number(match[1]) <= 16_384 && Number(match[2]) <= 16_384
  );
}

function validAspectRatio(value: string): boolean {
  if (value === "auto") {
    return true;
  }
  const match =
    /^([1-9][0-9]{0,2}(?:\.[0-9]{1,2})?):([1-9][0-9]{0,2}(?:\.[0-9]{1,2})?)$/u.exec(
      value,
    );
  return match !== null && Number(match[1]) <= 100 && Number(match[2]) <= 100;
}

function validResolution(value: string): boolean {
  return /^(?:auto|512|1[kK]|2[kK]|4[kK])$/u.test(value);
}

function optionalBoundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value >= minimum && value <= maximum)
  );
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function wireBody(
  preset: SupportedPreset,
  providerModelId: string,
  command: OpenAiCompatibleImageGenerationCommand,
): Readonly<Record<string, unknown>> {
  if (
    providerModelId.length < 1 ||
    providerModelId.length > 512 ||
    containsAsciiControl(providerModelId) ||
    command.prompt.length < 1 ||
    command.prompt.length > 32_000 ||
    !Array.isArray(command.referenceArtifactIds) ||
    command.referenceArtifactIds.length > maximumReferenceCount ||
    command.referenceArtifactIds.some(
      (value) => typeof value !== "string" || !ulidPattern.test(value),
    ) ||
    new Set(command.referenceArtifactIds).size !==
      command.referenceArtifactIds.length
  ) {
    return contract(
      "OpenAI-compatible image generation command is outside its bounded contract.",
    );
  }
  if (
    (command.size !== undefined && !validSize(command.size)) ||
    (command.aspectRatio !== undefined &&
      !validAspectRatio(command.aspectRatio)) ||
    (command.resolution !== undefined &&
      !validResolution(command.resolution)) ||
    (command.quality !== undefined &&
      !["auto", "low", "medium", "high"].includes(command.quality)) ||
    (command.outputFormat !== undefined &&
      !["png", "jpeg", "webp"].includes(command.outputFormat)) ||
    (command.background !== undefined &&
      !["auto", "opaque", "transparent"].includes(command.background)) ||
    !optionalBoundedInteger(command.outputCompression, 0, 100) ||
    !optionalBoundedInteger(command.numberOfImages, 1, 10) ||
    !optionalBoundedInteger(command.seed, 0, 4_294_967_295) ||
    (command.background === "transparent" && command.outputFormat === "jpeg") ||
    (command.outputCompression !== undefined &&
      command.outputFormat !== undefined &&
      !["jpeg", "webp"].includes(command.outputFormat))
  ) {
    return contract(
      "OpenAI-compatible image generation parameters are invalid or incompatible.",
    );
  }
  if (command.referenceArtifactIds.length > 0 && preset !== "openrouter") {
    return contract(
      `Provider preset ${preset} cannot safely express referenceArtifactIds on images.generations.v1.`,
    );
  }
  let unsupported: readonly unknown[] = [];
  if (preset === "openai") {
    unsupported = [command.aspectRatio, command.resolution, command.seed];
  } else if (preset === "xai") {
    unsupported = [
      command.size,
      command.outputFormat,
      command.background,
      command.outputCompression,
      command.seed,
    ];
  }
  if (unsupported.some((value) => value !== undefined)) {
    return contract(
      `Resolved image parameter is unsupported by the ${preset} images.generations.v1 protocol.`,
    );
  }
  return Object.freeze({
    model: providerModelId,
    prompt: command.prompt,
    ...(command.size === undefined || command.size === "auto"
      ? {}
      : { size: command.size }),
    ...(command.aspectRatio === undefined || command.aspectRatio === "auto"
      ? {}
      : { aspect_ratio: command.aspectRatio }),
    ...(command.resolution === undefined ||
    command.resolution.toLowerCase() === "auto"
      ? {}
      : { resolution: command.resolution }),
    ...(command.quality === undefined || command.quality === "auto"
      ? {}
      : { quality: command.quality }),
    ...(command.outputFormat === undefined
      ? {}
      : { output_format: command.outputFormat }),
    ...(command.background === undefined || command.background === "auto"
      ? {}
      : { background: command.background }),
    ...(command.outputCompression === undefined
      ? {}
      : { output_compression: command.outputCompression }),
    ...(command.numberOfImages === undefined
      ? {}
      : { n: command.numberOfImages }),
    ...(command.seed === undefined ? {} : { seed: command.seed }),
    ...(preset === "openrouter" ? { stream: false } : {}),
  });
}

function snapshotFor(
  request: ProviderRequestPreparationRequest,
  command: OpenAiCompatibleImageGenerationCommand,
): PreparedSnapshot {
  const context = preparationContext(request);
  const preset = presetFor(context);
  const path =
    preset === "openrouter"
      ? ("/images" as const)
      : ("/images/generations" as const);
  return Object.freeze({
    schemaVersion: preparedSchemaVersion,
    adapterKey,
    method: "POST",
    path,
    provider: Object.freeze({
      endpointId: context.endpoint.id,
      preset,
      apiSurface: "images.generations.v1" as const,
      providerModelId: context.model.providerModelId,
    }),
    stableRequestKey: request.stableRequestKey,
    body: wireBody(preset, context.model.providerModelId, command),
    referenceArtifactIds: Object.freeze([...command.referenceArtifactIds]),
  });
}

function parseSnapshot(
  request: AuthorizedProviderInvocationRequest,
): PreparedSnapshot {
  const value = request.preparedRequestSnapshot;
  if (
    !isPlainObject(value) ||
    !exactKeys(value, allowedSnapshotKeys) ||
    value.schemaVersion !== preparedSchemaVersion ||
    value.adapterKey !== adapterKey ||
    value.method !== "POST" ||
    (value.path !== "/images" && value.path !== "/images/generations") ||
    typeof value.stableRequestKey !== "string" ||
    value.stableRequestKey.length < 1 ||
    value.stableRequestKey.length > 512 ||
    !visibleAsciiPattern.test(value.stableRequestKey) ||
    value.stableRequestKey !== request.stableRequestKey ||
    !isPlainObject(value.provider) ||
    !exactKeys(value.provider, allowedProviderKeys) ||
    !isPlainObject(value.body) ||
    !exactKeys(value.body, allowedBodyKeys) ||
    !Array.isArray(value.referenceArtifactIds) ||
    value.referenceArtifactIds.length > maximumReferenceCount ||
    value.referenceArtifactIds.some(
      (candidate) =>
        typeof candidate !== "string" || !ulidPattern.test(candidate),
    ) ||
    new Set(value.referenceArtifactIds).size !==
      value.referenceArtifactIds.length ||
    typeof request.preparedRequestDigest !== "string" ||
    digestProviderValue(value) !== request.preparedRequestDigest
  ) {
    return contract(
      "Persisted image generation request snapshot is invalid or differs from its digest.",
    );
  }
  const context = request.executionContext;
  const preset = presetFor(context);
  const expectedPath =
    preset === "openrouter" ? "/images" : "/images/generations";
  if (
    value.path !== expectedPath ||
    value.provider.endpointId !== context.endpoint.id ||
    value.provider.preset !== preset ||
    value.provider.apiSurface !== "images.generations.v1" ||
    value.provider.providerModelId !== context.model.providerModelId ||
    value.body.model !== context.model.providerModelId ||
    typeof value.body.prompt !== "string" ||
    value.body.prompt.length < 1 ||
    value.body.prompt.length > 32_000 ||
    (preset !== "openrouter" && value.referenceArtifactIds.length > 0)
  ) {
    return contract(
      "Persisted image generation request snapshot does not match the pinned execution context.",
    );
  }
  const reconstructedBody = wireBody(preset, context.model.providerModelId, {
    prompt: value.body.prompt,
    referenceArtifactIds: value.referenceArtifactIds as readonly string[],
    ...(typeof value.body.size === "string" ? { size: value.body.size } : {}),
    ...(typeof value.body.aspect_ratio === "string"
      ? { aspectRatio: value.body.aspect_ratio }
      : {}),
    ...(typeof value.body.resolution === "string"
      ? { resolution: value.body.resolution }
      : {}),
    ...(typeof value.body.quality === "string"
      ? {
          quality: qualityValue(value.body.quality),
        }
      : {}),
    ...(typeof value.body.output_format === "string"
      ? {
          outputFormat: outputFormatValue(value.body.output_format),
        }
      : {}),
    ...(typeof value.body.background === "string"
      ? {
          background: backgroundValue(value.body.background),
        }
      : {}),
    ...(typeof value.body.output_compression === "number"
      ? {
          outputCompression: value.body.output_compression,
        }
      : {}),
    ...(typeof value.body.n === "number"
      ? { numberOfImages: value.body.n }
      : {}),
    ...(typeof value.body.seed === "number" ? { seed: value.body.seed } : {}),
  });
  if (
    digestProviderValue(reconstructedBody) !== digestProviderValue(value.body)
  ) {
    return contract(
      "Persisted image generation request body is not a canonical Adapter mapping.",
    );
  }
  return value as unknown as PreparedSnapshot;
}

async function readReference(
  artifact: WorkerInputArtifactRead,
  signal: AbortSignal,
): Promise<Buffer> {
  if (BigInt(artifact.byteSize) > BigInt(maximumReferenceBytes)) {
    return contract(
      "Image generation reference Artifact exceeds the Adapter limit.",
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of artifact.body) {
      signal.throwIfAborted();
      total += chunk.byteLength;
      if (total > maximumReferenceBytes) {
        return contract(
          "Image generation reference Artifact exceeded its bounded read limit.",
        );
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    throw error;
  }
}

function referencePointer(index: number): string {
  return `/referenceArtifactIds/${String(index)}`;
}

async function bodyWithReferences(
  request: AuthorizedProviderInvocationRequest & {
    readonly inputArtifacts: NonNullable<
      AuthorizedProviderInvocationRequest["inputArtifacts"]
    >;
  },
  snapshot: PreparedSnapshot,
  signal: AbortSignal,
): Promise<{
  readonly body: Readonly<Record<string, unknown>>;
  readonly sensitiveBuffers: readonly Buffer[];
}> {
  if (snapshot.referenceArtifactIds.length < 1) {
    return Object.freeze({
      body: snapshot.body,
      sensitiveBuffers: Object.freeze([]),
    });
  }
  const sensitiveBuffers: Buffer[] = [];
  const references: Readonly<Record<string, unknown>>[] = [];
  let totalBytes = 0;
  try {
    for (const [
      index,
      expectedArtifactId,
    ] of snapshot.referenceArtifactIds.entries()) {
      signal.throwIfAborted();
      const artifact = await request.inputArtifacts.open({
        inputPointer: referencePointer(index),
      });
      if (artifact.artifactId !== expectedArtifactId) {
        return contract(
          "Reference Artifact identity differs from the persisted request snapshot.",
        );
      }
      const bytes = await readReference(artifact, signal);
      sensitiveBuffers.push(bytes);
      totalBytes += bytes.byteLength;
      if (totalBytes > maximumAggregateReferenceBytes) {
        return contract(
          "Image generation references exceed the aggregate Adapter limit.",
        );
      }
      references.push(
        Object.freeze({
          type: "image_url",
          image_url: Object.freeze({
            url: `data:${artifact.mediaType};base64,${bytes.toString("base64")}`,
          }),
        }),
      );
    }
    return Object.freeze({
      body: Object.freeze({
        ...snapshot.body,
        input_references: Object.freeze(references),
      }),
      sensitiveBuffers: Object.freeze(sensitiveBuffers),
    });
  } catch (error) {
    for (const bytes of sensitiveBuffers) {
      bytes.fill(0);
    }
    throw error;
  }
}

function failureCode(response: ProviderHttpResponse): string {
  if (
    response.statusCode === 400 ||
    response.statusCode === 404 ||
    response.statusCode === 422
  ) {
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
  const explicitRejection = [400, 401, 403, 404, 422, 429].includes(
    response.statusCode,
  );
  return Object.freeze({
    observationKey: `submit:${createHash("sha256")
      .update(requestKey)
      .update(String(response.statusCode))
      .digest("hex")}`,
    status: explicitRejection ? "failed" : "unknown",
    stableErrorCode,
  });
}

function boundedProviderRequestId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > providerRequestIdMaximumLength ||
    !visibleAsciiPattern.test(value)
  ) {
    return responseFailure("provider.response_request_id_invalid");
  }
  return value;
}

function providerRequestId(
  response: ProviderHttpResponse,
  body: Readonly<Record<string, unknown>>,
): string | undefined {
  return boundedProviderRequestId(
    response.headers["x-request-id"] ??
      response.headers["request-id"] ??
      response.headers["x-grok-request-id"] ??
      body.id,
  );
}

function usageInteger(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(value)) {
    return value;
  }
  return undefined;
}

function usageMetrics(
  body: Readonly<Record<string, unknown>>,
  outputCount: number,
): readonly ProviderUsageMetric[] {
  const metrics: ProviderUsageMetric[] = [
    Object.freeze({
      metricKey: "output_images",
      numericValue: String(outputCount),
      unitCode: "image",
    }),
  ];
  const usage = body.usage;
  if (!isPlainObject(usage)) {
    return Object.freeze(metrics);
  }
  const aliases = [
    [["input_tokens", "prompt_tokens"], "input_tokens"],
    [["output_tokens", "completion_tokens"], "output_tokens"],
    [["total_tokens"], "total_tokens"],
  ] as const;
  for (const [fields, metricKey] of aliases) {
    const field = fields.find((candidate) => usage[candidate] !== undefined);
    const value = field === undefined ? undefined : usageInteger(usage[field]);
    if (value !== undefined) {
      metrics.push(
        Object.freeze({
          metricKey,
          numericValue: value,
          unitCode: "token",
        }),
      );
    }
  }
  if (isPlainObject(usage.input_tokens_details)) {
    for (const [field, metricKey] of [
      ["text_tokens", "input_text_tokens"],
      ["image_tokens", "input_image_tokens"],
    ] as const) {
      const value = usageInteger(usage.input_tokens_details[field]);
      if (value !== undefined) {
        metrics.push(
          Object.freeze({
            metricKey,
            numericValue: value,
            unitCode: "token",
          }),
        );
      }
    }
  }
  return Object.freeze(metrics);
}

function detectedMediaType(bytes: Buffer): SupportedMediaType {
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

function mediaTypeFromFormat(format: unknown): SupportedMediaType | undefined {
  if (format === undefined) {
    return undefined;
  }
  if (format === "png") {
    return "image/png";
  }
  if (format === "jpeg") {
    return "image/jpeg";
  }
  if (format === "webp") {
    return "image/webp";
  }
  return responseFailure("provider.response_output_format_invalid");
}

function declaredMediaType(value: unknown): SupportedMediaType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "image/png" ||
    value === "image/jpeg" ||
    value === "image/webp"
  ) {
    return value;
  }
  return responseFailure("provider.output_media_type_invalid");
}

function assertMediaType(
  bytes: Buffer,
  expected: SupportedMediaType | undefined,
): SupportedMediaType {
  const detected = detectedMediaType(bytes);
  if (expected !== undefined && detected !== expected) {
    bytes.fill(0);
    return responseFailure("provider.output_media_type_invalid");
  }
  return detected;
}

function decodeBase64Output(
  value: unknown,
  expectedMediaType: SupportedMediaType | undefined,
): DecodedOutput {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length % 4 !== 0 ||
    !base64Pattern.test(value) ||
    Math.floor((value.length * 3) / 4) > maximumDecodedOutputBytes
  ) {
    return responseFailure("provider.response_base64_invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.byteLength < 3 ||
    bytes.byteLength > maximumDecodedOutputBytes ||
    bytes.toString("base64") !== value
  ) {
    bytes.fill(0);
    return responseFailure("provider.response_base64_invalid");
  }
  const mediaType = assertMediaType(bytes, expectedMediaType);
  return Object.freeze({
    bytes,
    mediaType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    responseSource: "base64" as const,
  });
}

function outputTarget(value: unknown): {
  readonly baseUrl: string;
  readonly path: string;
} {
  if (typeof value !== "string" || value.length > 8_192) {
    return responseFailure("provider.response_url_invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return responseFailure("provider.response_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    return responseFailure("provider.response_url_invalid");
  }
  return Object.freeze({
    baseUrl: url.origin,
    path: `${url.pathname}${url.search}`,
  });
}

function contentTypeExpectation(
  value: string | undefined,
): SupportedMediaType | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "" || normalized === "application/octet-stream") {
    return undefined;
  }
  if (
    normalized === "image/png" ||
    normalized === "image/jpeg" ||
    normalized === "image/jpg" ||
    normalized === "image/webp"
  ) {
    return normalized === "image/jpg" ? "image/jpeg" : normalized;
  }
  return responseFailure("provider.output_media_type_invalid");
}

async function downloadUrlOutput(
  transport: ProviderHttpTransport,
  request: AuthorizedProviderInvocationRequest,
  value: unknown,
  expectedMediaType: SupportedMediaType | undefined,
  signal: AbortSignal,
): Promise<DecodedOutput> {
  const target = outputTarget(value);
  const response = await transport.request({
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
  });
  if (
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    !Buffer.isBuffer(response.body)
  ) {
    return responseFailure("provider.output_download_failed");
  }
  const bytes = response.body;
  if (bytes.byteLength < 3 || bytes.byteLength > maximumDecodedOutputBytes) {
    bytes.fill(0);
    return responseFailure("provider.output_download_failed");
  }
  const headerMediaType = contentTypeExpectation(
    response.headers["content-type"],
  );
  const mediaType = assertMediaType(
    bytes,
    expectedMediaType ?? headerMediaType,
  );
  if (headerMediaType !== undefined && headerMediaType !== mediaType) {
    bytes.fill(0);
    return responseFailure("provider.output_media_type_invalid");
  }
  return Object.freeze({
    bytes,
    mediaType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    responseSource: "url" as const,
  });
}

function outputReference(index: number) {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "generated",
    outputIndex: index,
  });
}

async function successObservation(
  transport: ProviderHttpTransport,
  response: ProviderHttpResponse,
  request: AuthorizedProviderInvocationRequest,
  snapshot: PreparedSnapshot,
  signal: AbortSignal,
): Promise<ProviderObservation> {
  if (
    !isPlainObject(response.body) ||
    !Array.isArray(response.body.data) ||
    response.body.data.length < 1 ||
    response.body.data.length > maximumOutputCount ||
    response.body.data.some((item) => !isPlainObject(item))
  ) {
    return responseFailure("provider.response_data_invalid");
  }
  const expectedCount =
    typeof snapshot.body.n === "number" ? snapshot.body.n : undefined;
  if (
    expectedCount !== undefined &&
    response.body.data.length !== expectedCount
  ) {
    return responseFailure("provider.response_output_count_mismatch");
  }
  for (const item of response.body.data) {
    const candidate = item as Readonly<Record<string, unknown>>;
    if (
      (typeof candidate.b64_json === "string") ===
      (typeof candidate.url === "string")
    )
      return responseFailure("provider.response_output_invalid");
  }
  const requestId = providerRequestId(response, response.body);
  const usage = usageMetrics(response.body, response.body.data.length);
  await request.onResultConfirmed?.({
    ...confirmedResultLinks(
      transport,
      response.body.data.map((item) => (item as Record<string, unknown>).url),
    ),
    usage,
    ...(requestId ? { providerRequestId: requestId } : {}),
  });
  const requestedMediaType = mediaTypeFromFormat(snapshot.body.output_format);
  const decoded: DecodedOutput[] = [];
  let aggregateBytes = 0;
  try {
    for (const item of response.body.data) {
      const candidate = item as Readonly<Record<string, unknown>>;
      const hasBase64 = typeof candidate.b64_json === "string";
      const hasUrl = typeof candidate.url === "string";
      if (hasBase64 === hasUrl) {
        return responseFailure("provider.response_output_invalid");
      }
      const itemMediaType =
        declaredMediaType(candidate.media_type) ?? requestedMediaType;
      const output = hasBase64
        ? decodeBase64Output(candidate.b64_json, itemMediaType)
        : await downloadUrlOutput(
            transport,
            request,
            candidate.url,
            itemMediaType,
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
          outputRole: "generated",
          outputIndex: index,
          artifactType: "image.generated",
          metadata: Object.freeze({
            providerPreset: snapshot.provider.preset,
            providerModelId: snapshot.provider.providerModelId,
            operation: "image.generate",
            generative: true,
            outputFormat: output.mediaType.replace("image/", "") as
              "jpeg" | "png" | "webp",
            responseSource: output.responseSource,
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
    const combinedDigest = createHash("sha256");
    for (const output of decoded) {
      combinedDigest.update(output.sha256);
    }
    return Object.freeze({
      observationKey: `submit:${createHash("sha256")
        .update(request.stableRequestKey)
        .update(combinedDigest.digest("hex"))
        .digest("hex")}`,
      status: "succeeded",
      ...(requestId ? { providerRequestId: requestId } : {}),
      output: Object.freeze({
        schemaVersion: "kanvas.image-generate-result/v1",
        imageArtifactId: outputReference(0),
      }),
      outputs,
      usage,
    });
  } catch (error) {
    for (const output of decoded) {
      output.bytes.fill(0);
    }
    throw error;
  }
}

export const openAiCompatibleImageGenerationFailureRetryability = Object.freeze(
  {
    "provider.remote_invalid_request": "terminal",
    "provider.remote_authentication_failed": "terminal",
    "provider.remote_access_denied": "terminal",
    "provider.remote_rate_limited": "retryable",
    "provider.remote_unavailable": "manual",
    "provider.response_failed": "manual",
    "provider.response_request_id_invalid": "manual",
    "provider.response_data_invalid": "manual",
    "provider.response_output_invalid": "manual",
    "provider.response_output_count_mismatch": "manual",
    "provider.response_output_format_invalid": "manual",
    "provider.response_base64_invalid": "manual",
    "provider.response_url_invalid": "manual",
    "provider.response_outputs_oversized": "manual",
    "provider.output_download_failed": "manual",
    "provider.output_download_disabled": "manual",
    "provider.output_origin_not_allowed": "manual",
    "provider.output_policy_unavailable": "manual",
    "provider.output_media_type_invalid": "manual",
  } as const,
);

export class OpenAiCompatibleImageGenerationProtocol {
  readonly #transport: ProviderHttpTransport;

  public constructor(transport: ProviderHttpTransport) {
    this.#transport = transport;
  }

  public prepare(
    request: ProviderRequestPreparationRequest,
    command: OpenAiCompatibleImageGenerationCommand,
  ): PreparedProviderRequest {
    return Object.freeze({
      snapshot: snapshotFor(request, command) as unknown as Readonly<
        Record<string, unknown>
      >,
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorized(request);
    const snapshot = parseSnapshot(request);
    const preparedBody = await bodyWithReferences(request, snapshot, signal);
    try {
      const response = await this.#transport.request({
        baseUrl: request.executionContext.endpoint.baseUrl,
        path: snapshot.path,
        method: "POST",
        headers: {
          authorization: credentialHeader(request.credential),
          "idempotency-key": request.stableRequestKey,
          accept: "application/json",
        },
        body: preparedBody.body,
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
      for (const bytes of preparedBody.sensitiveBuffers) {
        bytes.fill(0);
      }
    }
  }
}
