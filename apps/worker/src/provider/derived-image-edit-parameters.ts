import {
  ProviderAdapterContractError,
  type AuthorizedProviderInvocationRequest,
  type ProviderInvocationRequest,
} from "./provider-adapter.js";
import type {
  OpenWorkerInputArtifactRequest,
  WorkerInputArtifactAccess,
} from "../storage/worker-input-artifact-resolver.js";

export const derivedImageEditParameterKeys = Object.freeze([
  "resolution",
  "size",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
] as const);

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

export function derivedImageEditRouteRequiresPinnedOperation(
  request: ProviderInvocationRequest,
): boolean {
  const route = request.route;
  if (
    route.providerProtocolVersion !== 1 ||
    route.modelOperation !== "image.edit" ||
    !route.parameterPolicies ||
    !route.parameterPolicyDigest
  ) {
    return contract(
      "Derived image edit requests require a complete pinned image.edit parameter policy.",
    );
  }
  return true;
}

export function assertDerivedImageEditParameters(
  request: ProviderInvocationRequest,
  supportedKeys: ReadonlySet<string>,
): boolean {
  const route = request.route;
  derivedImageEditRouteRequiresPinnedOperation(request);
  if (
    Object.keys(request.effectiveParameters ?? {}).some(
      (key) =>
        !supportedKeys.has(key) ||
        !Object.hasOwn(route.parameterPolicies!, key),
    )
  ) {
    return contract(
      "Resolved derived image edit parameters contain an unknown or unpinned field.",
    );
  }
  return true;
}

export function derivedImageEditEnumParameter<const TValue extends string>(
  request: ProviderInvocationRequest,
  key: string,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  const value = request.effectiveParameters?.[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    return contract(
      `Resolved derived image edit parameter "${key}" is outside the Adapter protocol.`,
    );
  }
  return value as TValue;
}

export function optionalDerivedImageEditEnumParameter<
  const TValue extends string,
>(
  request: ProviderInvocationRequest,
  key: string,
  allowed: readonly TValue[],
): TValue | undefined {
  const value = request.effectiveParameters?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    return contract(
      `Resolved derived image edit parameter "${key}" is outside the Adapter protocol.`,
    );
  }
  return value as TValue;
}

export function derivedImageEditIntegerParameter(
  request: ProviderInvocationRequest,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
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
      `Resolved derived image edit parameter "${key}" is outside the Adapter protocol.`,
    );
  }
  return value;
}

export function authorizedDerivedImageEditRequest(
  request: ProviderInvocationRequest,
  label: string,
): asserts request is AuthorizedProviderInvocationRequest & {
  readonly inputArtifacts: WorkerInputArtifactAccess;
} {
  const candidate = request as Partial<AuthorizedProviderInvocationRequest>;
  if (
    !candidate.executionContext ||
    !(candidate.credential instanceof Uint8Array) ||
    candidate.credential.byteLength < 1 ||
    !candidate.inputArtifacts
  ) {
    contract(`${label} requires an authorized invocation and Artifact access.`);
  }
}

export function pinnedDerivedImageEditArtifactAccess(
  request: AuthorizedProviderInvocationRequest & {
    readonly inputArtifacts: WorkerInputArtifactAccess;
  },
  expectedArtifactIds: Readonly<Record<string, string>>,
): WorkerInputArtifactAccess {
  return Object.freeze({
    async open(options: OpenWorkerInputArtifactRequest) {
      const expectedArtifactId = expectedArtifactIds[options.inputPointer];
      if (!expectedArtifactId) {
        return contract(
          "Derived image edit Artifact pointer is not pinned by the prepared request.",
        );
      }
      const artifact = await request.inputArtifacts.open(options);
      if (artifact.artifactId !== expectedArtifactId) {
        return contract(
          "Derived image edit Artifact identity differs from the prepared request.",
        );
      }
      return artifact;
    },
  });
}
