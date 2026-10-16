import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root.js";
import { PageLoading } from "../components/feedback.js";

const maximumBoardQueryLength = 160;
export function validateBoardsSearch(search: Record<string, unknown>) {
  const q =
    typeof search.q === "string"
      ? search.q.trim().slice(0, maximumBoardQueryLength)
      : "";
  return q ? { q } : {};
}
export const boardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/boards",
  validateSearch: validateBoardsSearch,
  component: lazyRouteComponent(() => import("./boards-page.js"), "BoardsPage"),
  pendingComponent: PageLoading,
});
