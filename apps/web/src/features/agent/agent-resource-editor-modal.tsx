import { CloseOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Modal } from "antd";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { fetchWorkflowTemplate } from "../../api/transport.js";
import { PageLoading } from "../../components/feedback.js";
import type { AgentWorkbenchResource } from "./agent-resource-workbench.js";

const BoardDesktopContent = lazy(async () => {
  const module = await import("../../routes/board-desktop-content.js");
  return { default: module.BoardDesktopContent };
});

const WorkflowAuthoringWorkspaceV1 = lazy(async () => {
  const module =
    await import("../workflows/workflow-authoring-workspace-v1.js");
  return { default: module.WorkflowAuthoringWorkspaceV1 };
});

function EditorFallback({
  label,
  onClose,
}: {
  readonly label: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="relative grid h-full place-items-center bg-mist">
      <Button
        aria-label={t("agent.closeEditor")}
        className="absolute top-3 right-3 z-10"
        icon={<CloseOutlined />}
        onClick={onClose}
      />
      <PageLoading label={label} />
    </div>
  );
}

export function AgentResourceEditorModal({
  canAuthorWorkflow,
  canEditCanvas,
  canPublishWorkflow,
  canRunWorkflow,
  csrfToken,
  item,
  onClose,
  permissions,
  workspaceId,
}: {
  readonly canAuthorWorkflow: boolean;
  readonly canEditCanvas: boolean;
  readonly canPublishWorkflow: boolean;
  readonly canRunWorkflow: boolean;
  readonly csrfToken: string;
  readonly item?: AgentWorkbenchResource;
  readonly onClose: () => void;
  readonly permissions: readonly string[];
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const workflow = useQuery({
    queryKey: ["workflow-template", workspaceId, item?.resourceId],
    queryFn: () => fetchWorkflowTemplate(workspaceId, item!.resourceId),
    enabled: item?.kind === "workflow",
    retry: false,
    staleTime: 30_000,
  });
  let editor: React.JSX.Element | undefined;
  if (item?.kind === "canvas") {
    editor = (
      <Suspense
        fallback={
          <EditorFallback label={t("canvas.loading")} onClose={onClose} />
        }
      >
        <BoardDesktopContent
          canEdit={canEditCanvas}
          canvasDraftId={item.resourceId}
          csrfToken={csrfToken}
          embedded
          importImageInitially={false}
          onExit={onClose}
          permissions={permissions}
          workspaceId={workspaceId}
        />
      </Suspense>
    );
  } else if (item?.kind === "workflow") {
    if (workflow.isPending) {
      editor = (
        <EditorFallback
          label={t("workflows.editor.loading")}
          onClose={onClose}
        />
      );
    } else if (workflow.isError) {
      editor = (
        <div className="relative grid h-full place-items-center bg-mist">
          <Button
            aria-label={t("agent.closeInspector")}
            className="absolute top-3 right-3"
            icon={<CloseOutlined />}
            onClick={onClose}
          />
          <Empty description={t("agent.resourceUnavailable")} />
        </div>
      );
    } else {
      editor = (
        <Suspense
          fallback={
            <EditorFallback
              label={t("workflows.editor.loading")}
              onClose={onClose}
            />
          }
        >
          <WorkflowAuthoringWorkspaceV1
            canAuthor={canAuthorWorkflow}
            canPublish={canPublishWorkflow}
            canRun={canRunWorkflow}
            csrfToken={csrfToken}
            embedded
            onExit={onClose}
            workflowDefinitionId={workflow.data.workflowDefinitionId}
            workspaceId={workspaceId}
          />
        </Suspense>
      );
    }
  }

  return (
    <Modal
      centered
      className="[&_.ant-modal-content]:!overflow-hidden [&_.ant-modal-content]:!rounded-[12px] [&_.ant-modal-content]:!p-0"
      closeIcon={false}
      destroyOnHidden
      footer={null}
      keyboard={false}
      mask={{ blur: true, closable: false }}
      onCancel={onClose}
      open={item !== undefined}
      style={{ margin: 0, maxWidth: "calc(100vw - 48px)", paddingBottom: 0 }}
      styles={{ body: { height: "92dvh", overflow: "hidden" } }}
      width="calc(100vw - 48px)"
    >
      {editor}
    </Modal>
  );
}
