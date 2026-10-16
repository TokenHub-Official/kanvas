import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const workflowTemplateDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/workflow-templates/$workflowRevisionId",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    readonly brandKitId?: string;
    readonly withoutBrand?: boolean;
  } => ({
    ...(typeof search.brandKitId === "string" &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(search.brandKitId)
      ? { brandKitId: search.brandKitId }
      : {}),
    ...(search.withoutBrand === true || search.withoutBrand === "true"
      ? { withoutBrand: true }
      : {}),
  }),
  component: lazyRouteComponent(
    () => import("./workflow-template-detail-page.js"),
    "WorkflowTemplateDetailPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.workflowTemplate")} />
  ),
});
