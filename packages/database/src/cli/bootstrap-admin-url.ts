export function formatInstanceSetupUrl(
  rawToken: string,
  configuredOrigin?: string,
): string {
  const path = `/setup#${new URLSearchParams({
    setup: rawToken,
  }).toString()}`;
  const normalizedOrigin = configuredOrigin?.trim();
  if (!normalizedOrigin) {
    return path;
  }
  const url = new URL(path, normalizedOrigin);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "KANVAS_AUTH_BASE_URL must be a credential-free HTTP(S) URL.",
    );
  }
  return url.toString();
}
