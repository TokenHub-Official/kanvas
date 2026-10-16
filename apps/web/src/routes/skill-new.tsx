import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { validateSkillsSearch } from "./skills.js";
import { rootRoute } from "./root.js";

export const skillNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/skills/new",
  validateSearch: validateSkillsSearch,
  component: lazyRouteComponent(
    () => import("./skills-page.js"),
    "NewSkillPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
