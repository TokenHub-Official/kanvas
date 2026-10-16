import type { ProviderModelDiscoveryResult } from "@kanvas/contracts/api";

export type DiscoveredProviderModel =
  ProviderModelDiscoveryResult["models"][number];

export type DiscoveredImageCapability = "image.generate" | "image.edit";

export interface ProviderModelDiscoveryOption {
  readonly capabilities: readonly DiscoveredImageCapability[];
  readonly disabled: boolean;
  readonly displayName: string;
  readonly providerModelId: string;
}

export interface ProviderModelDiscoveryDraftState {
  readonly revision: number;
  readonly discovery?: ProviderModelDiscoveryResult;
  readonly error?: string;
  readonly selectedModelKeys: readonly string[];
}

export type ProviderModelDiscoveryDraftAction =
  | { readonly type: "invalidate" }
  | { readonly type: "begin" }
  | {
      readonly type: "resolved";
      readonly revision: number;
      readonly discovery: ProviderModelDiscoveryResult;
    }
  | {
      readonly type: "rejected";
      readonly revision: number;
      readonly error: string;
    }
  | {
      readonly type: "select";
      readonly modelKeys: readonly string[];
    };

const imageCapabilities = Object.freeze([
  "image.generate",
  "image.edit",
] as const);

export function discoveredImageCapabilities(
  model: DiscoveredProviderModel,
): readonly DiscoveredImageCapability[] {
  return Object.freeze(
    imageCapabilities.filter((capability) =>
      Object.hasOwn(model.operations, capability),
    ),
  );
}

export function providerModelDiscoveryOptions(
  discovery: ProviderModelDiscoveryResult,
): readonly ProviderModelDiscoveryOption[] {
  return Object.freeze(
    discovery.models.map((model) => {
      const capabilities = discoveredImageCapabilities(model);
      return Object.freeze({
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        capabilities,
        disabled:
          model.completeness === "identity_only" || capabilities.length === 0,
      });
    }),
  );
}

export function selectableProviderModelCount(
  discovery: ProviderModelDiscoveryResult,
): number {
  return providerModelDiscoveryOptions(discovery).filter(
    ({ disabled }) => !disabled,
  ).length;
}

export function selectedProviderModelKeys(
  discovery: ProviderModelDiscoveryResult,
  values: readonly string[],
): readonly string[] {
  const selectable = new Set(
    providerModelDiscoveryOptions(discovery)
      .filter(({ disabled }) => !disabled)
      .map(({ providerModelId }) => providerModelId),
  );
  return Object.freeze([
    ...new Set(
      values.filter((providerModelId) => selectable.has(providerModelId)),
    ),
  ]);
}

export function initialProviderModelDiscoveryDraftState(): ProviderModelDiscoveryDraftState {
  return Object.freeze({
    revision: 0,
    selectedModelKeys: Object.freeze([]),
  });
}

export function reduceProviderModelDiscoveryDraft(
  state: ProviderModelDiscoveryDraftState,
  action: ProviderModelDiscoveryDraftAction,
): ProviderModelDiscoveryDraftState {
  if (action.type === "invalidate") {
    return Object.freeze({
      revision: state.revision + 1,
      selectedModelKeys: Object.freeze([]),
    });
  }
  if (action.type === "begin") {
    return Object.freeze({
      revision: state.revision + 1,
      selectedModelKeys: Object.freeze([]),
    });
  }
  if (
    (action.type === "resolved" || action.type === "rejected") &&
    action.revision !== state.revision
  ) {
    return state;
  }
  if (action.type === "resolved") {
    return Object.freeze({
      revision: state.revision,
      discovery: action.discovery,
      selectedModelKeys: Object.freeze([]),
    });
  }
  if (action.type === "rejected") {
    return Object.freeze({
      revision: state.revision,
      error: action.error,
      selectedModelKeys: Object.freeze([]),
    });
  }
  return state.discovery
    ? Object.freeze({
        ...state,
        selectedModelKeys: selectedProviderModelKeys(
          state.discovery,
          action.modelKeys,
        ),
      })
    : state;
}
