import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/people",
  component: lazyRouteComponent(() => import("./people-page.js"), "PeoplePage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.people")} />
  ),
});
