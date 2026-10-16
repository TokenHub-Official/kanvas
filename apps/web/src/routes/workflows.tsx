import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/workflows",
  component: lazyRouteComponent(
    () => import("./workflows-page.js"),
    "WorkflowsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.workflows")} />
  ),
});
