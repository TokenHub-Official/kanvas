import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const resourceSourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/resource-sources",
  component: lazyRouteComponent(
    () => import("./resource-sources-page.js"),
    "ResourceSourcesPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("settings.resourceSources.loading")} />
  ),
});
