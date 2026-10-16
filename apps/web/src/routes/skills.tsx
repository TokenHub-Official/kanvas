import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { PageLoading } from "../components/feedback.js";
import { i18n } from "../i18n/i18n.js";
import { safeReturnTo } from "../auth/entry-recovery.js";
import { rootRoute } from "./root.js";

const maximumSkillSearchLength = 160;
const maximumFilePathLength = 512;
export function validateSkillsSearch(search: Record<string, unknown>) {
  const q =
    typeof search.q === "string"
      ? search.q.trim().slice(0, maximumSkillSearchLength)
      : "";
  const returnTo = safeReturnTo(search.returnTo);
  return {
    ...(search.scope === "mine" ? { scope: "mine" as const } : {}),
    ...(q ? { q } : {}),
    ...(search.status === "draft" ||
    search.status === "published" ||
    search.status === "changes" ||
    search.status === "unavailable"
      ? { status: search.status }
      : {}),
    ...(typeof search.file === "string" &&
    search.file.trim().length > 0 &&
    search.file.length <= maximumFilePathLength &&
    search.file !== "SKILL.md"
      ? { file: search.file }
      : {}),
    ...(returnTo ? { returnTo } : {}),
    ...(search.notice === "imported" ? { notice: "imported" as const } : {}),
  };
}

export const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/skills",
  validateSearch: validateSkillsSearch,
  component: lazyRouteComponent(() => import("./skills-page.js"), "SkillsPage"),
  pendingComponent: () => (
    <PageLoading label={i18n.t("common.opening.agent")} />
  ),
});
