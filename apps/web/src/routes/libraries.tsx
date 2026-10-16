import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root.js";
import { PageLoading } from "../components/feedback.js";
export const librariesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/libraries",
  component: lazyRouteComponent(
    () => import("./libraries-page.js"),
    "LibrariesPage",
  ),
  pendingComponent: () => <PageLoading />,
});
export const libraryDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/libraries/$libraryId",
  component: lazyRouteComponent(
    () => import("./libraries-page.js"),
    "LibraryDetailPage",
  ),
  pendingComponent: () => <PageLoading />,
});
