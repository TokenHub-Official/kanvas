import { createHash } from "node:crypto";

import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";

import {
  configuredPrompt,
  effectiveProviderParameter,
} from "./image-implementation-configuration.js";
import {
  type AsyncProviderAdapter,
  type AuthorizedProviderInvocationRequest,
  type PreparedProviderRequest,
  ProviderAdapterContractError,
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
import type {
  WorkerInputArtifactAccess,
  WorkerInputArtifactRead,
} from "../storage/worker-input-artifact-resolver.js";

export const geminiImageAdapterKey = "gemini.generate-content.image.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const providerModelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const visibleAsciiPattern = /^[\x21-\x7e]+$/u;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const hexadecimalSha256Pattern = /^[0-9a-f]{64}$/u;
const maximumInputArtifactBytes = 10_485_760;
const maximumTotalInputArtifactBytes = 10_485_760;
const maximumDecodedOutputBytes = 25_165_824;
const maximumReferenceImages = 14;
const maximumOutputImages = 8;
const maximumCandidateParts = 32;
const maximumPromptLength = 32_000;
const allowedInputKeys = new Set([
  "prompt",
  "sourceArtifactId",
  "referenceArtifactIds",
  "aspectRatio",
  "resolution",
  "outputFormat",
]);
const aspectRatios = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "4:5",
  "5:4",
  "16:9",
  "9:16",
  "21:9",
] as const;
const resolutions = ["512", "1k", "2k", "4k"] as const;
const outputFormats = ["png", "jpeg"] as const;

type GeminiImageOperation = "image.generate" | "image.edit";
type GeminiOutputFormat = (typeof outputFormats)[number];
type GeminiWireResolution = "512" | "1K" | "2K" | "4K";

interface GeminiImageInput {
  readonly prompt: string;
  readonly references: readonly {
    readonly artifactId: string;
    readonly inputPointer: string;
  }[];
  readonly sourceArtifactId?: string;
}

interface PreparedTextPart {
  readonly text: string;
}

interface PreparedArtifactPart {
  readonly inputArtifact: {
    readonly artifactId: string;
    readonly inputPointer: string;
  };
}

type PreparedPart = PreparedTextPart | PreparedArtifactPart;

interface PreparedGenerationConfig {
  readonly responseModalities: readonly ["IMAGE"];
  readonly responseFormat: {
    readonly image: {
      readonly delivery: "INLINE";
      readonly aspectRatio?: Exclude<(typeof aspectRatios)[number], "auto">;
      readonly imageSize?: GeminiWireResolution;
      readonly mimeType?: "IMAGE_JPEG";
    };
  };
}

interface GeminiPreparedSnapshot extends Readonly<Record<string, unknown>> {
  readonly schemaVersion: "kanvas.gemini-generate-content-request/v1";
  readonly adapterKey: typeof geminiImageAdapterKey;
  readonly method: "POST";
  readonly path: string;
  readonly model: string;
  readonly operation: GeminiImageOperation;
  readonly requestFingerprint: string;
  readonly parts: readonly PreparedPart[];
  readonly generationConfig: PreparedGenerationConfig;
  readonly result: {
    readonly outputRole: "generated" | "edited";
    readonly artifactType: "image.generated" | "image.edited";
    readonly outputFormat?: GeminiOutputFormat;
  };
}

interface DecodedImage {
  readonly bytes: Buffer;
  readonly mediaType: "image/jpeg" | "image/png";
  readonly sha256: string;
  readonly candidateIndex: number;
  readonly partIndex: number;
}

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

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
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
    contract(
      "Gemini image Adapter requires pinned execution context, callback-scoped credential, and Artifact access.",
    );
  }
}

function preparationContext(
  request: ProviderRequestPreparationRequest,
): ProviderInvocationExecutionContext {
  if (!request.executionContext) {
    return contract(
      "Gemini image request preparation requires a pinned execution context.",
    );
  }
  return request.executionContext;
}

function operationFor(
  request: Pick<ProviderInvocationRequest, "route">,
  context: ProviderInvocationExecutionContext,
): GeminiImageOperation {
  const operation = context.route.modelOperation;
  if (operation !== "image.generate" && operation !== "image.edit") {
    return contract(
      "Gemini image Adapter requires an explicit image.generate or image.edit operation.",
    );
  }
  if (
    request.route.providerProtocolVersion !== 1 ||
    request.route.modelOperation !== operation
  ) {
    return contract(
      "Gemini image Adapter operation differs from its pinned route.",
    );
  }
  return operation;
}

function providerModelId(context: ProviderInvocationExecutionContext): string {
  const candidate = context.model.providerModelId.replace(/^models\//u, "");
  if (candidate !== candidate.trim() || !providerModelPattern.test(candidate)) {
    return contract(
      "Gemini image Provider model ID is outside the Adapter contract.",
    );
  }
  return candidate;
}

function assertContext(
  request: Pick<ProviderInvocationRequest, "route">,
  context: ProviderInvocationExecutionContext,
): GeminiImageOperation {
  if (
    context.endpoint.adapterKind !== "gemini_native" ||
    context.endpoint.presetKind !== "gemini" ||
    context.route.providerProtocolVersion !== 1 ||
    context.route.apiSurface !== "generate-content.image.v1" ||
    request.route.providerProtocolVersion !== 1 ||
    request.route.apiSurface !== "generate-content.image.v1" ||
    context.route.providerEndpointId !== request.route.providerEndpointId ||
    context.route.modelDeploymentId !== request.route.modelDeploymentId
  ) {
    return contract(
      "Gemini image Adapter does not match the pinned endpoint or API surface.",
    );
  }
  providerModelId(context);
  return operationFor(request, context);
}

function parseArtifactId(value: unknown, field: string): string {
  if (typeof value !== "string" || !artifactIdPattern.test(value)) {
    return contract(`Gemini image ${field} must be an Artifact ULID.`);
  }
  return value;
}

function parseInput(
  value: unknown,
  operation: GeminiImageOperation,
): GeminiImageInput {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, allowedInputKeys) ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length < 1 ||
    value.prompt.length > maximumPromptLength
  ) {
    return contract(
      "Gemini image input does not match the bounded Adapter contract.",
    );
  }
  const references: {
    artifactId: string;
    inputPointer: string;
  }[] = [];
  let sourceArtifactId: string | undefined;
  if (value.sourceArtifactId !== undefined) {
    sourceArtifactId = parseArtifactId(
      value.sourceArtifactId,
      "sourceArtifactId",
    );
    references.push({
      artifactId: sourceArtifactId,
      inputPointer: "/sourceArtifactId",
    });
  }
  if (operation === "image.edit" && !sourceArtifactId) {
    return contract("Gemini image.edit requires sourceArtifactId.");
  }
  if (operation === "image.generate" && sourceArtifactId !== undefined) {
    return contract(
      "Gemini image.generate accepts referenceArtifactIds instead of sourceArtifactId.",
    );
  }
  if (value.referenceArtifactIds !== undefined) {
    if (
      !Array.isArray(value.referenceArtifactIds) ||
      value.referenceArtifactIds.length < 1 ||
      value.referenceArtifactIds.length > maximumReferenceImages
    ) {
      return contract(
        "Gemini referenceArtifactIds is outside its bounded contract.",
      );
    }
    value.referenceArtifactIds.forEach((artifactId, index) => {
      references.push({
        artifactId: parseArtifactId(
          artifactId,
          `referenceArtifactIds[${index}]`,
        ),
        inputPointer: `/referenceArtifactIds/${index}`,
      });
    });
  }
  if (
    references.length > maximumReferenceImages ||
    new Set(references.map(({ artifactId }) => artifactId)).size !==
      references.length
  ) {
    return contract(
      "Gemini image references must be unique and within the Adapter limit.",
    );
  }
  return Object.freeze({
    prompt: value.prompt.trim(),
    references: Object.freeze(
      references.map((reference) => Object.freeze(reference)),
    ),
    ...(sourceArtifactId ? { sourceArtifactId } : {}),
  });
}

function configuredGenerationConfig(
  request: ProviderRequestPreparationRequest,
): {
  readonly generationConfig: PreparedGenerationConfig;
  readonly outputFormat?: GeminiOutputFormat;
} {
  const effectiveParameterKeys = Object.keys(request.effectiveParameters ?? {});
  if (
    effectiveParameterKeys.some(
      (key) =>
        !["aspectRatio", "resolution", "outputFormat"].includes(key) ||
        (request.route.providerProtocolVersion === 1 &&
          !request.route.parameterPolicies?.[key]),
    )
  ) {
    return contract(
      "Resolved Gemini image parameters contain a field outside the pinned Adapter contract.",
    );
  }
  const aspectRatio = effectiveProviderParameter(
    request,
    "aspectRatio",
    aspectRatios,
  );
  const resolution = effectiveProviderParameter(
    request,
    "resolution",
    resolutions,
  );
  const outputFormat = effectiveProviderParameter(
    request,
    "outputFormat",
    outputFormats,
  );
  const imageSize =
    resolution === undefined
      ? undefined
      : ((resolution === "512"
          ? "512"
          : resolution.toUpperCase()) as GeminiWireResolution);
  const image = Object.freeze({
    delivery: "INLINE" as const,
    ...(aspectRatio && aspectRatio !== "auto" ? { aspectRatio } : {}),
    ...(imageSize ? { imageSize } : {}),
    ...(outputFormat === "jpeg" ? { mimeType: "IMAGE_JPEG" as const } : {}),
  });
  return Object.freeze({
    generationConfig: Object.freeze({
      responseModalities: Object.freeze(["IMAGE"] as const),
      responseFormat: Object.freeze({
        image,
      }),
    }),
    ...(outputFormat ? { outputFormat } : {}),
  });
}

function providerPath(model: string): string {
  return `/models/${encodeURIComponent(model)}:generateContent`;
}

function prepareSnapshot(
  request: ProviderRequestPreparationRequest,
): GeminiPreparedSnapshot {
  const context = preparationContext(request);
  const operation = assertContext(request, context);
  const input = parseInput(request.input, operation);
  const model = providerModelId(context);
  const configured = configuredGenerationConfig(request);
  const prompt = configuredPrompt(request, {
    prompt: input.prompt,
  });
  const parts: PreparedPart[] = [
    Object.freeze({ text: prompt }),
    ...input.references.map((reference) =>
      Object.freeze({
        inputArtifact: Object.freeze({
          artifactId: reference.artifactId,
          inputPointer: reference.inputPointer,
        }),
      }),
    ),
  ];
  return Object.freeze({
    schemaVersion: "kanvas.gemini-generate-content-request/v1",
    adapterKey: geminiImageAdapterKey,
    method: "POST",
    path: providerPath(model),
    model,
    operation,
    requestFingerprint: request.requestFingerprint,
    parts: Object.freeze(parts),
    generationConfig: configured.generationConfig,
    result: Object.freeze({
      outputRole:
        operation === "image.generate"
          ? ("generated" as const)
          : ("edited" as const),
      artifactType:
        operation === "image.generate"
          ? ("image.generated" as const)
          : ("image.edited" as const),
      ...(configured.outputFormat
        ? { outputFormat: configured.outputFormat }
        : {}),
    }),
  });
}

function parsePreparedPart(value: unknown, index: number): PreparedPart {
  if (!isPlainObject(value)) {
    return contract(
      "Gemini prepared request contains an invalid content part.",
    );
  }
  if (
    index === 0 &&
    Object.keys(value).length === 1 &&
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    value.text.length <= maximumPromptLength
  ) {
    return Object.freeze({ text: value.text });
  }
  const inputArtifact = value.inputArtifact;
  if (
    index < 1 ||
    Object.keys(value).length !== 1 ||
    !isPlainObject(inputArtifact) ||
    Object.keys(inputArtifact).length !== 2 ||
    typeof inputArtifact.inputPointer !== "string" ||
    !/^\/(?:sourceArtifactId|referenceArtifactIds\/(?:0|[1-9][0-9]?))$/u.test(
      inputArtifact.inputPointer,
    )
  ) {
    return contract(
      "Gemini prepared request contains an invalid Artifact part.",
    );
  }
  return Object.freeze({
    inputArtifact: Object.freeze({
      artifactId: parseArtifactId(
        inputArtifact.artifactId,
        "prepared Artifact ID",
      ),
      inputPointer: inputArtifact.inputPointer,
    }),
  });
}

function parsePreparedGenerationConfig(
  value: unknown,
): PreparedGenerationConfig {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    !Array.isArray(value.responseModalities) ||
    value.responseModalities.length !== 1 ||
    value.responseModalities[0] !== "IMAGE" ||
    !isPlainObject(value.responseFormat) ||
    Object.keys(value.responseFormat).length !== 1 ||
    !isPlainObject(value.responseFormat.image)
  ) {
    return contract("Gemini prepared generationConfig is invalid.");
  }
  const image = value.responseFormat.image;
  if (
    !hasOnlyKeys(
      image,
      new Set(["delivery", "aspectRatio", "imageSize", "mimeType"]),
    ) ||
    image.delivery !== "INLINE" ||
    (image.aspectRatio !== undefined &&
      (!aspectRatios.includes(
        image.aspectRatio as (typeof aspectRatios)[number],
      ) ||
        image.aspectRatio === "auto")) ||
    (image.imageSize !== undefined &&
      !["512", "1K", "2K", "4K"].includes(image.imageSize as string)) ||
    (image.mimeType !== undefined && image.mimeType !== "IMAGE_JPEG")
  ) {
    return contract("Gemini prepared image response format is invalid.");
  }
  return Object.freeze({
    responseModalities: Object.freeze(["IMAGE"] as const),
    responseFormat: Object.freeze({
      image: Object.freeze({
        delivery: "INLINE" as const,
        ...(typeof image.aspectRatio === "string"
          ? {
              aspectRatio: image.aspectRatio as Exclude<
                (typeof aspectRatios)[number],
                "auto"
              >,
            }
          : {}),
        ...(typeof image.imageSize === "string"
          ? {
              imageSize: image.imageSize as GeminiWireResolution,
            }
          : {}),
        ...(image.mimeType === "IMAGE_JPEG"
          ? { mimeType: "IMAGE_JPEG" as const }
          : {}),
      }),
    }),
  });
}

function parsePreparedResult(
  value: unknown,
  operation: GeminiImageOperation,
): GeminiPreparedSnapshot["result"] {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(
      value,
      new Set(["outputRole", "artifactType", "outputFormat"]),
    ) ||
    value.outputRole !==
      (operation === "image.generate" ? "generated" : "edited") ||
    value.artifactType !==
      (operation === "image.generate" ? "image.generated" : "image.edited") ||
    (value.outputFormat !== undefined &&
      !outputFormats.includes(value.outputFormat as GeminiOutputFormat))
  ) {
    return contract("Gemini prepared result mapping is invalid.");
  }
  const outputRole =
    operation === "image.generate"
      ? ("generated" as const)
      : ("edited" as const);
  const artifactType =
    operation === "image.generate"
      ? ("image.generated" as const)
      : ("image.edited" as const);
  return Object.freeze({
    outputRole,
    artifactType,
    ...(typeof value.outputFormat === "string"
      ? {
          outputFormat: value.outputFormat as GeminiOutputFormat,
        }
      : {}),
  });
}

function parsePreparedSnapshot(
  request: AuthorizedProviderInvocationRequest,
): GeminiPreparedSnapshot {
  const snapshot = request.preparedRequestSnapshot;
  if (
    !isPlainObject(snapshot) ||
    typeof request.preparedRequestDigest !== "string"
  ) {
    return contract("Gemini prepared request snapshot is missing or invalid.");
  }
  let observedDigest: string;
  try {
    observedDigest = digestProviderValue(snapshot);
  } catch {
    return contract("Gemini prepared request snapshot is not canonical JSON.");
  }
  if (observedDigest !== request.preparedRequestDigest) {
    return contract(
      "Gemini prepared request differs from its immutable digest.",
    );
  }
  if (
    !hasOnlyKeys(
      snapshot,
      new Set([
        "schemaVersion",
        "adapterKey",
        "method",
        "path",
        "model",
        "operation",
        "requestFingerprint",
        "parts",
        "generationConfig",
        "result",
      ]),
    ) ||
    Object.keys(snapshot).length !== 10 ||
    snapshot.schemaVersion !== "kanvas.gemini-generate-content-request/v1" ||
    snapshot.adapterKey !== geminiImageAdapterKey ||
    snapshot.method !== "POST" ||
    typeof snapshot.model !== "string" ||
    !providerModelPattern.test(snapshot.model) ||
    snapshot.path !== providerPath(snapshot.model) ||
    (snapshot.operation !== "image.generate" &&
      snapshot.operation !== "image.edit") ||
    snapshot.requestFingerprint !== request.requestFingerprint ||
    !Array.isArray(snapshot.parts) ||
    snapshot.parts.length < 1 ||
    snapshot.parts.length > maximumReferenceImages + 1
  ) {
    return contract("Gemini prepared request snapshot is missing or invalid.");
  }
  const expectedOperation = assertContext(request, request.executionContext);
  const expectedModel = providerModelId(request.executionContext);
  if (
    snapshot.operation !== expectedOperation ||
    snapshot.model !== expectedModel
  ) {
    return contract(
      "Gemini prepared request differs from its pinned execution context.",
    );
  }
  const parts = Object.freeze(snapshot.parts.map(parsePreparedPart));
  const artifactParts = parts.filter(
    (part): part is PreparedArtifactPart => "inputArtifact" in part,
  );
  if (
    new Set(artifactParts.map(({ inputArtifact }) => inputArtifact.artifactId))
      .size !== artifactParts.length ||
    (expectedOperation === "image.edit" &&
      artifactParts[0]?.inputArtifact.inputPointer !== "/sourceArtifactId") ||
    (expectedOperation === "image.generate" &&
      artifactParts.some(
        ({ inputArtifact }) =>
          inputArtifact.inputPointer === "/sourceArtifactId",
      ))
  ) {
    return contract("Gemini prepared Artifact lineage is invalid.");
  }
  const generationConfig = parsePreparedGenerationConfig(
    snapshot.generationConfig,
  );
  const result = parsePreparedResult(snapshot.result, expectedOperation);
  if (
    (result.outputFormat === "jpeg") !==
      (generationConfig.responseFormat.image.mimeType === "IMAGE_JPEG") ||
    (result.outputFormat === "png" &&
      generationConfig.responseFormat.image.mimeType !== undefined)
  ) {
    return contract("Gemini prepared output format mapping is inconsistent.");
  }
  return Object.freeze({
    schemaVersion: "kanvas.gemini-generate-content-request/v1",
    adapterKey: geminiImageAdapterKey,
    method: "POST",
    path: snapshot.path,
    model: snapshot.model,
    operation: expectedOperation,
    requestFingerprint: request.requestFingerprint,
    parts,
    generationConfig,
    result,
  });
}

function credentialHeader(credential: Uint8Array): string {
  const value = Buffer.from(credential).toString("utf8");
  if (
    value.length < 1 ||
    value.length > 4_096 ||
    value !== value.trim() ||
    !visibleAsciiPattern.test(value)
  ) {
    return contract(
      "Gemini Provider credential is not bounded printable ASCII.",
    );
  }
  return value;
}

function byteSize(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,19})$/u.test(value)) {
    return contract("Gemini input Artifact byte size is invalid.");
  }
  return BigInt(value);
}

async function readArtifact(
  artifact: WorkerInputArtifactRead,
  signal: AbortSignal,
  remainingBytes: number,
): Promise<Buffer> {
  const declaredSize = byteSize(artifact.byteSize);
  const limit = Math.min(maximumInputArtifactBytes, remainingBytes);
  if (
    declaredSize < 1n ||
    declaredSize > BigInt(limit) ||
    !hexadecimalSha256Pattern.test(artifact.sha256)
  ) {
    return contract("Gemini input Artifact exceeds its bounded contract.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const hash = createHash("sha256");
  try {
    for await (const chunk of artifact.body) {
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) {
        return contract(
          "Gemini input Artifact returned an invalid byte chunk.",
        );
      }
      total += chunk.byteLength;
      if (total > limit) {
        return contract(
          "Gemini input Artifact exceeded its bounded read limit.",
        );
      }
      const buffered = Buffer.from(chunk);
      hash.update(buffered);
      chunks.push(buffered);
    }
    if (
      BigInt(total) !== declaredSize ||
      hash.digest("hex") !== artifact.sha256
    ) {
      return contract(
        "Gemini input Artifact differs from its committed facts.",
      );
    }
    const joined = Buffer.concat(chunks, total);
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    return joined;
  } catch (error) {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    throw error;
  }
}

function artifactMediaType(
  artifact: WorkerInputArtifactRead,
): "image/jpeg" | "image/png" | "image/webp" {
  if (
    artifact.mediaType === "image/jpeg" ||
    artifact.mediaType === "image/png" ||
    artifact.mediaType === "image/webp"
  ) {
    return artifact.mediaType;
  }
  return contract("Gemini input Artifact media type is unsupported.");
}

async function providerParts(
  prepared: GeminiPreparedSnapshot,
  access: WorkerInputArtifactAccess,
  signal: AbortSignal,
): Promise<{
  readonly parts: readonly Readonly<Record<string, unknown>>[];
  readonly buffers: readonly Buffer[];
  readonly sourceArtifactIds: readonly string[];
}> {
  const parts: Readonly<Record<string, unknown>>[] = [];
  const buffers: Buffer[] = [];
  const sourceArtifactIds: string[] = [];
  let totalBytes = 0;
  try {
    for (const part of prepared.parts) {
      signal.throwIfAborted();
      if ("text" in part) {
        parts.push(Object.freeze({ text: part.text }));
        continue;
      }
      const artifact = await access.open({
        inputPointer: part.inputArtifact.inputPointer,
      });
      if (artifact.artifactId !== part.inputArtifact.artifactId) {
        return contract(
          "Gemini prepared Artifact ID differs from the authorized input.",
        );
      }
      const bytes = await readArtifact(
        artifact,
        signal,
        maximumTotalInputArtifactBytes - totalBytes,
      );
      buffers.push(bytes);
      totalBytes += bytes.byteLength;
      sourceArtifactIds.push(artifact.artifactId);
      parts.push(
        Object.freeze({
          inlineData: Object.freeze({
            mimeType: artifactMediaType(artifact),
            data: bytes.toString("base64"),
          }),
        }),
      );
    }
    return Object.freeze({
      parts: Object.freeze(parts),
      buffers: Object.freeze(buffers),
      sourceArtifactIds: Object.freeze(sourceArtifactIds),
    });
  } catch (error) {
    for (const bytes of buffers) {
      bytes.fill(0);
    }
    throw error;
  }
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

function failedObservation(
  response: ProviderHttpResponse,
  requestKey: string,
): ProviderObservation {
  return Object.freeze({
    observationKey: `submit:${createHash("sha256")
      .update(requestKey)
      .update(String(response.statusCode))
      .digest("hex")}`,
    status: "failed",
    stableErrorCode: failureCode(response),
  });
}

function boundedTokenCount(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return contract(`Gemini usageMetadata.${field} is invalid.`);
  }
  return value;
}

function usageMetrics(
  body: Readonly<Record<string, unknown>>,
): readonly ProviderUsageMetric[] {
  if (body.usageMetadata === undefined) {
    return Object.freeze([]);
  }
  if (!isPlainObject(body.usageMetadata)) {
    return contract("Gemini usageMetadata is invalid.");
  }
  const usage = body.usageMetadata;
  const values = new Map<string, number>();
  const add = (key: string, value: unknown, field: string): void => {
    const count = boundedTokenCount(value, field);
    if (count !== undefined) {
      values.set(key, count);
    }
  };
  add("input_tokens", usage.promptTokenCount, "promptTokenCount");
  add("output_tokens", usage.candidatesTokenCount, "candidatesTokenCount");
  add("total_tokens", usage.totalTokenCount, "totalTokenCount");
  add(
    "cached_input_tokens",
    usage.cachedContentTokenCount,
    "cachedContentTokenCount",
  );
  add("reasoning_tokens", usage.thoughtsTokenCount, "thoughtsTokenCount");
  const addDetails = (
    raw: unknown,
    field: string,
    prefix: "input" | "output",
  ): void => {
    if (raw === undefined) {
      return;
    }
    if (!Array.isArray(raw) || raw.length > 16) {
      contract(`Gemini usageMetadata.${field} is invalid.`);
    }
    for (const [index, detail] of raw.entries()) {
      if (!isPlainObject(detail) || typeof detail.modality !== "string") {
        contract(`Gemini usageMetadata.${field}[${index}] is invalid.`);
      }
      const count = boundedTokenCount(
        detail.tokenCount,
        `${field}[${index}].tokenCount`,
      );
      const modality = detail.modality.toLowerCase();
      if (
        count !== undefined &&
        (modality === "text" || modality === "image")
      ) {
        const key = `${prefix}_${modality}_tokens`;
        const total = (values.get(key) ?? 0) + count;
        if (!Number.isSafeInteger(total)) {
          contract(`Gemini usageMetadata.${field} token total is invalid.`);
        }
        values.set(key, total);
      }
    }
  };
  addDetails(usage.promptTokensDetails, "promptTokensDetails", "input");
  addDetails(
    usage.candidatesTokensDetails,
    "candidatesTokensDetails",
    "output",
  );
  return Object.freeze(
    [...values.entries()].map(([metricKey, numericValue]) =>
      Object.freeze({
        metricKey,
        numericValue: String(numericValue),
        unitCode: "token",
      }),
    ),
  );
}

function decodeImage(
  value: unknown,
  expectedFormat: GeminiOutputFormat | undefined,
  candidateIndex: number,
  partIndex: number,
): DecodedImage {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, new Set(["mimeType", "data"])) ||
    typeof value.mimeType !== "string" ||
    (value.mimeType !== "image/png" && value.mimeType !== "image/jpeg") ||
    typeof value.data !== "string" ||
    value.data.length < 4 ||
    value.data.length % 4 !== 0 ||
    !base64Pattern.test(value.data) ||
    Math.floor((value.data.length * 3) / 4) > maximumDecodedOutputBytes ||
    (expectedFormat === "png" && value.mimeType !== "image/png") ||
    (expectedFormat === "jpeg" && value.mimeType !== "image/jpeg")
  ) {
    return contract("Gemini image response contains invalid inlineData.");
  }
  const bytes = Buffer.from(value.data, "base64");
  const signatureMatches =
    value.mimeType === "image/png"
      ? bytes.byteLength >= 12 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.byteLength >= 4 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[bytes.byteLength - 2] === 0xff &&
        bytes[bytes.byteLength - 1] === 0xd9;
  if (
    bytes.byteLength > maximumDecodedOutputBytes ||
    bytes.toString("base64") !== value.data ||
    !signatureMatches
  ) {
    bytes.fill(0);
    return contract(
      "Gemini image response Base64 or media signature is invalid.",
    );
  }
  return Object.freeze({
    bytes,
    mediaType: value.mimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    candidateIndex,
    partIndex,
  });
}

function responseImages(
  body: Readonly<Record<string, unknown>>,
  expectedFormat: GeminiOutputFormat | undefined,
): readonly DecodedImage[] {
  if (
    !Array.isArray(body.candidates) ||
    body.candidates.length < 1 ||
    body.candidates.length > maximumOutputImages
  ) {
    return contract(
      "Gemini image response candidates are missing or unbounded.",
    );
  }
  const decoded: DecodedImage[] = [];
  try {
    for (const [candidateIndex, candidate] of body.candidates.entries()) {
      if (
        !isPlainObject(candidate) ||
        !isPlainObject(candidate.content) ||
        !Array.isArray(candidate.content.parts) ||
        candidate.content.parts.length < 1 ||
        candidate.content.parts.length > maximumCandidateParts
      ) {
        return contract("Gemini image response contains an invalid candidate.");
      }
      for (const [partIndex, part] of candidate.content.parts.entries()) {
        if (!isPlainObject(part)) {
          return contract(
            "Gemini image response contains an invalid candidate part.",
          );
        }
        if (part.thought !== undefined && typeof part.thought !== "boolean") {
          return contract(
            "Gemini image response contains an invalid thought marker.",
          );
        }
        if (part.inlineData === undefined || part.thought === true) {
          continue;
        }
        decoded.push(
          decodeImage(
            part.inlineData,
            expectedFormat,
            candidateIndex,
            partIndex,
          ),
        );
        if (decoded.length > maximumOutputImages) {
          return contract("Gemini image response contains too many images.");
        }
      }
    }
    if (decoded.length < 1) {
      return contract("Gemini image response contains no final inline image.");
    }
    const total = decoded.reduce(
      (sum, image) => sum + image.bytes.byteLength,
      0,
    );
    if (total > maximumDecodedOutputBytes) {
      return contract(
        "Gemini image response exceeds the aggregate output limit.",
      );
    }
    return Object.freeze(decoded);
  } catch (error) {
    for (const image of decoded) {
      image.bytes.fill(0);
    }
    throw error;
  }
}

function providerRequestId(
  response: ProviderHttpResponse,
  body: Readonly<Record<string, unknown>>,
): string | undefined {
  const value =
    body.responseId ??
    response.headers["x-request-id"] ??
    response.headers["x-goog-request-id"];
  if (
    value !== undefined &&
    (typeof value !== "string" ||
      value.length < 1 ||
      value.length > 512 ||
      !visibleAsciiPattern.test(value))
  ) {
    return contract("Gemini image response request ID is invalid.");
  }
  return value;
}

function outputReference(
  role: string,
  index = 0,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1",
    outputRole: role,
    outputIndex: index,
  });
}

function successObservation(
  response: ProviderHttpResponse,
  request: AuthorizedProviderInvocationRequest,
  prepared: GeminiPreparedSnapshot,
  sourceArtifactIds: readonly string[],
): ProviderObservation {
  if (!isPlainObject(response.body)) {
    return contract("Gemini image response must be a JSON object.");
  }
  const images = responseImages(response.body, prepared.result.outputFormat);
  try {
    const requestId = providerRequestId(response, response.body);
    const outputs: ProviderImageOutput[] = images.map((image, outputIndex) =>
      Object.freeze({
        outputRole: prepared.result.outputRole,
        outputIndex,
        artifactType: prepared.result.artifactType,
        metadata: Object.freeze({
          provider: "gemini",
          model: prepared.model,
          operation: prepared.operation,
          outputFormat: image.mediaType === "image/png" ? "png" : "jpeg",
          candidateIndex: image.candidateIndex,
          partIndex: image.partIndex,
          ...(sourceArtifactIds.length > 0
            ? {
                sourceArtifactIds: Object.freeze([...sourceArtifactIds]),
              }
            : {}),
          ...(requestId ? { providerRequestId: requestId } : {}),
        }),
        mediaType: image.mediaType,
        byteSize: String(image.bytes.byteLength),
        sha256: image.sha256,
        body: (async function* () {
          try {
            await Promise.resolve();
            yield image.bytes;
          } finally {
            image.bytes.fill(0);
          }
        })(),
      }),
    );
    const first = images[0]!;
    const output =
      prepared.operation === "image.generate"
        ? Object.freeze({
            schemaVersion: "kanvas.image-generate-result/v1",
            imageArtifactId: outputReference(prepared.result.outputRole),
          })
        : Object.freeze({
            schemaVersion: "kanvas.image-edit-result/v1",
            imageArtifactId: outputReference(prepared.result.outputRole),
            sourceArtifactId: sourceArtifactIds[0]!,
          });
    return Object.freeze({
      observationKey: `submit:${createHash("sha256")
        .update(request.stableRequestKey)
        .update(images.map(({ sha256 }) => sha256).join(":"))
        .digest("hex")}`,
      status: "succeeded",
      ...(requestId ? { providerRequestId: requestId } : {}),
      output: Object.freeze({
        ...output,
        mediaType: first.mediaType,
        sha256: first.sha256,
        byteSize: String(first.bytes.byteLength),
      }),
      outputs: Object.freeze(outputs),
      usage: usageMetrics(response.body),
    });
  } catch (error) {
    for (const image of images) {
      image.bytes.fill(0);
    }
    throw error;
  }
}

function failureRetryability(): Readonly<
  Record<string, "retryable" | "terminal" | "manual">
> {
  return Object.freeze({
    "provider.remote_invalid_request": "terminal",
    "provider.remote_authentication_failed": "terminal",
    "provider.remote_access_denied": "terminal",
    "provider.remote_rate_limited": "retryable",
    "provider.remote_unavailable": "retryable",
    "provider.response_failed": "manual",
  });
}

export class GeminiImageProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = geminiImageAdapterKey;
  readonly queryMode = "none" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = failureRetryability();

  public constructor(readonly transport: ProviderHttpTransport) {}

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    return Object.freeze({
      snapshot: prepareSnapshot(request),
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    authorized(request);
    const prepared = parsePreparedSnapshot(request);
    const providerContent = await providerParts(
      prepared,
      request.inputArtifacts,
      signal,
    );
    try {
      signal.throwIfAborted();
      const response = await this.transport.request({
        baseUrl: request.executionContext.endpoint.baseUrl,
        path: prepared.path,
        method: prepared.method,
        headers: {
          "x-goog-api-key": credentialHeader(request.credential),
          accept: "application/json",
        },
        body: Object.freeze({
          contents: Object.freeze([
            Object.freeze({
              role: "user",
              parts: providerContent.parts,
            }),
          ]),
          generationConfig: prepared.generationConfig,
        }),
        deadlineAt: request.deadlineAt,
        signal,
      });
      return response.statusCode >= 200 && response.statusCode < 300
        ? successObservation(
            response,
            request,
            prepared,
            providerContent.sourceArtifactIds,
          )
        : failedObservation(response, request.stableRequestKey);
    } finally {
      for (const bytes of providerContent.buffers) {
        bytes.fill(0);
      }
    }
  }

  public query(): Promise<ProviderObservation> {
    return Promise.reject(
      new ProviderAdapterContractError(
        "Gemini generateContent image requests do not expose a status query.",
      ),
    );
  }
}
