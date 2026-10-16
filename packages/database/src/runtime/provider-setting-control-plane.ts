import {
  parseModelProfileDocumentV1,
  parseProviderPricingDocumentV1,
  type ModelProfileDocumentV1,
} from "@kanvas/application";
import type { ProviderPricingDocumentV1 } from "@kanvas/contracts/provider-billing";
import { getProviderDefinition } from "@kanvas/contracts/provider-definition";
import {
  parseRuntimeAdapterDefinitionRevision,
  type RuntimeAdapterDefinitionRevision,
} from "@kanvas/contracts/capability";
import type {
  ProviderModelCapabilityKey,
  ProviderModelCatalogEntry,
  ProviderModelParameterPolicies,
} from "@kanvas/contracts/provider-model";

import {
  parseProviderConstraintDocument,
  parseProviderRoutePolicyDocument,
  type ProviderConstraintDocumentV1,
  type ProviderRoutePolicyDocumentV1,
} from "./configuration-policy.js";
import { digestProviderValue } from "./provider-value-digest.js";
import type { ProviderSettingPreset } from "./provider-settings-store.js";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export interface ProviderSettingControlPlaneIds {
  readonly endpointId: string;
  readonly credentialId: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly routePolicyRevisionIds: readonly string[];
  readonly budgetAccountId: string;
}

type ImageApiSurface =
  | "images.edits.v1"
  | "images.generations.v1"
  | "generate-content.image.v1"
  | "generation.tasks.v1";

export type ImageCapabilityKey = Exclude<
  ProviderModelCapabilityKey,
  "text.generate"
>;

export interface ProviderSettingRouteDefinition {
  readonly routePolicyRevisionId: string;
  readonly capabilityKey: ImageCapabilityKey;
  readonly apiSurface: ImageApiSurface;
  readonly parameterPolicies: ProviderModelParameterPolicies;
  readonly routePolicyDocument: ProviderRoutePolicyDocumentV1;
  readonly routePolicyDigest: string;
}

export interface ProviderRuntimeAdapterProfile {
  readonly adapterKey: string;
  readonly document: RuntimeAdapterDefinitionRevision;
}

interface ProviderRuntimeAdapterRow extends RowDataPacket {
  readonly adapterKey: string;
  readonly document: unknown;
}

export async function loadProviderRuntimeAdapterProfilesInTransaction(
  connection: PoolConnection,
  workspaceId: string,
): Promise<readonly ProviderRuntimeAdapterProfile[]> {
  const [rows] = await connection.execute<ProviderRuntimeAdapterRow[]>(
    `SELECT definition.adapter_key AS adapterKey, revision.document
     FROM runtime_adapter_revision AS revision
     INNER JOIN runtime_adapter_definition AS definition
       ON definition.workspace_id = revision.workspace_id
      AND definition.id = revision.runtime_adapter_definition_id
      AND definition.lifecycle_status = 'active'
     WHERE revision.workspace_id = ?
       AND revision.lifecycle_status IN ('published', 'deprecated')
       AND revision.execution_target = 'provider'
     ORDER BY definition.adapter_key, revision.revision DESC`,
    [workspaceId],
  );
  const current = new Map<string, ProviderRuntimeAdapterProfile>();
  for (const row of rows) {
    if (current.has(row.adapterKey)) continue;
    const document = parseRuntimeAdapterDefinitionRevision(
      typeof row.document === "string"
        ? (JSON.parse(row.document) as unknown)
        : row.document,
    );
    if (document.adapterKey !== row.adapterKey) {
      throw new Error("Runtime Adapter identity is inconsistent.");
    }
    current.set(
      row.adapterKey,
      Object.freeze({ adapterKey: row.adapterKey, document }),
    );
  }
  return Object.freeze([...current.values()]);
}

export function providerRuntimeAdaptersForRoute(
  adapters: readonly ProviderRuntimeAdapterProfile[],
  route: {
    readonly preset: ProviderSettingPreset;
    readonly capabilityKey: ImageCapabilityKey;
    readonly apiSurface: ImageApiSurface;
  },
): readonly ProviderRuntimeAdapterProfile[] {
  return Object.freeze(
    adapters.filter(({ document }) => {
      const selector = document.modelServiceSelector;
      return (
        document.executionTarget === "provider" &&
        document.sourceKinds.includes("model_service") &&
        selector?.operation === route.capabilityKey &&
        (selector.apiSurface === undefined ||
          selector.apiSurface === route.apiSurface) &&
        (selector.providerPreset === undefined ||
          selector.providerPreset === route.preset)
      );
    }),
  );
}

export interface ProviderSettingControlPlaneDefinition {
  readonly routes: readonly ProviderSettingRouteDefinition[];
  readonly regionCode: "global" | "us" | "private";
  readonly modelProfileDocument: ModelProfileDocumentV1;
  readonly modelProfileDigest: string;
  readonly modelDeploymentDigest: string;
  readonly pricingDocument: ProviderPricingDocumentV1;
  readonly pricingDigest: string;
  readonly pricingRevisionSourceKind: "contract";
  readonly routeConstraints: ProviderConstraintDocumentV1;
  readonly maximumCharge: {
    readonly currencyCode: "USD";
    readonly amount: string;
  };
  readonly requestTimeoutSeconds: number;
}

export interface ProviderAgentTextControlPlaneDefinition {
  readonly bindingId: string;
  readonly bindingKey: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly modelProfileDocument: ModelProfileDocumentV1;
  readonly modelProfileDigest: string;
  readonly modelDeploymentDigest: string;
  readonly pricingDocument: ProviderPricingDocumentV1;
  readonly pricingDigest: string;
  readonly routeDigest: string;
  readonly apiSurface:
    | "chat.completions.v1"
    | "responses.v1"
    | "generate-content.v1"
    | "messages.v1";
  readonly protocolKind:
    | "openai_chat"
    | "openai_responses"
    | "gemini_generate_content"
    | "anthropic_messages";
  readonly maximumCharge: {
    readonly currencyCode: "USD";
    readonly amount: string;
  };
}

export interface ProviderAgentTextPricingConfiguration {
  readonly inputPerMillion: string;
  readonly outputPerMillion: string;
  readonly cacheReadPerMillion?: string;
  readonly cacheWritePerMillion?: string;
  readonly maximumChargeAmount: string;
}

export function buildProviderAgentTextControlPlaneDefinition(options: {
  readonly providerSettingId: string;
  readonly providerEndpointId: string;
  readonly credentialId: string;
  readonly budgetAccountId: string;
  readonly bindingId: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly preset: ProviderSettingPreset;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly pricing: ProviderAgentTextPricingConfiguration;
  readonly observedAt: Date;
}): ProviderAgentTextControlPlaneDefinition {
  const transport = getProviderDefinition(options.preset)
    .agentTextTransports[0];
  if (!transport) {
    throw new TypeError("Provider has no Agent text protocol.");
  }
  const inputPerMillion = positiveMoney(
    options.pricing.inputPerMillion,
    "Agent input price",
  );
  const outputPerMillion = positiveMoney(
    options.pricing.outputPerMillion,
    "Agent output price",
  );
  const cacheReadPerMillion = options.pricing.cacheReadPerMillion
    ? positiveMoney(
        options.pricing.cacheReadPerMillion,
        "Agent cache-read price",
      )
    : undefined;
  const cacheWritePerMillion = options.pricing.cacheWritePerMillion
    ? positiveMoney(
        options.pricing.cacheWritePerMillion,
        "Agent cache-write price",
      )
    : undefined;
  const maximumChargeAmount = positiveMoney(
    options.pricing.maximumChargeAmount,
    "Agent maximum charge",
  );
  const evidenceDigest = digestProviderValue({
    domain: "kanvas.provider-agent-text-contract.v1",
    providerSettingId: options.providerSettingId,
    providerModelId: options.providerModelId,
    pricing: options.pricing,
  });
  const operationEvidence = Object.freeze([
    Object.freeze({
      kind: "administrator" as const,
      reference: "workspace.provider-agent-text-selection",
      observedAt: options.observedAt.toISOString(),
      sourceDigest: evidenceDigest,
      confidence: "high" as const,
      claim: "supported" as const,
    }),
  ]);
  const modelProfileDocument = parseModelProfileDocumentV1({
    schemaVersion: 1,
    model: {
      displayName: options.displayName,
      family: "agent-text",
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCall: true,
    },
    operations: {
      "text.generate": {
        parameters: [],
        evidence: operationEvidence,
      },
    },
    sources: [
      {
        kind: "manual",
        reference: "workspace.provider-agent-text-selection",
        observedAt: options.observedAt.toISOString(),
        sourceDigest: evidenceDigest,
      },
    ],
  });
  const pricingDocument = parseProviderPricingDocumentV1({
    schemaVersion: 1,
    billingMode: "metered",
    rates: [
      {
        metricKey:
          cacheReadPerMillion || cacheWritePerMillion
            ? "input_tokens_no_cache"
            : "input_tokens",
        unitCode: "token",
        quantity: "1000000",
        amount: inputPerMillion,
      },
      ...(cacheReadPerMillion
        ? [
            {
              metricKey: "cache_read_tokens",
              unitCode: "token",
              quantity: "1000000",
              amount: cacheReadPerMillion,
            },
          ]
        : []),
      ...(cacheWritePerMillion
        ? [
            {
              metricKey: "cache_write_tokens",
              unitCode: "token",
              quantity: "1000000",
              amount: cacheWritePerMillion,
            },
          ]
        : []),
      {
        metricKey: "output_tokens",
        unitCode: "token",
        quantity: "1000000",
        amount: outputPerMillion,
      },
    ],
    evidence: {
      priceVerified: true,
      sourceKind: "contract",
      sourceReference: `kanvas:provider-agent-text:${options.providerSettingId}`,
      observedAt: options.observedAt.toISOString(),
      sourceDigest: evidenceDigest,
    },
  });
  const modelProfileDigest = digestProviderValue(modelProfileDocument);
  const modelDeploymentDigest = digestProviderValue({
    modelProfileRevisionId: options.modelProfileRevisionId,
    providerEndpointId: options.providerEndpointId,
    providerModelId: options.providerModelId,
    modelProfileDigest,
    agentTextTransport: transport,
  });
  const pricingDigest = digestProviderValue(pricingDocument);
  const bindingKey = `agent.${digestProviderValue({
    providerSettingId: options.providerSettingId,
    providerModelId: options.providerModelId,
    modelProfileDigest,
    pricingDigest,
  }).slice(7, 39)}`;
  const maximumCharge = Object.freeze({
    currencyCode: "USD" as const,
    amount: maximumChargeAmount,
  });
  const routeFacts = Object.freeze({
    schemaVersion: 1,
    bindingId: options.bindingId,
    bindingKey,
    modelProfileRevisionId: options.modelProfileRevisionId,
    modelDeploymentId: options.modelDeploymentId,
    providerEndpointId: options.providerEndpointId,
    credentialId: options.credentialId,
    pricingRevisionId: options.pricingRevisionId,
    budgetAccountId: options.budgetAccountId,
    maximumCharge,
    apiSurface: transport.apiSurface,
    protocolKind: transport.protocolKind,
    providerModelId: options.providerModelId,
  });
  return Object.freeze({
    bindingId: options.bindingId,
    bindingKey,
    modelProfileRevisionId: options.modelProfileRevisionId,
    modelDeploymentId: options.modelDeploymentId,
    pricingRevisionId: options.pricingRevisionId,
    modelProfileDocument,
    modelProfileDigest,
    modelDeploymentDigest,
    pricingDocument,
    pricingDigest,
    routeDigest: digestProviderValue(routeFacts),
    apiSurface: transport.apiSurface,
    protocolKind: transport.protocolKind,
    maximumCharge,
  });
}

export interface ProviderSettingMeteredPricingRate {
  readonly metricKey: string;
  readonly unitCode: string;
  readonly quantity: string;
  readonly amount: string;
}

export type ProviderSettingModelPricingConfiguration =
  | {
      readonly providerModelId: string;
      readonly billingMode: "fixed";
      readonly fixedChargeAmount: string;
    }
  | {
      readonly providerModelId: string;
      readonly billingMode: "metered";
      readonly rates: readonly ProviderSettingMeteredPricingRate[];
      readonly minimumChargeAmount?: string;
      readonly maximumChargeAmount: string;
    }
  | {
      readonly providerModelId: string;
      readonly billingMode: "provider_reported";
      readonly maximumChargeAmount: string;
    };

const moneyPattern = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const metricKeyPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const unitCodePattern = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const quantityPattern = /^(?:[1-9][0-9]{0,19})$/u;

function positiveMoney(value: unknown, label: string): string {
  if (typeof value !== "string" || !moneyPattern.test(value) || value === "0") {
    throw new Error(`${label} must be a positive bounded decimal.`);
  }
  return value;
}

export function parseProviderSettingModelPricingConfigurations(
  value: unknown,
  modelKeys: readonly string[],
): readonly ProviderSettingModelPricingConfiguration[] {
  if (modelKeys.length === 0 && (value === undefined || value === null)) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value) || value.length !== modelKeys.length) {
    throw new Error(
      "Provider setting pricing must configure every selected model exactly once.",
    );
  }
  const expected = new Set(modelKeys);
  const seen = new Set<string>();
  const configurations = value.map((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`Provider model pricing ${String(index)} is invalid.`);
    }
    const pricing = candidate as Readonly<Record<string, unknown>>;
    if (
      typeof pricing.providerModelId !== "string" ||
      !expected.has(pricing.providerModelId) ||
      seen.has(pricing.providerModelId)
    ) {
      throw new Error(
        "Provider model pricing identity is missing or duplicated.",
      );
    }
    seen.add(pricing.providerModelId);
    if (pricing.billingMode === "fixed") {
      return Object.freeze({
        providerModelId: pricing.providerModelId,
        billingMode: "fixed" as const,
        fixedChargeAmount: positiveMoney(
          pricing.fixedChargeAmount,
          "Provider fixed charge",
        ),
      });
    }
    if (pricing.billingMode === "provider_reported") {
      return Object.freeze({
        providerModelId: pricing.providerModelId,
        billingMode: "provider_reported" as const,
        maximumChargeAmount: positiveMoney(
          pricing.maximumChargeAmount,
          "Provider-reported maximum charge",
        ),
      });
    }
    if (
      pricing.billingMode !== "metered" ||
      !Array.isArray(pricing.rates) ||
      pricing.rates.length < 1 ||
      pricing.rates.length > 32
    ) {
      throw new Error("Provider model pricing mode or rates are invalid.");
    }
    const rateKeys = new Set<string>();
    const rates = pricing.rates.map((rawRate, rateIndex) => {
      if (!rawRate || typeof rawRate !== "object" || Array.isArray(rawRate)) {
        throw new Error(
          `Provider pricing rate ${String(rateIndex)} is invalid.`,
        );
      }
      const rate = rawRate as Readonly<Record<string, unknown>>;
      if (
        typeof rate.metricKey !== "string" ||
        !metricKeyPattern.test(rate.metricKey) ||
        typeof rate.unitCode !== "string" ||
        !unitCodePattern.test(rate.unitCode) ||
        typeof rate.quantity !== "string" ||
        !quantityPattern.test(rate.quantity) ||
        rateKeys.has(rate.metricKey)
      ) {
        throw new Error(
          `Provider pricing rate ${String(rateIndex)} is invalid or duplicated.`,
        );
      }
      rateKeys.add(rate.metricKey);
      return Object.freeze({
        metricKey: rate.metricKey,
        unitCode: rate.unitCode,
        quantity: rate.quantity,
        amount: positiveMoney(
          rate.amount,
          `Provider pricing rate ${String(rateIndex)} amount`,
        ),
      });
    });
    return Object.freeze({
      providerModelId: pricing.providerModelId,
      billingMode: "metered" as const,
      rates: Object.freeze(rates),
      ...(pricing.minimumChargeAmount === undefined
        ? {}
        : {
            minimumChargeAmount: positiveMoney(
              pricing.minimumChargeAmount,
              "Provider minimum charge",
            ),
          }),
      maximumChargeAmount: positiveMoney(
        pricing.maximumChargeAmount,
        "Provider metered maximum charge",
      ),
    });
  });
  return Object.freeze(configurations);
}

function pricingDocument(options: {
  readonly providerSettingId: string;
  readonly providerModelId: string;
  readonly preset: ProviderSettingPreset;
  readonly configuration: ProviderSettingModelPricingConfiguration;
  readonly routes: readonly Pick<
    ProviderSettingRouteDefinition,
    "capabilityKey" | "apiSurface"
  >[];
  readonly runtimeAdapters: readonly ProviderRuntimeAdapterProfile[];
  readonly observedAt: Date;
}): {
  readonly document: ProviderPricingDocumentV1;
  readonly maximumChargeAmount: string;
} {
  const evidenceDigest = digestProviderValue({
    domain: "kanvas.provider-setting-pricing-contract.v1",
    providerSettingId: options.providerSettingId,
    providerModelId: options.providerModelId,
    configuration: options.configuration,
  });
  const evidence = {
    priceVerified: true as const,
    sourceKind: "contract" as const,
    sourceReference: `kanvas:provider-setting:${
      options.providerSettingId
    }:model:${digestProviderValue(options.providerModelId).slice(7, 23)}`,
    observedAt: options.observedAt.toISOString(),
    sourceDigest: evidenceDigest,
  };
  if (options.configuration.billingMode === "fixed") {
    return Object.freeze({
      document: parseProviderPricingDocumentV1({
        schemaVersion: 1,
        billingMode: "fixed",
        fixedChargeAmount: options.configuration.fixedChargeAmount,
        evidence,
      }),
      maximumChargeAmount: options.configuration.fixedChargeAmount,
    });
  }
  if (options.configuration.billingMode === "provider_reported") {
    if (
      options.preset !== "tokenhub" ||
      options.routes.some((route) => route.apiSurface !== "generation.tasks.v1")
    ) {
      throw new Error(
        "Provider-reported pricing has no exact charge response contract for this route.",
      );
    }
    return Object.freeze({
      document: parseProviderPricingDocumentV1({
        schemaVersion: 1,
        billingMode: "provider_reported",
        currencyCode: "USD",
        evidence: {
          chargeVerified: true,
          sourceKind: "contract",
          sourceReference: "tokenhub.generation-task.quota",
          observedAt: options.observedAt.toISOString(),
          sourceDigest: evidenceDigest,
        },
      }),
      maximumChargeAmount: options.configuration.maximumChargeAmount,
    });
  }
  const requiredMetrics = options.configuration.rates.map(
    (rate) => `${rate.metricKey}:${rate.unitCode}`,
  );
  for (const route of options.routes) {
    const adapters = providerRuntimeAdaptersForRoute(options.runtimeAdapters, {
      preset: options.preset,
      capabilityKey: route.capabilityKey,
      apiSurface: route.apiSurface,
    });
    if (adapters.length === 0) {
      throw new TypeError(
        `Provider route ${route.capabilityKey} on ${route.apiSurface} has no published Runtime Adapter. Run the release database migration to initialize system adapters.`,
      );
    }
    for (const adapter of adapters) {
      const supported = new Set(
        (adapter.document.usageMetrics ?? []).map(
          ({ metricKey, unitCode }) => `${metricKey}:${unitCode}`,
        ),
      );
      if (requiredMetrics.some((metric) => !supported.has(metric))) {
        throw new Error(
          `Provider pricing requires usage metrics not emitted by Runtime Adapter ${adapter.adapterKey}.`,
        );
      }
    }
  }
  return Object.freeze({
    document: parseProviderPricingDocumentV1({
      schemaVersion: 1,
      billingMode: "metered",
      rates: options.configuration.rates,
      ...(options.configuration.minimumChargeAmount
        ? { minimumChargeAmount: options.configuration.minimumChargeAmount }
        : {}),
      evidence,
    }),
    maximumChargeAmount: options.configuration.maximumChargeAmount,
  });
}

const imageApiSurfaces = new Set<ImageApiSurface>([
  "images.edits.v1",
  "images.generations.v1",
  "generate-content.image.v1",
  "generation.tasks.v1",
]);

const executableProviderParameterTypes = Object.freeze({
  aspectRatio: "enum",
  resolution: "enum",
  size: "enum",
  quality: "enum",
  outputFormat: "enum",
  background: "enum",
  outputCompression: "integer",
  numberOfImages: "integer",
  seed: "integer",
} as const);

function imageApiSurface(value: string): ImageApiSurface {
  if (!imageApiSurfaces.has(value as ImageApiSurface)) {
    throw new Error(
      `Provider image API surface ${value} has no executable Adapter mapping.`,
    );
  }
  return value as ImageApiSurface;
}

export function buildProviderSettingControlPlaneDefinition(options: {
  readonly ids: ProviderSettingControlPlaneIds;
  readonly providerSettingId: string;
  readonly preset: ProviderSettingPreset;
  readonly providerModelId: string;
  readonly catalogEntry: ProviderModelCatalogEntry;
  readonly pricingConfiguration: ProviderSettingModelPricingConfiguration;
  readonly runtimeAdapters: readonly ProviderRuntimeAdapterProfile[];
  readonly observedAt: Date;
}): ProviderSettingControlPlaneDefinition {
  const generationTasks =
    options.preset === "newapi" || options.preset === "tokenhub";
  let regionCode: "global" | "private" | "us" = "global";
  if (options.preset === "newapi") {
    regionCode = "private";
  } else if (options.preset === "tokenhub") {
    regionCode = "us";
  }
  let adapterKind:
    | "gemini_native"
    | "openai_compatible"
    | "openai_native"
    | "openrouter_native"
    | "anthropic_native" = "openai_compatible";
  if (options.preset === "openai") {
    adapterKind = "openai_native";
  } else if (options.preset === "openrouter") {
    adapterKind = "openrouter_native";
  } else if (options.preset === "gemini") {
    adapterKind = "gemini_native";
  } else if (options.preset === "anthropic") {
    adapterKind = "anthropic_native";
  }
  const gatewayManaged = options.preset === "openrouter" || generationTasks;
  const partialTransparency = gatewayManaged;
  let modelFamily = "gpt-image";
  if (options.preset === "gemini") {
    modelFamily = "gemini-image";
  } else if (generationTasks) {
    modelFamily = "image-generation-task";
  } else if (options.preset === "xai") {
    modelFamily = "grok-image";
  }
  const requestTimeoutSeconds = generationTasks ? 300 : 180;
  if (
    options.catalogEntry.providerModelId !== options.providerModelId ||
    options.catalogEntry.completeness === "identity_only"
  ) {
    throw new Error("Provider model catalog entry is not activation-ready.");
  }
  const modelProfileDocument = parseModelProfileDocumentV1({
    schemaVersion: 1,
    model: {
      displayName: options.catalogEntry.displayName,
      family: modelFamily,
      ...(options.catalogEntry.description === undefined
        ? {}
        : { description: options.catalogEntry.description }),
      inputModalities: options.catalogEntry.inputModalities,
      outputModalities: options.catalogEntry.outputModalities,
    },
    operations: Object.fromEntries(
      (["text.generate", "image.generate", "image.edit"] as const).flatMap(
        (capabilityKey) => {
          const operation = options.catalogEntry.operations[capabilityKey];
          return operation
            ? [
                [
                  capabilityKey,
                  {
                    parameters: operation.parameters,
                    evidence: operation.evidence,
                  },
                ],
              ]
            : [];
        },
      ),
    ),
    sources: options.catalogEntry.evidence.map((evidence) => ({
      kind: evidence.kind === "administrator" ? "manual" : "provider",
      reference: evidence.reference,
      observedAt: evidence.observedAt,
      sourceDigest: evidence.sourceDigest,
    })),
  });
  const routeDrafts = (["image.generate", "image.edit"] as const).flatMap(
    (capabilityKey) => {
      const operation = modelProfileDocument.operations[capabilityKey];
      const catalogOperation = options.catalogEntry.operations[capabilityKey];
      if (!operation || !catalogOperation) {
        return [];
      }
      const parameterPolicies = Object.freeze(
        Object.fromEntries(
          operation.parameters.flatMap((parameter) => {
            const supportedType =
              executableProviderParameterTypes[
                parameter.key as keyof typeof executableProviderParameterTypes
              ];
            if (!supportedType || supportedType !== parameter.valueType) {
              if (parameter.required) {
                throw new Error(
                  `Required Provider parameter ${parameter.key} has no executable canonical Adapter mapping.`,
                );
              }
              return [];
            }
            return [
              [
                parameter.key,
                Object.freeze({
                  callerPolicy: parameter.required
                    ? ("required" as const)
                    : ("optional" as const),
                  ...(parameter.valueType === "enum" &&
                  parameter.values.length > 0
                    ? { allowedValues: [...parameter.values] }
                    : {}),
                }),
              ] as const,
            ];
          }),
        ),
      );
      return catalogOperation.apiSurfaces.map((apiSurface) => ({
        capabilityKey,
        apiSurface: imageApiSurface(apiSurface),
        parameterPolicies,
      }));
    },
  );
  if (
    routeDrafts.length < 1 ||
    routeDrafts.length > options.ids.routePolicyRevisionIds.length
  ) {
    throw new Error("Provider model operations are missing route identities.");
  }
  for (const route of routeDrafts) {
    if (
      providerRuntimeAdaptersForRoute(options.runtimeAdapters, {
        preset: options.preset,
        capabilityKey: route.capabilityKey,
        apiSurface: route.apiSurface,
      }).length === 0
    ) {
      throw new TypeError(
        `Provider route ${route.capabilityKey} on ${route.apiSurface} has no published Runtime Adapter. Run the release database migration to initialize system adapters.`,
      );
    }
  }
  const pricing = pricingDocument({
    providerSettingId: options.providerSettingId,
    providerModelId: options.providerModelId,
    preset: options.preset,
    configuration: options.pricingConfiguration,
    routes: routeDrafts,
    runtimeAdapters: options.runtimeAdapters,
    observedAt: options.observedAt,
  });
  const maximumCharge = Object.freeze({
    currencyCode: "USD" as const,
    amount: pricing.maximumChargeAmount,
  });
  const routeConstraints = parseProviderConstraintDocument(
    {
      allowedAdapterKinds: [adapterKind],
      allowedPresetKinds: [options.preset],
      allowedRegionCodes: [regionCode],
      allowedProviderEndpointIds: [options.ids.endpointId],
      allowedRoutingModes: [
        gatewayManaged ? "gateway_managed" : "kanvas_fixed",
      ],
      allowedExecutionTransparencies: [
        partialTransparency ? "partial" : "full",
      ],
      maximumCharge,
      maxProviderRequestSeconds: requestTimeoutSeconds,
    },
    "Provider setting route constraints",
  );
  const routes = Object.freeze(
    routeDrafts.map((draft, index) => {
      const routePolicyRevisionId = options.ids.routePolicyRevisionIds[index]!;
      const routePolicyDocument = parseProviderRoutePolicyDocument({
        capabilityKey: draft.capabilityKey,
        parameterPolicies: draft.parameterPolicies,
        providerKey: options.preset,
        apiSurface: draft.apiSurface,
        providerEndpointId: options.ids.endpointId,
        credentialId: options.ids.credentialId,
        modelDeploymentId: options.ids.modelDeploymentId,
        pricingRevisionId: options.ids.pricingRevisionId,
        budgetAccountId: options.ids.budgetAccountId,
        routingMode: gatewayManaged ? "gateway_managed" : "kanvas_fixed",
        executionTransparency: partialTransparency ? "partial" : "full",
        maximumCharge,
        requestTimeoutSeconds,
        queryMode: generationTasks ? "provider_request_id" : "none",
        notFoundIsAuthoritative: false,
        constraints: routeConstraints,
      });
      return Object.freeze({
        routePolicyRevisionId,
        capabilityKey: draft.capabilityKey,
        apiSurface: draft.apiSurface,
        parameterPolicies: draft.parameterPolicies,
        routePolicyDocument,
        routePolicyDigest: digestProviderValue(routePolicyDocument),
      });
    }),
  );
  return Object.freeze({
    routes,
    regionCode,
    modelProfileDocument,
    modelProfileDigest: digestProviderValue(modelProfileDocument),
    modelDeploymentDigest: digestProviderValue({
      modelProfileRevisionId: options.ids.modelProfileRevisionId,
      providerModelId: options.providerModelId,
      operations: modelProfileDocument.operations,
    }),
    pricingDocument: pricing.document,
    pricingDigest: digestProviderValue(pricing.document),
    pricingRevisionSourceKind: "contract",
    routeConstraints,
    maximumCharge,
    requestTimeoutSeconds,
  });
}
