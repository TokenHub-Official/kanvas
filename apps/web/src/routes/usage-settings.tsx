import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const usageSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/usage",
  component: lazyRouteComponent(
    () => import("./usage-settings-page.js"),
    "UsageSettingsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("settings.usage.opening")} />
  ),
});
