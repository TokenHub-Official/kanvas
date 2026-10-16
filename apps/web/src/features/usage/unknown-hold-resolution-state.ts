export type UnknownHoldResolution = "charged" | "not_charged";
export type EvidenceCopyStatus = "idle" | "copied" | "failed";

export interface UnknownHoldResolutionFieldErrors {
  resolution: string | undefined;
  chargedAmount: string | undefined;
  evidenceReference: string | undefined;
}

export interface UnknownHoldResolutionState {
  readonly chargedAmount: string;
  readonly copyStatus: EvidenceCopyStatus;
  readonly discardRequested: boolean;
  readonly evidenceReference: string;
  readonly fieldErrors: UnknownHoldResolutionFieldErrors;
  readonly formError?: string | undefined;
  readonly locallyResolved: boolean;
  readonly open: boolean;
  readonly resolution?: UnknownHoldResolution | undefined;
}

type UnknownHoldResolutionAction =
  | { readonly type: "charged_amount_changed"; readonly value: string }
  | {
      readonly type: "copy_status_changed";
      readonly status: EvidenceCopyStatus;
    }
  | { readonly type: "discard" }
  | { readonly type: "discard_visibility_changed"; readonly open: boolean }
  | { readonly type: "evidence_reference_changed"; readonly value: string }
  | { readonly type: "open" }
  | { readonly type: "request_close" }
  | { readonly type: "request_failed"; readonly error: string }
  | { readonly type: "request_started" }
  | { readonly type: "resolved" }
  | {
      readonly type: "resolution_changed";
      readonly resolution: UnknownHoldResolution;
    }
  | {
      readonly type: "validation_failed";
      readonly fieldErrors: UnknownHoldResolutionFieldErrors;
    };

const emptyFieldErrors: UnknownHoldResolutionFieldErrors = {
  resolution: undefined,
  chargedAmount: undefined,
  evidenceReference: undefined,
};

export const initialUnknownHoldResolutionState: UnknownHoldResolutionState = {
  chargedAmount: "",
  copyStatus: "idle",
  discardRequested: false,
  evidenceReference: "",
  fieldErrors: emptyFieldErrors,
  locallyResolved: false,
  open: false,
};

export function unknownHoldResolutionDirty(
  state: UnknownHoldResolutionState,
): boolean {
  return (
    state.resolution !== undefined ||
    state.chargedAmount.length > 0 ||
    state.evidenceReference.length > 0
  );
}

function clearDraft(
  state: UnknownHoldResolutionState,
): UnknownHoldResolutionState {
  return {
    ...initialUnknownHoldResolutionState,
    locallyResolved: state.locallyResolved,
  };
}

export function reduceUnknownHoldResolution(
  state: UnknownHoldResolutionState,
  action: UnknownHoldResolutionAction,
): UnknownHoldResolutionState {
  switch (action.type) {
    case "open":
      return { ...state, open: true };
    case "request_close":
      return unknownHoldResolutionDirty(state)
        ? { ...state, discardRequested: true }
        : clearDraft(state);
    case "discard_visibility_changed":
      return { ...state, discardRequested: action.open };
    case "discard":
      return clearDraft(state);
    case "resolved":
      return {
        ...clearDraft(state),
        locallyResolved: true,
      };
    case "resolution_changed":
      return {
        ...state,
        chargedAmount:
          action.resolution === "not_charged" ? "" : state.chargedAmount,
        fieldErrors: {
          ...state.fieldErrors,
          resolution: undefined,
          ...(action.resolution === "not_charged"
            ? { chargedAmount: undefined }
            : {}),
        },
        resolution: action.resolution,
      };
    case "charged_amount_changed":
      return {
        ...state,
        chargedAmount: action.value,
        fieldErrors: { ...state.fieldErrors, chargedAmount: undefined },
      };
    case "evidence_reference_changed":
      return {
        ...state,
        evidenceReference: action.value,
        fieldErrors: { ...state.fieldErrors, evidenceReference: undefined },
      };
    case "validation_failed":
      return { ...state, fieldErrors: action.fieldErrors };
    case "copy_status_changed":
      return { ...state, copyStatus: action.status };
    case "request_started":
      return { ...state, formError: undefined };
    case "request_failed":
      return { ...state, formError: action.error };
  }
}
