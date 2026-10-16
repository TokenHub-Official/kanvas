import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";
import { validateAgentCanvasSearch } from "../features/agent/agent-entry-search.js";

export const agentThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/agent/$threadId",
  validateSearch: validateAgentCanvasSearch,
  component: lazyRouteComponent(() => import("./agent-page.js"), "AgentPage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
