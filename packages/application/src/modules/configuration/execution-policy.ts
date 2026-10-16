import { DomainError } from "../../foundation/domain-error.js";

export type ExecutionTransparency = "opaque" | "partial" | "full";
export type ProviderRoutingMode = "kanvas_fixed" | "gateway_managed";

export interface ProviderPolicyConstraints {
  readonly allowedAdapterKinds?: readonly string[];
  readonly allowedProviderKinds?: readonly string[];
  readonly allowedRoutingModes?: readonly ProviderRoutingMode[];
  readonly deniedEndpointIds?: readonly string[];
  readonly deniedModelDeploymentIds?: readonly string[];
  readonly minimumExecutionTransparency?: ExecutionTransparency;
}

export interface EgressPolicyConstraints {
  readonly allowedRegionCodes?: readonly string[];
  readonly allowedDataClassifications?: readonly string[];
  readonly allowPrivateEndpoints?: boolean;
  readonly allowProviderRetention?: boolean;
}

export interface ResourcePolicyConstraints {
  readonly maximumRequestDurationMs?: number;
  readonly maximumInputBytes?: number;
  readonly maximumOutputBytes?: number;
}

export interface CurrencyMaximumCharge {
  readonly currencyCode: string;
  readonly amount: string;
}

export interface CostPolicyConstraints {
  readonly allowedCurrencyCodes?: readonly string[];
  readonly maximumCharges?: readonly CurrencyMaximumCharge[];
  readonly requireKnownPricing?: boolean;
  readonly requireKnownMaximumCharge?: boolean;
}

export interface ExecutionPolicyDocumentV1 {
  readonly schemaVersion: 1;
  readonly provider: ProviderPolicyConstraints;
  readonly egress: EgressPolicyConstraints;
  readonly resources: ResourcePolicyConstraints;
  readonly cost: CostPolicyConstraints;
}

export interface EffectiveExecutionPolicy {
  readonly schemaVersion: 1;
  readonly provider: {
    readonly allowedAdapterKinds?: readonly string[];
    readonly allowedProviderKinds?: readonly string[];
    readonly allowedRoutingModes?: readonly ProviderRoutingMode[];
    readonly deniedEndpointIds: readonly string[];
    readonly deniedModelDeploymentIds: readonly string[];
    readonly minimumExecutionTransparency: ExecutionTransparency;
  };
  readonly egress: {
    readonly allowedRegionCodes?: readonly string[];
    readonly allowedDataClassifications?: readonly string[];
    readonly allowPrivateEndpoints: boolean;
    readonly allowProviderRetention: boolean;
  };
  readonly resources: ResourcePolicyConstraints;
  readonly cost: {
    readonly allowedCurrencyCodes?: readonly string[];
    readonly maximumCharges: readonly CurrencyMaximumCharge[];
    readonly requireKnownPricing: boolean;
    readonly requireKnownMaximumCharge: boolean;
  };
}

export interface ProviderCandidatePolicyFacts {
  readonly adapterKind: string;
  readonly providerKind: string;
  readonly endpointId: string;
  readonly modelDeploymentId: string;
  readonly routingMode: ProviderRoutingMode;
  readonly executionTransparency: ExecutionTransparency;
  readonly regionCode: string;
  readonly dataClassification: string;
  readonly privateEndpoint: boolean;
  readonly providerRetention: boolean;
  readonly requestDurationMs: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly pricingKnown: boolean;
  readonly maximumCharge?: CurrencyMaximumCharge;
}

export type ProviderCandidatePolicyDenialCode =
  | "policy.adapter_not_allowed"
  | "policy.provider_not_allowed"
  | "policy.routing_mode_not_allowed"
  | "policy.endpoint_denied"
  | "policy.model_deployment_denied"
  | "policy.transparency_insufficient"
  | "policy.region_not_allowed"
  | "policy.data_classification_not_allowed"
  | "policy.private_endpoint_denied"
  | "policy.provider_retention_denied"
  | "policy.request_duration_exceeded"
  | "policy.input_size_exceeded"
  | "policy.output_size_exceeded"
  | "policy.pricing_unknown"
  | "policy.maximum_charge_unknown"
  | "policy.currency_not_allowed"
  | "policy.maximum_charge_exceeded";

export interface ProviderCandidatePolicyDecision {
  readonly effect: "allow" | "deny";
  readonly reasons: readonly ProviderCandidatePolicyDenialCode[];
}

const topLevelKeys = new Set([
  "schemaVersion",
  "provider",
  "egress",
  "resources",
  "cost",
]);
const providerKeys = new Set([
  "allowedAdapterKinds",
  "allowedProviderKinds",
  "allowedRoutingModes",
  "deniedEndpointIds",
  "deniedModelDeploymentIds",
  "minimumExecutionTransparency",
]);
const egressKeys = new Set([
  "allowedRegionCodes",
  "allowedDataClassifications",
  "allowPrivateEndpoints",
  "allowProviderRetention",
]);
const resourceKeys = new Set([
  "maximumRequestDurationMs",
  "maximumInputBytes",
  "maximumOutputBytes",
]);
const costKeys = new Set([
  "allowedCurrencyCodes",
  "maximumCharges",
  "requireKnownPricing",
  "requireKnownMaximumCharge",
]);
const currencyMaximumKeys = new Set(["currencyCode", "amount"]);
const routingModes = new Set<ProviderRoutingMode>([
  "kanvas_fixed",
  "gateway_managed",
]);
const transparencies = new Set<ExecutionTransparency>([
  "opaque",
  "partial",
  "full",
]);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const regionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const currencyPattern = /^[A-Z]{3}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const maximumSetEntries = 128;

function invalid(message: string): never {
  throw new DomainError("execution_policy.invalid", message);
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
    invalid(`${field} must contain enumerable data properties only.`);
  }
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
  field: string,
): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) {
    invalid(`${field} contains unknown field ${unknown}.`);
  }
}

function optionalBoolean(
  value: Readonly<Record<string, unknown>>,
  key: string,
  field: string,
): boolean | undefined {
  const candidate = value[key];
  if (candidate === undefined) {
    return undefined;
  }
  if (typeof candidate !== "boolean") {
    invalid(`${field}.${key} must be a boolean.`);
  }
  return candidate;
}

function optionalPositiveInteger(
  value: Readonly<Record<string, unknown>>,
  key: string,
  field: string,
): number | undefined {
  const candidate = value[key];
  if (candidate === undefined) {
    return undefined;
  }
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1
  ) {
    invalid(`${field}.${key} must be a positive safe integer.`);
  }
  return candidate;
}

function optionalStringSet<T extends string>(
  value: Readonly<Record<string, unknown>>,
  key: string,
  field: string,
  validate: (candidate: string) => candidate is T,
): readonly T[] | undefined {
  const candidate = value[key];
  if (candidate === undefined) {
    return undefined;
  }
  if (!Array.isArray(candidate) || candidate.length > maximumSetEntries) {
    invalid(
      `${field}.${key} must be an array with at most ${maximumSetEntries} entries.`,
    );
  }
  const result = new Set<T>();
  for (const entry of candidate) {
    if (typeof entry !== "string" || !validate(entry)) {
      invalid(`${field}.${key} contains an invalid value.`);
    }
    if (result.has(entry)) {
      invalid(`${field}.${key} contains a duplicate value.`);
    }
    result.add(entry);
  }
  return Object.freeze([...result].sort());
}

function isIdentifier(value: string): value is string {
  return identifierPattern.test(value);
}

function isRegion(value: string): value is string {
  return regionPattern.test(value);
}

function isCurrency(value: string): value is string {
  return currencyPattern.test(value);
}

function isRoutingMode(value: string): value is ProviderRoutingMode {
  return routingModes.has(value as ProviderRoutingMode);
}

function parseProvider(value: unknown): ProviderPolicyConstraints {
  assertPlainRecord(value, "provider");
  rejectUnknownKeys(value, providerKeys, "provider");
  const minimumExecutionTransparency = value.minimumExecutionTransparency;
  if (
    minimumExecutionTransparency !== undefined &&
    (typeof minimumExecutionTransparency !== "string" ||
      !transparencies.has(
        minimumExecutionTransparency as ExecutionTransparency,
      ))
  ) {
    invalid(
      "provider.minimumExecutionTransparency must be opaque, partial, or full.",
    );
  }
  const allowedAdapterKinds = optionalStringSet(
    value,
    "allowedAdapterKinds",
    "provider",
    isIdentifier,
  );
  const allowedProviderKinds = optionalStringSet(
    value,
    "allowedProviderKinds",
    "provider",
    isIdentifier,
  );
  const allowedRoutingModes = optionalStringSet(
    value,
    "allowedRoutingModes",
    "provider",
    isRoutingMode,
  );
  const deniedEndpointIds = optionalStringSet(
    value,
    "deniedEndpointIds",
    "provider",
    isIdentifier,
  );
  const deniedModelDeploymentIds = optionalStringSet(
    value,
    "deniedModelDeploymentIds",
    "provider",
    isIdentifier,
  );
  return Object.freeze({
    ...(allowedAdapterKinds !== undefined ? { allowedAdapterKinds } : {}),
    ...(allowedProviderKinds !== undefined ? { allowedProviderKinds } : {}),
    ...(allowedRoutingModes !== undefined ? { allowedRoutingModes } : {}),
    ...(deniedEndpointIds !== undefined ? { deniedEndpointIds } : {}),
    ...(deniedModelDeploymentIds !== undefined
      ? { deniedModelDeploymentIds }
      : {}),
    ...(minimumExecutionTransparency !== undefined
      ? {
          minimumExecutionTransparency:
            minimumExecutionTransparency as ExecutionTransparency,
        }
      : {}),
  });
}

function parseEgress(value: unknown): EgressPolicyConstraints {
  assertPlainRecord(value, "egress");
  rejectUnknownKeys(value, egressKeys, "egress");
  const allowedRegionCodes = optionalStringSet(
    value,
    "allowedRegionCodes",
    "egress",
    isRegion,
  );
  const allowedDataClassifications = optionalStringSet(
    value,
    "allowedDataClassifications",
    "egress",
    isIdentifier,
  );
  const allowPrivateEndpoints = optionalBoolean(
    value,
    "allowPrivateEndpoints",
    "egress",
  );
  const allowProviderRetention = optionalBoolean(
    value,
    "allowProviderRetention",
    "egress",
  );
  return Object.freeze({
    ...(allowedRegionCodes !== undefined ? { allowedRegionCodes } : {}),
    ...(allowedDataClassifications !== undefined
      ? { allowedDataClassifications }
      : {}),
    ...(allowPrivateEndpoints !== undefined ? { allowPrivateEndpoints } : {}),
    ...(allowProviderRetention !== undefined ? { allowProviderRetention } : {}),
  });
}

function parseResources(value: unknown): ResourcePolicyConstraints {
  assertPlainRecord(value, "resources");
  rejectUnknownKeys(value, resourceKeys, "resources");
  const maximumRequestDurationMs = optionalPositiveInteger(
    value,
    "maximumRequestDurationMs",
    "resources",
  );
  const maximumInputBytes = optionalPositiveInteger(
    value,
    "maximumInputBytes",
    "resources",
  );
  const maximumOutputBytes = optionalPositiveInteger(
    value,
    "maximumOutputBytes",
    "resources",
  );
  return Object.freeze({
    ...(maximumRequestDurationMs !== undefined
      ? { maximumRequestDurationMs }
      : {}),
    ...(maximumInputBytes !== undefined ? { maximumInputBytes } : {}),
    ...(maximumOutputBytes !== undefined ? { maximumOutputBytes } : {}),
  });
}

function parseMaximumCharges(
  value: unknown,
): readonly CurrencyMaximumCharge[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > maximumSetEntries) {
    invalid(
      `cost.maximumCharges must be an array with at most ${maximumSetEntries} entries.`,
    );
  }
  const charges = new Map<string, CurrencyMaximumCharge>();
  for (const entry of value) {
    assertPlainRecord(entry, "cost.maximumCharges[]");
    rejectUnknownKeys(entry, currencyMaximumKeys, "cost.maximumCharges[]");
    if (
      typeof entry.currencyCode !== "string" ||
      !currencyPattern.test(entry.currencyCode) ||
      typeof entry.amount !== "string" ||
      !decimalPattern.test(entry.amount)
    ) {
      invalid(
        "cost.maximumCharges entries require an ISO currency and unsigned fixed-point amount.",
      );
    }
    if (charges.has(entry.currencyCode)) {
      invalid(
        `cost.maximumCharges contains duplicate currency ${entry.currencyCode}.`,
      );
    }
    charges.set(
      entry.currencyCode,
      Object.freeze({
        currencyCode: entry.currencyCode,
        amount: entry.amount,
      }),
    );
  }
  return Object.freeze(
    [...charges.values()].sort((left, right) =>
      left.currencyCode.localeCompare(right.currencyCode),
    ),
  );
}

function parseCost(value: unknown): CostPolicyConstraints {
  assertPlainRecord(value, "cost");
  rejectUnknownKeys(value, costKeys, "cost");
  const allowedCurrencyCodes = optionalStringSet(
    value,
    "allowedCurrencyCodes",
    "cost",
    isCurrency,
  );
  const maximumCharges = parseMaximumCharges(value.maximumCharges);
  const requireKnownPricing = optionalBoolean(
    value,
    "requireKnownPricing",
    "cost",
  );
  const requireKnownMaximumCharge = optionalBoolean(
    value,
    "requireKnownMaximumCharge",
    "cost",
  );
  if (
    allowedCurrencyCodes &&
    maximumCharges?.some(
      (charge) => !allowedCurrencyCodes.includes(charge.currencyCode),
    )
  ) {
    invalid(
      "cost.maximumCharges cannot name a currency excluded by allowedCurrencyCodes.",
    );
  }
  return Object.freeze({
    ...(allowedCurrencyCodes !== undefined ? { allowedCurrencyCodes } : {}),
    ...(maximumCharges !== undefined ? { maximumCharges } : {}),
    ...(requireKnownPricing !== undefined ? { requireKnownPricing } : {}),
    ...(requireKnownMaximumCharge !== undefined
      ? { requireKnownMaximumCharge }
      : {}),
  });
}

export function parseExecutionPolicyDocument(
  value: unknown,
): ExecutionPolicyDocumentV1 {
  assertPlainRecord(value, "Execution policy");
  rejectUnknownKeys(value, topLevelKeys, "Execution policy");
  if (value.schemaVersion !== 1) {
    invalid("Execution policy schemaVersion must equal 1.");
  }
  return Object.freeze({
    schemaVersion: 1,
    provider: parseProvider(value.provider),
    egress: parseEgress(value.egress),
    resources: parseResources(value.resources),
    cost: parseCost(value.cost),
  });
}

function intersectOptionalSets<T extends string>(
  sets: readonly (readonly T[] | undefined)[],
): readonly T[] | undefined {
  const constrained = sets.filter(
    (set): set is readonly T[] => set !== undefined,
  );
  if (constrained.length === 0) {
    return undefined;
  }
  const [first, ...rest] = constrained;
  return Object.freeze(
    (first ?? [])
      .filter((value) => rest.every((set) => set.includes(value)))
      .sort(),
  );
}

function unionSets(
  sets: readonly (readonly string[] | undefined)[],
): readonly string[] {
  return Object.freeze([...new Set(sets.flatMap((set) => set ?? []))].sort());
}

function minimumOptionalInteger(
  values: readonly (number | undefined)[],
): number | undefined {
  const constrained = values.filter(
    (value): value is number => value !== undefined,
  );
  return constrained.length === 0 ? undefined : Math.min(...constrained);
}

function decimalParts(value: string): {
  readonly integer: string;
  readonly fraction: string;
} {
  const [integer = "0", fraction = ""] = value.split(".");
  return { integer, fraction };
}

export function compareUnsignedDecimal(
  left: string,
  right: string,
): -1 | 0 | 1 {
  if (!decimalPattern.test(left) || !decimalPattern.test(right)) {
    invalid("Decimal comparison requires canonical unsigned amounts.");
  }
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  if (leftParts.integer.length !== rightParts.integer.length) {
    return leftParts.integer.length < rightParts.integer.length ? -1 : 1;
  }
  if (leftParts.integer !== rightParts.integer) {
    return leftParts.integer < rightParts.integer ? -1 : 1;
  }
  const width = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftFraction = leftParts.fraction.padEnd(width, "0");
  const rightFraction = rightParts.fraction.padEnd(width, "0");
  if (leftFraction === rightFraction) {
    return 0;
  }
  return leftFraction < rightFraction ? -1 : 1;
}

function minimumCharge(
  layers: readonly ExecutionPolicyDocumentV1[],
  currencyCode: string,
): CurrencyMaximumCharge | undefined {
  const amounts = layers.flatMap(
    (layer) =>
      layer.cost.maximumCharges
        ?.filter((charge) => charge.currencyCode === currencyCode)
        .map((charge) => charge.amount) ?? [],
  );
  if (amounts.length === 0) {
    return undefined;
  }
  const amount = amounts.reduce((current, candidate) =>
    compareUnsignedDecimal(candidate, current) < 0 ? candidate : current,
  );
  return Object.freeze({ currencyCode, amount });
}

const transparencyRank: Readonly<Record<ExecutionTransparency, number>> =
  Object.freeze({
    opaque: 0,
    partial: 1,
    full: 2,
  });

function strongestTransparency(
  layers: readonly ExecutionPolicyDocumentV1[],
): ExecutionTransparency {
  return layers.reduce<ExecutionTransparency>((current, layer) => {
    const candidate = layer.provider.minimumExecutionTransparency ?? "opaque";
    return transparencyRank[candidate] > transparencyRank[current]
      ? candidate
      : current;
  }, "opaque");
}

/**
 * The caller must order layers Deployment -> Instance -> Workspace -> Route.
 * The operation is commutative for every security constraint; order is
 * accepted only to make the authority chain explicit at call sites.
 */
export function intersectExecutionPolicies(
  layers: readonly ExecutionPolicyDocumentV1[],
): EffectiveExecutionPolicy {
  if (layers.length < 1 || layers.length > 4) {
    invalid("Execution policy intersection requires one to four layers.");
  }
  const allowedCurrencyCodes = intersectOptionalSets(
    layers.map((layer) => layer.cost.allowedCurrencyCodes),
  );
  const chargeCurrencies = new Set(
    layers.flatMap(
      (layer) =>
        layer.cost.maximumCharges?.map((charge) => charge.currencyCode) ?? [],
    ),
  );
  const maximumCharges = Object.freeze(
    [...chargeCurrencies]
      .filter(
        (currencyCode) =>
          allowedCurrencyCodes === undefined ||
          allowedCurrencyCodes.includes(currencyCode),
      )
      .sort()
      .flatMap((currencyCode) => {
        const charge = minimumCharge(layers, currencyCode);
        return charge ? [charge] : [];
      }),
  );
  const maximumRequestDurationMs = minimumOptionalInteger(
    layers.map((layer) => layer.resources.maximumRequestDurationMs),
  );
  const maximumInputBytes = minimumOptionalInteger(
    layers.map((layer) => layer.resources.maximumInputBytes),
  );
  const maximumOutputBytes = minimumOptionalInteger(
    layers.map((layer) => layer.resources.maximumOutputBytes),
  );
  const allowedAdapterKinds = intersectOptionalSets(
    layers.map((layer) => layer.provider.allowedAdapterKinds),
  );
  const allowedProviderKinds = intersectOptionalSets(
    layers.map((layer) => layer.provider.allowedProviderKinds),
  );
  const allowedRoutingModes = intersectOptionalSets(
    layers.map((layer) => layer.provider.allowedRoutingModes),
  );
  const allowedRegionCodes = intersectOptionalSets(
    layers.map((layer) => layer.egress.allowedRegionCodes),
  );
  const allowedDataClassifications = intersectOptionalSets(
    layers.map((layer) => layer.egress.allowedDataClassifications),
  );
  const resources = Object.freeze({
    ...(maximumRequestDurationMs !== undefined
      ? { maximumRequestDurationMs }
      : {}),
    ...(maximumInputBytes !== undefined ? { maximumInputBytes } : {}),
    ...(maximumOutputBytes !== undefined ? { maximumOutputBytes } : {}),
  });
  return Object.freeze({
    schemaVersion: 1,
    provider: Object.freeze({
      ...(allowedAdapterKinds !== undefined ? { allowedAdapterKinds } : {}),
      ...(allowedProviderKinds !== undefined ? { allowedProviderKinds } : {}),
      ...(allowedRoutingModes !== undefined ? { allowedRoutingModes } : {}),
      deniedEndpointIds: unionSets(
        layers.map((layer) => layer.provider.deniedEndpointIds),
      ),
      deniedModelDeploymentIds: unionSets(
        layers.map((layer) => layer.provider.deniedModelDeploymentIds),
      ),
      minimumExecutionTransparency: strongestTransparency(layers),
    }),
    egress: Object.freeze({
      ...(allowedRegionCodes !== undefined ? { allowedRegionCodes } : {}),
      ...(allowedDataClassifications !== undefined
        ? { allowedDataClassifications }
        : {}),
      allowPrivateEndpoints: layers.every(
        (layer) => layer.egress.allowPrivateEndpoints !== false,
      ),
      allowProviderRetention: layers.every(
        (layer) => layer.egress.allowProviderRetention !== false,
      ),
    }),
    resources,
    cost: Object.freeze({
      ...(allowedCurrencyCodes !== undefined ? { allowedCurrencyCodes } : {}),
      maximumCharges,
      requireKnownPricing: layers.some(
        (layer) => layer.cost.requireKnownPricing === true,
      ),
      requireKnownMaximumCharge: layers.some(
        (layer) => layer.cost.requireKnownMaximumCharge === true,
      ),
    }),
  });
}

function setDenies(
  allowed: readonly string[] | undefined,
  value: string,
): boolean {
  return allowed !== undefined && !allowed.includes(value);
}

export function evaluateProviderCandidatePolicy(
  policy: EffectiveExecutionPolicy,
  facts: ProviderCandidatePolicyFacts,
): ProviderCandidatePolicyDecision {
  const reasons: ProviderCandidatePolicyDenialCode[] = [];
  if (setDenies(policy.provider.allowedAdapterKinds, facts.adapterKind)) {
    reasons.push("policy.adapter_not_allowed");
  }
  if (setDenies(policy.provider.allowedProviderKinds, facts.providerKind)) {
    reasons.push("policy.provider_not_allowed");
  }
  if (setDenies(policy.provider.allowedRoutingModes, facts.routingMode)) {
    reasons.push("policy.routing_mode_not_allowed");
  }
  if (policy.provider.deniedEndpointIds.includes(facts.endpointId)) {
    reasons.push("policy.endpoint_denied");
  }
  if (
    policy.provider.deniedModelDeploymentIds.includes(facts.modelDeploymentId)
  ) {
    reasons.push("policy.model_deployment_denied");
  }
  if (
    transparencyRank[facts.executionTransparency] <
    transparencyRank[policy.provider.minimumExecutionTransparency]
  ) {
    reasons.push("policy.transparency_insufficient");
  }
  if (setDenies(policy.egress.allowedRegionCodes, facts.regionCode)) {
    reasons.push("policy.region_not_allowed");
  }
  if (
    setDenies(
      policy.egress.allowedDataClassifications,
      facts.dataClassification,
    )
  ) {
    reasons.push("policy.data_classification_not_allowed");
  }
  if (facts.privateEndpoint && !policy.egress.allowPrivateEndpoints) {
    reasons.push("policy.private_endpoint_denied");
  }
  if (facts.providerRetention && !policy.egress.allowProviderRetention) {
    reasons.push("policy.provider_retention_denied");
  }
  if (
    policy.resources.maximumRequestDurationMs !== undefined &&
    facts.requestDurationMs > policy.resources.maximumRequestDurationMs
  ) {
    reasons.push("policy.request_duration_exceeded");
  }
  if (
    policy.resources.maximumInputBytes !== undefined &&
    facts.inputBytes > policy.resources.maximumInputBytes
  ) {
    reasons.push("policy.input_size_exceeded");
  }
  if (
    policy.resources.maximumOutputBytes !== undefined &&
    facts.outputBytes > policy.resources.maximumOutputBytes
  ) {
    reasons.push("policy.output_size_exceeded");
  }
  if (policy.cost.requireKnownPricing && !facts.pricingKnown) {
    reasons.push("policy.pricing_unknown");
  }
  if (
    policy.cost.requireKnownMaximumCharge &&
    facts.maximumCharge === undefined
  ) {
    reasons.push("policy.maximum_charge_unknown");
  }
  if (facts.maximumCharge) {
    if (
      setDenies(
        policy.cost.allowedCurrencyCodes,
        facts.maximumCharge.currencyCode,
      )
    ) {
      reasons.push("policy.currency_not_allowed");
    }
    const ceiling = policy.cost.maximumCharges.find(
      (charge) => charge.currencyCode === facts.maximumCharge?.currencyCode,
    );
    if (
      ceiling &&
      compareUnsignedDecimal(facts.maximumCharge.amount, ceiling.amount) > 0
    ) {
      reasons.push("policy.maximum_charge_exceeded");
    }
  }
  return Object.freeze({
    effect: reasons.length === 0 ? "allow" : "deny",
    reasons: Object.freeze(reasons),
  });
}
