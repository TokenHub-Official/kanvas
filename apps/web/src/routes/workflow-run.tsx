import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const workflowRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/workflow-runs/$workflowRunId",
  component: lazyRouteComponent(
    () => import("./workflow-run-page.js"),
    "WorkflowRunPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("workflows.runSession.loading")} />
  ),
});
