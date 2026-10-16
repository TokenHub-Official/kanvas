import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root.js";

export const taskRecordsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/tasks",
  component: lazyRouteComponent(
    () => import("./task-records-page.js"),
    "TaskRecordsPage",
  ),
});
