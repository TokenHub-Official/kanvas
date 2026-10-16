import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const modelResourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/model-resources",
  component: lazyRouteComponent(
    () => import("./model-resources-page.js"),
    "ModelResourcesPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("settings.modelResources.opening")} />
  ),
});
