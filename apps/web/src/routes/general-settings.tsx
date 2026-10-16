import { createRoute } from "@tanstack/react-router";

import { GeneralSettingsPage } from "./general-settings-page.js";
import { rootRoute } from "./root.js";

export const generalSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId/settings/general",
  component: GeneralSettingsPage,
});
