import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { validateAgentCanvasSearch } from "../features/agent/agent-entry-search.js";
import { rootRoute } from "./root.js";

export const workspaceHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId",
  validateSearch: validateAgentCanvasSearch,
  component: lazyRouteComponent(
    () => import("./agent-home-page.js"),
    "AgentHomePage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.workspace")} />
  ),
});
