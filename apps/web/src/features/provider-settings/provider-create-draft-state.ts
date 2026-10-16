import type { ProviderSettingPreset } from "@kanvas/contracts/api";

import {
  clearProviderCreateFieldError,
  type ProviderCreateField,
  type ProviderCreateFieldErrors,
} from "./provider-settings-form.js";

export interface ProviderCreateDraftState {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly displayName: string;
  readonly fieldErrors: ProviderCreateFieldErrors;
  readonly formError?: string | undefined;
  readonly open: boolean;
  readonly preset: ProviderSettingPreset;
}

export type ProviderCreateDraftAction =
  | { readonly type: "api_key_changed"; readonly value: string }
  | { readonly type: "base_url_changed"; readonly value: string }
  | { readonly type: "close" }
  | { readonly type: "discovery_invalidated" }
  | { readonly type: "display_name_changed"; readonly value: string }
  | {
      readonly type: "field_errors_cleared";
      readonly fields: readonly ProviderCreateField[];
    }
  | {
      readonly type: "field_errors_merged";
      readonly fieldErrors: ProviderCreateFieldErrors;
    }
  | { readonly type: "form_valid" }
  | { readonly type: "model_selection_changed" }
  | { readonly type: "open" }
  | { readonly type: "preset_changed"; readonly preset: ProviderSettingPreset }
  | {
      readonly type: "request_failed";
      readonly apiKeyError?: string;
      readonly error: string;
    }
  | {
      readonly type: "validation_failed";
      readonly fieldErrors: ProviderCreateFieldErrors;
    };

export const initialProviderCreateDraftState: ProviderCreateDraftState = {
  apiKey: "",
  baseUrl: "",
  displayName: "",
  fieldErrors: {},
  open: false,
  preset: "tokenhub",
};

export function reduceProviderCreateDraft(
  state: ProviderCreateDraftState,
  action: ProviderCreateDraftAction,
): ProviderCreateDraftState {
  if (action.type === "open") {
    return { ...state, open: true };
  }
  if (action.type === "close") {
    return initialProviderCreateDraftState;
  }
  if (action.type === "preset_changed") {
    return {
      ...clearFieldError(state, "baseUrl"),
      baseUrl: "",
      formError: undefined,
      preset: action.preset,
    };
  }
  if (action.type === "display_name_changed") {
    return {
      ...clearFieldError(state, "displayName"),
      displayName: action.value,
      formError: undefined,
    };
  }
  if (action.type === "base_url_changed") {
    return {
      ...clearFieldError(state, "baseUrl"),
      baseUrl: action.value,
      formError: undefined,
    };
  }
  if (action.type === "api_key_changed") {
    return {
      ...clearFieldError(state, "apiKey"),
      apiKey: action.value,
      formError: undefined,
    };
  }
  if (
    action.type === "discovery_invalidated" ||
    action.type === "model_selection_changed"
  ) {
    return {
      ...clearFieldError(state, "modelKeys"),
      formError: undefined,
    };
  }
  if (action.type === "field_errors_merged") {
    return {
      ...state,
      fieldErrors: {
        ...state.fieldErrors,
        ...action.fieldErrors,
      },
    };
  }
  if (action.type === "field_errors_cleared") {
    return {
      ...state,
      fieldErrors: action.fields.reduce(
        (current, field) => clearProviderCreateFieldError(current, field),
        state.fieldErrors,
      ),
    };
  }
  if (action.type === "validation_failed") {
    return {
      ...state,
      fieldErrors: action.fieldErrors,
      formError: undefined,
    };
  }
  if (action.type === "form_valid") {
    return {
      ...state,
      fieldErrors: {},
      formError: undefined,
    };
  }
  return {
    ...state,
    apiKey: action.apiKeyError ? "" : state.apiKey,
    fieldErrors: action.apiKeyError
      ? { ...state.fieldErrors, apiKey: action.apiKeyError }
      : state.fieldErrors,
    formError: action.error,
  };
}

function clearFieldError(
  state: ProviderCreateDraftState,
  field: ProviderCreateField,
): ProviderCreateDraftState {
  return {
    ...state,
    fieldErrors: clearProviderCreateFieldError(state.fieldErrors, field),
  };
}
