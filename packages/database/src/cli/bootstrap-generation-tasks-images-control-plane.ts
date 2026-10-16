import type { PoolConnection } from "mysql2/promise";

import {
  parseModelProfileDocumentV1,
  parseProviderPricingDocumentV1,
} from "@kanvas/application";
import {
  parseProviderConstraintDocument,
  parseProviderRoutePolicyDocument,
} from "../runtime/configuration-policy.js";
import { digestProviderValue } from "../runtime/provider-value-digest.js";
import { secretAadDigestFor } from "../runtime/secret-version-store.js";
import {
  bootstrapImageProviderResources,
  type ImageProviderControlPlaneBootstrapResult,
  type ImageProviderResourceDefinition,
  type ImageProviderResourceSpec,
} from "./bootstrap-image-provider-resources.js";
import { generationTasksImagesResourceIds } from "./image-provider-control-plane-ids.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const deploymentReferencePattern =
  /^deployment:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{0,479}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const regionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const moneyPattern = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const sourceReferencePattern = /^[\x20-\x7e]{1,512}$/u;

export interface GenerationTasksImagesControlPlaneConfiguration {
  readonly apiOrigin: string;
  readonly deploymentReference: string;
  readonly endpointValidationDigest: string;
  readonly fixedChargeAmount: string;
  readonly fixedPricingEvidenceDigest: string;
  readonly fixedPricingEvidenceReference: string;
  readonly presetKind: "newapi" | "tokenhub";
  readonly providerKey: string;
  readonly providerModelId: string;
  readonly regionCode: string;
  readonly secretMaterialFingerprint: string;
  readonly validatedAt: Date;
}

export interface GenerationTasksImagesControlPlaneDefinition extends ImageProviderResourceDefinition {
  readonly spec: ImageProviderResourceSpec;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required when Generation Tasks Images control-plane bootstrap is enabled.`,
    );
  }
  return value;
}

function parseDate(value: string, name: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(
      `${name} must be an ISO-8601 UTC timestamp produced by Date.toISOString().`,
    );
  }
  if (parsed.getTime() > Date.now()) {
    throw new Error(`${name} cannot be in the future.`);
  }
  return parsed;
}

function parseExactHttpsOrigin(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `${name} must be an exact HTTPS origin without credentials, path, query or fragment.`,
    );
  }
  return parsed.origin;
}

function assertDigest(value: string, name: string): void {
  if (!digestPattern.test(value)) {
    throw new Error(`${name} must be a canonical SHA-256 digest.`);
  }
}

export function loadGenerationTasksImagesControlPlaneConfiguration(
  environment: NodeJS.ProcessEnv,
): GenerationTasksImagesControlPlaneConfiguration | undefined {
  const enabled =
    environment.KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED?.trim();
  if (!enabled || enabled === "false") {
    return undefined;
  }
  if (enabled !== "true") {
    throw new Error(
      "KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED must be true or false.",
    );
  }
  const presetKind =
    environment.KANVAS_GENERATION_TASKS_IMAGES_PRESET_KIND?.trim() ||
    "tokenhub";
  if (presetKind !== "newapi" && presetKind !== "tokenhub") {
    throw new Error(
      "KANVAS_GENERATION_TASKS_IMAGES_PRESET_KIND must be newapi or tokenhub.",
    );
  }
  const providerKey =
    environment.KANVAS_GENERATION_TASKS_IMAGES_PROVIDER_KEY?.trim() ||
    presetKind;
  const providerModelId =
    environment.KANVAS_GENERATION_TASKS_IMAGES_MODEL_ID?.trim() ||
    "gpt-image-2";
  const regionCode =
    environment.KANVAS_GENERATION_TASKS_IMAGES_REGION_CODE?.trim() ||
    (presetKind === "tokenhub" ? "us" : "private");
  if (
    !identifierPattern.test(providerKey) ||
    !identifierPattern.test(providerModelId) ||
    !regionPattern.test(regionCode)
  ) {
    throw new Error(
      "Generation Tasks provider, model or region identifier is invalid.",
    );
  }
  const deploymentReference = required(
    environment,
    "KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE",
  );
  if (!deploymentReferencePattern.test(deploymentReference)) {
    throw new Error(
      "KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE must be a bounded deployment:// reference.",
    );
  }
  const secretMaterialFingerprint = required(
    environment,
    "KANVAS_GENERATION_TASKS_IMAGES_SECRET_FINGERPRINT",
  );
  const endpointValidationDigest = required(
    environment,
    "KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATION_DIGEST",
  );
  assertDigest(
    secretMaterialFingerprint,
    "KANVAS_GENERATION_TASKS_IMAGES_SECRET_FINGERPRINT",
  );
  assertDigest(
    endpointValidationDigest,
    "KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATION_DIGEST",
  );
  const fixedChargeAmount = required(
    environment,
    "KANVAS_GENERATION_TASKS_IMAGES_FIXED_CHARGE_AMOUNT",
  );
  const fixedPricingEvidenceReference = required(
    environment,
    "KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_REFERENCE",
  );
  const fixedPricingEvidenceDigest = required(
    environment,
    "KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_DIGEST",
  );
  if (
    fixedChargeAmount &&
    (!moneyPattern.test(fixedChargeAmount) || fixedChargeAmount === "0")
  ) {
    throw new Error(
      "KANVAS_GENERATION_TASKS_IMAGES_FIXED_CHARGE_AMOUNT must be a positive bounded decimal.",
    );
  }
  if (
    fixedPricingEvidenceReference &&
    !sourceReferencePattern.test(fixedPricingEvidenceReference)
  ) {
    throw new Error(
      "KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_REFERENCE is invalid.",
    );
  }
  if (fixedPricingEvidenceDigest) {
    assertDigest(
      fixedPricingEvidenceDigest,
      "KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_DIGEST",
    );
  }
  return Object.freeze({
    apiOrigin: parseExactHttpsOrigin(
      environment.KANVAS_GENERATION_TASKS_IMAGES_API_ORIGIN?.trim() ||
        "https://us-api.tokenhub.com",
      "KANVAS_GENERATION_TASKS_IMAGES_API_ORIGIN",
    ),
    deploymentReference,
    endpointValidationDigest,
    presetKind,
    providerKey,
    providerModelId,
    fixedChargeAmount,
    fixedPricingEvidenceReference,
    fixedPricingEvidenceDigest,
    regionCode,
    secretMaterialFingerprint,
    validatedAt: parseDate(
      required(
        environment,
        "KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATED_AT",
      ),
      "KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATED_AT",
    ),
  });
}

export function buildGenerationTasksImagesControlPlaneDefinition(options: {
  readonly configuration: GenerationTasksImagesControlPlaneConfiguration;
  readonly instanceId: string;
  readonly workspaceId: string;
}): GenerationTasksImagesControlPlaneDefinition {
  const { configuration } = options;
  const ids = generationTasksImagesResourceIds;
  const maximumCharge = Object.freeze({
    currencyCode: "USD",
    amount: "1",
  });
  const routeConstraints = Object.freeze({
    allowedAdapterKinds: Object.freeze(["openai_compatible"]),
    allowedPresetKinds: Object.freeze([configuration.presetKind]),
    allowedRegionCodes: Object.freeze([configuration.regionCode]),
    allowedProviderEndpointIds: Object.freeze([ids.endpoint]),
    allowedRoutingModes: Object.freeze(["gateway_managed"]),
    allowedExecutionTransparencies: Object.freeze(["partial"]),
    maximumCharge,
    maxProviderRequestSeconds: 300,
  });
  const routePolicyDocument = parseProviderRoutePolicyDocument({
    providerKey: configuration.providerKey,
    apiSurface: "generation.tasks.v1",
    providerEndpointId: ids.endpoint,
    credentialId: ids.credential,
    modelDeploymentId: ids.modelDeployment,
    pricingRevisionId: ids.pricingRevision,
    budgetAccountId: ids.budgetAccount,
    routingMode: "gateway_managed",
    executionTransparency: "partial",
    maximumCharge,
    requestTimeoutSeconds: 300,
    queryMode: "provider_request_id",
    notFoundIsAuthoritative: false,
    constraints: parseProviderConstraintDocument(
      routeConstraints,
      "Generation Tasks route constraints",
    ),
  });
  const capabilityEvidence = Object.freeze([
    Object.freeze({
      kind: "administrator" as const,
      reference: "bootstrap.generation-tasks-images",
      observedAt: configuration.validatedAt.toISOString(),
      sourceDigest: configuration.endpointValidationDigest,
      confidence: "high" as const,
      claim: "supported" as const,
    }),
  ]);
  const modelProfileDocument = parseModelProfileDocumentV1({
    schemaVersion: 1,
    model: {
      displayName: "Generation Tasks Images",
      family: "image-generation-task",
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
    },
    operations: {
      "image.generate": {
        parameters: [],
        evidence: capabilityEvidence,
      },
      "image.edit": {
        parameters: [],
        evidence: capabilityEvidence,
      },
    },
    sources: [
      {
        kind: "manual",
        reference: "bootstrap.generation-tasks-images",
        observedAt: configuration.validatedAt.toISOString(),
        sourceDigest: configuration.endpointValidationDigest,
      },
    ],
  });
  const pricingDocument = parseProviderPricingDocumentV1({
    schemaVersion: 1,
    billingMode: "fixed",
    fixedChargeAmount: configuration.fixedChargeAmount,
    evidence: {
      priceVerified: true,
      sourceKind: "contract",
      sourceReference: configuration.fixedPricingEvidenceReference,
      observedAt: configuration.validatedAt.toISOString(),
      sourceDigest: configuration.fixedPricingEvidenceDigest,
    },
  });
  const endpointBaseUrl = configuration.apiOrigin;
  const definition = {
    endpointBaseUrl,
    endpointBaseUrlDigest: digestProviderValue({
      baseUrl: endpointBaseUrl,
    }),
    modelProfileDocument,
    modelProfileDigest: digestProviderValue(modelProfileDocument),
    modelDeploymentDigest: digestProviderValue({
      modelProfileRevisionId: ids.modelProfileRevision,
      providerModelId: configuration.providerModelId,
      apiSurface: "generation.tasks.v1",
    }),
    pricingDocument,
    pricingDigest: digestProviderValue(pricingDocument),
    pricingRevisionSourceKind: "contract",
    routePolicyDocument,
    routePolicyDigest: digestProviderValue(routePolicyDocument),
    secretAadDigest: secretAadDigestFor({
      instanceId: options.instanceId,
      workspaceId: options.workspaceId,
      credentialId: ids.credential,
      secretVersionId: ids.secretVersion,
      providerKind: configuration.presetKind,
      formatVersion: 1,
    }),
  } satisfies ImageProviderResourceDefinition;
  const spec: ImageProviderResourceSpec = {
    label: "Generation Tasks Images",
    ids,
    endpoint: {
      key: "generation-tasks-images-primary",
      adapterKind: "openai_compatible",
      presetKind: configuration.presetKind,
      canonicalOrigin: configuration.apiOrigin,
      regionCode: configuration.regionCode,
      networkPolicy: Object.freeze({
        tlsRequired: true,
        privateNetworksAllowed: configuration.regionCode === "private",
      }),
      dataPolicy: Object.freeze({
        externalEgress: true,
        sendsSourceImage: true,
        providerRetentionControlledExternally: true,
        asynchronousResultUrls: true,
      }),
    },
    credential: {
      key: "generation-tasks-images-primary",
      providerKind: configuration.presetKind,
      authority: `${configuration.presetKind}-api-key`,
      billingIdentity: `deployment-owned-${configuration.presetKind}-account`,
      egressIdentity: "kanvas-worker",
    },
    modelProfileKey: "generation-tasks-images",
    modelDeploymentKey: "generation-tasks-images-primary",
    pricingKey: "generation-tasks-images-usd",
    routeKey: "generation-tasks-images-edit-primary",
    budget: {
      key: "generation-tasks-images-development",
      hardLimitAmount: "20",
    },
    providerModelId: configuration.providerModelId,
    deploymentReference: configuration.deploymentReference,
    secretMaterialFingerprint: configuration.secretMaterialFingerprint,
    endpointValidationDigest: configuration.endpointValidationDigest,
    validatedAt: configuration.validatedAt,
  };
  return Object.freeze({
    ...definition,
    spec: Object.freeze(spec),
  });
}

export async function bootstrapGenerationTasksImagesControlPlane(
  connection: PoolConnection,
  options: {
    readonly actorId: string;
    readonly configuration: GenerationTasksImagesControlPlaneConfiguration;
    readonly instanceId: string;
    readonly workspaceId: string;
  },
): Promise<ImageProviderControlPlaneBootstrapResult> {
  const definition = buildGenerationTasksImagesControlPlaneDefinition(options);
  return bootstrapImageProviderResources(connection, {
    actorId: options.actorId,
    workspaceId: options.workspaceId,
    definition,
    spec: definition.spec,
  });
}
