import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

const maximumAgentSearchLength = 160;
export function validateAgentsSearch(search: Record<string, unknown>) {
  return {
    ...(typeof search.q === "string" && search.q.length > 0
      ? { q: search.q.slice(0, maximumAgentSearchLength) }
      : {}),
    ...(search.scope === "mine" ? { scope: "mine" as const } : {}),
  };
}

export const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/agents",
  validateSearch: validateAgentsSearch,
  component: lazyRouteComponent(() => import("./agents-page.js"), "AgentsPage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
