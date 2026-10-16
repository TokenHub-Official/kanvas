import type { PoolConnection } from "mysql2/promise";

import {
  buildUnverifiedProviderPricingDocumentV1,
  parseModelProfileDocumentV1,
} from "@kanvas/application";
import { parseProviderRoutePolicyDocument } from "../runtime/configuration-policy.js";
import { digestProviderValue } from "../runtime/provider-value-digest.js";
import { secretAadDigestFor } from "../runtime/secret-version-store.js";
import {
  bootstrapImageProviderResources,
  type ImageProviderControlPlaneBootstrapResult,
  type ImageProviderResourceDefinition,
  type ImageProviderResourceSpec,
} from "./bootstrap-image-provider-resources.js";
import {
  imageProviderSharedPolicyIds,
  openAiImagesResourceIds,
} from "./image-provider-control-plane-ids.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const deploymentReferencePattern =
  /^deployment:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{0,479}$/u;
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export const openAiImagesControlPlaneIds = Object.freeze({
  ...imageProviderSharedPolicyIds,
  ...openAiImagesResourceIds,
});

export interface OpenAiImagesControlPlaneConfiguration {
  readonly deploymentReference: string;
  readonly endpointValidationDigest: string;
  readonly providerModelId: string;
  readonly secretMaterialFingerprint: string;
  readonly validatedAt: Date;
}

export interface OpenAiImagesControlPlaneDefinition extends ImageProviderResourceDefinition {
  readonly spec: ImageProviderResourceSpec;
}

export type OpenAiImagesControlPlaneBootstrapResult =
  ImageProviderControlPlaneBootstrapResult;

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required when OpenAI Images control-plane bootstrap is enabled.`,
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

function assertDigest(value: string, name: string): void {
  if (!digestPattern.test(value)) {
    throw new Error(`${name} must be a canonical SHA-256 digest.`);
  }
}

export function loadOpenAiImagesControlPlaneConfiguration(
  environment: NodeJS.ProcessEnv,
): OpenAiImagesControlPlaneConfiguration | undefined {
  const enabled =
    environment.KANVAS_OPENAI_IMAGES_CONTROL_PLANE_ENABLED?.trim();
  if (!enabled || enabled === "false") {
    return undefined;
  }
  if (enabled !== "true") {
    throw new Error(
      "KANVAS_OPENAI_IMAGES_CONTROL_PLANE_ENABLED must be true or false.",
    );
  }
  const deploymentReference = required(
    environment,
    "KANVAS_OPENAI_IMAGES_DEPLOYMENT_REFERENCE",
  );
  const secretMaterialFingerprint = required(
    environment,
    "KANVAS_OPENAI_IMAGES_SECRET_FINGERPRINT",
  );
  const endpointValidationDigest = required(
    environment,
    "KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATION_DIGEST",
  );
  const validatedAt = parseDate(
    required(environment, "KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATED_AT"),
    "KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATED_AT",
  );
  const providerModelId =
    environment.KANVAS_OPENAI_IMAGES_MODEL_ID?.trim() || "gpt-image-1.5";
  if (!deploymentReferencePattern.test(deploymentReference)) {
    throw new Error(
      "KANVAS_OPENAI_IMAGES_DEPLOYMENT_REFERENCE must be a bounded deployment:// reference.",
    );
  }
  assertDigest(
    secretMaterialFingerprint,
    "KANVAS_OPENAI_IMAGES_SECRET_FINGERPRINT",
  );
  assertDigest(
    endpointValidationDigest,
    "KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATION_DIGEST",
  );
  if (!modelIdPattern.test(providerModelId)) {
    throw new Error(
      "KANVAS_OPENAI_IMAGES_MODEL_ID is not a bounded Provider model identifier.",
    );
  }
  return Object.freeze({
    deploymentReference,
    secretMaterialFingerprint,
    endpointValidationDigest,
    validatedAt,
    providerModelId,
  });
}

export function buildOpenAiImagesControlPlaneDefinition(options: {
  readonly configuration: OpenAiImagesControlPlaneConfiguration;
  readonly instanceId: string;
  readonly workspaceId: string;
}): OpenAiImagesControlPlaneDefinition {
  const { configuration } = options;
  const ids = openAiImagesResourceIds;
  const endpointBaseUrl = "https://api.openai.com/v1";
  const maximumCharge = Object.freeze({
    currencyCode: "USD",
    amount: "2",
  });
  const routeConstraints = Object.freeze({
    allowedAdapterKinds: Object.freeze(["openai_native"]),
    allowedPresetKinds: Object.freeze(["openai"]),
    allowedRegionCodes: Object.freeze(["global"]),
    allowedProviderEndpointIds: Object.freeze([ids.endpoint]),
    allowedRoutingModes: Object.freeze(["kanvas_fixed"]),
    allowedExecutionTransparencies: Object.freeze(["full"]),
    maximumCharge,
    maxProviderRequestSeconds: 180,
  });
  const routePolicyDocument = parseProviderRoutePolicyDocument({
    providerKey: "openai",
    apiSurface: "images.edits.v1",
    providerEndpointId: ids.endpoint,
    credentialId: ids.credential,
    modelDeploymentId: ids.modelDeployment,
    pricingRevisionId: ids.pricingRevision,
    budgetAccountId: ids.budgetAccount,
    routingMode: "kanvas_fixed",
    executionTransparency: "full",
    maximumCharge,
    requestTimeoutSeconds: 180,
    queryMode: "none",
    notFoundIsAuthoritative: false,
    constraints: routeConstraints,
  });
  const capabilityEvidence = Object.freeze([
    Object.freeze({
      kind: "administrator" as const,
      reference: "bootstrap.openai-images",
      observedAt: configuration.validatedAt.toISOString(),
      sourceDigest: configuration.endpointValidationDigest,
      confidence: "high" as const,
      claim: "supported" as const,
    }),
  ]);
  const modelProfileDocument = parseModelProfileDocumentV1({
    schemaVersion: 1,
    model: {
      displayName: "OpenAI Images",
      family: "gpt-image",
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
    },
    operations: {
      "image.edit": {
        parameters: [],
        evidence: capabilityEvidence,
      },
    },
    sources: [
      {
        kind: "manual",
        reference: "bootstrap.openai-images",
        observedAt: configuration.validatedAt.toISOString(),
        sourceDigest: configuration.endpointValidationDigest,
      },
    ],
  });
  const pricingDocument = buildUnverifiedProviderPricingDocumentV1(
    "provider_price_evidence_missing",
  );
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
      apiSurface: "images.edits.v1",
    }),
    pricingDocument,
    pricingDigest: digestProviderValue(pricingDocument),
    pricingRevisionSourceKind: "unverified",
    routePolicyDocument,
    routePolicyDigest: digestProviderValue(routePolicyDocument),
    secretAadDigest: secretAadDigestFor({
      instanceId: options.instanceId,
      workspaceId: options.workspaceId,
      credentialId: ids.credential,
      secretVersionId: ids.secretVersion,
      providerKind: "openai",
      formatVersion: 1,
    }),
  } satisfies ImageProviderResourceDefinition;
  const spec: ImageProviderResourceSpec = {
    label: "OpenAI Images",
    ids,
    endpoint: {
      key: "openai-images-primary",
      adapterKind: "openai_native",
      presetKind: "openai",
      canonicalOrigin: "https://api.openai.com",
      regionCode: "global",
      networkPolicy: Object.freeze({
        tlsRequired: true,
        privateNetworksAllowed: false,
      }),
      dataPolicy: Object.freeze({
        externalEgress: true,
        sendsSourceImage: true,
        providerRetentionControlledExternally: true,
        asynchronousResultUrls: false,
      }),
    },
    credential: {
      key: "openai-images-primary",
      providerKind: "openai",
      authority: "openai-api-project",
      billingIdentity: "deployment-owned-openai-project",
      egressIdentity: "kanvas-worker",
    },
    modelProfileKey: "openai-images",
    modelDeploymentKey: "openai-images-primary",
    pricingKey: "openai-images-usd",
    routeKey: "openai-images-edit-primary",
    budget: {
      key: "openai-images-development",
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

export async function bootstrapOpenAiImagesControlPlane(
  connection: PoolConnection,
  options: {
    readonly actorId: string;
    readonly configuration: OpenAiImagesControlPlaneConfiguration;
    readonly instanceId: string;
    readonly workspaceId: string;
  },
): Promise<OpenAiImagesControlPlaneBootstrapResult> {
  const definition = buildOpenAiImagesControlPlaneDefinition(options);
  return bootstrapImageProviderResources(connection, {
    actorId: options.actorId,
    workspaceId: options.workspaceId,
    definition,
    spec: definition.spec,
  });
}
