import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { safeReturnTo } from "../auth/entry-recovery.js";
import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const operationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/runs/$workflowRunId",
  validateSearch: (
    search: Record<string, unknown>,
  ): { readonly returnTo?: string; readonly kind?: "capability" } => {
    const returnTo = safeReturnTo(search.returnTo);
    return {
      ...(returnTo ? { returnTo } : {}),
      ...(search.kind === "capability" ? { kind: "capability" as const } : {}),
    };
  },
  component: lazyRouteComponent(
    () => import("./operations-page.js"),
    "OperationsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.operations")} />
  ),
});
