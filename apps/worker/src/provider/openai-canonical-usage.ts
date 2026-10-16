import type { ProviderUsageMetric } from "./provider-adapter.js";

export interface CanonicalOpenAiUsage {
  readonly inputTokens?: number;
  readonly inputTokensNoCache?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly inputTextTokens?: number;
  readonly inputImageTokens?: number;
  readonly outputTextTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function integer(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]{0,15})$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstInteger(
  source: Readonly<Record<string, unknown>> | undefined,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = integer(source?.[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function normalizeOpenAiUsage(
  value: unknown,
  semantics: {
    readonly inputIsText?: boolean;
    readonly outputIsText?: boolean;
  } = {},
): CanonicalOpenAiUsage {
  const usage = record(value);
  if (!usage) return Object.freeze({});
  const inputDetails =
    record(usage.input_tokens_details) ?? record(usage.prompt_tokens_details);
  const outputDetails =
    record(usage.output_tokens_details) ??
    record(usage.completion_tokens_details);
  const inputTokens = firstInteger(usage, ["input_tokens", "prompt_tokens"]);
  const outputTokens = firstInteger(usage, [
    "output_tokens",
    "completion_tokens",
  ]);
  const inputTextTokens =
    firstInteger(inputDetails, ["text_tokens"]) ??
    (semantics.inputIsText ? inputTokens : undefined);
  const outputTextTokens =
    firstInteger(outputDetails, ["text_tokens"]) ??
    (semantics.outputIsText ? outputTokens : undefined);
  const cacheReadTokens =
    firstInteger(inputDetails, ["cached_tokens"]) ??
    firstInteger(usage, ["cached_input_tokens", "prompt_cache_hit_tokens"]);
  const inputTokensNoCache =
    inputTokens !== undefined &&
    cacheReadTokens !== undefined &&
    cacheReadTokens <= inputTokens
      ? inputTokens - cacheReadTokens
      : undefined;
  return Object.freeze({
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(inputTokensNoCache === undefined ? {} : { inputTokensNoCache }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(() => {
      const totalTokens = firstInteger(usage, ["total_tokens"]);
      return totalTokens === undefined ? {} : { totalTokens };
    })(),
    ...(inputTextTokens === undefined ? {} : { inputTextTokens }),
    ...(() => {
      const inputImageTokens = firstInteger(inputDetails, ["image_tokens"]);
      return inputImageTokens === undefined ? {} : { inputImageTokens };
    })(),
    ...(outputTextTokens === undefined ? {} : { outputTextTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(() => {
      const cacheWriteTokens = firstInteger(usage, [
        "cache_creation_input_tokens",
      ]);
      return cacheWriteTokens === undefined ? {} : { cacheWriteTokens };
    })(),
    ...(() => {
      const reasoningTokens = firstInteger(outputDetails, ["reasoning_tokens"]);
      return reasoningTokens === undefined ? {} : { reasoningTokens };
    })(),
  });
}

export function canonicalOpenAiUsageMetrics(
  usage: CanonicalOpenAiUsage,
): readonly ProviderUsageMetric[] {
  const metrics: ProviderUsageMetric[] = [];
  const add = (metricKey: string, numericValue: number | undefined): void => {
    if (numericValue !== undefined) {
      metrics.push(
        Object.freeze({
          metricKey,
          numericValue: String(numericValue),
          unitCode: "token",
        }),
      );
    }
  };
  add("input_tokens", usage.inputTokens);
  add("input_tokens_no_cache", usage.inputTokensNoCache);
  add("output_tokens", usage.outputTokens);
  add("total_tokens", usage.totalTokens);
  add("input_text_tokens", usage.inputTextTokens);
  add("input_image_tokens", usage.inputImageTokens);
  add("output_text_tokens", usage.outputTextTokens);
  add("cache_read_tokens", usage.cacheReadTokens);
  add("cache_write_tokens", usage.cacheWriteTokens);
  add("reasoning_tokens", usage.reasoningTokens);
  return Object.freeze(metrics);
}
