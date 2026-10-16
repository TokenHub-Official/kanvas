import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const providerSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/providers",
  component: lazyRouteComponent(
    () => import("./provider-settings-page.js"),
    "ProviderSettingsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.providers")} />
  ),
});
