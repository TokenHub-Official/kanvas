export interface ModelReferenceCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly reasoning?: number;
  readonly inputAudio?: number;
  readonly outputAudio?: number;
}

export interface ModelReferenceLimit {
  readonly context: number;
  readonly input?: number;
  readonly output?: number;
}

export interface ModelReferenceModalities {
  readonly input: readonly ModelReferenceModality[];
  readonly output: readonly ModelReferenceModality[];
}

export type ModelReferenceModality =
  "text" | "image" | "audio" | "video" | "pdf";

export interface CanonicalModelReference {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly family?: string;
  readonly attachment?: boolean;
  readonly reasoning?: boolean;
  readonly toolCall?: boolean;
  readonly structuredOutput?: boolean;
  readonly temperature?: boolean;
  readonly releaseDate?: string;
  readonly lastUpdated?: string;
  readonly modalities?: ModelReferenceModalities;
  readonly limit?: ModelReferenceLimit;
}

export interface ProviderModelReference extends Omit<
  CanonicalModelReference,
  "key"
> {
  readonly upstreamModelId: string;
  readonly canonicalModelKey?: string;
  readonly cost?: ModelReferenceCost;
  readonly status?: "alpha" | "beta" | "deprecated";
}

export interface ProviderReference {
  readonly slug: string;
  readonly displayName: string;
  readonly apiUrl?: string;
  readonly documentationUrl: string;
  readonly models: readonly ProviderModelReference[];
}

export interface ModelReferenceDocumentV1 {
  readonly schemaVersion: 1;
  readonly source: "models.dev";
  readonly sourceRevision: string;
  readonly observedAt: string;
  readonly canonicalModels: readonly CanonicalModelReference[];
  readonly providers: readonly ProviderReference[];
}

const maximumProviders = 1_000;
const maximumCanonicalModels = 5_000;
const maximumProviderModels = 20_000;
const modalitySet = new Set<ModelReferenceModality>([
  "text",
  "image",
  "audio",
  "video",
  "pdf",
]);

function invalid(message: string): never {
  throw new TypeError(message);
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function text(value: unknown, label: string, maximumLength: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    typeof value !== "string" ||
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    hasControlCharacter(normalized)
  ) {
    return invalid(`${label} must be bounded printable text.`);
  }
  return normalized;
}

function identifier(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  const normalized = text(value, label, maximumLength);
  if (value !== normalized) {
    return invalid(`${label} must not contain surrounding whitespace.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximumLength: number,
): string | undefined {
  return value === undefined ? undefined : text(value, label, maximumLength);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return invalid(`${label} must be boolean.`);
  return value;
}

function positiveNumber(
  value: unknown,
  label: string,
  optional = false,
): number | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return invalid(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function modalities(
  value: unknown,
  label: string,
): ModelReferenceModalities | undefined {
  if (value === undefined) return undefined;
  const input = record(value, label);
  const parse = (candidate: unknown, itemLabel: string) => {
    if (!Array.isArray(candidate) || candidate.length > modalitySet.size) {
      return invalid(`${itemLabel} must be a bounded modality array.`);
    }
    const values = candidate.map((item) => {
      if (
        typeof item !== "string" ||
        !modalitySet.has(item as ModelReferenceModality)
      ) {
        return invalid(`${itemLabel} contains an unsupported modality.`);
      }
      return item as ModelReferenceModality;
    });
    return Object.freeze([...new Set(values)]);
  };
  return Object.freeze({
    input: parse(input.input, `${label}.input`),
    output: parse(input.output, `${label}.output`),
  });
}

function limit(value: unknown, label: string): ModelReferenceLimit | undefined {
  if (value === undefined) return undefined;
  const input = record(value, label);
  return Object.freeze({
    context: positiveNumber(input.context, `${label}.context`)!,
    ...(input.input === undefined
      ? {}
      : { input: positiveNumber(input.input, `${label}.input`)! }),
    ...(input.output === undefined
      ? {}
      : { output: positiveNumber(input.output, `${label}.output`)! }),
  });
}

function cost(value: unknown, label: string): ModelReferenceCost | undefined {
  if (value === undefined) return undefined;
  const input = record(value, label);
  return Object.freeze({
    input: positiveNumber(input.input, `${label}.input`)!,
    output: positiveNumber(input.output, `${label}.output`)!,
    ...(input.cache_read === undefined
      ? {}
      : {
          cacheRead: positiveNumber(input.cache_read, `${label}.cache_read`)!,
        }),
    ...(input.cache_write === undefined
      ? {}
      : {
          cacheWrite: positiveNumber(
            input.cache_write,
            `${label}.cache_write`,
          )!,
        }),
    ...(input.reasoning === undefined
      ? {}
      : {
          reasoning: positiveNumber(input.reasoning, `${label}.reasoning`)!,
        }),
    ...(input.input_audio === undefined
      ? {}
      : {
          inputAudio: positiveNumber(
            input.input_audio,
            `${label}.input_audio`,
          )!,
        }),
    ...(input.output_audio === undefined
      ? {}
      : {
          outputAudio: positiveNumber(
            input.output_audio,
            `${label}.output_audio`,
          )!,
        }),
  });
}

function commonModel(
  value: unknown,
  label: string,
): Omit<CanonicalModelReference, "key"> {
  const input = record(value, label);
  const optional = <T>(key: string, parsed: T | undefined) =>
    parsed === undefined ? {} : { [key]: parsed };
  return Object.freeze({
    displayName: text(input.name, `${label}.name`, 160),
    description: text(input.description, `${label}.description`, 10_000),
    ...optional("family", optionalText(input.family, `${label}.family`, 120)),
    ...optional(
      "attachment",
      optionalBoolean(input.attachment, `${label}.attachment`),
    ),
    ...optional(
      "reasoning",
      optionalBoolean(input.reasoning, `${label}.reasoning`),
    ),
    ...optional(
      "toolCall",
      optionalBoolean(input.tool_call, `${label}.tool_call`),
    ),
    ...optional(
      "structuredOutput",
      optionalBoolean(input.structured_output, `${label}.structured_output`),
    ),
    ...optional(
      "temperature",
      optionalBoolean(input.temperature, `${label}.temperature`),
    ),
    ...optional(
      "releaseDate",
      optionalText(input.release_date, `${label}.release_date`, 10),
    ),
    ...optional(
      "lastUpdated",
      optionalText(input.last_updated, `${label}.last_updated`, 10),
    ),
    ...optional(
      "modalities",
      modalities(input.modalities, `${label}.modalities`),
    ),
    ...optional("limit", limit(input.limit, `${label}.limit`)),
  });
}

function canonicalModelKey(
  canonicalKeys: ReadonlySet<string>,
  providerSlug: string,
  upstreamModelId: string,
): string | undefined {
  if (canonicalKeys.has(upstreamModelId)) return upstreamModelId;
  const firstPartyKey = `${providerSlug}/${upstreamModelId}`;
  return canonicalKeys.has(firstPartyKey) ? firstPartyKey : undefined;
}

export function buildModelsDevReferenceDocument(input: {
  readonly modelCatalog: unknown;
  readonly providerCatalog: unknown;
  readonly sourceRevision: string;
  readonly observedAt: string;
}): ModelReferenceDocumentV1 {
  const modelCatalog = record(input.modelCatalog, "models.dev models.json");
  const providerCatalog = record(input.providerCatalog, "models.dev api.json");
  const modelEntries = Object.entries(modelCatalog);
  const providerEntries = Object.entries(providerCatalog);
  if (modelEntries.length > maximumCanonicalModels) {
    return invalid("models.dev contains too many canonical Models.");
  }
  if (providerEntries.length > maximumProviders) {
    return invalid("models.dev contains too many Providers.");
  }
  const canonicalKeys = new Set(modelEntries.map(([key]) => key));
  const canonicalModels = modelEntries.map(([key, value], index) =>
    Object.freeze({
      key: identifier(key, `models.dev model key ${String(index)}`, 512),
      ...commonModel(value, `models.dev model ${key}`),
    }),
  );
  let providerModelCount = 0;
  const providers = providerEntries.map(([slug, value], providerIndex) => {
    const provider = record(value, `models.dev Provider ${slug}`);
    const models = Object.entries(
      record(provider.models, `models.dev Provider ${slug}.models`),
    ).map(([upstreamModelId, modelValue], modelIndex) => {
      providerModelCount += 1;
      if (providerModelCount > maximumProviderModels) {
        return invalid("models.dev contains too many Provider Models.");
      }
      const model = record(
        modelValue,
        `models.dev Provider ${slug} Model ${upstreamModelId}`,
      );
      const status = model.status;
      if (
        status !== undefined &&
        status !== "alpha" &&
        status !== "beta" &&
        status !== "deprecated"
      ) {
        return invalid("models.dev Provider Model status is unsupported.");
      }
      const canonicalKey = canonicalModelKey(
        canonicalKeys,
        slug,
        upstreamModelId,
      );
      return Object.freeze({
        upstreamModelId: identifier(
          upstreamModelId,
          `models.dev Provider ${slug} Model key ${String(modelIndex)}`,
          512,
        ),
        ...commonModel(
          model,
          `models.dev Provider ${slug} Model ${upstreamModelId}`,
        ),
        ...(canonicalKey ? { canonicalModelKey: canonicalKey } : {}),
        ...(status ? { status } : {}),
        ...(model.cost === undefined
          ? {}
          : {
              cost: cost(model.cost, `models.dev Provider ${slug} Model cost`)!,
            }),
      });
    });
    return Object.freeze({
      slug: identifier(
        slug,
        `models.dev Provider key ${String(providerIndex)}`,
        120,
      ),
      displayName: text(provider.name, `models.dev Provider ${slug}.name`, 160),
      ...(provider.api === undefined
        ? {}
        : {
            apiUrl: text(
              provider.api,
              `models.dev Provider ${slug}.api`,
              2_048,
            ),
          }),
      documentationUrl: text(
        provider.doc,
        `models.dev Provider ${slug}.doc`,
        2_048,
      ),
      models: Object.freeze(models),
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    source: "models.dev",
    sourceRevision: identifier(
      input.sourceRevision,
      "models.dev sourceRevision",
      160,
    ),
    observedAt: text(input.observedAt, "models.dev observedAt", 40),
    canonicalModels: Object.freeze(canonicalModels),
    providers: Object.freeze(providers),
  });
}
