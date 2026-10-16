import { authClient } from "./auth-client.js";

export interface LoginProvider {
  readonly id: string;
  readonly name: string;
  readonly type: "github" | "google" | "microsoft" | "discord" | "oidc";
}

export interface LoginMethods {
  readonly emailAndPasswordEnabled: boolean;
  readonly emailPasswordRegistrationEnabled: boolean;
  readonly emailPasswordInvitationEnabled: boolean;
  readonly emailVerificationRequired: boolean;
  readonly providers: readonly LoginProvider[];
}

export function emailRegistrationRequiresVerification(
  methods: Pick<LoginMethods, "emailVerificationRequired"> | undefined,
): boolean {
  return methods?.emailVerificationRequired !== false;
}

export class EmailRegistrationSignInError extends Error {
  public constructor() {
    super("Registered account sign-in failed.");
    this.name = "EmailRegistrationSignInError";
  }
}

export async function signInEmailRegistration(
  email: string,
  password: string,
): Promise<void> {
  const result = await authClient.signIn.email({
    email,
    password,
    rememberMe: true,
  });
  if (result.error) throw new EmailRegistrationSignInError();
}

export async function fetchLoginMethods(): Promise<LoginMethods> {
  const response = await fetch("/api/auth/login-methods", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Login methods unavailable");
  return response.json() as Promise<LoginMethods>;
}

export async function startOAuth(
  provider: LoginProvider,
  callbackURL: string,
  errorCallbackURL: string,
  link = false,
): Promise<void> {
  let result;
  if (provider.type === "oidc") {
    result = link
      ? await authClient.oauth2.link({
          providerId: provider.id,
          callbackURL,
          errorCallbackURL,
        })
      : await authClient.signIn.oauth2({
          providerId: provider.id,
          callbackURL,
          errorCallbackURL,
          disableRedirect: true,
        });
  } else {
    result = link
      ? await authClient.linkSocial({
          provider: provider.type,
          callbackURL,
          errorCallbackURL,
          disableRedirect: true,
        })
      : await authClient.signIn.social({
          provider: provider.type,
          callbackURL,
          errorCallbackURL,
          disableRedirect: true,
        });
  }
  if (result.error || !result.data?.url)
    throw new Error("OAuth redirect unavailable");
  window.location.assign(result.data.url);
}

export function oauthErrorKey(
  error: string,
):
  | "linkRequired"
  | "registrationClosed"
  | "emailMismatch"
  | "stateExpired"
  | "oauthFailed" {
  if (error === "account_not_linked") return "linkRequired";
  if (["signup_disabled", "signup disabled"].includes(error))
    return "registrationClosed";
  if (["email_doesn't_match", "email_mismatch"].includes(error))
    return "emailMismatch";
  if (["state_mismatch", "state_security_mismatch"].includes(error))
    return "stateExpired";
  return "oauthFailed";
}
