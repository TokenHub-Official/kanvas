import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

const WORKFLOW_TEMPLATE_FILTER_MAX_LENGTH = 120;

export const workflowTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/workflow-templates",
  validateSearch: (value: Record<string, unknown>) => ({
    ...(typeof value.q === "string" && value.q.trim()
      ? { q: value.q.trim().slice(0, WORKFLOW_TEMPLATE_FILTER_MAX_LENGTH) }
      : {}),
    ...(typeof value.category === "string" && value.category.trim()
      ? {
          category: value.category
            .trim()
            .slice(0, WORKFLOW_TEMPLATE_FILTER_MAX_LENGTH),
        }
      : {}),
  }),
  component: lazyRouteComponent(
    () => import("./workflow-templates-page.js"),
    "WorkflowTemplatesPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.workflowTemplates")} />
  ),
});
