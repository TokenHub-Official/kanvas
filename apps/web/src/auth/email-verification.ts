export function emailVerificationCallbackUrl(
  origin: string,
  returnTo?: string,
): string {
  const callback = new URL("/email-verification", origin);
  if (returnTo) callback.searchParams.set("returnTo", returnTo);
  return callback.toString();
}
