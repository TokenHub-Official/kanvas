import {
  createEffectiveInvocationValidationSchema,
  effectiveInvocationSchemaInvariantIssues,
  type EffectiveInvocationField,
  type EffectiveInvocationSchema,
  type EffectiveInvocationUnavailableReason,
} from "@kanvas/contracts/api";
import type {
  ProviderModelParameterDefinition,
  ProviderModelParameterPolicies,
} from "@kanvas/contracts/provider-model";

export interface EffectiveInvocationRouteCandidate {
  readonly parameterDefinitions: readonly ProviderModelParameterDefinition[];
  readonly parameterPolicies: ProviderModelParameterPolicies;
}

export interface EffectiveInvocationRouteGroup {
  readonly controlledParameterKeys: readonly string[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly dispatchableCandidateCount?: number;
  readonly candidates: readonly EffectiveInvocationRouteCandidate[];
}

export interface ProjectEffectiveInvocationSchemaOptions {
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly routeGroups: readonly EffectiveInvocationRouteGroup[];
}

type Scalar = string | number | boolean;

type Domain =
  | {
      readonly kind: "enum";
      readonly values: readonly Scalar[];
      readonly scalarKind: "string" | "integer" | "boolean" | "mixed";
    }
  | {
      readonly kind: "integer";
      readonly minimum: number;
      readonly maximum: number;
      readonly step: number;
      readonly offset: number;
    }
  | {
      readonly kind: "boolean";
    }
  | {
      readonly kind: "string";
      readonly maxLength: number;
    };

type StructuredDomain =
  | {
      readonly kind: "artifact";
    }
  | {
      readonly kind: "artifact_list";
      readonly minItems: number;
      readonly maxItems: number;
      readonly uniqueItems: boolean;
    }
  | {
      readonly kind: "json";
      readonly jsonType: "object" | "array";
    };

interface CandidateField {
  readonly definition: ProviderModelParameterDefinition;
  readonly domain: Domain;
  readonly required: boolean;
}

const schemaVersion = "kanvas.effective-invocation-schema/v1" as const;
const parameterKeyPattern = /^[A-Za-z_][A-Za-z0-9._-]*$/u;
const artifactIdSchemaPattern = "^[0-7][0-9A-HJKMNP-TV-Z]{25}$";
const maximumStructuredInputLength = 32_000;
const maximumArtifactListItems = 200;

function unavailable(
  reason: EffectiveInvocationUnavailableReason,
  controlledParameterKeys: readonly string[],
): EffectiveInvocationSchema {
  return Object.freeze({
    schemaVersion,
    availability: "unavailable",
    reason,
    controlledParameterKeys: [...controlledParameterKeys],
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function scalar(value: unknown): value is Scalar {
  return (
    (typeof value === "string" && value.length > 0 && value.length <= 32_000) ||
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    typeof value === "boolean"
  );
}

function scalarKey(value: Scalar): string {
  return `${typeof value}:${String(value)}`;
}

function scalarKind(
  values: readonly Scalar[],
): Extract<Domain, { readonly kind: "enum" }>["scalarKind"] {
  const kinds = new Set(
    values.map((value) =>
      typeof value === "number" ? "integer" : typeof value,
    ),
  );
  return kinds.size === 1
    ? ([...kinds][0] as "string" | "integer" | "boolean")
    : "mixed";
}

function enumDomain(
  values: readonly unknown[],
): Extract<Domain, { readonly kind: "enum" }> | undefined {
  if (
    values.length < 1 ||
    values.length > 256 ||
    values.some((value) => !scalar(value))
  ) {
    return undefined;
  }
  const parsed = values as readonly Scalar[];
  if (new Set(parsed.map(scalarKey)).size !== parsed.length) {
    return undefined;
  }
  return Object.freeze({
    kind: "enum",
    values: Object.freeze([...parsed]),
    scalarKind: scalarKind(parsed),
  });
}

function safeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : fallback;
}

function propertyDomain(
  property: Readonly<Record<string, unknown>>,
): Domain | undefined {
  if (Object.hasOwn(property, "const")) {
    return scalar(property.const) ? enumDomain([property.const]) : undefined;
  }
  if (Array.isArray(property.enum)) {
    return enumDomain(property.enum);
  }
  if (property.type === "integer") {
    const minimum = safeInteger(property.minimum, Number.MIN_SAFE_INTEGER);
    const maximum = safeInteger(property.maximum, Number.MAX_SAFE_INTEGER);
    const step = safeInteger(property.multipleOf, 1);
    return minimum <= maximum && step >= 1
      ? Object.freeze({
          kind: "integer",
          minimum,
          maximum,
          step,
          offset: 0,
        })
      : undefined;
  }
  if (property.type === "boolean") {
    return Object.freeze({ kind: "boolean" });
  }
  if (property.type === "string") {
    const maxLength = safeInteger(property.maxLength, 32_000);
    return maxLength >= 1 && maxLength <= 32_000
      ? Object.freeze({ kind: "string", maxLength })
      : undefined;
  }
  return undefined;
}

function boundedNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function artifactProperty(
  property: Readonly<Record<string, unknown>>,
): boolean {
  return (
    property.type === "string" && property.pattern === artifactIdSchemaPattern
  );
}

function structuredDomain(
  property: Readonly<Record<string, unknown>>,
): StructuredDomain | undefined {
  if (artifactProperty(property)) {
    return Object.freeze({ kind: "artifact" });
  }
  if (property.type === "object") {
    return Object.freeze({
      kind: "json",
      jsonType: "object",
    });
  }
  if (property.type !== "array") {
    return undefined;
  }
  const items = record(property.items);
  if (!items || !artifactProperty(items)) {
    return Object.freeze({
      kind: "json",
      jsonType: "array",
    });
  }
  const minItems = boundedNonNegativeInteger(property.minItems, 0);
  const maxItems = boundedNonNegativeInteger(
    property.maxItems,
    maximumArtifactListItems,
  );
  if (
    minItems > maxItems ||
    maxItems < 1 ||
    maxItems > maximumArtifactListItems
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: "artifact_list",
    minItems,
    maxItems,
    uniqueItems: property.uniqueItems === true,
  });
}

function intersectStructuredDomains(
  domains: readonly StructuredDomain[],
): StructuredDomain | undefined {
  if (domains.every((domain) => domain.kind === "artifact")) {
    return Object.freeze({ kind: "artifact" });
  }
  if (
    domains.every(
      (domain) =>
        domain.kind === "artifact_list" ||
        (domain.kind === "json" && domain.jsonType === "array"),
    )
  ) {
    const artifactLists = domains.filter(
      (
        domain,
      ): domain is Extract<
        StructuredDomain,
        { readonly kind: "artifact_list" }
      > => domain.kind === "artifact_list",
    );
    if (artifactLists.length === 0) {
      return Object.freeze({
        kind: "json",
        jsonType: "array",
      });
    }
    const minItems = Math.max(
      ...artifactLists.map((domain) => domain.minItems),
    );
    const maxItems = Math.min(
      ...artifactLists.map((domain) => domain.maxItems),
    );
    return minItems <= maxItems
      ? Object.freeze({
          kind: "artifact_list",
          minItems,
          maxItems,
          uniqueItems: artifactLists.some((domain) => domain.uniqueItems),
        })
      : undefined;
  }
  const first = domains[0];
  if (
    first?.kind === "json" &&
    domains.every(
      (domain) => domain.kind === "json" && domain.jsonType === first.jsonType,
    )
  ) {
    return first?.kind === "json"
      ? Object.freeze({
          kind: "json",
          jsonType: first.jsonType,
        })
      : undefined;
  }
  return undefined;
}

function definitionDomain(
  definition: ProviderModelParameterDefinition,
  policy: ProviderModelParameterPolicies[string],
): Domain | undefined {
  if (policy.allowedValues) {
    return enumDomain(policy.allowedValues);
  }
  if (definition.valueType === "enum") {
    return enumDomain(definition.values);
  }
  if (definition.valueType === "integer") {
    const minimum = Math.max(
      definition.minimum,
      policy.minimum ?? definition.minimum,
    );
    const maximum = Math.min(
      definition.maximum,
      policy.maximum ?? definition.maximum,
    );
    return minimum <= maximum
      ? Object.freeze({
          kind: "integer",
          minimum,
          maximum,
          step: definition.step ?? 1,
          offset: definition.minimum,
        })
      : undefined;
  }
  if (definition.valueType === "boolean") {
    return Object.freeze({ kind: "boolean" });
  }
  return Object.freeze({
    kind: "string",
    maxLength: definition.maxLength,
  });
}

function candidateField(
  candidate: EffectiveInvocationRouteCandidate,
  key: string,
): CandidateField | undefined {
  const policy = candidate.parameterPolicies[key];
  const definition = candidate.parameterDefinitions.find(
    (item) => item.key === key,
  );
  if (!policy || !definition || policy.callerPolicy === "fixed") {
    return undefined;
  }
  const domain = definitionDomain(definition, policy);
  return domain
    ? Object.freeze({
        definition,
        domain,
        required:
          policy.callerPolicy === "required" ||
          (definition.required && policy.defaultValue === undefined),
      })
    : undefined;
}

function supports(domain: Domain, value: Scalar): boolean {
  if (domain.kind === "enum") {
    return domain.values.some(
      (candidate) => typeof candidate === typeof value && candidate === value,
    );
  }
  if (domain.kind === "boolean") {
    return typeof value === "boolean";
  }
  if (domain.kind === "string") {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= domain.maxLength
    );
  }
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= domain.minimum &&
    value <= domain.maximum &&
    (value - domain.offset) % domain.step === 0
  );
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function extendedGcd(
  left: bigint,
  right: bigint,
): readonly [bigint, bigint, bigint] {
  if (right === 0n) {
    return [left, 1n, 0n];
  }
  const [value, x, y] = extendedGcd(right, left % right);
  return [value, y, x - (left / right) * y];
}

function modulo(value: bigint, divisor: bigint): bigint {
  const remainder = value % divisor;
  return remainder < 0n ? remainder + divisor : remainder;
}

function combineCongruence(
  left: {
    readonly residue: bigint;
    readonly modulus: bigint;
  },
  right: {
    readonly residue: bigint;
    readonly modulus: bigint;
  },
):
  | {
      readonly residue: bigint;
      readonly modulus: bigint;
    }
  | undefined {
  const common = gcd(left.modulus, right.modulus);
  const difference = right.residue - left.residue;
  if (difference % common !== 0n) {
    return undefined;
  }
  const leftReduced = left.modulus / common;
  const rightReduced = right.modulus / common;
  const [, inverse] = extendedGcd(leftReduced, rightReduced);
  const multiplier = modulo((difference / common) * inverse, rightReduced);
  const modulus = left.modulus * rightReduced;
  return Object.freeze({
    residue: modulo(left.residue + left.modulus * multiplier, modulus),
    modulus,
  });
}

function integerIntersection(
  domains: readonly Extract<Domain, { readonly kind: "integer" }>[],
): Domain | undefined {
  const minimum = Math.max(...domains.map((domain) => domain.minimum));
  const maximum = Math.min(...domains.map((domain) => domain.maximum));
  if (minimum > maximum) {
    return undefined;
  }
  let congruence = {
    residue: 0n,
    modulus: 1n,
  };
  for (const domain of domains) {
    const combined = combineCongruence(congruence, {
      residue: modulo(BigInt(domain.offset), BigInt(domain.step)),
      modulus: BigInt(domain.step),
    });
    if (!combined) {
      return undefined;
    }
    congruence = combined;
  }
  const minimumBigInt = BigInt(minimum);
  const maximumBigInt = BigInt(maximum);
  const distance = minimumBigInt - congruence.residue;
  const multiplier =
    distance <= 0n
      ? 0n
      : (distance + congruence.modulus - 1n) / congruence.modulus;
  const first = congruence.residue + multiplier * congruence.modulus;
  if (first > maximumBigInt) {
    return undefined;
  }
  if (
    first < BigInt(Number.MIN_SAFE_INTEGER) ||
    first > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return undefined;
  }
  if (congruence.modulus > BigInt(Number.MAX_SAFE_INTEGER)) {
    return enumDomain([Number(first)]);
  }
  return Object.freeze({
    kind: "integer",
    minimum: Number(first),
    maximum,
    step: Number(congruence.modulus),
    offset: Number(first),
  });
}

function intersectDomains(domains: readonly Domain[]): Domain | undefined {
  const enumerated = domains.find((domain) => domain.kind === "enum");
  if (enumerated?.kind === "enum") {
    return enumDomain(
      enumerated.values.filter((value) =>
        domains.every((domain) => supports(domain, value)),
      ),
    );
  }
  if (domains.every((domain) => domain.kind === "boolean")) {
    return Object.freeze({ kind: "boolean" });
  }
  if (domains.every((domain) => domain.kind === "string")) {
    return Object.freeze({
      kind: "string",
      maxLength: Math.min(
        ...domains.map((domain) =>
          domain.kind === "string"
            ? domain.maxLength
            : Number.POSITIVE_INFINITY,
        ),
      ),
    });
  }
  if (domains.every((domain) => domain.kind === "integer")) {
    return integerIntersection(domains);
  }
  return undefined;
}

function boundedText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
    ? value
    : undefined;
}

function fieldPlaceholder(
  property: Readonly<Record<string, unknown>>,
): string | undefined {
  return boundedText(record(property["x-kanvas-ui"])?.placeholder, 500);
}

function fieldFromDomain(
  key: string,
  required: boolean,
  domain: Domain,
  property: Readonly<Record<string, unknown>>,
  candidateFields: readonly CandidateField[],
): EffectiveInvocationField {
  const candidateLabels = new Set(
    candidateFields.map((field) => field.definition.label),
  );
  const candidateDescriptions = new Set(
    candidateFields.flatMap((field) =>
      field.definition.description ? [field.definition.description] : [],
    ),
  );
  const label =
    boundedText(property.title, 160) ??
    (candidateLabels.size === 1 ? [...candidateLabels][0]! : key);
  const description =
    boundedText(property.description, 1_000) ??
    (candidateDescriptions.size === 1
      ? [...candidateDescriptions][0]
      : undefined);
  const placeholder = fieldPlaceholder(property);
  const common = {
    key,
    label,
    required,
    ...(description ? { description } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
  if (scalar(property.const) && supports(domain, property.const)) {
    return Object.freeze({
      ...common,
      valueType: "constant",
      value: property.const,
    });
  }
  if (domain.kind === "enum") {
    if (
      domain.scalarKind === "boolean" &&
      domain.values.every(
        (value): value is boolean => typeof value === "boolean",
      )
    ) {
      return Object.freeze({
        ...common,
        valueType: "boolean",
        allowedValues: [...domain.values],
      });
    }
    return Object.freeze({
      ...common,
      valueType: "enum",
      values: [...domain.values],
    });
  }
  if (domain.kind === "integer") {
    return Object.freeze({
      ...common,
      valueType: "integer",
      minimum: domain.minimum,
      maximum: domain.maximum,
      ...(domain.step === 1 ? {} : { step: domain.step }),
    });
  }
  if (domain.kind === "boolean") {
    return Object.freeze({
      ...common,
      valueType: "boolean",
    });
  }
  return Object.freeze({
    ...common,
    valueType: "string",
    maxLength: domain.maxLength,
  });
}

function fieldFromStructuredDomain(
  key: string,
  required: boolean,
  domain: StructuredDomain,
  property: Readonly<Record<string, unknown>>,
): EffectiveInvocationField {
  const label = boundedText(property.title, 160) ?? key;
  const description = boundedText(property.description, 1_000);
  const placeholder = fieldPlaceholder(property);
  const common = {
    key,
    label,
    required,
    ...(description ? { description } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
  if (domain.kind === "artifact") {
    return Object.freeze({
      ...common,
      valueType: "artifact",
    });
  }
  if (domain.kind === "artifact_list") {
    return Object.freeze({
      ...common,
      valueType: "artifact_list",
      minItems: domain.minItems,
      maxItems: domain.maxItems,
      uniqueItems: domain.uniqueItems,
    });
  }
  return Object.freeze({
    ...common,
    valueType: "json",
    jsonType: domain.jsonType,
    maxLength: maximumStructuredInputLength,
  });
}

export function projectEffectiveInvocationSchema(
  options: ProjectEffectiveInvocationSchemaOptions,
): EffectiveInvocationSchema {
  const controlledParameterKeys = [
    ...new Set(
      options.routeGroups.flatMap((group) => group.controlledParameterKeys),
    ),
  ].sort();
  if (
    controlledParameterKeys.length > 64 ||
    controlledParameterKeys.some((key) => !parameterKeyPattern.test(key))
  ) {
    return unavailable("schema_conflict", controlledParameterKeys.slice(0, 64));
  }
  const validationSchema = createEffectiveInvocationValidationSchema(
    options.inputSchema,
  );
  if (!validationSchema) {
    return unavailable("unsupported_schema", controlledParameterKeys);
  }
  const properties = record(options.inputSchema.properties);
  if (options.inputSchema.type !== "object" || !properties) {
    return unavailable("unsupported_schema", controlledParameterKeys);
  }
  const requiredItems = Array.isArray(options.inputSchema.required)
    ? options.inputSchema.required
    : [];
  if (
    requiredItems.some(
      (value) => typeof value !== "string" || !Object.hasOwn(properties, value),
    )
  ) {
    return unavailable("unsupported_schema", controlledParameterKeys);
  }
  const required = new Set(requiredItems as readonly string[]);
  const controlled = new Set(controlledParameterKeys);
  const fields: EffectiveInvocationField[] = [];

  for (const [key, value] of Object.entries(properties)) {
    const property = record(value);
    if (!property || !parameterKeyPattern.test(key)) {
      if (required.has(key)) {
        return unavailable("unsupported_schema", controlledParameterKeys);
      }
      continue;
    }
    const routePropertyFacts = options.routeGroups.map((group) => {
      const routeProperties = record(group.inputSchema.properties);
      const routeRequired = Array.isArray(group.inputSchema.required)
        ? group.inputSchema.required.includes(key)
        : false;
      return {
        property: routeProperties ? record(routeProperties[key]) : undefined,
        required: routeRequired,
        rejectsUnknown: group.inputSchema.additionalProperties === false,
      };
    });
    const candidateDomains = routePropertyFacts.flatMap((fact) => {
      const domain = fact.property ? propertyDomain(fact.property) : undefined;
      return domain ? [domain] : [];
    });
    const baseDomain = propertyDomain(property);
    const baseStructuredDomain = structuredDomain(property);
    const baseRequired =
      required.has(key) || routePropertyFacts.some((fact) => fact.required);
    if (!controlled.has(key)) {
      if (baseStructuredDomain) {
        const routeStructuredDomains = routePropertyFacts.flatMap((fact) => {
          const domain = fact.property
            ? structuredDomain(fact.property)
            : undefined;
          return domain ? [domain] : [];
        });
        const incompatibleRouteProperty = routePropertyFacts.some(
          (fact) =>
            (fact.property !== undefined &&
              structuredDomain(fact.property) === undefined) ||
            (fact.property === undefined && fact.rejectsUnknown),
        );
        const effectiveStructuredDomain = !incompatibleRouteProperty
          ? intersectStructuredDomains([
              baseStructuredDomain,
              ...routeStructuredDomains,
            ])
          : undefined;
        if (!effectiveStructuredDomain) {
          if (baseRequired) {
            return unavailable("unsupported_schema", controlledParameterKeys);
          }
          continue;
        }
        fields.push(
          fieldFromStructuredDomain(
            key,
            baseRequired,
            effectiveStructuredDomain,
            property,
          ),
        );
        continue;
      }
      const incompatibleRouteProperty = routePropertyFacts.some(
        (fact) =>
          (fact.property !== undefined &&
            propertyDomain(fact.property) === undefined) ||
          (fact.property === undefined && fact.rejectsUnknown),
      );
      const effectiveDomain =
        baseDomain && !incompatibleRouteProperty
          ? intersectDomains([baseDomain, ...candidateDomains])
          : undefined;
      if (!effectiveDomain) {
        if (baseRequired) {
          return unavailable("unsupported_schema", controlledParameterKeys);
        }
        continue;
      }
      fields.push(
        fieldFromDomain(key, baseRequired, effectiveDomain, property, []),
      );
      continue;
    }

    const relevantGroups = options.routeGroups.filter((group) =>
      group.controlledParameterKeys.includes(key),
    );
    const candidateFields = relevantGroups.flatMap((group) =>
      group.candidates.flatMap((candidate) => {
        const field = candidateField(candidate, key);
        return field ? [field] : [];
      }),
    );
    const candidateCount = relevantGroups.reduce(
      (total, group) =>
        total + (group.dispatchableCandidateCount ?? group.candidates.length),
      0,
    );
    const callerRequired =
      baseRequired || candidateFields.some((field) => field.required);
    const incompatibleRouteProperty = routePropertyFacts.some(
      (fact) =>
        (fact.property !== undefined &&
          propertyDomain(fact.property) === undefined) ||
        (fact.property === undefined && fact.rejectsUnknown),
    );
    if (
      !baseDomain ||
      incompatibleRouteProperty ||
      candidateCount === 0 ||
      candidateFields.length !== candidateCount
    ) {
      if (callerRequired) {
        return unavailable("schema_conflict", controlledParameterKeys);
      }
      continue;
    }
    const intersection = intersectDomains([
      baseDomain,
      ...candidateDomains,
      ...candidateFields.map((field) => field.domain),
    ]);
    if (!intersection) {
      if (callerRequired) {
        return unavailable("schema_conflict", controlledParameterKeys);
      }
      continue;
    }
    fields.push(
      fieldFromDomain(
        key,
        callerRequired,
        intersection,
        property,
        candidateFields,
      ),
    );
  }

  for (const key of controlledParameterKeys) {
    if (Object.hasOwn(properties, key)) {
      continue;
    }
    const relevantGroups = options.routeGroups.filter((group) =>
      group.controlledParameterKeys.includes(key),
    );
    if (
      relevantGroups.some((group) =>
        group.candidates.some((candidate) => {
          const field = candidateField(candidate, key);
          return field?.required === true;
        }),
      )
    ) {
      return unavailable("schema_conflict", controlledParameterKeys);
    }
  }

  for (const group of options.routeGroups) {
    const routeRequired = Array.isArray(group.inputSchema.required)
      ? group.inputSchema.required
      : [];
    if (
      routeRequired.some(
        (key) => typeof key !== "string" || !Object.hasOwn(properties, key),
      )
    ) {
      return unavailable("unsupported_schema", controlledParameterKeys);
    }
  }

  const projected = Object.freeze({
    schemaVersion,
    availability: "available",
    controlledParameterKeys: [...controlledParameterKeys],
    validationSchema,
    fields: [...fields],
  }) satisfies EffectiveInvocationSchema;
  return effectiveInvocationSchemaInvariantIssues(projected).length === 0
    ? projected
    : unavailable("schema_conflict", controlledParameterKeys);
}

export function unavailableEffectiveInvocationSchema(
  reason: EffectiveInvocationUnavailableReason,
  controlledParameterKeys: readonly string[] = [],
): Extract<
  EffectiveInvocationSchema,
  { readonly availability: "unavailable" }
> {
  return unavailable(reason, controlledParameterKeys) as Extract<
    EffectiveInvocationSchema,
    { readonly availability: "unavailable" }
  >;
}
