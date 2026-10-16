import {
  ProviderAdapterContractError,
  type AsyncProviderAdapter,
  type PreparedProviderRequest,
  type ProviderInvocationRequest,
  type ProviderObservation,
  type ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import { configuredPrompt } from "./image-implementation-configuration.js";
import {
  OpenAiCompatibleImageGenerationProtocol,
  openAiCompatibleImageGenerationFailureRetryability,
  type OpenAiCompatibleImageGenerationCommand,
} from "./openai-compatible-image-generation-protocol.js";
import type { ProviderHttpTransport } from "./provider-http-transport.js";

export const openAiCompatibleImageGenerateAdapterKey =
  "openai-compatible.images.generations.v1";

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const allowedInputKeys = new Set([
  "prompt",
  "referenceArtifactIds",
  "size",
  "aspectRatio",
  "resolution",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
  "numberOfImages",
  "seed",
]);
const supportedParameterKeys = new Set([
  "size",
  "aspectRatio",
  "resolution",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
  "numberOfImages",
  "seed",
]);
const qualities = new Set(["auto", "low", "medium", "high"]);
const outputFormats = new Set(["png", "jpeg", "webp"]);
const backgrounds = new Set(["auto", "opaque", "transparent"]);

interface ImageGenerateInput {
  readonly prompt: string;
  readonly referenceArtifactIds: readonly string[];
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

function parseInput(value: unknown): ImageGenerateInput {
  const rawReferenceArtifactIds = isPlainObject(value)
    ? value.referenceArtifactIds
    : undefined;
  if (
    !isPlainObject(value) ||
    Object.keys(value).some((key) => !allowedInputKeys.has(key)) ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length < 1 ||
    value.prompt.length > 8_000 ||
    (rawReferenceArtifactIds !== undefined &&
      (!Array.isArray(rawReferenceArtifactIds) ||
        rawReferenceArtifactIds.length < 1 ||
        rawReferenceArtifactIds.length > 14 ||
        rawReferenceArtifactIds.some(
          (candidate) =>
            typeof candidate !== "string" || !ulidPattern.test(candidate),
        ) ||
        new Set(rawReferenceArtifactIds).size !==
          rawReferenceArtifactIds.length))
  ) {
    return contract(
      "Image generate input does not match kanvas.image-generate-input/v1.",
    );
  }
  return Object.freeze({
    prompt: value.prompt.trim(),
    referenceArtifactIds: Object.freeze(
      Array.isArray(rawReferenceArtifactIds)
        ? rawReferenceArtifactIds.map((candidate) => String(candidate))
        : [],
    ),
  });
}

function effectiveValues(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
): Readonly<Record<string, string | number | boolean>> {
  const route = request.route;
  if (
    route.providerProtocolVersion !== 1 ||
    !("modelOperation" in route) ||
    route.modelOperation !== "image.generate" ||
    !route.parameterPolicies ||
    !route.parameterPolicyDigest
  ) {
    return contract(
      "Image generation requires a pinned v2 model operation and parameter policy.",
    );
  }
  const policies = route.parameterPolicies;
  if (!policies) {
    return contract("Image generation route parameter policy is missing.");
  }
  const values = request.effectiveParameters ?? {};
  if (
    Object.keys(values).some(
      (key) =>
        !supportedParameterKeys.has(key) || !Object.hasOwn(policies, key),
    )
  ) {
    return contract(
      "Resolved image parameters contain a field outside the pinned Adapter contract.",
    );
  }
  return values;
}

function optionalString(
  values: Readonly<Record<string, string | number | boolean>>,
  key: string,
  validate: (value: string) => boolean,
): string | undefined {
  const value = values[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !validate(value)) {
    return contract(
      `Resolved Provider parameter "${key}" is outside the image generation protocol.`,
    );
  }
  return value;
}

function optionalInteger(
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
      `Resolved Provider parameter "${key}" is outside the image generation protocol.`,
    );
  }
  return value;
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

function commandFor(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
): OpenAiCompatibleImageGenerationCommand {
  const input = parseInput(request.input);
  const values = effectiveValues(request);
  const numberOfImages = optionalInteger(values, "numberOfImages", 1, 10);
  const quality = optionalString(values, "quality", (value) =>
    qualities.has(value),
  ) as OpenAiCompatibleImageGenerationCommand["quality"];
  const outputFormat = optionalString(values, "outputFormat", (value) =>
    outputFormats.has(value),
  ) as OpenAiCompatibleImageGenerationCommand["outputFormat"];
  const background = optionalString(values, "background", (value) =>
    backgrounds.has(value),
  ) as OpenAiCompatibleImageGenerationCommand["background"];
  const size = optionalString(values, "size", validSize);
  const aspectRatio = optionalString(values, "aspectRatio", validAspectRatio);
  const resolution = optionalString(values, "resolution", validResolution);
  const outputCompression = optionalInteger(
    values,
    "outputCompression",
    0,
    100,
  );
  const seed = optionalInteger(values, "seed", 0, 4_294_967_295);
  return Object.freeze({
    prompt: configuredPrompt(request, { prompt: input.prompt }),
    referenceArtifactIds: input.referenceArtifactIds,
    ...(size === undefined ? {} : { size }),
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(quality === undefined ? {} : { quality }),
    ...(outputFormat === undefined ? {} : { outputFormat }),
    ...(background === undefined ? {} : { background }),
    ...(outputCompression === undefined ? {} : { outputCompression }),
    ...(numberOfImages === undefined ? {} : { numberOfImages }),
    ...(seed === undefined ? {} : { seed }),
  });
}

export class OpenAiCompatibleImageGenerateProviderAdapter implements AsyncProviderAdapter {
  readonly adapterKey = openAiCompatibleImageGenerateAdapterKey;
  readonly queryMode = "none" as const;
  readonly notFoundIsAuthoritative = false;
  readonly credentialMode = "provider-secret" as const;
  readonly failureRetryability =
    openAiCompatibleImageGenerationFailureRetryability;
  readonly #protocol: OpenAiCompatibleImageGenerationProtocol;

  public constructor(transport: ProviderHttpTransport) {
    this.#protocol = new OpenAiCompatibleImageGenerationProtocol(transport);
  }

  public prepare(
    request: ProviderRequestPreparationRequest,
  ): PreparedProviderRequest {
    return this.#protocol.prepare(request, commandFor(request));
  }

  public submit(
    request: ProviderInvocationRequest,
    signal: AbortSignal,
  ): Promise<ProviderObservation> {
    return this.#protocol.submit(request, signal);
  }

  public query(): Promise<ProviderObservation> {
    return Promise.reject(
      new ProviderAdapterContractError(
        "OpenAI-compatible image generation does not expose a status query.",
      ),
    );
  }
}
