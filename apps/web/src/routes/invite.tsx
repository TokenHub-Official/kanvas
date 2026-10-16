import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { rootRoute } from "./root.js";

export const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$invitationToken",
  component: lazyRouteComponent(() => import("./invite-page.js"), "InvitePage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.invite")} />
  ),
});
