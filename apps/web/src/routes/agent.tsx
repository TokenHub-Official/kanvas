import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { validateAgentCanvasSearch } from "../features/agent/agent-entry-search.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/agent",
  validateSearch: validateAgentCanvasSearch,
  component: lazyRouteComponent(() => import("./agent-page.js"), "AgentPage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
