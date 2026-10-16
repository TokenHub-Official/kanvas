import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { validateAssetSearch } from "./assets.js";
import { rootRoute } from "./root.js";

export const assetDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/assets/$assetId",
  validateSearch: validateAssetSearch,
  component: lazyRouteComponent(
    () => import("./asset-detail-page.js"),
    "AssetDetailPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.asset")} />
  ),
});
