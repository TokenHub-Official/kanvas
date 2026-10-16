import { validateAgentsSearch } from "./agents.js";
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const agentNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/agents/new",
  validateSearch: validateAgentsSearch,
  component: lazyRouteComponent(
    () => import("./agent-editor-page.js"),
    "NewAgentPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
