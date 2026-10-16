import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { validateSkillsSearch } from "./skills.js";
import { rootRoute } from "./root.js";

export const skillEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/skills/drafts/$skillDraftId/edit",
  validateSearch: validateSkillsSearch,
  component: lazyRouteComponent(
    () => import("./skills-page.js"),
    "EditSkillPage",
  ),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
