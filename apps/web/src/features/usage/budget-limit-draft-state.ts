export interface BudgetLimitDraftState {
  readonly fieldError?: string | undefined;
  readonly formError?: string | undefined;
  readonly limit: string;
  readonly open: boolean;
}

type BudgetLimitDraftAction =
  | { readonly type: "close"; readonly originalLimit: string }
  | { readonly type: "field_error"; readonly error: string }
  | { readonly type: "form_error"; readonly error: string }
  | { readonly type: "limit_changed"; readonly limit: string }
  | { readonly type: "open"; readonly originalLimit: string }
  | { readonly type: "saved"; readonly limit: string }
  | { readonly type: "validation_passed" };

export function createBudgetLimitDraft(
  originalLimit: string,
): BudgetLimitDraftState {
  return {
    limit: originalLimit,
    open: false,
  };
}

export function reduceBudgetLimitDraft(
  state: BudgetLimitDraftState,
  action: BudgetLimitDraftAction,
): BudgetLimitDraftState {
  switch (action.type) {
    case "open":
      return {
        limit: action.originalLimit,
        open: true,
      };
    case "close":
      return createBudgetLimitDraft(action.originalLimit);
    case "saved":
      return createBudgetLimitDraft(action.limit);
    case "limit_changed":
      return {
        ...state,
        fieldError: undefined,
        formError: undefined,
        limit: action.limit,
      };
    case "field_error":
      return { ...state, fieldError: action.error };
    case "form_error":
      return { ...state, formError: action.error };
    case "validation_passed":
      return { ...state, fieldError: undefined };
  }
}
