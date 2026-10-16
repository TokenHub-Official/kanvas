export type InvitationState = "accepted" | "expired" | "pending" | "revoked";

export type InvitationAuthenticationState =
  "authenticated" | "error" | "pending" | "unauthenticated";

export type InvitationIdentityStatus =
  "matched" | "mismatched" | "signed_out" | "unverified";

export type InvitationPrimaryAction =
  | "access-removed"
  | "accept"
  | "enter-workspace"
  | "login-then-enter"
  | "register-or-login"
  | "retry-identity"
  | "return-home"
  | "switch-account-to-accept"
  | "switch-account-to-enter"
  | "verify-identity";

export type InvitationAcceptanceErrorCode =
  | "accountMismatch"
  | "changed"
  | "missing"
  | "rateLimited"
  | "sessionExpired"
  | "unavailable";

export function invitationAcceptanceErrorCode(
  status?: number,
): InvitationAcceptanceErrorCode {
  if (status === httpStatus.unauthorized) {
    return "sessionExpired";
  }
  if (status === httpStatus.forbidden) {
    return "accountMismatch";
  }
  if (status === httpStatus.notFound) {
    return "missing";
  }
  if (status === httpStatus.conflict) {
    return "changed";
  }
  if (status === httpStatus.tooManyRequests) {
    return "rateLimited";
  }
  return "unavailable";
}

export function invitationPrimaryAction(
  invitationState: InvitationState,
  authenticationState: InvitationAuthenticationState,
  hasWorkspaceAccess: boolean,
  identityStatus: InvitationIdentityStatus,
): InvitationPrimaryAction {
  if (invitationState === "accepted") {
    if (authenticationState === "authenticated") {
      if (hasWorkspaceAccess) return "enter-workspace";
      return identityStatus === "matched"
        ? "access-removed"
        : "switch-account-to-enter";
    }
    if (authenticationState === "unauthenticated") {
      return "login-then-enter";
    }
    return authenticationState === "pending"
      ? "verify-identity"
      : "retry-identity";
  }
  if (invitationState !== "pending") {
    return "return-home";
  }
  if (authenticationState === "authenticated") {
    if (identityStatus === "matched") {
      return "accept";
    }
    if (identityStatus === "mismatched" || identityStatus === "unverified") {
      return "switch-account-to-accept";
    }
    return "retry-identity";
  }
  if (authenticationState === "unauthenticated") {
    return "register-or-login";
  }
  return authenticationState === "pending"
    ? "verify-identity"
    : "retry-identity";
}
import { httpStatus } from "../api/http-status.js";
