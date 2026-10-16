import { validateAgentsSearch } from "./agents.js";
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const agentProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/agents/$agentDefinitionId",
  validateSearch: (search: Record<string, unknown>) => ({
    ...validateAgentsSearch(search),
    ...(search.tab === "resources" || search.tab === "instructions"
      ? { tab: search.tab }
      : {}),
  }),
  component: lazyRouteComponent(
    () => import("./agent-editor-page.js"),
    "ReadAgentPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
