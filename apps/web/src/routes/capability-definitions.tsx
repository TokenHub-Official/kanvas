import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

const maximumCapabilitySearchLength = 160;

export function validateCapabilityDefinitionsSearch(
  search: Record<string, unknown>,
): Readonly<{
  capabilityId?: string;
  q?: string;
  source?: string;
  view?: "archived" | "installed" | "recommendations";
}> {
  const view =
    search.view === "archived" || search.view === "recommendations"
      ? search.view
      : undefined;
  return {
    ...(typeof search.source === "string" ? { source: search.source } : {}),
    ...(typeof search.capabilityId === "string"
      ? { capabilityId: search.capabilityId }
      : {}),
    ...(typeof search.q === "string" && search.q.length > 0
      ? { q: search.q.slice(0, maximumCapabilitySearchLength) }
      : {}),
    ...(view ? { view } : {}),
  };
}

export const capabilityDefinitionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/capabilities",
  validateSearch: validateCapabilityDefinitionsSearch,
  component: lazyRouteComponent(
    () => import("./capability-definitions-page.js"),
    "CapabilityDefinitionsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("settings.capabilityDefinitions.opening")} />
  ),
});
