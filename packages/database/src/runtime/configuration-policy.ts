import { parseProviderModelParameterPolicies } from "@kanvas/application";
import type { ProviderModelParameterPolicies } from "@kanvas/contracts/provider-model";

import {
  decimalToUnits,
  minimumDecimal,
  normalizeUnsignedDecimal,
} from "./fixed-decimal.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const regionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const currencyPattern = /^[A-Z]{3}$/u;

export type ProviderAdapterKind =
  | "openai_native"
  | "openrouter_native"
  | "openai_compatible"
  | "gemini_native"
  | "anthropic_native";
export type ProviderPresetKind =
  | "none"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "xai"
  | "gemini"
  | "newapi"
  | "tokenhub";
export type ProviderRoutingMode = "kanvas_fixed" | "gateway_managed";
export type ProviderExecutionTransparency = "full" | "partial" | "opaque";
export type ProviderQueryMode =
  "client_request_id" | "provider_request_id" | "none";

export interface ProviderMoneyBound {
  readonly currencyCode: string;
  readonly amount: string;
}

export interface ProviderConstraintDocumentV1 {
  readonly allowedAdapterKinds?: readonly ProviderAdapterKind[];
  readonly allowedPresetKinds?: readonly ProviderPresetKind[];
  readonly allowedRegionCodes?: readonly string[];
  readonly deniedRegionCodes?: readonly string[];
  readonly allowedProviderEndpointIds?: readonly string[];
  readonly deniedProviderEndpointIds?: readonly string[];
  readonly allowedRoutingModes?: readonly ProviderRoutingMode[];
  readonly allowedExecutionTransparencies?: readonly ProviderExecutionTransparency[];
  readonly maximumCharge?: ProviderMoneyBound;
  readonly maxProviderRequestSeconds?: number;
}

export interface ProviderDeploymentHardBounds {
  readonly allowedAdapterKinds: readonly ProviderAdapterKind[];
  readonly allowedPresetKinds: readonly ProviderPresetKind[];
  readonly allowedRegionCodes: readonly string[];
  readonly deniedRegionCodes?: readonly string[];
  readonly allowedProviderEndpointIds?: readonly string[];
  readonly deniedProviderEndpointIds?: readonly string[];
  readonly allowedRoutingModes: readonly ProviderRoutingMode[];
  readonly allowedExecutionTransparencies: readonly ProviderExecutionTransparency[];
  readonly maximumCharge: ProviderMoneyBound;
  readonly maxProviderRequestSeconds: number;
}

export interface ProviderRoutePolicyDocumentV1 {
  readonly capabilityKey?: string;
  readonly parameterPolicies?: ProviderModelParameterPolicies;
  readonly providerKey: string;
  readonly apiSurface: string;
  readonly providerEndpointId: string;
  readonly credentialId: string;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly budgetAccountId: string;
  readonly routingMode: ProviderRoutingMode;
  readonly executionTransparency: ProviderExecutionTransparency;
  readonly maximumCharge: ProviderMoneyBound;
  readonly requestTimeoutSeconds: number;
  readonly queryMode: ProviderQueryMode;
  readonly notFoundIsAuthoritative: boolean;
  readonly constraints: ProviderConstraintDocumentV1;
}

export interface ResolvedProviderConstraints {
  readonly allowedAdapterKinds: readonly ProviderAdapterKind[];
  readonly allowedPresetKinds: readonly ProviderPresetKind[];
  readonly allowedRegionCodes: readonly string[];
  readonly deniedRegionCodes: readonly string[];
  readonly allowedProviderEndpointIds?: readonly string[];
  readonly deniedProviderEndpointIds: readonly string[];
  readonly allowedRoutingModes: readonly ProviderRoutingMode[];
  readonly allowedExecutionTransparencies: readonly ProviderExecutionTransparency[];
  readonly maximumCharge: ProviderMoneyBound;
  readonly maxProviderRequestSeconds: number;
}

export interface ProviderEndpointPolicyFacts {
  readonly id: string;
  readonly adapterKind: ProviderAdapterKind;
  readonly presetKind: ProviderPresetKind;
  readonly regionCode: string;
}

export type ConfigurationPolicyErrorCode =
  | "configuration_policy.invalid"
  | "configuration_policy.empty_intersection"
  | "configuration_policy.candidate_forbidden";

export class ConfigurationPolicyError extends Error {
  public constructor(
    public readonly code: ConfigurationPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConfigurationPolicyError";
  }
}

function fail(code: ConfigurationPolicyErrorCode, message: string): never {
  throw new ConfigurationPolicyError(code, message);
}

function invalid(message: string): never {
  return fail("configuration_policy.invalid", message);
}

function assertPlainRecord(
  value: unknown,
  label: string,
): asserts value is Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    invalid(`${label} must be a plain JSON object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    )
  ) {
    invalid(`${label} must contain enumerable data properties only.`);
  }
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) {
    invalid(`${label} contains unknown field ${unknown}.`);
  }
  const missing = [...required].find((key) => !Object.hasOwn(record, key));
  if (missing) {
    invalid(`${label} is missing required field ${missing}.`);
  }
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function parseStringSet<TValue extends string>(
  value: unknown,
  label: string,
  isAllowed: (candidate: string) => candidate is TValue,
): readonly TValue[] {
  if (!Array.isArray(value)) {
    invalid(`${label} must be an array.`);
  }
  const result = new Set<TValue>();
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      !isAllowed(candidate) ||
      result.has(candidate)
    ) {
      invalid(`${label} contains an invalid or duplicate value.`);
    }
    result.add(candidate);
  }
  return Object.freeze([...result].sort(compareText));
}

function optionalStringSet<TValue extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  isAllowed: (candidate: string) => candidate is TValue,
): readonly TValue[] | undefined {
  return Object.hasOwn(record, key)
    ? parseStringSet(record[key], `${label}.${key}`, isAllowed)
    : undefined;
}

function isAdapterKind(value: string): value is ProviderAdapterKind {
  return (
    value === "openai_native" ||
    value === "openrouter_native" ||
    value === "openai_compatible" ||
    value === "gemini_native" ||
    value === "anthropic_native"
  );
}

function isPresetKind(value: string): value is ProviderPresetKind {
  return (
    value === "none" ||
    value === "openai" ||
    value === "anthropic" ||
    value === "openrouter" ||
    value === "xai" ||
    value === "gemini" ||
    value === "newapi" ||
    value === "tokenhub"
  );
}

function isRoutingMode(value: string): value is ProviderRoutingMode {
  return value === "kanvas_fixed" || value === "gateway_managed";
}

function isTransparency(value: string): value is ProviderExecutionTransparency {
  return value === "full" || value === "partial" || value === "opaque";
}

function isRegion(value: string): value is string {
  return regionPattern.test(value);
}

function isId(value: string): value is string {
  return idPattern.test(value);
}

function parseMoney(value: unknown, label: string): ProviderMoneyBound {
  assertPlainRecord(value, label);
  assertExactKeys(
    value,
    new Set(["currencyCode", "amount"]),
    new Set(["currencyCode", "amount"]),
    label,
  );
  if (
    typeof value.currencyCode !== "string" ||
    !currencyPattern.test(value.currencyCode)
  ) {
    invalid(`${label}.currencyCode must be an ISO currency code.`);
  }
  return Object.freeze({
    currencyCode: value.currencyCode,
    amount: normalizeUnsignedDecimal(value.amount, `${label}.amount`),
  });
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 86_400
  ) {
    invalid(`${label} must be an integer between 1 and 86400.`);
  }
  return value;
}

const constraintKeys = new Set([
  "allowedAdapterKinds",
  "allowedPresetKinds",
  "allowedRegionCodes",
  "deniedRegionCodes",
  "allowedProviderEndpointIds",
  "deniedProviderEndpointIds",
  "allowedRoutingModes",
  "allowedExecutionTransparencies",
  "maximumCharge",
  "maxProviderRequestSeconds",
]);

export function parseProviderConstraintDocument(
  value: unknown,
  label = "Provider policy",
): ProviderConstraintDocumentV1 {
  assertPlainRecord(value, label);
  assertExactKeys(value, constraintKeys, new Set(), label);
  const allowedAdapterKinds = optionalStringSet(
    value,
    "allowedAdapterKinds",
    label,
    isAdapterKind,
  );
  const allowedPresetKinds = optionalStringSet(
    value,
    "allowedPresetKinds",
    label,
    isPresetKind,
  );
  const allowedRegionCodes = optionalStringSet(
    value,
    "allowedRegionCodes",
    label,
    isRegion,
  );
  const deniedRegionCodes = optionalStringSet(
    value,
    "deniedRegionCodes",
    label,
    isRegion,
  );
  const allowedProviderEndpointIds = optionalStringSet(
    value,
    "allowedProviderEndpointIds",
    label,
    isId,
  );
  const deniedProviderEndpointIds = optionalStringSet(
    value,
    "deniedProviderEndpointIds",
    label,
    isId,
  );
  const allowedRoutingModes = optionalStringSet(
    value,
    "allowedRoutingModes",
    label,
    isRoutingMode,
  );
  const allowedExecutionTransparencies = optionalStringSet(
    value,
    "allowedExecutionTransparencies",
    label,
    isTransparency,
  );
  return Object.freeze({
    ...(allowedAdapterKinds ? { allowedAdapterKinds } : {}),
    ...(allowedPresetKinds ? { allowedPresetKinds } : {}),
    ...(allowedRegionCodes ? { allowedRegionCodes } : {}),
    ...(deniedRegionCodes ? { deniedRegionCodes } : {}),
    ...(allowedProviderEndpointIds ? { allowedProviderEndpointIds } : {}),
    ...(deniedProviderEndpointIds ? { deniedProviderEndpointIds } : {}),
    ...(allowedRoutingModes ? { allowedRoutingModes } : {}),
    ...(allowedExecutionTransparencies
      ? { allowedExecutionTransparencies }
      : {}),
    ...(Object.hasOwn(value, "maximumCharge")
      ? {
          maximumCharge: parseMoney(
            value.maximumCharge,
            `${label}.maximumCharge`,
          ),
        }
      : {}),
    ...(Object.hasOwn(value, "maxProviderRequestSeconds")
      ? {
          maxProviderRequestSeconds: parsePositiveInteger(
            value.maxProviderRequestSeconds,
            `${label}.maxProviderRequestSeconds`,
          ),
        }
      : {}),
  });
}

export function parseProviderDeploymentHardBounds(
  value: unknown,
): ProviderDeploymentHardBounds {
  const parsed = parseProviderConstraintDocument(
    value,
    "Deployment hard bounds",
  );
  if (
    !parsed.allowedAdapterKinds ||
    !parsed.allowedPresetKinds ||
    !parsed.allowedRegionCodes ||
    !parsed.allowedRoutingModes ||
    !parsed.allowedExecutionTransparencies ||
    !parsed.maximumCharge ||
    parsed.maxProviderRequestSeconds === undefined
  ) {
    invalid(
      "Deployment hard bounds must define every core allowlist and upper bound.",
    );
  }
  return Object.freeze({
    allowedAdapterKinds: parsed.allowedAdapterKinds,
    allowedPresetKinds: parsed.allowedPresetKinds,
    allowedRegionCodes: parsed.allowedRegionCodes,
    ...(parsed.deniedRegionCodes
      ? { deniedRegionCodes: parsed.deniedRegionCodes }
      : {}),
    ...(parsed.allowedProviderEndpointIds
      ? {
          allowedProviderEndpointIds: parsed.allowedProviderEndpointIds,
        }
      : {}),
    ...(parsed.deniedProviderEndpointIds
      ? {
          deniedProviderEndpointIds: parsed.deniedProviderEndpointIds,
        }
      : {}),
    allowedRoutingModes: parsed.allowedRoutingModes,
    allowedExecutionTransparencies: parsed.allowedExecutionTransparencies,
    maximumCharge: parsed.maximumCharge,
    maxProviderRequestSeconds: parsed.maxProviderRequestSeconds,
  });
}

const routeKeys = new Set([
  "capabilityKey",
  "parameterPolicies",
  "providerKey",
  "apiSurface",
  "providerEndpointId",
  "credentialId",
  "modelDeploymentId",
  "pricingRevisionId",
  "budgetAccountId",
  "routingMode",
  "executionTransparency",
  "maximumCharge",
  "requestTimeoutSeconds",
  "queryMode",
  "notFoundIsAuthoritative",
  "constraints",
]);
const requiredRouteKeys = new Set(
  [...routeKeys].filter(
    (key) => key !== "capabilityKey" && key !== "parameterPolicies",
  ),
);

function parseIdentifier(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    !identifierPattern.test(value)
  ) {
    invalid(`${label} must be a bounded opaque identifier.`);
  }
  return value;
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
  return value;
}

export function parseProviderRoutePolicyDocument(
  value: unknown,
): ProviderRoutePolicyDocumentV1 {
  assertPlainRecord(value, "Route policy");
  assertExactKeys(value, routeKeys, requiredRouteKeys, "Route policy");
  const routingMode = value.routingMode;
  const executionTransparency = value.executionTransparency;
  const queryMode = value.queryMode;
  if (typeof routingMode !== "string" || !isRoutingMode(routingMode)) {
    invalid("Route policy routingMode is invalid.");
  }
  if (
    typeof executionTransparency !== "string" ||
    !isTransparency(executionTransparency)
  ) {
    invalid("Route policy executionTransparency is invalid.");
  }
  if (routingMode === "gateway_managed" && executionTransparency === "full") {
    invalid(
      "A gateway-managed route cannot claim full execution transparency.",
    );
  }
  if (
    queryMode !== "client_request_id" &&
    queryMode !== "provider_request_id" &&
    queryMode !== "none"
  ) {
    invalid("Route policy queryMode is invalid.");
  }
  if (
    typeof value.notFoundIsAuthoritative !== "boolean" ||
    (queryMode === "none" && value.notFoundIsAuthoritative)
  ) {
    invalid("Route policy notFoundIsAuthoritative is invalid.");
  }
  return Object.freeze({
    ...(value.capabilityKey === undefined
      ? {}
      : {
          capabilityKey: parseIdentifier(
            value.capabilityKey,
            "Route policy capabilityKey",
            160,
          ),
        }),
    ...(value.parameterPolicies === undefined
      ? {}
      : {
          parameterPolicies: parseProviderModelParameterPolicies(
            value.parameterPolicies,
          ),
        }),
    providerKey: parseIdentifier(
      value.providerKey,
      "Route policy providerKey",
      80,
    ),
    apiSurface: parseIdentifier(
      value.apiSurface,
      "Route policy apiSurface",
      80,
    ),
    providerEndpointId: parseId(
      value.providerEndpointId,
      "Route policy providerEndpointId",
    ),
    credentialId: parseId(value.credentialId, "Route policy credentialId"),
    modelDeploymentId: parseId(
      value.modelDeploymentId,
      "Route policy modelDeploymentId",
    ),
    pricingRevisionId: parseId(
      value.pricingRevisionId,
      "Route policy pricingRevisionId",
    ),
    budgetAccountId: parseId(
      value.budgetAccountId,
      "Route policy budgetAccountId",
    ),
    routingMode,
    executionTransparency,
    maximumCharge: parseMoney(
      value.maximumCharge,
      "Route policy maximumCharge",
    ),
    requestTimeoutSeconds: parsePositiveInteger(
      value.requestTimeoutSeconds,
      "Route policy requestTimeoutSeconds",
    ),
    queryMode,
    notFoundIsAuthoritative: value.notFoundIsAuthoritative,
    constraints: parseProviderConstraintDocument(
      value.constraints,
      "Route policy constraints",
    ),
  });
}

function intersect<TValue extends string>(
  current: readonly TValue[],
  next: readonly TValue[] | undefined,
): readonly TValue[] {
  if (!next) {
    return current;
  }
  const allowed = new Set(next);
  return Object.freeze(current.filter((candidate) => allowed.has(candidate)));
}

function union(
  values: readonly (readonly string[] | undefined)[],
): readonly string[] {
  return Object.freeze(
    [...new Set(values.flatMap((value) => (value ? [...value] : [])))].sort(
      compareText,
    ),
  );
}

function optionalIntersection(
  current: readonly string[] | undefined,
  next: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!current) {
    return next;
  }
  return next ? intersect(current, next) : current;
}

export function resolveProviderConstraintIntersection(
  deploymentValue: unknown,
  instance: ProviderConstraintDocumentV1,
  workspace: ProviderConstraintDocumentV1,
  route: ProviderConstraintDocumentV1,
): ResolvedProviderConstraints {
  const deployment = parseProviderDeploymentHardBounds(deploymentValue);
  const policies = [instance, workspace, route] as const;
  let allowedAdapterKinds = deployment.allowedAdapterKinds;
  let allowedPresetKinds = deployment.allowedPresetKinds;
  let allowedRegionCodes = deployment.allowedRegionCodes;
  let allowedProviderEndpointIds = deployment.allowedProviderEndpointIds;
  let allowedRoutingModes = deployment.allowedRoutingModes;
  let allowedExecutionTransparencies =
    deployment.allowedExecutionTransparencies;
  for (const policy of policies) {
    allowedAdapterKinds = intersect(
      allowedAdapterKinds,
      policy.allowedAdapterKinds,
    );
    allowedPresetKinds = intersect(
      allowedPresetKinds,
      policy.allowedPresetKinds,
    );
    allowedRegionCodes = intersect(
      allowedRegionCodes,
      policy.allowedRegionCodes,
    );
    allowedProviderEndpointIds = optionalIntersection(
      allowedProviderEndpointIds,
      policy.allowedProviderEndpointIds,
    );
    allowedRoutingModes = intersect(
      allowedRoutingModes,
      policy.allowedRoutingModes,
    );
    allowedExecutionTransparencies = intersect(
      allowedExecutionTransparencies,
      policy.allowedExecutionTransparencies,
    );
  }
  const deniedRegionCodes = union([
    deployment.deniedRegionCodes,
    instance.deniedRegionCodes,
    workspace.deniedRegionCodes,
    route.deniedRegionCodes,
  ]);
  const deniedProviderEndpointIds = union([
    deployment.deniedProviderEndpointIds,
    instance.deniedProviderEndpointIds,
    workspace.deniedProviderEndpointIds,
    route.deniedProviderEndpointIds,
  ]);
  const deniedRegions = new Set(deniedRegionCodes);
  const deniedEndpoints = new Set(deniedProviderEndpointIds);
  allowedRegionCodes = Object.freeze(
    allowedRegionCodes.filter((value) => !deniedRegions.has(value)),
  );
  if (allowedProviderEndpointIds) {
    allowedProviderEndpointIds = Object.freeze(
      allowedProviderEndpointIds.filter((value) => !deniedEndpoints.has(value)),
    );
  }
  const maximumChargeBounds = [
    deployment.maximumCharge,
    instance.maximumCharge,
    workspace.maximumCharge,
    route.maximumCharge,
  ].filter((value): value is ProviderMoneyBound => value !== undefined);
  const currencies = new Set(
    maximumChargeBounds.map(({ currencyCode }) => currencyCode),
  );
  if (currencies.size !== 1) {
    invalid("Provider policy maximum-charge currencies conflict.");
  }
  const maximumCharge = Object.freeze({
    currencyCode: maximumChargeBounds[0]?.currencyCode ?? "",
    amount: minimumDecimal(maximumChargeBounds.map(({ amount }) => amount)),
  });
  const maxProviderRequestSeconds = Math.min(
    deployment.maxProviderRequestSeconds,
    ...policies.map(
      (policy) =>
        policy.maxProviderRequestSeconds ??
        deployment.maxProviderRequestSeconds,
    ),
  );
  if (
    allowedAdapterKinds.length === 0 ||
    allowedPresetKinds.length === 0 ||
    allowedRegionCodes.length === 0 ||
    allowedRoutingModes.length === 0 ||
    allowedExecutionTransparencies.length === 0 ||
    allowedProviderEndpointIds?.length === 0
  ) {
    fail(
      "configuration_policy.empty_intersection",
      "Provider policy intersection denies every candidate.",
    );
  }
  return Object.freeze({
    allowedAdapterKinds,
    allowedPresetKinds,
    allowedRegionCodes,
    deniedRegionCodes,
    ...(allowedProviderEndpointIds ? { allowedProviderEndpointIds } : {}),
    deniedProviderEndpointIds,
    allowedRoutingModes,
    allowedExecutionTransparencies,
    maximumCharge,
    maxProviderRequestSeconds,
  });
}

export function assertProviderRouteAllowed(
  route: ProviderRoutePolicyDocumentV1,
  endpoint: ProviderEndpointPolicyFacts,
  constraints: ResolvedProviderConstraints,
): void {
  const endpointAllowlist = constraints.allowedProviderEndpointIds;
  if (
    route.providerEndpointId !== endpoint.id ||
    !constraints.allowedAdapterKinds.includes(endpoint.adapterKind) ||
    !constraints.allowedPresetKinds.includes(endpoint.presetKind) ||
    !constraints.allowedRegionCodes.includes(endpoint.regionCode) ||
    constraints.deniedRegionCodes.includes(endpoint.regionCode) ||
    (endpointAllowlist !== undefined &&
      !endpointAllowlist.includes(endpoint.id)) ||
    constraints.deniedProviderEndpointIds.includes(endpoint.id) ||
    !constraints.allowedRoutingModes.includes(route.routingMode) ||
    !constraints.allowedExecutionTransparencies.includes(
      route.executionTransparency,
    ) ||
    route.requestTimeoutSeconds > constraints.maxProviderRequestSeconds ||
    route.maximumCharge.currencyCode !==
      constraints.maximumCharge.currencyCode ||
    decimalToUnits(route.maximumCharge.amount) >
      decimalToUnits(constraints.maximumCharge.amount)
  ) {
    fail(
      "configuration_policy.candidate_forbidden",
      "Provider route candidate exceeds the resolved policy intersection.",
    );
  }
}
