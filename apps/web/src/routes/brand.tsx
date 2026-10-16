import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { safeReturnTo } from "../auth/entry-recovery.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export function validateBrandSearch(search: Record<string, unknown>) {
  const returnTo = safeReturnTo(search.returnTo);
  const brandKitId =
    typeof search.brandKitId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.brandKitId)
      ? search.brandKitId
      : undefined;
  return {
    ...(returnTo ? { returnTo } : {}),
    ...(brandKitId ? { brandKitId } : {}),
  };
}

export const brandRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/brand",
  validateSearch: validateBrandSearch,
  component: lazyRouteComponent(() => import("./brand-page.js"), "BrandPage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.brand")} />
  ),
});
