import {
  clearInstanceSetupFieldError,
  normalizeInstanceSetupSlug,
  type InstanceSetupFieldErrors,
} from "./instance-setup-form.js";

export interface InstanceSetupPageState {
  readonly error?: string | undefined;
  readonly fieldErrors: InstanceSetupFieldErrors;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly organizationSlugTouched: boolean;
  readonly setupLinkUnavailable: boolean;
  readonly setupToken: string;
  readonly submitting: boolean;
  readonly switchAccountAvailable: boolean;
  readonly switchAccountError?: string | undefined;
  readonly switchingAccount: boolean;
  readonly urlSettingsOpen: boolean;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly workspaceSlugTouched: boolean;
}

type InstanceSetupPageAction =
  | { readonly type: "organization_name_changed"; readonly value: string }
  | { readonly type: "organization_slug_changed"; readonly value: string }
  | {
      readonly type: "submission_failed";
      readonly error: string;
      readonly switchAccountAvailable: boolean;
    }
  | { readonly type: "submission_finished" }
  | { readonly type: "submission_started" }
  | { readonly type: "switch_account_failed"; readonly error: string }
  | { readonly type: "switch_account_started" }
  | { readonly type: "token_rejected" }
  | { readonly type: "toggle_url_settings" }
  | {
      readonly type: "validation_failed";
      readonly fieldErrors: InstanceSetupFieldErrors;
      readonly revealUrlSettings: boolean;
    }
  | { readonly type: "workspace_name_changed"; readonly value: string }
  | { readonly type: "workspace_slug_changed"; readonly value: string };

export function createInstanceSetupPageState(
  setupToken: string,
): InstanceSetupPageState {
  return {
    fieldErrors: {},
    organizationName: "",
    organizationSlug: "",
    organizationSlugTouched: false,
    setupLinkUnavailable: setupToken.length === 0,
    setupToken,
    submitting: false,
    switchAccountAvailable: false,
    switchingAccount: false,
    urlSettingsOpen: false,
    workspaceName: "",
    workspaceSlug: "",
    workspaceSlugTouched: false,
  };
}

export function reduceInstanceSetupPage(
  state: InstanceSetupPageState,
  action: InstanceSetupPageAction,
): InstanceSetupPageState {
  switch (action.type) {
    case "organization_name_changed": {
      const fieldErrors = clearInstanceSetupFieldError(
        state.fieldErrors,
        "organizationName",
      );
      return {
        ...state,
        error: undefined,
        fieldErrors: state.organizationSlugTouched
          ? fieldErrors
          : clearInstanceSetupFieldError(fieldErrors, "organizationSlug"),
        organizationName: action.value,
        organizationSlug: state.organizationSlugTouched
          ? state.organizationSlug
          : normalizeInstanceSetupSlug(action.value),
      };
    }
    case "workspace_name_changed": {
      const fieldErrors = clearInstanceSetupFieldError(
        state.fieldErrors,
        "workspaceName",
      );
      return {
        ...state,
        error: undefined,
        fieldErrors: state.workspaceSlugTouched
          ? fieldErrors
          : clearInstanceSetupFieldError(fieldErrors, "workspaceSlug"),
        workspaceName: action.value,
        workspaceSlug: state.workspaceSlugTouched
          ? state.workspaceSlug
          : normalizeInstanceSetupSlug(action.value),
      };
    }
    case "organization_slug_changed":
      return {
        ...state,
        error: undefined,
        fieldErrors: clearInstanceSetupFieldError(
          state.fieldErrors,
          "organizationSlug",
        ),
        organizationSlug: normalizeInstanceSetupSlug(action.value),
        organizationSlugTouched: true,
      };
    case "workspace_slug_changed":
      return {
        ...state,
        error: undefined,
        fieldErrors: clearInstanceSetupFieldError(
          state.fieldErrors,
          "workspaceSlug",
        ),
        workspaceSlug: normalizeInstanceSetupSlug(action.value),
        workspaceSlugTouched: true,
      };
    case "toggle_url_settings":
      return { ...state, urlSettingsOpen: !state.urlSettingsOpen };
    case "validation_failed":
      return {
        ...state,
        error: undefined,
        fieldErrors: action.fieldErrors,
        urlSettingsOpen: action.revealUrlSettings || state.urlSettingsOpen,
      };
    case "submission_started":
      return {
        ...state,
        error: undefined,
        fieldErrors: {},
        submitting: true,
        switchAccountAvailable: false,
        switchAccountError: undefined,
      };
    case "submission_finished":
      return { ...state, submitting: false };
    case "token_rejected":
      return {
        ...state,
        fieldErrors: {},
        setupLinkUnavailable: true,
        setupToken: "",
      };
    case "submission_failed":
      return {
        ...state,
        error: action.error,
        fieldErrors: {},
        switchAccountAvailable: action.switchAccountAvailable,
      };
    case "switch_account_started":
      return {
        ...state,
        switchAccountError: undefined,
        switchingAccount: true,
      };
    case "switch_account_failed":
      return {
        ...state,
        switchAccountError: action.error,
        switchingAccount: false,
      };
  }
}
