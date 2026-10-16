import type {
  ProviderModelCapabilityKey,
  ProviderModelParameterPolicies,
} from "@kanvas/contracts/provider-model";

import { DomainError } from "../../../foundation/domain-error.js";
import { parseProviderModelParameterPolicies } from "../../configuration/provider-parameter-policy.js";

type CapabilityProviderModelOperation = Exclude<
  ProviderModelCapabilityKey,
  "text.generate"
>;

export type ProviderQueryMode =
  "client_request_id" | "provider_request_id" | "none";

interface ProviderRouteSnapshotCommon {
  readonly providerKey: string;
  readonly apiSurface: string;
  readonly providerEndpointId: string;
  readonly credentialIdentityId: string;
  readonly credentialIdentityEpoch: number;
  readonly modelDeploymentId?: string;
  readonly pricingRevisionId?: string;
  readonly routeCandidateDigest: string;
  readonly requestScopeDigest: string;
  readonly queryMode: ProviderQueryMode;
  readonly notFoundIsAuthoritative: boolean;
}

export interface ProviderMaximumCharge {
  readonly currencyCode: string;
  readonly amount: string;
}

export interface CurrentProviderRouteSnapshot extends ProviderRouteSnapshotCommon {
  readonly providerProtocolVersion: 1;
  readonly pinnedSecretVersionId: string;
  readonly credentialIdentityDigest: string;
  readonly instancePolicyRevisionId: string;
  readonly workspacePolicyRevisionId: string;
  readonly routePolicyRevisionId: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly budgetAccountId: string;
  readonly routingMode: "kanvas_fixed" | "gateway_managed";
  readonly executionTransparency: "full" | "partial" | "opaque";
  readonly maximumCharge: ProviderMaximumCharge;
  readonly modelOperation?: CapabilityProviderModelOperation;
  readonly parameterPolicies?: ProviderModelParameterPolicies;
  readonly parameterPolicyDigest?: string;
}

export type ProviderRouteSnapshot = CurrentProviderRouteSnapshot;

const commonProviderRouteKeys = [
  "providerProtocolVersion",
  "providerKey",
  "apiSurface",
  "providerEndpointId",
  "credentialIdentityId",
  "credentialIdentityEpoch",
  "modelDeploymentId",
  "pricingRevisionId",
  "routeCandidateDigest",
  "requestScopeDigest",
  "queryMode",
  "notFoundIsAuthoritative",
] as const;
const currentProviderRouteKeys = new Set([
  ...commonProviderRouteKeys,
  "pinnedSecretVersionId",
  "credentialIdentityDigest",
  "instancePolicyRevisionId",
  "workspacePolicyRevisionId",
  "routePolicyRevisionId",
  "modelProfileRevisionId",
  "budgetAccountId",
  "routingMode",
  "executionTransparency",
  "maximumCharge",
  "modelOperation",
  "parameterPolicies",
  "parameterPolicyDigest",
]);
const boundedIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const kanvasIdentity = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const canonicalDigest = /^sha256:[a-f0-9]{64}$/;
const moneyAmount = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const currencyCode = /^[A-Z]{3}$/;

function invalid(message: string): never {
  throw new DomainError("provider_route_snapshot.invalid", message);
}

function parseIdentifier(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    !boundedIdentifier.test(value)
  ) {
    return invalid(
      `${field} must be a 1-${maximumLength} character opaque identifier.`,
    );
  }
  return value;
}

function parseDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !canonicalDigest.test(value)) {
    return invalid(`${field} must be a canonical SHA-256 digest.`);
  }
  return value;
}

function parseModelOperation(value: unknown): CapabilityProviderModelOperation {
  if (value !== "image.generate" && value !== "image.edit") {
    return invalid("modelOperation must be image.generate or image.edit.");
  }
  return value;
}

function parseKanvasIdentity(value: unknown, field: string): string {
  if (typeof value !== "string" || !kanvasIdentity.test(value)) {
    return invalid(`${field} must be a 26-character Kanvas ULID.`);
  }
  return value;
}

function optionalKanvasIdentity(
  record: Readonly<Record<string, unknown>>,
  field: "modelDeploymentId" | "pricingRevisionId",
): string | undefined {
  const value = record[field];
  return value === undefined ? undefined : parseKanvasIdentity(value, field);
}

function assertPlainRecord(
  value: unknown,
  field: string,
): asserts value is Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid(`${field} must be a plain JSON object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    )
  ) {
    invalid(`${field} must contain only enumerable data properties.`);
  }
}

function parseMaximumCharge(value: unknown): ProviderMaximumCharge {
  assertPlainRecord(value, "maximumCharge");
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("currencyCode") ||
    !keys.includes("amount")
  ) {
    return invalid("maximumCharge must contain only currencyCode and amount.");
  }
  if (
    typeof value.currencyCode !== "string" ||
    !currencyCode.test(value.currencyCode) ||
    typeof value.amount !== "string" ||
    !moneyAmount.test(value.amount)
  ) {
    return invalid(
      "maximumCharge must use an ISO currency and unsigned fixed-point amount.",
    );
  }
  return Object.freeze({
    currencyCode: value.currencyCode,
    amount: value.amount,
  });
}

export function parseProviderRouteSnapshot(
  value: unknown,
): ProviderRouteSnapshot {
  assertPlainRecord(value, "Provider route snapshot");
  const record = value;
  const providerProtocolVersion = record.providerProtocolVersion;
  if (providerProtocolVersion !== 1) {
    return invalid("providerProtocolVersion must equal 1.");
  }
  const unknownKey = Object.keys(record).find(
    (key) => !currentProviderRouteKeys.has(key),
  );
  if (unknownKey) {
    return invalid(
      `Provider route snapshot contains unknown field ${unknownKey}.`,
    );
  }
  const credentialIdentityEpoch = record.credentialIdentityEpoch;
  if (
    typeof credentialIdentityEpoch !== "number" ||
    !Number.isSafeInteger(credentialIdentityEpoch) ||
    credentialIdentityEpoch < 1 ||
    credentialIdentityEpoch > 4_294_967_295
  ) {
    return invalid(
      "credentialIdentityEpoch must be an integer between 1 and 4294967295.",
    );
  }
  const queryMode = record.queryMode;
  if (
    queryMode !== "client_request_id" &&
    queryMode !== "provider_request_id" &&
    queryMode !== "none"
  ) {
    return invalid(
      "queryMode must be client_request_id, provider_request_id, or none.",
    );
  }
  if (typeof record.notFoundIsAuthoritative !== "boolean") {
    return invalid("notFoundIsAuthoritative must be a boolean.");
  }
  if (queryMode === "none" && record.notFoundIsAuthoritative) {
    return invalid(
      "notFoundIsAuthoritative cannot be true when queryMode is none.",
    );
  }

  const modelDeploymentId = optionalKanvasIdentity(record, "modelDeploymentId");
  const pricingRevisionId = optionalKanvasIdentity(record, "pricingRevisionId");

  const common = {
    providerKey: parseIdentifier(record.providerKey, "providerKey", 80),
    apiSurface: parseIdentifier(record.apiSurface, "apiSurface", 80),
    providerEndpointId: parseKanvasIdentity(
      record.providerEndpointId,
      "providerEndpointId",
    ),
    credentialIdentityId: parseKanvasIdentity(
      record.credentialIdentityId,
      "credentialIdentityId",
    ),
    credentialIdentityEpoch,
    ...(modelDeploymentId ? { modelDeploymentId } : {}),
    ...(pricingRevisionId ? { pricingRevisionId } : {}),
    routeCandidateDigest: parseDigest(
      record.routeCandidateDigest,
      "routeCandidateDigest",
    ),
    requestScopeDigest: parseDigest(
      record.requestScopeDigest,
      "requestScopeDigest",
    ),
    queryMode,
    notFoundIsAuthoritative: record.notFoundIsAuthoritative,
  } as const;
  const routingMode = record.routingMode;
  if (routingMode !== "kanvas_fixed" && routingMode !== "gateway_managed") {
    return invalid("routingMode must be kanvas_fixed or gateway_managed.");
  }
  const executionTransparency = record.executionTransparency;
  if (
    executionTransparency !== "full" &&
    executionTransparency !== "partial" &&
    executionTransparency !== "opaque"
  ) {
    return invalid("executionTransparency must be full, partial, or opaque.");
  }
  if (routingMode === "gateway_managed" && executionTransparency === "full") {
    return invalid(
      "A gateway-managed route cannot claim full execution transparency.",
    );
  }
  if (!modelDeploymentId || !pricingRevisionId) {
    return invalid(
      "Provider route requires modelDeploymentId and pricingRevisionId.",
    );
  }
  const hasModelOperation = record.modelOperation !== undefined;
  const hasParameterPolicies = record.parameterPolicies !== undefined;
  const hasParameterPolicyDigest = record.parameterPolicyDigest !== undefined;
  if (
    hasModelOperation !== hasParameterPolicies ||
    hasModelOperation !== hasParameterPolicyDigest
  ) {
    return invalid(
      "Provider route parameter policy facts must be supplied together.",
    );
  }
  const parameterFacts = hasModelOperation
    ? {
        modelOperation: parseModelOperation(record.modelOperation),
        parameterPolicies: parseProviderModelParameterPolicies(
          record.parameterPolicies,
        ),
        parameterPolicyDigest: parseDigest(
          record.parameterPolicyDigest,
          "parameterPolicyDigest",
        ),
      }
    : {};

  return Object.freeze({
    providerProtocolVersion: 1,
    ...common,
    modelDeploymentId,
    pricingRevisionId,
    pinnedSecretVersionId: parseKanvasIdentity(
      record.pinnedSecretVersionId,
      "pinnedSecretVersionId",
    ),
    credentialIdentityDigest: parseDigest(
      record.credentialIdentityDigest,
      "credentialIdentityDigest",
    ),
    instancePolicyRevisionId: parseKanvasIdentity(
      record.instancePolicyRevisionId,
      "instancePolicyRevisionId",
    ),
    workspacePolicyRevisionId: parseKanvasIdentity(
      record.workspacePolicyRevisionId,
      "workspacePolicyRevisionId",
    ),
    routePolicyRevisionId: parseKanvasIdentity(
      record.routePolicyRevisionId,
      "routePolicyRevisionId",
    ),
    modelProfileRevisionId: parseKanvasIdentity(
      record.modelProfileRevisionId,
      "modelProfileRevisionId",
    ),
    budgetAccountId: parseKanvasIdentity(
      record.budgetAccountId,
      "budgetAccountId",
    ),
    routingMode,
    executionTransparency,
    maximumCharge: parseMaximumCharge(record.maximumCharge),
    ...parameterFacts,
  });
}
