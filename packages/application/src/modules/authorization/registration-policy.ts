export type RegistrationMode = "closed" | "account_only";

export interface InstanceRegistrationPolicy {
  readonly mode: RegistrationMode;
  readonly emailPasswordEnabled: boolean;
  readonly emailVerificationRequired: boolean;
  readonly oidcProviderIds: readonly string[];
  /** Zero identifies the implicit closed policy before an administrator saves it. */
  readonly version: number;
}

export type RegistrationMethod =
  | { readonly kind: "email_password" }
  | { readonly kind: "oidc"; readonly providerId: string };

export function registrationMethodAllowed(
  policy: InstanceRegistrationPolicy,
  method: RegistrationMethod,
): boolean {
  if (policy.mode !== "account_only") return false;
  return method.kind === "email_password"
    ? policy.emailPasswordEnabled
    : policy.oidcProviderIds.includes(method.providerId);
}
