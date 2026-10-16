import type { WorkspaceTeam } from "@kanvas/contracts/api";

export type PeopleWorkspaceRole = WorkspaceTeam["members"][number]["role"];

export interface PeopleInviteDraftState {
  readonly email: string;
  readonly error?: string | undefined;
  readonly open: boolean;
  readonly ownerRiskAcknowledged: boolean;
  readonly role: PeopleWorkspaceRole;
  readonly shareUrl?: string | undefined;
}

type PeopleInviteDraftAction =
  | { readonly type: "close" }
  | { readonly type: "created"; readonly shareUrl: string }
  | { readonly type: "email_changed"; readonly email: string }
  | { readonly type: "open" }
  | { readonly type: "owner_risk_changed"; readonly acknowledged: boolean }
  | { readonly type: "request_failed"; readonly error: string }
  | { readonly type: "resent"; readonly shareUrl: string }
  | { readonly type: "role_changed"; readonly role: PeopleWorkspaceRole }
  | { readonly type: "validation_failed"; readonly error: string };

export const initialPeopleInviteDraftState: PeopleInviteDraftState = {
  email: "",
  open: false,
  ownerRiskAcknowledged: false,
  role: "editor",
};

export function reducePeopleInviteDraft(
  state: PeopleInviteDraftState,
  action: PeopleInviteDraftAction,
): PeopleInviteDraftState {
  switch (action.type) {
    case "open":
      return { ...state, open: true };
    case "close":
      return initialPeopleInviteDraftState;
    case "email_changed":
      return { ...state, email: action.email, error: undefined };
    case "role_changed":
      return {
        ...state,
        ownerRiskAcknowledged: false,
        role: action.role,
      };
    case "owner_risk_changed":
      return { ...state, ownerRiskAcknowledged: action.acknowledged };
    case "created":
      return {
        ...state,
        email: "",
        error: undefined,
        ownerRiskAcknowledged: false,
        shareUrl: action.shareUrl,
      };
    case "resent":
      return {
        ...state,
        error: undefined,
        open: true,
        shareUrl: action.shareUrl,
      };
    case "request_failed":
    case "validation_failed":
      return { ...state, error: action.error };
  }
}
