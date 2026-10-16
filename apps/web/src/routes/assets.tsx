import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

const ASSET_SEARCH_MAX_LENGTH = 120;

export const validateAssetSearch = (
  value: Record<string, unknown>,
): {
  readonly q?: string;
} => ({
  ...(typeof value.q === "string" &&
  value.q.trim().length > 0 &&
  value.q.trim().length <= ASSET_SEARCH_MAX_LENGTH
    ? { q: value.q.trim() }
    : {}),
});

export const assetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/assets",
  validateSearch: validateAssetSearch,
  component: lazyRouteComponent(() => import("./assets-page.js"), "AssetsPage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.assets")} />
  ),
});
