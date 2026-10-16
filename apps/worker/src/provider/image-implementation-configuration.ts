import type {
  AuthorizedProviderInvocationRequest,
  ProviderInvocationRequest,
} from "./provider-adapter.js";
import { ProviderAdapterContractError } from "./provider-adapter.js";

const maximumPromptTemplateLength = 12_000;

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return contract(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function configurationFor(
  request: ProviderInvocationRequest,
): Readonly<Record<string, unknown>> {
  const authorized = request as Partial<AuthorizedProviderInvocationRequest>;
  if (!authorized.executionContext) {
    return contract(
      "Image implementation configuration requires an authorized Provider invocation.",
    );
  }
  return record(
    authorized.executionContext.implementationConfiguration,
    "Image implementation configuration",
  );
}

export function configuredPrompt(
  request: ProviderInvocationRequest,
  variables: Readonly<Record<string, string>>,
): string {
  const configuration = configurationFor(request);
  const template = configuration.promptTemplate;
  if (
    typeof template !== "string" ||
    template.trim().length < 1 ||
    template.length > maximumPromptTemplateLength
  ) {
    return contract(
      "Image implementation promptTemplate is missing or outside its bounded contract.",
    );
  }
  const rendered = template.replace(
    /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/gu,
    (_placeholder, key: string) => {
      if (!(key in variables)) {
        return contract(
          `Image implementation promptTemplate contains unsupported variable "${key}".`,
        );
      }
      return variables[key] ?? "";
    },
  );
  if (/\{\{|\}\}/u.test(rendered)) {
    return contract(
      "Image implementation promptTemplate contains an invalid placeholder.",
    );
  }
  const prompt = rendered.trim();
  if (prompt.length < 1 || prompt.length > 32_000) {
    return contract(
      "Rendered image implementation prompt is outside its bounded contract.",
    );
  }
  return prompt;
}

export function configuredProviderParameter<const TValue extends string>(
  request: ProviderInvocationRequest,
  key: string,
  allowed: readonly TValue[],
): TValue {
  const configuration = configurationFor(request);
  const parameters = record(
    configuration.providerParameters,
    "Image implementation providerParameters",
  );
  const value = parameters[key];
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    return contract(
      `Image implementation provider parameter "${key}" is missing or unsupported.`,
    );
  }
  return value as TValue;
}

export function effectiveProviderParameter<
  const TValue extends string | number | boolean,
>(
  request: ProviderInvocationRequest,
  key: string,
  allowed: readonly TValue[],
): TValue | undefined {
  if (
    request.route.providerProtocolVersion === 1 &&
    request.route.parameterPolicies
  ) {
    const policy = request.route.parameterPolicies[key];
    if (!policy) {
      return undefined;
    }
    const value = request.effectiveParameters?.[key];
    if (value === undefined) {
      return undefined;
    }
    if (!allowed.includes(value as TValue)) {
      return contract(
        `Resolved Provider parameter "${key}" is outside the Adapter protocol.`,
      );
    }
    return value as TValue;
  }
  if (allowed.some((candidate) => typeof candidate !== "string")) {
    return undefined;
  }
  return configuredProviderParameter(
    request,
    key,
    allowed as readonly Extract<TValue, string>[],
  );
}

export function effectiveIntegerProviderParameter(
  request: ProviderInvocationRequest,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (
    request.route.providerProtocolVersion !== 1 ||
    !request.route.parameterPolicies?.[key]
  ) {
    return undefined;
  }
  const value = request.effectiveParameters?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return contract(
      `Resolved Provider parameter "${key}" is outside the Adapter protocol.`,
    );
  }
  return value;
}
