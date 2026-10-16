import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const modelSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/models",
  component: lazyRouteComponent(
    () => import("./model-settings-page.js"),
    "ModelSettingsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("settings.models.opening")} />
  ),
});

export const availableModelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/models/available",
  component: lazyRouteComponent(
    () => import("./available-models-page.js"),
    "AvailableModelsPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("settings.models.opening")} />
  ),
});
