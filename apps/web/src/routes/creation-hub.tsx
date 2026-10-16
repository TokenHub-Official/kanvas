import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const creationHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/new",
  component: lazyRouteComponent(
    () => import("./creation-hub-page.js"),
    "CreationHubPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.creation")} />
  ),
});
