import { createHash } from "node:crypto";

import type {
  ProviderModelCapabilityKey,
  ProviderModelCatalogDocument,
  ProviderModelCatalogEntry,
  ProviderModelEvidence,
  ProviderModelModality,
  ProviderModelOperationDefinition,
  ProviderModelOperations,
  ProviderModelParameterDefinition,
  ProviderModelParameterValue,
} from "@kanvas/contracts/provider-model";
import { parseProviderModelCatalogDocument } from "@kanvas/contracts/provider-model";
import {
  getProviderDefinition,
  type ProviderDefinitionSlug,
} from "@kanvas/contracts/provider-definition";

import {
  ProviderSettingProbeError,
  type ProviderProbeRequester,
} from "./provider-setting-probe.js";

const maximumModels = 2_000;
const maximumPages = 10;
const maximumCanonicalSourceBytes = 4 * 1_024 * 1_024;

export type ProviderModelDiscoveryPreset = ProviderDefinitionSlug;

export interface DiscoverProviderModelCatalogOptions {
  readonly preset: ProviderModelDiscoveryPreset;
  readonly baseUrl: string;
  readonly apiKey: Uint8Array;
  readonly observedAt: Date;
  /**
   * OpenRouter's model-level descriptors are a union across endpoints. The
   * selected models are refined against their definitive per-endpoint records
   * before the catalog is persisted for activation.
   */
  readonly refineModelKeys?: readonly string[];
}

export class ProviderModelDiscoveryError extends Error {
  public constructor(
    public readonly code:
      | "authentication_failed"
      | "access_denied"
      | "rate_limited"
      | "unavailable"
      | "unsafe_endpoint"
      | "invalid_response"
      | "page_limit"
      | "model_limit",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderModelDiscoveryError";
  }
}

interface RawDiscoveryPage {
  readonly body: unknown;
  readonly models: readonly unknown[];
  readonly nextPageToken?: string;
}

interface CatalogEntryDraft {
  readonly providerModelId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly inputModalities: readonly ProviderModelModality[];
  readonly outputModalities: readonly ProviderModelModality[];
  readonly operations: ProviderModelOperations;
  readonly completeness: "identity_only" | "partial";
  readonly evidence: readonly ProviderModelEvidence[];
}

type ParameterDraft = Omit<ProviderModelParameterDefinition, "evidence">;

interface TrustedImageAdapterOperationManifest {
  readonly apiSurfaces: readonly string[];
  readonly parameters: readonly ParameterDraft[];
}

interface TrustedImageAdapterManifest {
  readonly reference: string;
  readonly presets: readonly ProviderModelDiscoveryPreset[];
  readonly matches: (providerModelId: string) => boolean;
  readonly inputModalities: readonly ProviderModelModality[];
  readonly outputModalities: readonly ProviderModelModality[];
  readonly operations: Readonly<
    Partial<
      Record<ProviderModelCapabilityKey, TrustedImageAdapterOperationManifest>
    >
  >;
}

const commonAspectRatios = Object.freeze([
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
]);

const xaiAspectRatios = Object.freeze([
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

const openAiImageParameters = Object.freeze([
  Object.freeze({
    key: "size",
    label: "Size",
    valueType: "enum" as const,
    values: Object.freeze(["auto", "1024x1024", "1536x1024", "1024x1536"]),
    required: false,
  }),
  Object.freeze({
    key: "quality",
    label: "Quality",
    valueType: "enum" as const,
    values: Object.freeze(["auto", "low", "medium", "high"]),
    required: false,
  }),
  Object.freeze({
    key: "outputFormat",
    label: "Output format",
    valueType: "enum" as const,
    values: Object.freeze(["png", "jpeg", "webp"]),
    required: false,
  }),
  Object.freeze({
    key: "background",
    label: "Background",
    valueType: "enum" as const,
    values: Object.freeze(["auto", "opaque", "transparent"]),
    required: false,
  }),
  Object.freeze({
    key: "outputCompression",
    label: "Output compression",
    valueType: "integer" as const,
    minimum: 0,
    maximum: 100,
    required: false,
  }),
]);

const generationTasksParameters = Object.freeze([
  Object.freeze({
    key: "aspectRatio",
    label: "Aspect ratio",
    valueType: "enum" as const,
    values: commonAspectRatios,
    required: false,
  }),
  Object.freeze({
    key: "resolution",
    label: "Resolution",
    valueType: "enum" as const,
    values: Object.freeze(["1k", "2k", "4k"]),
    required: false,
  }),
  Object.freeze({
    key: "quality",
    label: "Quality",
    valueType: "enum" as const,
    values: Object.freeze(["auto", "low", "medium", "high"]),
    required: false,
  }),
  Object.freeze({
    key: "outputFormat",
    label: "Output format",
    valueType: "enum" as const,
    values: Object.freeze(["png", "jpeg", "webp"]),
    required: false,
  }),
]);

const generationTasksEditParameters = Object.freeze(
  generationTasksParameters.filter(({ key }) => key !== "aspectRatio"),
);

const tokenHubGenerationTasksParameters = Object.freeze(
  generationTasksParameters.filter(({ key }) => key !== "resolution"),
);

function isKnownGatewayImageModel(providerModelId: string): boolean {
  const normalized = providerModelId.toLowerCase();
  return (
    /(?:^|\/)(?:gpt-image-|dall-e-)/u.test(normalized) ||
    /(?:^|\/)gemini-[a-z0-9.-]*image(?:-|$)/u.test(normalized) ||
    /(?:^|\/)wan[a-z0-9.-]*(?:t2i|i2i|image)/u.test(normalized) ||
    /(?:^|\/)[a-z0-9.-]*seedream[a-z0-9.-]*/u.test(normalized)
  );
}

const trustedImageAdapterManifests: readonly TrustedImageAdapterManifest[] =
  Object.freeze([
    Object.freeze({
      reference: "kanvas.openai-images.v1",
      presets: Object.freeze(["openai"] as const),
      matches: (modelId: string) =>
        /^(?:gpt-image-|dall-e-)/u.test(modelId.toLowerCase()),
      inputModalities: Object.freeze(["text", "image", "mask"] as const),
      outputModalities: Object.freeze(["image"] as const),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["images.generations.v1"]),
          parameters: openAiImageParameters,
        }),
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["images.edits.v1"]),
          parameters: openAiImageParameters,
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.xai-images.v1",
      presets: Object.freeze(["xai"] as const),
      matches: () => true,
      inputModalities: Object.freeze(["text", "image"] as const),
      outputModalities: Object.freeze(["image"] as const),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["images.generations.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "aspectRatio",
              label: "Aspect ratio",
              valueType: "enum" as const,
              values: xaiAspectRatios,
              required: false,
            }),
            Object.freeze({
              key: "resolution",
              label: "Resolution",
              valueType: "enum" as const,
              values: Object.freeze(["1k", "2k"]),
              required: false,
            }),
          ]),
        }),
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["images.edits.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "aspectRatio",
              label: "Aspect ratio",
              valueType: "enum" as const,
              values: xaiAspectRatios,
              required: false,
            }),
          ]),
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.xai-images-quality-2.v1",
      presets: Object.freeze(["xai"] as const),
      matches: (modelId: string) =>
        modelId.toLowerCase() === "grok-imagine-image-2.0",
      inputModalities: Object.freeze([]),
      outputModalities: Object.freeze([]),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["images.generations.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "quality",
              label: "Quality",
              valueType: "enum" as const,
              values: Object.freeze(["low", "medium"]),
              required: false,
            }),
          ]),
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.gemini-images.v1",
      presets: Object.freeze(["gemini"] as const),
      matches: (modelId: string) =>
        /(?:^|\/)gemini-[a-z0-9.-]*image(?:-|$)/u.test(modelId.toLowerCase()),
      inputModalities: Object.freeze(["text", "image"] as const),
      outputModalities: Object.freeze(["image"] as const),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "aspectRatio",
              label: "Aspect ratio",
              valueType: "enum" as const,
              values: commonAspectRatios,
              required: false,
            }),
            Object.freeze({
              key: "outputFormat",
              label: "Output format",
              valueType: "enum" as const,
              values: Object.freeze(["png", "jpeg"]),
              required: false,
            }),
          ]),
        }),
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "aspectRatio",
              label: "Aspect ratio",
              valueType: "enum" as const,
              values: commonAspectRatios,
              required: false,
            }),
            Object.freeze({
              key: "outputFormat",
              label: "Output format",
              valueType: "enum" as const,
              values: Object.freeze(["png", "jpeg"]),
              required: false,
            }),
          ]),
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.gemini-3-images.v1",
      presets: Object.freeze(["gemini"] as const),
      matches: (modelId: string) => {
        const normalized = modelId.toLowerCase();
        return (
          normalized.includes("gemini-3") &&
          normalized.includes("image") &&
          !normalized.includes("lite") &&
          !normalized.includes("gemini-3.1-flash-image")
        );
      },
      inputModalities: Object.freeze([]),
      outputModalities: Object.freeze([]),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "resolution",
              label: "Resolution",
              valueType: "enum" as const,
              values: Object.freeze(["1k", "2k", "4k"]),
              required: false,
            }),
          ]),
        }),
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "resolution",
              label: "Resolution",
              valueType: "enum" as const,
              values: Object.freeze(["1k", "2k", "4k"]),
              required: false,
            }),
          ]),
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.gemini-3.1-flash-images.v1",
      presets: Object.freeze(["gemini"] as const),
      matches: (modelId: string) => {
        const normalized = modelId.toLowerCase();
        return (
          normalized.includes("gemini-3.1-flash-image") &&
          !normalized.includes("lite")
        );
      },
      inputModalities: Object.freeze([]),
      outputModalities: Object.freeze([]),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "resolution",
              label: "Resolution",
              valueType: "enum" as const,
              values: Object.freeze(["512", "1k", "2k", "4k"]),
              required: false,
            }),
          ]),
        }),
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "resolution",
              label: "Resolution",
              valueType: "enum" as const,
              values: Object.freeze(["512", "1k", "2k", "4k"]),
              required: false,
            }),
          ]),
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.gemini-3.1-flash-lite-images.v1",
      presets: Object.freeze(["gemini"] as const),
      matches: (modelId: string) =>
        modelId.toLowerCase().includes("gemini-3.1-flash-lite-image"),
      inputModalities: Object.freeze([]),
      outputModalities: Object.freeze([]),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "resolution",
              label: "Resolution",
              valueType: "enum" as const,
              values: Object.freeze(["1k"]),
              required: false,
            }),
          ]),
        }),
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["generate-content.image.v1"]),
          parameters: Object.freeze([
            Object.freeze({
              key: "resolution",
              label: "Resolution",
              valueType: "enum" as const,
              values: Object.freeze(["1k"]),
              required: false,
            }),
          ]),
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.generation-tasks-images.v1",
      presets: Object.freeze(["newapi"] as const),
      matches: isKnownGatewayImageModel,
      inputModalities: Object.freeze(["text", "image", "mask"] as const),
      outputModalities: Object.freeze(["image"] as const),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["generation.tasks.v1"]),
          parameters: generationTasksParameters,
        }),
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["generation.tasks.v1"]),
          parameters: generationTasksEditParameters,
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.tokenhub-gpt-image-2-generate.v1",
      presets: Object.freeze(["tokenhub"] as const),
      matches: (model: string) =>
        ["gpt-image-2", "tokenhub/gpt-image-2"].includes(model),
      inputModalities: Object.freeze(["text"] as const),
      outputModalities: Object.freeze(["image"] as const),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["generation.tasks.v1"]),
          parameters: tokenHubGenerationTasksParameters,
        }),
      }),
    }),
    Object.freeze({
      reference: "kanvas.tokenhub-gpt-image-2-edit.v1",
      presets: Object.freeze(["tokenhub"] as const),
      matches: (model: string) =>
        ["gpt-image-2-edit", "tokenhub/gpt-image-2-edit"].includes(model),
      inputModalities: Object.freeze(["text", "image"] as const),
      outputModalities: Object.freeze(["image"] as const),
      operations: Object.freeze({
        "image.edit": Object.freeze({
          apiSurfaces: Object.freeze(["generation.tasks.v1"]),
          parameters: tokenHubGenerationTasksParameters,
        }),
      }),
    }),
  ]);

function fail(
  code: ProviderModelDiscoveryError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new ProviderModelDiscoveryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function plainRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail("invalid_response", `${label} must be a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function canonicalJson(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
  depth = 0,
): string {
  if (depth > 32) {
    return fail(
      "invalid_response",
      "Provider model discovery response is too deeply nested.",
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (!value || typeof value !== "object") {
    return fail(
      "invalid_response",
      "Provider model discovery response is not canonical JSON.",
    );
  }
  if (ancestors.has(value)) {
    return fail(
      "invalid_response",
      "Provider model discovery response contains a cycle.",
    );
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => canonicalJson(item, nextAncestors, depth + 1))
      .join(",")}]`;
  }
  const record = plainRecord(value, "Provider model discovery response");
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          record[key],
          nextAncestors,
          depth + 1,
        )}`,
    )
    .join(",")}}`;
}

function digestSource(value: unknown): string {
  const canonical = canonicalJson(value);
  if (Buffer.byteLength(canonical, "utf8") > maximumCanonicalSourceBytes) {
    return fail(
      "invalid_response",
      "Provider model discovery response exceeds the canonical source limit.",
    );
  }
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function assertSuccessfulStatus(statusCode: number): void {
  if (statusCode >= 200 && statusCode < 300) {
    return;
  }
  if (statusCode === 401) {
    return fail(
      "authentication_failed",
      "Provider model discovery credential is invalid.",
    );
  }
  if (statusCode === 403) {
    return fail(
      "access_denied",
      "Provider model discovery credential lacks access.",
    );
  }
  if (statusCode === 429) {
    return fail("rate_limited", "Provider model discovery was rate limited.");
  }
  return fail("unavailable", "Provider model discovery is unavailable.");
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function requiredModelId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value !== value.trim() ||
    containsControlCharacter(value)
  ) {
    return fail("invalid_response", `${label} has an invalid model ID.`);
  }
  return value.replace(/^models\//u, "");
}

function normalizedText(
  value: unknown,
  fallback: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = Array.from(value)
    .map((character) => (containsControlCharacter(character) ? " " : character))
    .join("")
    .trim();
  return normalized ? normalized.slice(0, maximumLength).trim() : fallback;
}

function optionalDescription(value: unknown): {
  readonly description?: string;
} {
  if (typeof value !== "string") {
    return {};
  }
  const description = normalizedText(value, "", 1_000);
  return description ? { description } : {};
}

function unique<const TValue extends string>(
  values: readonly TValue[],
): readonly TValue[] {
  return Object.freeze([...new Set(values)]);
}

function normalizedModalities(
  value: unknown,
): readonly ProviderModelModality[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    return fail(
      "invalid_response",
      "Provider model modalities must be an array.",
    );
  }
  const modalities: ProviderModelModality[] = [];
  for (const candidate of value as unknown[]) {
    if (candidate === "text" || candidate === "image" || candidate === "mask") {
      modalities.push(candidate);
    } else if (typeof candidate !== "string") {
      return fail(
        "invalid_response",
        "Provider model modality must be a string.",
      );
    }
  }
  return unique(modalities);
}

function evidence(
  input: Omit<ProviderModelEvidence, "observedAt" | "sourceDigest">,
  observedAt: string,
  sourceDigest: string,
): ProviderModelEvidence {
  return Object.freeze({
    ...input,
    observedAt,
    sourceDigest,
  });
}

function openRouterParameterKey(value: string): string | undefined {
  return {
    resolution: "resolution",
    aspect_ratio: "aspectRatio",
    size: "size",
    quality: "quality",
    output_format: "outputFormat",
    background: "background",
    output_compression: "outputCompression",
    n: "numberOfImages",
    seed: "seed",
  }[value];
}

function parameterLabel(key: string): string {
  const label = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/^./u, (character) => character.toUpperCase());
  return label.slice(0, 120);
}

function scalarValues(
  value: unknown,
  label: string,
): readonly ProviderModelParameterValue[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    return fail(
      "invalid_response",
      `${label} must contain between 1 and 128 values.`,
    );
  }
  return Object.freeze(
    value.map((candidate) => {
      if (
        typeof candidate !== "string" &&
        typeof candidate !== "boolean" &&
        !(typeof candidate === "number" && Number.isSafeInteger(candidate))
      ) {
        return fail(
          "invalid_response",
          `${label} contains a non-scalar value.`,
        );
      }
      return candidate;
    }),
  );
}

function validExecutableImageSize(value: string): boolean {
  if (/^(?:auto|512|[1-4][kK])$/u.test(value)) {
    return true;
  }
  const match = /^([1-9][0-9]{1,4})x([1-9][0-9]{1,4})$/u.exec(value);
  return (
    match !== null && Number(match[1]) <= 16_384 && Number(match[2]) <= 16_384
  );
}

function validExecutableAspectRatio(value: string): boolean {
  if (value === "auto") {
    return true;
  }
  const match =
    /^([1-9][0-9]{0,2}(?:\.[0-9]{1,2})?):([1-9][0-9]{0,2}(?:\.[0-9]{1,2})?)$/u.exec(
      value,
    );
  return match !== null && Number(match[1]) <= 100 && Number(match[2]) <= 100;
}

function executableOpenRouterEnumValues(
  key: string,
  values: readonly ProviderModelParameterValue[],
): readonly ProviderModelParameterValue[] {
  const executable = values.filter((value) => {
    if (typeof value !== "string") {
      return false;
    }
    if (key === "resolution") {
      return /^(?:auto|512|1[kK]|2[kK]|4[kK])$/u.test(value);
    }
    if (key === "aspectRatio") {
      return validExecutableAspectRatio(value);
    }
    if (key === "size") {
      return validExecutableImageSize(value);
    }
    if (key === "quality") {
      return ["auto", "low", "medium", "high"].includes(value);
    }
    if (key === "outputFormat") {
      return ["png", "jpeg", "webp"].includes(value);
    }
    if (key === "background") {
      return ["auto", "opaque", "transparent"].includes(value);
    }
    return false;
  });
  return Object.freeze([...new Set(executable)]);
}

function openRouterAdapterIntegerRange(
  key: string,
): readonly [number, number] | undefined {
  if (key === "outputCompression") {
    return [0, 100];
  }
  if (key === "numberOfImages") {
    return [1, 10];
  }
  return key === "seed" ? [0, 4_294_967_295] : undefined;
}

function executableOpenRouterIntegerRange(
  key: string,
  minimum: number,
  maximum: number,
): readonly [number, number] | undefined {
  const adapterRange = openRouterAdapterIntegerRange(key);
  if (!adapterRange) {
    return undefined;
  }
  const safeMinimum = Math.max(minimum, adapterRange[0]);
  const safeMaximum = Math.min(maximum, adapterRange[1]);
  return safeMinimum <= safeMaximum
    ? Object.freeze([safeMinimum, safeMaximum])
    : undefined;
}

function openRouterParameters(
  value: unknown,
  observedAt: string,
  sourceDigest: string,
  reference = "openrouter.images.models",
): readonly ProviderModelParameterDefinition[] {
  const descriptors = plainRecord(value, "OpenRouter supported_parameters");
  const entries = Object.entries(descriptors);
  if (entries.length > 64) {
    return fail(
      "invalid_response",
      "OpenRouter returned too many parameter descriptors.",
    );
  }
  const providerEvidence = Object.freeze([
    evidence(
      {
        kind: "provider_api",
        reference,
        confidence: "high",
        claim: "supported",
      },
      observedAt,
      sourceDigest,
    ),
  ]);
  const parameters: ProviderModelParameterDefinition[] = [];
  for (const [remoteKey, candidate] of entries) {
    const key = openRouterParameterKey(remoteKey);
    if (!key) {
      continue;
    }
    const descriptor = plainRecord(
      candidate,
      `OpenRouter parameter ${remoteKey}`,
    );
    const common = {
      key,
      label: parameterLabel(key),
      required: false,
      evidence: providerEvidence,
    };
    if (descriptor.type === "enum") {
      const values = executableOpenRouterEnumValues(
        key,
        scalarValues(
          descriptor.values,
          `OpenRouter parameter ${remoteKey} values`,
        ),
      );
      if (
        key === "outputCompression" ||
        key === "numberOfImages" ||
        key === "seed"
      ) {
        return fail(
          "invalid_response",
          `OpenRouter parameter ${remoteKey} has an incompatible enum descriptor.`,
        );
      }
      if (values.length > 0) {
        parameters.push(
          Object.freeze({
            ...common,
            valueType: "enum" as const,
            values,
          }),
        );
      }
      continue;
    }
    if (
      descriptor.type === "range" &&
      Number.isSafeInteger(descriptor.min) &&
      Number.isSafeInteger(descriptor.max) &&
      (descriptor.min as number) <= (descriptor.max as number)
    ) {
      if (
        key !== "outputCompression" &&
        key !== "numberOfImages" &&
        key !== "seed"
      ) {
        return fail(
          "invalid_response",
          `OpenRouter parameter ${remoteKey} has an incompatible range descriptor.`,
        );
      }
      const range = executableOpenRouterIntegerRange(
        key,
        descriptor.min as number,
        descriptor.max as number,
      );
      if (range) {
        parameters.push(
          Object.freeze({
            ...common,
            valueType: "integer" as const,
            minimum: range[0],
            maximum: range[1],
          }),
        );
      }
      continue;
    }
    if (descriptor.type === "boolean") {
      if (
        key === "outputCompression" ||
        key === "numberOfImages" ||
        key === "seed"
      ) {
        const [minimum, maximum] = openRouterAdapterIntegerRange(key)!;
        parameters.push(
          Object.freeze({
            ...common,
            valueType: "integer" as const,
            minimum,
            maximum,
          }),
        );
        continue;
      }
      // OpenRouter uses a boolean descriptor as a presence flag. It does
      // not prove an enum domain for a string-valued canonical parameter.
      continue;
    }
    return fail(
      "invalid_response",
      `OpenRouter parameter ${remoteKey} has an unsupported descriptor.`,
    );
  }
  return Object.freeze(parameters);
}

function catalogMethod(preset: ProviderModelDiscoveryPreset): string {
  return getProviderDefinition(preset).catalogDiscoveryMethod;
}

function parsePage(
  preset: ProviderModelDiscoveryPreset,
  body: unknown,
): RawDiscoveryPage {
  const root = plainRecord(body, `${preset} model discovery response`);
  let candidate = root.data;
  if (preset === "xai" || preset === "gemini") {
    candidate = root.models;
  } else if (preset === "newapi" || preset === "tokenhub") {
    candidate = root.data ?? root.models;
  }
  if (!Array.isArray(candidate)) {
    return fail(
      "invalid_response",
      `${preset} model discovery response has no model array.`,
    );
  }
  const token = root.nextPageToken;
  if (
    preset === "anthropic" &&
    root.has_more !== undefined &&
    typeof root.has_more !== "boolean"
  ) {
    return fail(
      "invalid_response",
      "anthropic model discovery returned an invalid pagination flag.",
    );
  }
  if (
    preset === "anthropic" &&
    root.has_more === true &&
    typeof root.last_id !== "string"
  ) {
    return fail(
      "invalid_response",
      "anthropic model discovery returned an invalid continuation token.",
    );
  }
  const anthropicToken =
    preset === "anthropic" && root.has_more === true ? root.last_id : undefined;
  const continuationToken = token ?? anthropicToken;
  if (
    continuationToken !== undefined &&
    ((preset !== "gemini" && preset !== "anthropic") ||
      typeof continuationToken !== "string" ||
      continuationToken.length < 1 ||
      continuationToken.length > 2_048 ||
      containsControlCharacter(continuationToken))
  ) {
    return fail(
      "invalid_response",
      `${preset} model discovery returned an invalid continuation token.`,
    );
  }
  return Object.freeze({
    body,
    models: candidate,
    ...(typeof continuationToken === "string"
      ? { nextPageToken: continuationToken }
      : {}),
  });
}

function initialPath(preset: ProviderModelDiscoveryPreset): string {
  return getProviderDefinition(preset).catalogPath;
}

function nextPath(
  preset: ProviderModelDiscoveryPreset,
  pageToken: string,
): string {
  if (preset === "anthropic") {
    return `/models?limit=1000&after_id=${encodeURIComponent(pageToken)}`;
  }
  if (preset !== "gemini") {
    return fail(
      "invalid_response",
      `${preset} returned an unsupported continuation token.`,
    );
  }
  return `/models?pageSize=1000&pageToken=${encodeURIComponent(pageToken)}`;
}

function normalizeProviderEntry(
  preset: ProviderModelDiscoveryPreset,
  value: unknown,
  observedAt: string,
  sourceDigest: string,
): CatalogEntryDraft {
  const model = plainRecord(value, `${preset} model entry`);
  const providerModelId = requiredModelId(
    model.id ?? model.name,
    `${preset} model entry`,
  );
  const providerIdentityEvidence = evidence(
    {
      kind: "provider_api",
      reference: catalogMethod(preset),
      confidence: "high",
      claim: "identity",
    },
    observedAt,
    sourceDigest,
  );
  const base = {
    providerModelId,
    displayName: normalizedText(
      model.displayName ?? model.display_name ?? model.name,
      providerModelId,
      160,
    ),
    ...optionalDescription(model.description),
    evidence: Object.freeze([providerIdentityEvidence]),
  };
  if (preset === "openrouter") {
    const architecture = plainRecord(
      model.architecture,
      "OpenRouter model architecture",
    );
    const inputModalities = normalizedModalities(architecture.input_modalities);
    const outputModalities = normalizedModalities(
      architecture.output_modalities,
    );
    if (!outputModalities.includes("image")) {
      return fail(
        "invalid_response",
        "OpenRouter image catalog returned a model without image output.",
      );
    }
    const supportedEvidence = evidence(
      {
        kind: "provider_api",
        reference: catalogMethod(preset),
        confidence: "high",
        claim: "supported",
      },
      observedAt,
      sourceDigest,
    );
    const parameters = openRouterParameters(
      model.supported_parameters,
      observedAt,
      sourceDigest,
    );
    const operations = {
      "image.generate": Object.freeze({
        apiSurfaces: Object.freeze(["images.generations.v1"]),
        parameters,
        evidence: Object.freeze([supportedEvidence]),
      }),
    };
    return Object.freeze({
      ...base,
      inputModalities,
      outputModalities,
      operations: Object.freeze(operations),
      completeness: "partial",
      evidence: Object.freeze([providerIdentityEvidence]),
    });
  }
  if (preset === "xai") {
    const supportedEvidence = evidence(
      {
        kind: "provider_api",
        reference: catalogMethod(preset),
        confidence: "high",
        claim: "supported",
      },
      observedAt,
      sourceDigest,
    );
    return Object.freeze({
      ...base,
      inputModalities:
        model.input_modalities === undefined
          ? Object.freeze(["text"] as const)
          : normalizedModalities(model.input_modalities),
      outputModalities:
        model.output_modalities === undefined
          ? Object.freeze(["image"] as const)
          : normalizedModalities(model.output_modalities),
      operations: Object.freeze({
        "image.generate": Object.freeze({
          apiSurfaces: Object.freeze(["images.generations.v1"]),
          parameters: Object.freeze([]),
          evidence: Object.freeze([supportedEvidence]),
        }),
      }),
      completeness: "partial",
      evidence: Object.freeze([providerIdentityEvidence]),
    });
  }
  return Object.freeze({
    ...base,
    inputModalities: Object.freeze([]),
    outputModalities: Object.freeze([]),
    operations: Object.freeze({}),
    completeness: "identity_only",
  });
}

function manifestDigest(manifest: TrustedImageAdapterManifest): string {
  return digestSource({
    reference: manifest.reference,
    presets: manifest.presets,
    inputModalities: manifest.inputModalities,
    outputModalities: manifest.outputModalities,
    operations: manifest.operations,
  });
}

function withEvidence(
  definition: ParameterDraft,
  manifestEvidence: readonly ProviderModelEvidence[],
): ProviderModelParameterDefinition {
  return Object.freeze({
    ...definition,
    evidence: manifestEvidence,
  }) as ProviderModelParameterDefinition;
}

function mergeParameter(
  current: ProviderModelParameterDefinition | undefined,
  incoming: ProviderModelParameterDefinition,
): ProviderModelParameterDefinition {
  if (!current) {
    return incoming;
  }
  if (current.valueType !== incoming.valueType) {
    return fail(
      "invalid_response",
      `Parameter ${incoming.key} has conflicting evidence types.`,
    );
  }
  const mergedEvidence = uniqueEvidence([
    ...current.evidence,
    ...incoming.evidence,
  ]);
  if (current.valueType === "enum" && incoming.valueType === "enum") {
    const incomingValues = new Set(
      incoming.values.map((value) => `${typeof value}:${String(value)}`),
    );
    const values = current.values.filter((value) =>
      incomingValues.has(`${typeof value}:${String(value)}`),
    );
    if (values.length < 1) {
      return fail(
        "invalid_response",
        `Parameter ${incoming.key} has disjoint evidence values.`,
      );
    }
    return Object.freeze({
      ...current,
      values: Object.freeze(values),
      evidence: mergedEvidence,
    });
  }
  if (current.valueType === "integer" && incoming.valueType === "integer") {
    const minimum = Math.max(current.minimum, incoming.minimum);
    const maximum = Math.min(current.maximum, incoming.maximum);
    if (minimum > maximum) {
      return fail(
        "invalid_response",
        `Parameter ${incoming.key} has disjoint evidence ranges.`,
      );
    }
    return Object.freeze({
      ...current,
      minimum,
      maximum,
      evidence: mergedEvidence,
    });
  }
  return Object.freeze({
    ...current,
    evidence: mergedEvidence,
  });
}

function uniqueEvidence(
  values: readonly ProviderModelEvidence[],
): readonly ProviderModelEvidence[] {
  const seen = new Set<string>();
  return Object.freeze(
    values.filter((item) => {
      const key = [
        item.kind,
        item.reference,
        item.sourceDigest,
        item.claim,
      ].join("\0");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  );
}

function mergeOperation(
  operationKey: ProviderModelCapabilityKey,
  current: ProviderModelOperationDefinition | undefined,
  incoming: ProviderModelOperationDefinition,
): ProviderModelOperationDefinition {
  if (!current) {
    return incoming;
  }
  const incomingSurfaces = new Set(incoming.apiSurfaces);
  const apiSurfaces = current.apiSurfaces.filter((surface) =>
    incomingSurfaces.has(surface),
  );
  if (apiSurfaces.length < 1) {
    return fail(
      "invalid_response",
      `Operation ${operationKey} has disjoint API surface evidence.`,
    );
  }
  const parameters = new Map(
    current.parameters.map((parameter) => [parameter.key, parameter]),
  );
  for (const parameter of incoming.parameters) {
    parameters.set(
      parameter.key,
      mergeParameter(parameters.get(parameter.key), parameter),
    );
  }
  return Object.freeze({
    apiSurfaces: Object.freeze(apiSurfaces),
    parameters: Object.freeze([...parameters.values()]),
    evidence: uniqueEvidence([...current.evidence, ...incoming.evidence]),
  });
}

function applyTrustedManifests(
  preset: ProviderModelDiscoveryPreset,
  draft: CatalogEntryDraft,
  observedAt: string,
): ProviderModelCatalogEntry {
  const manifests = trustedImageAdapterManifests.filter(
    (manifest) =>
      manifest.presets.includes(preset) &&
      manifest.matches(draft.providerModelId),
  );
  if (manifests.length < 1) {
    return draft;
  }
  const inputModalities = [...draft.inputModalities];
  const outputModalities = [...draft.outputModalities];
  const operations: Partial<
    Record<ProviderModelCapabilityKey, ProviderModelOperationDefinition>
  > = {
    ...draft.operations,
  };
  for (const manifest of manifests) {
    const itemEvidence = evidence(
      {
        kind: "adapter_manifest",
        reference: manifest.reference,
        confidence: "high",
        claim: "supported",
      },
      observedAt,
      manifestDigest(manifest),
    );
    inputModalities.push(...manifest.inputModalities);
    outputModalities.push(...manifest.outputModalities);
    for (const operationKey of ["image.generate", "image.edit"] as const) {
      if (operationKey === "image.edit" && preset === "openrouter") {
        continue;
      }
      const manifestOperation = manifest.operations[operationKey];
      if (!manifestOperation) {
        continue;
      }
      const incoming = Object.freeze({
        apiSurfaces: manifestOperation.apiSurfaces,
        parameters: Object.freeze(
          manifestOperation.parameters.map((definition) =>
            withEvidence(definition, Object.freeze([itemEvidence])),
          ),
        ),
        evidence: Object.freeze([itemEvidence]),
      });
      operations[operationKey] = mergeOperation(
        operationKey,
        operations[operationKey],
        incoming,
      );
    }
  }
  return Object.freeze({
    ...draft,
    inputModalities: unique(inputModalities),
    outputModalities: unique(outputModalities),
    operations: Object.freeze(operations),
    completeness: "partial",
    evidence: draft.evidence,
  });
}

function encodedModelPath(model: string): string {
  return model
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function refineOpenRouterEntry(
  entry: ProviderModelCatalogEntry,
  body: unknown,
  observedAt: string,
): ProviderModelCatalogEntry {
  const root = plainRecord(body, "OpenRouter image model endpoints response");
  const responseModelId = requiredModelId(
    root.id,
    "OpenRouter image model endpoints response",
  );
  if (responseModelId !== entry.providerModelId) {
    return fail(
      "invalid_response",
      "OpenRouter endpoint records do not match the selected model.",
    );
  }
  if (
    !Array.isArray(root.endpoints) ||
    root.endpoints.length < 1 ||
    root.endpoints.length > 128
  ) {
    return fail(
      "invalid_response",
      "OpenRouter endpoint records must contain between 1 and 128 endpoints.",
    );
  }
  const sourceDigest = digestSource(body);
  const endpointParameters = root.endpoints.map((candidate, index) => {
    const endpoint = plainRecord(
      candidate,
      `OpenRouter endpoint records[${String(index)}]`,
    );
    return openRouterParameters(
      endpoint.supported_parameters,
      observedAt,
      sourceDigest,
      "openrouter.images.model-endpoints",
    );
  });
  let safeParameters = new Map(
    endpointParameters[0]!.map((parameter) => [parameter.key, parameter]),
  );
  for (const parameters of endpointParameters.slice(1)) {
    const incoming = new Map(
      parameters.map((parameter) => [parameter.key, parameter]),
    );
    safeParameters = new Map(
      [...safeParameters.entries()].flatMap(([key, parameter]) => {
        const next = incoming.get(key);
        return next ? [[key, mergeParameter(parameter, next)] as const] : [];
      }),
    );
  }
  const endpointEvidence = evidence(
    {
      kind: "provider_api",
      reference: "openrouter.images.model-endpoints",
      confidence: "high",
      claim: "supported",
    },
    observedAt,
    sourceDigest,
  );
  const operations: Partial<
    Record<ProviderModelCapabilityKey, ProviderModelOperationDefinition>
  > = {};
  for (const operationKey of ["image.generate"] as const) {
    const operation = entry.operations[operationKey];
    if (!operation) {
      continue;
    }
    operations[operationKey] = Object.freeze({
      ...operation,
      parameters: Object.freeze([...safeParameters.values()]),
      evidence: uniqueEvidence([...operation.evidence, endpointEvidence]),
    });
  }
  return Object.freeze({
    ...entry,
    operations: Object.freeze(operations),
  });
}

export async function discoverProviderModelCatalog(
  options: DiscoverProviderModelCatalogOptions,
  requester: ProviderProbeRequester,
): Promise<ProviderModelCatalogDocument> {
  if (Number.isNaN(options.observedAt.getTime())) {
    return fail(
      "invalid_response",
      "Provider model discovery observation time is invalid.",
    );
  }
  const observedAt = options.observedAt.toISOString();
  const material = Buffer.from(options.apiKey);
  const apiKey = material.toString("utf8");
  let headers: Readonly<Record<string, string>> = {
    authorization: `Bearer ${apiKey}`,
  };
  if (options.preset === "gemini") {
    headers = { "x-goog-api-key": apiKey };
  } else if (options.preset === "anthropic") {
    headers = {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    };
  }
  const pages: RawDiscoveryPage[] = [];
  const rawModels: unknown[] = [];
  let path = initialPath(options.preset);
  try {
    const requestJson = async (requestPath: string) => {
      const response = await requester({
        baseUrl: options.baseUrl,
        path: requestPath,
        headers,
      }).catch((error: unknown) => {
        if (error instanceof ProviderModelDiscoveryError) {
          throw error;
        }
        if (error instanceof ProviderSettingProbeError) {
          const code =
            error.code === "model_not_found" ? "invalid_response" : error.code;
          return fail(code, error.message, error);
        }
        return fail(
          "unavailable",
          "Provider model discovery request failed.",
          error,
        );
      });
      assertSuccessfulStatus(response.statusCode);
      return response;
    };
    for (let pageNumber = 1; ; pageNumber += 1) {
      const response = await requestJson(path);
      const page = parsePage(options.preset, response.body);
      pages.push(page);
      rawModels.push(...page.models);
      if (rawModels.length > maximumModels) {
        return fail(
          "model_limit",
          `Provider model discovery exceeds ${String(maximumModels)} models.`,
        );
      }
      if (!page.nextPageToken) {
        break;
      }
      if (pageNumber >= maximumPages) {
        return fail(
          "page_limit",
          `Provider model discovery exceeds ${String(maximumPages)} pages.`,
        );
      }
      path = nextPath(options.preset, page.nextPageToken);
    }
    const sourceDigest = digestSource(pages.map((page) => page.body));
    const modelIds = new Set<string>();
    let models = rawModels.map((candidate) => {
      const draft = normalizeProviderEntry(
        options.preset,
        candidate,
        observedAt,
        sourceDigest,
      );
      if (modelIds.has(draft.providerModelId)) {
        return fail(
          "invalid_response",
          `Provider model discovery returned duplicate model ${draft.providerModelId}.`,
        );
      }
      modelIds.add(draft.providerModelId);
      return applyTrustedManifests(options.preset, draft, observedAt);
    });
    if (options.preset === "openrouter" && options.refineModelKeys) {
      const selected = new Set(options.refineModelKeys);
      if (
        selected.size !== options.refineModelKeys.length ||
        selected.size > 32 ||
        [...selected].some(
          (modelKey) =>
            typeof modelKey !== "string" ||
            modelKey.length < 1 ||
            modelKey.length > 255 ||
            !modelIds.has(modelKey),
        )
      ) {
        return fail(
          "invalid_response",
          "OpenRouter refinement model keys are invalid.",
        );
      }
      const refined = new Map<string, ProviderModelCatalogEntry>();
      for (const modelKey of selected) {
        const response = await requestJson(
          `/images/models/${encodedModelPath(modelKey)}/endpoints`,
        );
        refined.set(
          modelKey,
          refineOpenRouterEntry(
            models.find((model) => model.providerModelId === modelKey)!,
            response.body,
            observedAt,
          ),
        );
      }
      models = models.map(
        (model) => refined.get(model.providerModelId) ?? model,
      );
    }
    return parseProviderModelCatalogDocument({
      schemaVersion: 1,
      providerPreset: options.preset,
      discoveryMethod: catalogMethod(options.preset),
      sourceDigest,
      models,
    });
  } finally {
    material.fill(0);
  }
}
