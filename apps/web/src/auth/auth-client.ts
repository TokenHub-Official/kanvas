import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  basePath: "/api/auth",
  plugins: [genericOAuthClient()],
});
