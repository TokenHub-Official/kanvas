import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: lazyRouteComponent(() => import("./setup-page.js"), "SetupPage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.setup")} />
  ),
});
