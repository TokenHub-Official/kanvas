import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

const runStates = new Set(["all", "active", "completed", "unfinished"]);

export const workflowRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/workflow-runs",
  validateSearch: (value: Record<string, unknown>) => ({
    state:
      typeof value.state === "string" && runStates.has(value.state)
        ? (value.state as "all" | "active" | "completed" | "unfinished")
        : ("all" as const),
  }),
  component: lazyRouteComponent(
    () => import("./workflow-runs-page.js"),
    "WorkflowRunsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("workflows.runs.loading")} />
  ),
});
