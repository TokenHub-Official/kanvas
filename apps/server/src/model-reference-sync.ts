import { createHash } from "node:crypto";

import type {
  ModelReferenceDefaults,
  ModelReferenceSyncResult,
} from "@kanvas/contracts/api";
import {
  buildModelsDevReferenceDocument,
  type ModelReferenceDocumentV1,
  type ProviderModelReference,
} from "@kanvas/contracts/model-reference";
import {
  getProviderDefinition,
  type ProviderDefinitionSlug,
} from "@kanvas/contracts/provider-definition";
import {
  digestProviderValue,
  type ModelReferenceSnapshotRecord,
  type ModelReferenceStore,
} from "@kanvas/database/runtime";
import { ulid } from "ulid";

const modelsUrl = "https://models.dev/models.json";
const providersUrl = "https://models.dev/api.json";
const maximumSourceBytes = 16 * 1_024 * 1_024;
const requestTimeoutMilliseconds = 30_000;
const freshSnapshotMilliseconds = 15 * 60 * 1_000;
let lastSuccessfulRefresh:
  { readonly sourceRevision: string; readonly checkedAt: Date } | undefined;

type ProviderMatch = {
  readonly providerSlug: string;
  readonly model: ProviderModelReference;
};

async function downloadJson(
  url: string,
  requester: typeof fetch,
): Promise<{ readonly text: string; readonly value: unknown }> {
  const response = await requester(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
  if (!response.ok) {
    throw new Error(`models.dev returned HTTP ${String(response.status)}.`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumSourceBytes) {
    throw new Error("models.dev response is too large.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumSourceBytes) {
    throw new Error("models.dev response is too large.");
  }
  return Object.freeze({ text, value: JSON.parse(text) as unknown });
}

export async function refreshModelReference(options: {
  readonly store: ModelReferenceStore;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly requester?: typeof fetch;
}): Promise<ModelReferenceSnapshotRecord> {
  const requester = options.requester ?? fetch;
  const [models, providers] = await Promise.all([
    downloadJson(modelsUrl, requester),
    downloadJson(providersUrl, requester),
  ]);
  const rawDigest = createHash("sha256")
    .update(models.text)
    .update("\0")
    .update(providers.text)
    .digest("hex");
  const sourceRevision = `models.dev:${rawDigest}`;
  const current = await options.store.getCurrent();
  if (current?.sourceRevision === sourceRevision) return current;
  const document = buildModelsDevReferenceDocument({
    modelCatalog: models.value,
    providerCatalog: providers.value,
    sourceRevision,
    observedAt: options.now.toISOString(),
  });
  return (
    await options.store.publish({
      id: ulid(),
      sourceRevision,
      sourceDigest: digestProviderValue(document),
      document,
      fetchedAt: options.now,
      publishedAt: options.now,
      actorPrincipalId: options.actorPrincipalId,
    })
  ).snapshot;
}

export async function loadLatestModelReference(options: {
  readonly store: ModelReferenceStore;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly requester?: typeof fetch;
  readonly force?: boolean;
}): Promise<{
  readonly snapshot: ModelReferenceSnapshotRecord;
  readonly stale: boolean;
}> {
  const current = await options.store.getCurrent();
  const recentRefresh = lastSuccessfulRefresh;
  const lastCheckedAt =
    recentRefresh && recentRefresh.sourceRevision === current?.sourceRevision
      ? recentRefresh.checkedAt
      : current?.fetchedAt;
  if (
    current &&
    lastCheckedAt &&
    !options.force &&
    options.now.getTime() - lastCheckedAt.getTime() < freshSnapshotMilliseconds
  ) {
    return Object.freeze({ snapshot: current, stale: false });
  }
  try {
    const snapshot = await refreshModelReference(options);
    lastSuccessfulRefresh = {
      sourceRevision: snapshot.sourceRevision,
      checkedAt: options.now,
    };
    return Object.freeze({
      snapshot,
      stale: false,
    });
  } catch (error) {
    if (current) return Object.freeze({ snapshot: current, stale: true });
    throw error;
  }
}

function consensus<T>(
  matches: readonly ProviderMatch[],
  value: (match: ProviderMatch) => T | undefined,
): {
  readonly value?: T;
  readonly source?: string;
  readonly conflict: boolean;
} {
  const available = matches.flatMap((match) => {
    const candidate = value(match);
    return candidate === undefined ? [] : [{ match, candidate }];
  });
  if (available.length === 0) return { conflict: false };
  const signatures = new Set(
    available.map(({ candidate }) => JSON.stringify(candidate)),
  );
  return signatures.size === 1
    ? {
        value: available[0]!.candidate,
        source: `provider:${available[0]!.match.providerSlug}`,
        conflict: false,
      }
    : { conflict: true };
}

export function resolveModelReferenceDefaults(options: {
  readonly document: ModelReferenceDocumentV1;
  readonly canonicalReference: string;
  readonly upstreamModelId: string;
  readonly providerPreset: ProviderDefinitionSlug;
  readonly stale?: boolean;
}): ModelReferenceSyncResult {
  let canonical = options.document.canonicalModels.find(
    (model) => model.key === options.canonicalReference,
  );
  const matches = options.document.providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.upstreamModelId === options.upstreamModelId)
      .map((model) => ({ providerSlug: provider.slug, model })),
  );
  const preferredProvider = getProviderDefinition(
    options.providerPreset,
  ).modelsDevProviderKey;
  const preferred = preferredProvider
    ? matches.find((match) => match.providerSlug === preferredProvider)
    : undefined;
  const candidates = preferred ? [preferred] : matches;
  const linkedKeys = new Set(
    candidates.flatMap(({ model }) =>
      model.canonicalModelKey ? [model.canonicalModelKey] : [],
    ),
  );
  if (!canonical && linkedKeys.size === 1) {
    canonical = options.document.canonicalModels.find((model) =>
      linkedKeys.has(model.key),
    );
  }
  if (!canonical && linkedKeys.size === 0) {
    const exact = options.document.canonicalModels.filter(
      (model) =>
        model.key === options.upstreamModelId ||
        (!options.upstreamModelId.includes("/") &&
          model.key.slice(model.key.indexOf("/") + 1) ===
            options.upstreamModelId),
    );
    // Exact, unique model identity only; never infer from a family or version prefix.
    if (exact.length === 1) canonical = exact[0];
  }
  let metadataConflict = false;
  const field = <T>(
    select: (
      model: ProviderModelReference | NonNullable<typeof canonical>,
    ) => T | undefined,
  ): T | undefined => {
    const canonicalValue = canonical ? select(canonical) : undefined;
    if (canonicalValue !== undefined) return canonicalValue;
    const result = consensus(candidates, ({ model }) => select(model));
    metadataConflict ||= result.conflict;
    return result.value;
  };
  const pricing = consensus(candidates, ({ model }) => model.cost);
  const warnings: ModelReferenceSyncResult["warnings"][number][] = [];
  if (options.stale) warnings.push("stale_snapshot");
  if (pricing.conflict) warnings.push("pricing_conflict");
  if (!canonical && matches.length === 0) {
    return {
      status: "not_found",
      stale: Boolean(options.stale),
      sourceRevision: options.document.sourceRevision,
      observedAt: options.document.observedAt,
      warnings,
    };
  }
  const values = {
    displayName: field((model) => model.displayName),
    family: field((model) => model.family),
    description: field((model) => model.description),
    inputModalities: field((model) => model.modalities?.input),
    outputModalities: field((model) => model.modalities?.output),
    contextWindow: field((model) => model.limit?.context),
    maximumInputTokens: field((model) => model.limit?.input),
    maximumOutputTokens: field((model) => model.limit?.output),
    attachment: field((model) => model.attachment),
    reasoning: field((model) => model.reasoning),
    toolCall: field((model) => model.toolCall),
    structuredOutput: field((model) => model.structuredOutput),
    temperature: field((model) => model.temperature),
  };
  const defaults: ModelReferenceDefaults = {
    ...Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined),
    ),
    ...(pricing.value ? { cost: pricing.value } : {}),
  };
  if (metadataConflict) warnings.push("metadata_conflict");
  let metadataSource: string | undefined;
  if (canonical) metadataSource = `canonical:${canonical.key}`;
  else if (candidates.length === 1)
    metadataSource = `provider:${candidates[0]!.providerSlug}`;
  else if (Object.values(values).some((value) => value !== undefined))
    metadataSource = "providers:consensus";
  return {
    status: warnings.some((warning) => warning !== "stale_snapshot")
      ? "partial"
      : "resolved",
    stale: Boolean(options.stale),
    sourceRevision: options.document.sourceRevision,
    observedAt: options.document.observedAt,
    ...(metadataSource ? { metadataSource } : {}),
    ...(pricing.source ? { pricingSource: pricing.source } : {}),
    warnings,
    defaults,
  };
}
