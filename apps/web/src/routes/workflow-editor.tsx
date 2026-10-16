import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { safeReturnTo } from "../auth/entry-recovery.js";
import { rootRoute } from "./root.js";

export const workflowEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/workflows/$workflowDefinitionId",
  validateSearch: (search: Record<string, unknown>) => {
    const returnTo = safeReturnTo(search.returnTo);
    return { ...(returnTo ? { returnTo } : {}) };
  },
  component: lazyRouteComponent(
    () => import("./workflow-editor-page.js"),
    "WorkflowEditorPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.workflowEditor")} />
  ),
});
