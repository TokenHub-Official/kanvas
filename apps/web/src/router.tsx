import { librariesRoute, libraryDetailRoute } from "./routes/libraries.js";
import { runtimeConfigurationRoute } from "./routes/runtime-configuration.js";
import {
  externalToolsRoute,
  externalToolUseRoute,
  siteToolsRoute,
  siteToolNewRoute,
  siteToolEditRoute,
} from "./routes/external-tools.js";
import { taskRecordsRoute } from "./routes/task-records.js";
import { createRouter } from "@tanstack/react-router";
import { accountRoute } from "./routes/account.js";

import { assetsRoute } from "./routes/assets.js";
import { agentsRoute } from "./routes/agents.js";
import { agentEditRoute } from "./routes/agent-edit.js";
import { agentNewRoute } from "./routes/agent-new.js";
import { agentProfileRoute } from "./routes/agent-profile.js";
import { agentRoute } from "./routes/agent.js";
import { agentThreadRoute } from "./routes/agent-thread.js";
import { assetDetailRoute } from "./routes/asset-detail.js";
import { boardsRoute } from "./routes/boards.js";
import { boardRoute } from "./routes/board.js";
import { brandRoute } from "./routes/brand.js";
import { creationHubRoute } from "./routes/creation-hub.js";
import { generalSettingsRoute } from "./routes/general-settings.js";
import { emailVerificationRoute } from "./routes/email-verification.js";
import { indexRoute } from "./routes/index.js";
import { instanceAccessRoute } from "./routes/instance-access.js";
import { inviteRoute } from "./routes/invite.js";
import { loginRoute } from "./routes/login.js";
import {
  availableModelsRoute,
  modelSettingsRoute,
} from "./routes/model-settings.js";
import { modelResourcesRoute } from "./routes/model-resources.js";
import { operationsRoute } from "./routes/operations.js";
import { peopleRoute } from "./routes/people.js";
import { providerSettingsRoute } from "./routes/provider-settings.js";
import { registerRoute } from "./routes/register.js";
import { resourceSourcesRoute } from "./routes/resource-sources.js";
import { rootRoute } from "./routes/root.js";
import { settingsRoute } from "./routes/settings.js";
import { usageSettingsRoute } from "./routes/usage-settings.js";
import { capabilityDefinitionsRoute } from "./routes/capability-definitions.js";
import { setupRoute } from "./routes/setup.js";
import { skillsRoute } from "./routes/skills.js";
import { skillDraftRoute } from "./routes/skill-draft.js";
import { skillDetailRoute } from "./routes/skill-detail.js";
import { skillEditRoute } from "./routes/skill-edit.js";
import { skillNewRoute } from "./routes/skill-new.js";
import { workspaceHomeRoute } from "./routes/workspace-home.js";
import { workflowsRoute } from "./routes/workflows.js";
import { workflowEditorRoute } from "./routes/workflow-editor.js";
import { workflowTemplatesRoute } from "./routes/workflow-templates.js";
import { workflowTemplateDetailRoute } from "./routes/workflow-template-detail.js";
import { workflowRunRoute } from "./routes/workflow-run.js";
import { workflowRunsRoute } from "./routes/workflow-runs.js";

const routeTree = rootRoute.addChildren([
  accountRoute,
  externalToolsRoute,
  externalToolUseRoute,
  siteToolsRoute,
  siteToolNewRoute,
  siteToolEditRoute,
  indexRoute,
  instanceAccessRoute,
  runtimeConfigurationRoute,
  loginRoute,
  registerRoute,
  emailVerificationRoute,
  inviteRoute,
  setupRoute,
  workspaceHomeRoute,
  agentsRoute,
  agentNewRoute,
  agentEditRoute,
  agentProfileRoute,
  skillsRoute,
  skillNewRoute,
  skillEditRoute,
  skillDetailRoute,
  skillDraftRoute,
  agentRoute,
  agentThreadRoute,
  boardsRoute,
  boardRoute,
  brandRoute,
  librariesRoute,
  libraryDetailRoute,
  creationHubRoute,
  assetsRoute,
  assetDetailRoute,
  workflowsRoute,
  workflowEditorRoute,
  workflowTemplatesRoute,
  workflowTemplateDetailRoute,
  workflowRunsRoute,
  workflowRunRoute,
  settingsRoute,
  generalSettingsRoute,
  usageSettingsRoute,
  capabilityDefinitionsRoute,
  modelResourcesRoute,
  providerSettingsRoute,
  modelSettingsRoute,
  availableModelsRoute,
  resourceSourcesRoute,
  peopleRoute,
  operationsRoute,
  taskRecordsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: ({ location }) =>
    /^\/w\/[^/]+\/(?:agents|skills)(?:\/|$)/u.test(location.pathname) ||
    /^\/w\/[^/]+\/settings\/capabilities(?:\/|$)/u.test(location.pathname),
  getScrollRestorationKey: (location) => location.href,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
