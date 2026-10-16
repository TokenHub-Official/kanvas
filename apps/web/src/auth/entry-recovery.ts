import { httpStatus } from "../api/http-status.js";

export const lastWorkspacePreferenceKey = "kanvas.last-workspace-id";

const maximumReturnToLength = 2_048;
const MAX_CONTROL_CODE_POINT = 31;
const DELETE_CONTROL_CODE_POINT = 127;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= MAX_CONTROL_CODE_POINT ||
        codePoint === DELETE_CONTROL_CODE_POINT)
    ) {
      return true;
    }
  }
  return false;
}

export function safeReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumReturnToLength ||
    value !== value.trim() ||
    hasControlCharacter(value) ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return undefined;
  }
  try {
    const resolved = new URL(value, "https://kanvas.invalid");
    if (
      resolved.origin !== "https://kanvas.invalid" ||
      resolved.pathname === "/login" ||
      (resolved.pathname === "/setup" &&
        new URLSearchParams(resolved.hash.slice(1)).has("setup"))
    ) {
      return undefined;
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return undefined;
  }
}

export function returnToFromLocation(
  location: Pick<Location, "pathname" | "search"> &
    Partial<Pick<Location, "hash">>,
): string {
  return (
    safeReturnTo(
      `${location.pathname}${location.search}${location.hash ?? ""}`,
    ) ?? "/"
  );
}

export function clearWorkspacePreference(
  storage: Pick<Storage, "removeItem">,
): void {
  storage.removeItem(lastWorkspacePreferenceKey);
}

export type AuthenticationRecoveryDecision = "resume" | "sign_in";

export function shouldRedirectAuthenticatedLogin(options: {
  readonly authenticationRecoveryRequired: boolean;
  readonly hasOAuthError: boolean;
  readonly hasSession: boolean;
}): boolean {
  return (
    options.hasSession &&
    !options.authenticationRecoveryRequired &&
    !options.hasOAuthError
  );
}

export async function authenticationRecoveryDecision(
  client: Readonly<{
    getSession(): Promise<Readonly<{ data: object | null }>>;
  }>,
): Promise<AuthenticationRecoveryDecision> {
  try {
    const current = await client.getSession();
    return current.data ? "resume" : "sign_in";
  } catch {
    return "sign_in";
  }
}

export type LoginErrorCode =
  | "accountUnavailable"
  | "credentials"
  | "emailNotVerified"
  | "rateLimited"
  | "unavailable";

export function loginErrorCode(status?: number, code?: string): LoginErrorCode {
  if (code?.toUpperCase() === "EMAIL_NOT_VERIFIED") {
    return "emailNotVerified";
  }
  if (status === httpStatus.tooManyRequests) {
    return "rateLimited";
  }
  if (status === httpStatus.forbidden) {
    return "accountUnavailable";
  }
  if (status === httpStatus.badRequest || status === httpStatus.unauthorized) {
    return "credentials";
  }
  return "unavailable";
}
