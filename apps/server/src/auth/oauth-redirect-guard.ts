import { APIError, createAuthMiddleware } from "better-auth/api";

export function oauthRedirectGuard(
  baseUrl: string,
  trustedOrigins: readonly string[],
) {
  const origins = new Set([new URL(baseUrl).origin, ...trustedOrigins]);
  return createAuthMiddleware((context) => {
    if (
      ![
        "/sign-in/social",
        "/sign-in/oauth2",
        "/link-social",
        "/oauth2/link",
      ].includes(context.path)
    )
      return Promise.resolve();
    const body: unknown = context.body;
    if (!body || typeof body !== "object") return Promise.resolve();
    for (const field of [
      "callbackURL",
      "errorCallbackURL",
      "newUserCallbackURL",
    ] as const) {
      if (!(field in body)) continue;
      const value: unknown = (body as Record<string, unknown>)[field];
      if (value === undefined) continue;
      let valid = false;
      if (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 2048 &&
        value.trim() === value &&
        !value.includes("\\") &&
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      ) {
        try {
          const url = new URL(value, baseUrl);
          valid = origins.has(url.origin) && !url.username && !url.password;
        } catch {
          /* Invalid URLs are rejected below. */
        }
      }
      if (!valid)
        throw new APIError("FORBIDDEN", {
          message: "Invalid OAuth return URL.",
        });
    }
    return Promise.resolve();
  });
}
