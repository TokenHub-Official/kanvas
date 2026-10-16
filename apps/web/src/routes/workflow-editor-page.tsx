import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { PageLoading } from "../components/feedback.js";
import { WorkspaceBoundary } from "../components/workspace-page.js";

const routeApi = getRouteApi("/w/$workspaceId/workflows/$workflowDefinitionId");

const WorkflowAuthoringWorkspaceV1 = lazy(async () => {
  const module =
    await import("../features/workflows/workflow-authoring-workspace-v1.js");
  return { default: module.WorkflowAuthoringWorkspaceV1 };
});

export function WorkflowEditorPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { returnTo } = routeApi.useSearch();
  function returnToSource(): void {
    if (returnTo) void navigate({ href: returnTo });
  }
  const { workflowDefinitionId, workspaceId } = routeApi.useParams();

  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <Suspense
          fallback={<PageLoading label={t("workflows.editor.loading")} />}
        >
          <WorkflowAuthoringWorkspaceV1
            canAuthor={workspace.permissions.includes("workflow.author")}
            canPublish={workspace.permissions.includes("workflow.publish")}
            canRun={workspace.permissions.includes("workflow.run")}
            csrfToken={context.csrfToken}
            {...(returnTo
              ? {
                  onExit: returnToSource,
                  exitLabel: t("agent.editor.returnSource"),
                }
              : {})}
            workflowDefinitionId={workflowDefinitionId}
            workspaceId={workspace.id}
          />
        </Suspense>
      )}
    </WorkspaceBoundary>
  );
}
