import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root.js";

export const externalToolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/tools",
  component: lazyRouteComponent(
    () => import("./external-tools-page.js"),
    "ExternalToolsPage",
  ),
});

export const externalToolUseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/tools/$slug",
  component: lazyRouteComponent(
    () => import("./external-tool-use-page.js"),
    "ExternalToolUsePage",
  ),
});
export const siteToolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/tools",
  component: lazyRouteComponent(
    () => import("./site-tools-page.js"),
    "SiteToolsPage",
  ),
});
export const siteToolNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/tools/new",
  component: lazyRouteComponent(
    () => import("./site-tools-page.js"),
    "SiteToolNewPage",
  ),
});
export const siteToolEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/tools/$toolId",
  component: lazyRouteComponent(
    () => import("./site-tools-page.js"),
    "SiteToolEditPage",
  ),
});
