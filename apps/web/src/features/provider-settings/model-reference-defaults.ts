import type { ProviderSettingPreset } from "@kanvas/contracts/api";
import { getProviderDefinition } from "@kanvas/contracts/provider-definition";

export interface ModelReferenceDefaults {
  readonly providerName: string;
  readonly inputPerMillion: string;
  readonly outputPerMillion: string;
  readonly cacheReadPerMillion?: string;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function price(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? String(value)
    : undefined;
}

export function modelReferenceDefaults(
  catalog: unknown,
  preset: ProviderSettingPreset,
  providerModelId: string,
): ModelReferenceDefaults | undefined {
  const providerId = getProviderDefinition(preset).modelsDevProviderKey;
  const provider = providerId
    ? record(record(catalog)?.[providerId])
    : undefined;
  const models = record(provider?.models);
  const model = record(models?.[providerModelId]);
  const cost = record(model?.cost);
  const inputPerMillion = price(cost?.input);
  const outputPerMillion = price(cost?.output);
  if (!provider || !model || !inputPerMillion || !outputPerMillion) {
    return undefined;
  }
  const cacheReadPerMillion = price(cost?.cache_read);
  return Object.freeze({
    providerName:
      typeof provider.name === "string" ? provider.name : providerId!,
    inputPerMillion,
    outputPerMillion,
    ...(cacheReadPerMillion ? { cacheReadPerMillion } : {}),
  });
}
