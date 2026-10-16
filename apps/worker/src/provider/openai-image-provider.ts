import { createHash, randomBytes } from "node:crypto";

import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";

import {
  ProviderAdapterContractError,
  type AsyncProviderAdapter,
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

export const openAiImageEditAdapterKey = "openai.images.edits.v1";

const maximumInputArtifactBytes = 52_428_800;
const maximumDecodedOutputBytes = 50_331_648;
const visibleAsciiPattern = /^[\x21-\x7e]+$/u;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const inputFields = new Set([
  "sourceArtifactId",
  "maskArtifactId",
  "prompt",
  "aspectRatio",
  "resolution",
  "size",
  "quality",
  "outputFormat",
  "outputCompression",
  "background",
  "numberOfImages",
  "seed",
]);
const supportedEffectiveParameterKeys = new Set([
  "size",
  "quality",
  "outputFormat",
  "outputCompression",
  "background",
]);
const outputFormats = new Set(["png", "jpeg", "webp"]);
const sizes = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);
const qualities = new Set(["auto", "low", "medium", "high"]);
const backgrounds = new Set(["auto", "transparent", "opaque"]);
const artifactTypes = new Set([
  "image.edited",
  "image.generated",
  "image.upscaled",
  "image.expanded",
  "image.object-removed",
]);

export interface OpenAiImageEditCommand {
  readonly sourceArtifactId: string;
  readonly sourceInputPointer: string;
  readonly prompt: string;
  readonly maskArtifactId?: string;
  readonly maskInputPointer?: string;
  readonly size: string;
  readonly quality: string;
  readonly outputFormat: "png" | "jpeg" | "webp";
  readonly outputCompression?: number;
  readonly background: string;
  readonly outputArtifactType: string;
  readonly outputRole: string;
  readonly adapterState: Readonly<Record<string, unknown>>;
}

interface OpenAiImageEditPreparedSnapshot extends Readonly<
  Record<string, unknown>
> {
  readonly schemaVersion: "kanvas.openai-image-edit-request/v1";
  readonly adapterKey: string;
  readonly method: "POST";
  readonly path: "/images/edits";
  readonly requestFingerprint: string;
  readonly model: string;
  readonly multipart: {
    readonly source: {
      readonly artifactId: string;
      readonly inputPointer: string;
    };
    readonly mask?: {
      readonly artifactId: string;
      readonly inputPointer: string;
    };
    readonly fields: {
      readonly prompt: string;
      readonly size: string;
      readonly quality: string;
      readonly outputFormat: "png" | "jpeg" | "webp";
      readonly outputCompression?: number;
      readonly background: string;
    };
  };
  readonly result: {
    readonly outputArtifactType: string;
    readonly outputRole: string;
  };
  readonly adapterState: Readonly<Record<string, unknown>>;
}

export interface OpenAiImageEditProtocolResult {
  readonly observation: ProviderObservation;
  readonly prepared: OpenAiImageEditPreparedSnapshot;
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
    contract(
      "OpenAI Images Adapter requires pinned execution context, callback-scoped credential, and Artifact access.",
    );
  }
}

function assertContext(
  request: Pick<ProviderInvocationRequest, "route">,
  context: ProviderInvocationExecutionContext,
  requireImageEditOperation: boolean,
): void {
  if (
    context.endpoint.adapterKind !== "openai_native" ||
    context.endpoint.presetKind !== "openai" ||
    context.route.apiSurface !== "images.edits.v1" ||
    context.route.providerProtocolVersion !== 1 ||
    request.route.providerProtocolVersion !== 1 ||
    request.route.apiSurface !== "images.edits.v1" ||
    context.route.providerEndpointId !== request.route.providerEndpointId ||
    context.route.modelDeploymentId !== request.route.modelDeploymentId ||
    (requireImageEditOperation &&
      (context.route.modelOperation !== "image.edit" ||
        request.route.modelOperation !== "image.edit" ||
        !request.route.parameterPolicies ||
        !request.route.parameterPolicyDigest))
  ) {
    contract(
      "OpenAI Images Adapter does not match the pinned endpoint or API surface.",
    );
  }
  if (
    context.model.providerModelId.length < 1 ||
    context.model.providerModelId.length > 256 ||
    context.model.providerModelId !== context.model.providerModelId.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(context.model.providerModelId)
  ) {
    contract("OpenAI Images Adapter model ID is outside its bounded contract.");
  }
}

function credentialHeader(credential: Uint8Array): string {
  const value = Buffer.from(credential).toString("utf8");
  if (
    value.length < 1 ||
    value.length > 4_096 ||
    value !== value.trim() ||
    /[^\x21-\x7e]/u.test(value)
  ) {
    return contract("Provider credential is not bounded printable ASCII.");
  }
  return `Bearer ${value}`;
}

function preparationContext(
  request: ProviderRequestPreparationRequest,
): ProviderInvocationExecutionContext {
  if (!request.executionContext) {
    return contract(
      "OpenAI image edit preparation requires a pinned execution context.",
    );
  }
  return request.executionContext;
}

function effectiveValues(
  request: ProviderRequestPreparationRequest,
): Readonly<Record<string, string | number | boolean>> {
  const route = request.route;
  if (
    route.providerProtocolVersion !== 1 ||
    route.modelOperation !== "image.edit" ||
    !route.parameterPolicies ||
    !route.parameterPolicyDigest
  ) {
    return contract(
      "OpenAI image edit requires a pinned v2 model operation and parameter policy.",
    );
  }
  const values = request.effectiveParameters ?? {};
  const policies = route.parameterPolicies;
  if (
    Object.keys(values).some(
      (key) =>
        !supportedEffectiveParameterKeys.has(key) ||
        !Object.hasOwn(policies, key),
    )
  ) {
    return contract(
      "Resolved OpenAI image edit parameters contain an unknown or unpinned field.",
    );
  }
  return values;
}

function optionalStringParameter(
  values: Readonly<Record<string, string | number | boolean>>,
  key: string,
  allowed: ReadonlySet<string>,
): string | undefined {
  const value = values[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.has(value)) {
    return contract(
      `Resolved OpenAI image edit parameter "${key}" is outside the Adapter protocol.`,
    );
  }
  return value;
}

function optionalIntegerParameter(
  values: Readonly<Record<string, string | number | boolean>>,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = values[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return contract(
      `Resolved OpenAI image edit parameter "${key}" is outside the Adapter protocol.`,
    );
  }
  return value;
}

function parseInput(
  request: ProviderRequestPreparationRequest,
): OpenAiImageEditCommand {
  const value = request.input;
  if (
    !isPlainObject(value) ||
    Object.keys(value).some((key) => !inputFields.has(key)) ||
    typeof value.sourceArtifactId !== "string" ||
    !artifactIdPattern.test(value.sourceArtifactId) ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length < 1 ||
    value.prompt.length > 32_000
  ) {
    return contract(
      "OpenAI image edit input does not match the bounded Adapter contract.",
    );
  }
  const values = effectiveValues(request);
  const size = optionalStringParameter(values, "size", sizes) ?? "auto";
  const quality =
    optionalStringParameter(values, "quality", qualities) ?? "high";
  const outputFormat =
    optionalStringParameter(values, "outputFormat", outputFormats) ?? "png";
  const background =
    optionalStringParameter(values, "background", backgrounds) ?? "auto";
  const outputCompression = optionalIntegerParameter(
    values,
    "outputCompression",
    0,
    100,
  );
  if (
    value.maskArtifactId !== undefined &&
    (typeof value.maskArtifactId !== "string" ||
      !artifactIdPattern.test(value.maskArtifactId) ||
      value.maskArtifactId === value.sourceArtifactId)
  ) {
    return contract("OpenAI image edit options are invalid.");
  }
  return Object.freeze({
    sourceArtifactId: value.sourceArtifactId,
    sourceInputPointer: "/sourceArtifactId",
    prompt: configuredPrompt(request, {
      prompt: value.prompt.trim(),
    }),
    ...(typeof value.maskArtifactId === "string"
      ? {
          maskArtifactId: value.maskArtifactId,
          maskInputPointer: "/maskArtifactId",
        }
      : {}),
    size,
    quality,
    outputFormat: outputFormat as OpenAiImageEditCommand["outputFormat"],
    ...(outputCompression !== undefined ? { outputCompression } : {}),
    background,
    outputArtifactType: "image.edited",
    outputRole: "edited",
    adapterState: Object.freeze({
      sourceArtifactId: value.sourceArtifactId,
    }),
  });
}

function boundedAdapterKey(value: string): string {
  if (
    value.length < 1 ||
    value.length > 160 ||
    !visibleAsciiPattern.test(value)
  ) {
    return contract("OpenAI image edit Adapter key is invalid.");
  }
  return value;
}

function boundedInputPointer(value: string): string {
  if (value !== "/sourceArtifactId" && value !== "/maskArtifactId") {
    return contract("OpenAI image edit Artifact pointer is invalid.");
  }
  return value;
}

function validateCommand(
  command: OpenAiImageEditCommand,
): OpenAiImageEditCommand {
  if (
    typeof command.sourceArtifactId !== "string" ||
    !artifactIdPattern.test(command.sourceArtifactId) ||
    typeof command.sourceInputPointer !== "string" ||
    typeof command.prompt !== "string" ||
    command.prompt.trim().length < 1 ||
    command.prompt.length > 32_000 ||
    typeof command.size !== "string" ||
    !sizes.has(command.size) ||
    typeof command.quality !== "string" ||
    !qualities.has(command.quality) ||
    typeof command.outputFormat !== "string" ||
    !outputFormats.has(command.outputFormat) ||
    typeof command.background !== "string" ||
    !backgrounds.has(command.background) ||
    typeof command.outputArtifactType !== "string" ||
    !artifactTypes.has(command.outputArtifactType) ||
    typeof command.outputRole !== "string" ||
    command.outputRole.length < 1 ||
    command.outputRole.length > 80 ||
    !visibleAsciiPattern.test(command.outputRole) ||
    !isPlainObject(command.adapterState) ||
    (command.outputCompression !== undefined &&
      (!Number.isSafeInteger(command.outputCompression) ||
        command.outputCompression < 0 ||
        command.outputCompression > 100)) ||
    (command.maskArtifactId === undefined) !==
      (command.maskInputPointer === undefined) ||
    (command.maskArtifactId !== undefined &&
      (typeof command.maskArtifactId !== "string" ||
        !artifactIdPattern.test(command.maskArtifactId))) ||
    (command.maskInputPointer !== undefined &&
      typeof command.maskInputPointer !== "string")
  ) {
    return contract(
      "OpenAI image edit command is outside the bounded protocol.",
    );
  }
  const sourceInputPointer = boundedInputPointer(command.sourceInputPointer);
  const maskInputPointer = command.maskInputPointer
    ? boundedInputPointer(command.maskInputPointer)
    : undefined;
  if (
    sourceInputPointer !== "/sourceArtifactId" ||
    (maskInputPointer !== undefined && maskInputPointer !== "/maskArtifactId")
  ) {
    return contract("OpenAI image edit Artifact roles are invalid.");
  }
  return Object.freeze({
    sourceArtifactId: command.sourceArtifactId,
    sourceInputPointer,
    prompt: command.prompt,
    ...(command.maskArtifactId && maskInputPointer
      ? {
          maskArtifactId: command.maskArtifactId,
          maskInputPointer,
        }
      : {}),
    size: command.size,
    quality: command.quality,
    outputFormat: command.outputFormat,
    ...(command.outputCompression !== undefined
      ? { outputCompression: command.outputCompression }
      : {}),
    background: command.background,
    outputArtifactType: command.outputArtifactType,
    outputRole: command.outputRole,
    adapterState: Object.freeze({
      ...command.adapterState,
    }),
  });
}

function snapshotFrom(
  request: ProviderRequestPreparationRequest,
  adapterKey: string,
  commandValue: OpenAiImageEditCommand,
  requireImageEditOperation: boolean,
): OpenAiImageEditPreparedSnapshot {
  const context = preparationContext(request);
  assertContext(request, context, requireImageEditOperation);
  const command = validateCommand(commandValue);
  return Object.freeze({
    schemaVersion: "kanvas.openai-image-edit-request/v1",
    adapterKey: boundedAdapterKey(adapterKey),
    method: "POST",
    path: "/images/edits",
    requestFingerprint: request.requestFingerprint,
    model: context.model.providerModelId,
    multipart: Object.freeze({
      source: Object.freeze({
        artifactId: command.sourceArtifactId,
        inputPointer: command.sourceInputPointer,
      }),
      ...(command.maskArtifactId && command.maskInputPointer
        ? {
            mask: Object.freeze({
              artifactId: command.maskArtifactId,
              inputPointer: command.maskInputPointer,
            }),
          }
        : {}),
      fields: Object.freeze({
        prompt: command.prompt,
        size: command.size,
        quality: command.quality,
        outputFormat: command.outputFormat,
        ...(command.outputCompression !== undefined
          ? {
              outputCompression: command.outputCompression,
            }
          : {}),
        background: command.background,
      }),
    }),
    result: Object.freeze({
      outputArtifactType: command.outputArtifactType,
      outputRole: command.outputRole,
    }),
    adapterState: command.adapterState,
  });
}

export function prepareOpenAiImageEditRequest(
  request: ProviderRequestPreparationRequest,
  options: {
    readonly adapterKey: string;
    readonly command: OpenAiImageEditCommand;
    readonly requireImageEditOperation?: boolean;
  },
): PreparedProviderRequest {
  return Object.freeze({
    snapshot: snapshotFrom(
      request,
      options.adapterKey,
      options.command,
      options.requireImageEditOperation ?? false,
    ),
  });
}

function snapshotRecord(
  request: AuthorizedProviderInvocationRequest,
): Readonly<Record<string, unknown>> {
  const snapshot = request.preparedRequestSnapshot;
  if (
    !isPlainObject(snapshot) ||
    typeof request.preparedRequestDigest !== "string"
  ) {
    return contract("OpenAI image edit prepared request is missing.");
  }
  let observedDigest: string;
  try {
    observedDigest = digestProviderValue(snapshot);
  } catch {
    return contract(
      "OpenAI image edit prepared request is not canonical JSON.",
    );
  }
  if (observedDigest !== request.preparedRequestDigest) {
    return contract(
      "OpenAI image edit prepared request differs from its immutable digest.",
    );
  }
  return snapshot;
}

function parseArtifactReference(
  value: unknown,
  role: "source" | "mask",
): {
  readonly artifactId: string;
  readonly inputPointer: string;
} {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.artifactId !== "string" ||
    !artifactIdPattern.test(value.artifactId) ||
    typeof value.inputPointer !== "string"
  ) {
    return contract(`OpenAI image edit prepared ${role} Artifact is invalid.`);
  }
  const inputPointer = boundedInputPointer(value.inputPointer);
  if (
    inputPointer !==
    (role === "source" ? "/sourceArtifactId" : "/maskArtifactId")
  ) {
    return contract(
      `OpenAI image edit prepared ${role} Artifact role is invalid.`,
    );
  }
  return Object.freeze({
    artifactId: value.artifactId,
    inputPointer,
  });
}

export function readPreparedOpenAiImageEditRequest(
  request: AuthorizedProviderInvocationRequest,
  options: {
    readonly adapterKey: string;
    readonly requireImageEditOperation?: boolean;
  },
): OpenAiImageEditPreparedSnapshot {
  const snapshot = snapshotRecord(request);
  if (
    Object.keys(snapshot).length !== 9 ||
    snapshot.schemaVersion !== "kanvas.openai-image-edit-request/v1" ||
    snapshot.adapterKey !== boundedAdapterKey(options.adapterKey) ||
    snapshot.method !== "POST" ||
    snapshot.path !== "/images/edits" ||
    snapshot.requestFingerprint !== request.requestFingerprint ||
    typeof snapshot.model !== "string" ||
    !isPlainObject(snapshot.multipart) ||
    !isPlainObject(snapshot.multipart.fields) ||
    !isPlainObject(snapshot.result) ||
    !isPlainObject(snapshot.adapterState) ||
    Object.keys(snapshot.multipart).some(
      (key) => key !== "source" && key !== "mask" && key !== "fields",
    ) ||
    Object.keys(snapshot.multipart.fields).some(
      (key) =>
        ![
          "prompt",
          "size",
          "quality",
          "outputFormat",
          "outputCompression",
          "background",
        ].includes(key),
    ) ||
    Object.keys(snapshot.result).length !== 2 ||
    typeof snapshot.multipart.fields.prompt !== "string" ||
    typeof snapshot.multipart.fields.size !== "string" ||
    typeof snapshot.multipart.fields.quality !== "string" ||
    typeof snapshot.multipart.fields.outputFormat !== "string" ||
    (snapshot.multipart.fields.outputCompression !== undefined &&
      typeof snapshot.multipart.fields.outputCompression !== "number") ||
    typeof snapshot.multipart.fields.background !== "string" ||
    typeof snapshot.result.outputArtifactType !== "string" ||
    typeof snapshot.result.outputRole !== "string"
  ) {
    return contract("OpenAI image edit prepared request shape is invalid.");
  }
  assertContext(
    request,
    request.executionContext,
    options.requireImageEditOperation ?? false,
  );
  if (snapshot.model !== request.executionContext.model.providerModelId) {
    return contract(
      "OpenAI image edit prepared model differs from the pinned execution context.",
    );
  }
  const fields = snapshot.multipart.fields;
  const result = snapshot.result;
  const source = parseArtifactReference(snapshot.multipart.source, "source");
  const mask =
    snapshot.multipart.mask === undefined
      ? undefined
      : parseArtifactReference(snapshot.multipart.mask, "mask");
  const command = validateCommand({
    sourceArtifactId: source.artifactId,
    sourceInputPointer: source.inputPointer,
    ...(mask
      ? {
          maskArtifactId: mask.artifactId,
          maskInputPointer: mask.inputPointer,
        }
      : {}),
    prompt: fields.prompt as string,
    size: fields.size as string,
    quality: fields.quality as string,
    outputFormat: fields.outputFormat as OpenAiImageEditCommand["outputFormat"],
    ...(fields.outputCompression !== undefined
      ? {
          outputCompression: fields.outputCompression as number,
        }
      : {}),
    background: fields.background as string,
    outputArtifactType: result.outputArtifactType as string,
    outputRole: result.outputRole as string,
    adapterState: snapshot.adapterState,
  });
  return snapshotFrom(
    Object.freeze({
      ...request,
      executionContext: request.executionContext,
    }),
    options.adapterKey,
    command,
    options.requireImageEditOperation ?? false,
  );
}

async function readArtifact(
  artifact: WorkerInputArtifactRead,
  signal: AbortSignal,
): Promise<Buffer> {
  if (BigInt(artifact.byteSize) > BigInt(maximumInputArtifactBytes)) {
    return contract("OpenAI image input Artifact exceeds the Adapter limit.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of artifact.body) {
    signal.throwIfAborted();
    total += chunk.byteLength;
    if (total > maximumInputArtifactBytes) {
      for (const buffered of chunks) {
        buffered.fill(0);
      }
      return contract(
        "OpenAI image input Artifact exceeded its bounded read limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function multipartHeader(
  boundary: string,
  disposition: string,
  contentType?: string,
): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; ${disposition}\r\n${
      contentType ? `Content-Type: ${contentType}\r\n` : ""
    }\r\n`,
    "utf8",
  );
}

function appendField(
  parts: Buffer[],
  boundary: string,
  name: string,
  value: string,
): void {
  parts.push(
    multipartHeader(boundary, `name="${name}"`),
    Buffer.from(value, "utf8"),
    Buffer.from("\r\n", "utf8"),
  );
}

function extensionFor(mediaType: string): string {
  if (mediaType === "image/jpeg") {
    return "jpg";
  }
  if (mediaType === "image/webp") {
    return "webp";
  }
  return "png";
}

function appendFile(
  parts: Buffer[],
  boundary: string,
  name: string,
  artifact: WorkerInputArtifactRead,
  body: Buffer,
): void {
  parts.push(
    multipartHeader(
      boundary,
      `name="${name}"; filename="${name}.${extensionFor(artifact.mediaType)}"`,
      artifact.mediaType,
    ),
    body,
    Buffer.from("\r\n", "utf8"),
  );
}

function buildMultipart(
  prepared: OpenAiImageEditPreparedSnapshot,
  source: WorkerInputArtifactRead,
  sourceBody: Buffer,
  mask: WorkerInputArtifactRead | undefined,
  maskBody: Buffer | undefined,
): { readonly body: Buffer; readonly contentType: string } {
  const boundary = `kanvas-${randomBytes(24).toString("hex")}`;
  const parts: Buffer[] = [];
  appendField(parts, boundary, "model", prepared.model);
  appendField(parts, boundary, "prompt", prepared.multipart.fields.prompt);
  appendField(parts, boundary, "size", prepared.multipart.fields.size);
  appendField(parts, boundary, "quality", prepared.multipart.fields.quality);
  appendField(
    parts,
    boundary,
    "output_format",
    prepared.multipart.fields.outputFormat,
  );
  appendField(
    parts,
    boundary,
    "background",
    prepared.multipart.fields.background,
  );
  if (prepared.multipart.fields.outputCompression !== undefined) {
    appendField(
      parts,
      boundary,
      "output_compression",
      String(prepared.multipart.fields.outputCompression),
    );
  }
  appendFile(parts, boundary, "image[]", source, sourceBody);
  if (mask && maskBody) {
    appendFile(parts, boundary, "mask", mask, maskBody);
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Object.freeze({
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  });
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

function usageMetrics(
  body: Readonly<Record<string, unknown>>,
): readonly ProviderUsageMetric[] {
  if (!isPlainObject(body.usage)) {
    return Object.freeze([]);
  }
  const metrics: ProviderUsageMetric[] = [];
  const add = (metricKey: string, value: unknown): void => {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      metrics.push(
        Object.freeze({
          metricKey,
          numericValue: String(value),
          unitCode: "token",
        }),
      );
    }
  };
  add("input_tokens", body.usage.input_tokens);
  add("output_tokens", body.usage.output_tokens);
  add("total_tokens", body.usage.total_tokens);
  if (isPlainObject(body.usage.input_tokens_details)) {
    add("input_text_tokens", body.usage.input_tokens_details.text_tokens);
    add("input_image_tokens", body.usage.input_tokens_details.image_tokens);
  }
  return Object.freeze(metrics);
}

function decodeImage(
  encoded: unknown,
  format: OpenAiImageEditCommand["outputFormat"],
): {
  readonly bytes: Buffer;
  readonly mediaType: ProviderImageOutput["mediaType"];
  readonly sha256: string;
} {
  if (
    typeof encoded !== "string" ||
    encoded.length < 4 ||
    encoded.length % 4 !== 0 ||
    !base64Pattern.test(encoded) ||
    Math.floor((encoded.length * 3) / 4) > maximumDecodedOutputBytes
  ) {
    return contract(
      "OpenAI image response contains invalid or oversized Base64.",
    );
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.byteLength < 12 ||
    bytes.byteLength > maximumDecodedOutputBytes ||
    bytes.toString("base64") !== encoded
  ) {
    bytes.fill(0);
    return contract("OpenAI image response Base64 is not canonical.");
  }
  const signatures = {
    png: bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg: bytes[0] === 0xff && bytes[1] === 0xd8,
    webp:
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP",
  };
  if (!signatures[format]) {
    bytes.fill(0);
    return contract(
      "OpenAI image response does not match the requested format.",
    );
  }
  return Object.freeze({
    bytes,
    mediaType: `image/${format}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function successObservation(
  response: ProviderHttpResponse,
  request: AuthorizedProviderInvocationRequest,
  prepared: OpenAiImageEditPreparedSnapshot,
): ProviderObservation {
  if (
    !isPlainObject(response.body) ||
    !Array.isArray(response.body.data) ||
    response.body.data.length !== 1 ||
    !isPlainObject(response.body.data[0])
  ) {
    return contract(
      "OpenAI image response does not contain exactly one output.",
    );
  }
  const decoded = decodeImage(
    response.body.data[0].b64_json,
    prepared.multipart.fields.outputFormat,
  );
  const providerRequestId = response.headers["x-request-id"];
  if (
    providerRequestId !== undefined &&
    (providerRequestId.length < 1 ||
      providerRequestId.length > 512 ||
      !visibleAsciiPattern.test(providerRequestId))
  ) {
    decoded.bytes.fill(0);
    return contract("OpenAI image response request ID is invalid.");
  }
  const output: ProviderImageOutput = Object.freeze({
    outputRole: prepared.result.outputRole,
    outputIndex: 0,
    artifactType: prepared.result.outputArtifactType,
    metadata: Object.freeze({
      provider: "openai",
      model: request.executionContext.model.providerModelId,
      operation: "image_edit",
      outputFormat: prepared.multipart.fields.outputFormat,
      quality: prepared.multipart.fields.quality,
      size: prepared.multipart.fields.size,
      sourceArtifactId: prepared.multipart.source.artifactId,
      ...(providerRequestId ? { providerRequestId } : {}),
    }),
    mediaType: decoded.mediaType,
    byteSize: String(decoded.bytes.byteLength),
    sha256: decoded.sha256,
    body: (async function* () {
      try {
        await Promise.resolve();
        yield decoded.bytes;
      } finally {
        decoded.bytes.fill(0);
      }
    })(),
  });
  return Object.freeze({
    observationKey: `submit:${createHash("sha256")
      .update(request.stableRequestKey)
      .update(decoded.sha256)
      .digest("hex")}`,
    status: "succeeded",
    ...(providerRequestId ? { providerRequestId } : {}),
    output: Object.freeze({
      imageArtifactId: Object.freeze({
        $kanvas: "attempt-output-artifact/v1" as const,
        outputRole: prepared.result.outputRole,
        outputIndex: 0,
      }),
      mediaType: decoded.mediaType,
      sha256: decoded.sha256,
      byteSize: String(decoded.bytes.byteLength),
      providerOperation: "image_edit",
    }),
    outputs: Object.freeze([output]),
    usage: usageMetrics(response.body),
  });
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

export const openAiImageEditFailureRetryability = failureRetryability();

export async function submitPreparedOpenAiImageEdit(
  requestValue: ProviderInvocationRequest,
  signal: AbortSignal,
  options: {
    readonly adapterKey: string;
    readonly inputArtifacts?: WorkerInputArtifactAccess;
    readonly requireImageEditOperation?: boolean;
    readonly transport: ProviderHttpTransport;
  },
): Promise<OpenAiImageEditProtocolResult> {
  authorized(requestValue);
  const request = requestValue;
  const prepared = readPreparedOpenAiImageEditRequest(request, {
    adapterKey: options.adapterKey,
    ...(options.requireImageEditOperation !== undefined
      ? {
          requireImageEditOperation: options.requireImageEditOperation,
        }
      : {}),
  });
  const inputArtifacts = options.inputArtifacts ?? request.inputArtifacts;
  const source = await inputArtifacts.open({
    inputPointer: prepared.multipart.source.inputPointer,
  });
  if (source.artifactId !== prepared.multipart.source.artifactId) {
    return contract(
      "OpenAI image edit source Artifact differs from the prepared request.",
    );
  }
  const mask = prepared.multipart.mask
    ? await inputArtifacts.open({
        inputPointer: prepared.multipart.mask.inputPointer,
      })
    : undefined;
  if (mask && mask.artifactId !== prepared.multipart.mask?.artifactId) {
    return contract(
      "OpenAI image edit mask Artifact differs from the prepared request.",
    );
  }
  const sourceBody = await readArtifact(source, signal);
  let maskBody: Buffer | undefined;
  let multipartBody: Buffer | undefined;
  try {
    maskBody = mask ? await readArtifact(mask, signal) : undefined;
    const multipart = buildMultipart(
      prepared,
      source,
      sourceBody,
      mask,
      maskBody,
    );
    multipartBody = multipart.body;
    const response = await options.transport.request({
      baseUrl: request.executionContext.endpoint.baseUrl,
      path: prepared.path,
      method: prepared.method,
      headers: {
        authorization: credentialHeader(request.credential),
        "idempotency-key": request.stableRequestKey,
        accept: "application/json",
      },
      binaryBody: multipart.body,
      contentType: multipart.contentType,
      deadlineAt: request.deadlineAt,
      signal,
    });
    const observation =
      response.statusCode >= 200 && response.statusCode < 300
        ? successObservation(response, request, prepared)
        : failedObservation(response, request.stableRequestKey);
    return Object.freeze({
      observation,
      prepared,
    });
  } finally {
    sourceBody.fill(0);
    maskBody?.fill(0);
    multipartBody?.fill(0);
  }
}

function mapAtomicImageEditObservation(
  result: OpenAiImageEditProtocolResult,
): ProviderObservation {
  const { observation, prepared } = result;
  if (observation.status !== "succeeded") {
    return observation;
  }
  if (observation.outputs?.length !== 1) {
    return contract("OpenAI image edit Provider output is incomplete.");
  }
  return Object.freeze({
    ...observation,
    output: Object.freeze({
      schemaVersion: "kanvas.image-edit-result/v1",
      imageArtifactId: Object.freeze({
        $kanvas: "attempt-output-artifact/v1" as const,
        outputRole: prepared.result.outputRole,
        outputIndex: 0,
      }),
      sourceArtifactId: prepared.multipart.source.artifactId,
    }),
  });
}

export class OpenAiImageEditProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = openAiImageEditAdapterKey;
  readonly queryMode = "none" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability = openAiImageEditFailureRetryability;

  public constructor(readonly transport: ProviderHttpTransport) {}

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    return prepareOpenAiImageEditRequest(request, {
      adapterKey: this.adapterKey,
      command: parseInput(request),
      requireImageEditOperation: true,
    });
  }

  public async submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    return mapAtomicImageEditObservation(
      await submitPreparedOpenAiImageEdit(request, signal, {
        adapterKey: this.adapterKey,
        requireImageEditOperation: true,
        transport: this.transport,
      }),
    );
  }

  public query(): Promise<ProviderObservation> {
    return Promise.reject(
      new ProviderAdapterContractError(
        "OpenAI image edits do not expose a status query in the current Adapter.",
      ),
    );
  }
}
