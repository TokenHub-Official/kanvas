import type { ProviderSettingSummary } from "@kanvas/contracts/api";

export interface ProviderSecretDraftState {
  readonly apiKey: string;
  readonly error?: string;
  readonly fieldError?: string;
  readonly target?: ProviderSettingSummary;
}

export type ProviderSecretDraftAction =
  | { readonly type: "clear_errors" }
  | { readonly type: "close" }
  | { readonly type: "key_changed"; readonly apiKey: string }
  | { readonly type: "open"; readonly target: ProviderSettingSummary }
  | {
      readonly type: "request_failed";
      readonly clearApiKey: boolean;
      readonly error: string;
      readonly fieldError?: string;
    }
  | {
      readonly type: "validation_failed";
      readonly clearError: boolean;
      readonly fieldError: string;
    };

export const initialProviderSecretDraftState: ProviderSecretDraftState = {
  apiKey: "",
};

export function reduceProviderSecretDraft(
  state: ProviderSecretDraftState,
  action: ProviderSecretDraftAction,
): ProviderSecretDraftState {
  if (action.type === "open") {
    return {
      apiKey: "",
      target: action.target,
    };
  }
  if (action.type === "close") {
    return initialProviderSecretDraftState;
  }
  if (action.type === "key_changed") {
    return draftBase(state, action.apiKey);
  }
  if (action.type === "clear_errors") {
    return draftBase(state, state.apiKey);
  }
  if (action.type === "validation_failed") {
    return action.clearError
      ? {
          ...draftBase(state, state.apiKey),
          fieldError: action.fieldError,
        }
      : {
          ...state,
          fieldError: action.fieldError,
        };
  }
  return {
    ...state,
    apiKey: action.clearApiKey ? "" : state.apiKey,
    error: action.error,
    ...(action.fieldError ? { fieldError: action.fieldError } : {}),
  };
}

function draftBase(
  state: ProviderSecretDraftState,
  apiKey: string,
): ProviderSecretDraftState {
  return {
    apiKey,
    ...(state.target ? { target: state.target } : {}),
  };
}
