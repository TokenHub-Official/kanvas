import {
  ResourceActions,
  ResourceUnavailable,
  useResourceStates,
} from "./resource-lifecycle.js";
import {
  ArrowRightOutlined,
  EditOutlined,
  PoweroffOutlined,
} from "@ant-design/icons";
import type { AgentHubSkill, AgentHubSkillDetail } from "@kanvas/contracts/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Modal, Skeleton } from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiProblem,
  changeResourceState,
  changeSkillRuntimeStatus,
  downloadSkillPackage,
  fetchAgentHubSkill,
  fetchSkillDrafts,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import { ActionLink } from "./action-link.js";
import { InlineNotice } from "./feedback.js";
import { SkillDetailContent } from "./skill-detail-content.js";
import type { SkillFileSelection } from "./skill-content-browser.js";
import { StatusTag } from "./status-tag.js";
import { skillAvailability } from "./skill-availability.js";
import {
  invalidateResourceQueries,
  notifyResourceStateChange,
} from "../api/resource-state-events.js";
const downloadUrlLifetime = 1000;
export function SkillDetailPanel({
  workspaceId,
  definitionId,
  csrfToken,
  principalId,
  canManage,
  canPublish,
  canUse,
  canReadAssets,
  onEdit,
  selection,
  summary,
}: {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly csrfToken: string;
  readonly principalId: string;
  readonly canManage: boolean;
  readonly canPublish: boolean;
  readonly canUse: boolean;
  readonly canReadAssets: boolean;
  readonly onEdit: (draftId: string) => void;
  readonly selection: SkillFileSelection;
  readonly summary?: AgentHubSkill;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [modal, modalContext] = Modal.useModal();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const resourceStates = useResourceStates(workspaceId, "skill");
  const detail = useQuery({
    queryKey: ["agent-hub-skill", workspaceId, definitionId],
    queryFn: () => fetchAgentHubSkill(workspaceId, definitionId),
    retry: false,
  });
  const drafts = useQuery({
    queryKey: ["skill-drafts", workspaceId],
    queryFn: () => fetchSkillDrafts(workspaceId),
    enabled: canManage,
    retry: false,
  });
  const editable = drafts.data?.items.find(
    (draft) => draft.skillDefinitionId === definitionId,
  );
  async function exportPackage(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const exported = await downloadSkillPackage(workspaceId, definitionId);
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), downloadUrlLifetime);
    } catch {
      setError(t("agent.hub.skillActionError"));
    } finally {
      setPending(false);
    }
  }
  async function changeStatus(
    skill: AgentHubSkillDetail,
    runtimeStatus: "enabled" | "disabled" | "revoked",
  ): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await changeSkillRuntimeStatus(
        { csrfToken, workspaceId },
        skill.skillRevisionId,
        {
          expectedVersion: skill.activationVersion,
          runtimeStatus,
          ...(runtimeStatus === "revoked"
            ? { reasonCode: "owner.revoked" }
            : {}),
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-hub-skills", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-hub-skill", workspaceId, definitionId],
        }),
      ]);
    } catch {
      setError(t("agent.hub.skillActionError"));
    } finally {
      setPending(false);
    }
  }
  async function enableSkill(skill: AgentHubSkillDetail): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const resource = resourceStates.data?.items.find(
        (item) => item.id === skill.id,
      );
      let activation = skill;
      if (resource?.state === "disabled") {
        await changeResourceState(
          { csrfToken, workspaceId },
          "skill",
          skill.id,
          { expectedVersion: resource.version, state: "enabled" },
        );
        notifyResourceStateChange(workspaceId);
        activation = await fetchAgentHubSkill(workspaceId, definitionId);
      }
      if (activation.runtimeStatus === "disabled") {
        await changeSkillRuntimeStatus(
          { csrfToken, workspaceId },
          activation.skillRevisionId,
          {
            expectedVersion: activation.activationVersion,
            runtimeStatus: "enabled",
          },
        );
      }
      await invalidateResourceQueries(queryClient, workspaceId);
    } catch {
      await invalidateResourceQueries(queryClient, workspaceId);
      setError(t("agent.hub.skillActionError"));
    } finally {
      setPending(false);
    }
  }
  if (detail.isPending)
    return (
      <div className="p-6">
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  const skill = detail.data;
  if (!skill || detail.isError)
    return (
      <div className="p-6">
        <ResourceUnavailable
          workspaceId={workspaceId}
          csrfToken={csrfToken}
          kind="skill"
          id={definitionId}
        >
          {summary && (
            <header className="mb-6">
              <h2 className="text-lg font-semibold">{summary.displayName}</h2>
              <p className="text-sm leading-6 text-muted">{summary.summary}</p>
            </header>
          )}
          <InlineNotice
            title={t("agent.hub.skillUnavailable")}
            action={
              skillReadErrorKey(detail.error) ===
              "agent.skillWorkbench.readServiceError" ? (
                <Button onClick={() => void detail.refetch()}>
                  {t("agent.editor.retry")}
                </Button>
              ) : undefined
            }
            tone="danger"
          >
            {t(skillReadErrorKey(detail.error))}
          </InlineNotice>
        </ResourceUnavailable>
      </div>
    );
  const owned = skill.ownerPrincipalId === principalId;
  const resourceState = resourceStates.data?.items.find(
    (item) => item.id === skill.id,
  );
  const availability = skillAvailability({
    published: skill,
    ...(resourceState ? { resourceState: resourceState.state } : {}),
  });
  let feedback: ReactNode;
  if (error)
    feedback = (
      <InlineNotice
        className="mx-6 mb-3"
        title={error}
        tone="danger"
        closable={{ onClose: () => setError(undefined) }}
      />
    );
  else if (availability.kind === "disabled")
    feedback = (
      <InlineNotice
        className="mx-6 mt-3"
        title={t("agent.skillWorkbench.disabledTitle")}
        tone="warning"
      >
        {t("agent.skillWorkbench.disabledDescription")}
      </InlineNotice>
    );
  else if (availability.kind === "revoked")
    feedback = (
      <InlineNotice
        className="mx-6 mt-3"
        title={t("agent.skillWorkbench.revokedTitle")}
        tone="danger"
      >
        {t("agent.skillWorkbench.revokedDescription")}
      </InlineNotice>
    );
  else if (!canUse)
    feedback = (
      <InlineNotice
        className="mx-6 mt-3"
        title={t("agent.skillWorkbench.viewOnlyTitle")}
      >
        {t("agent.skillWorkbench.viewOnlyDescription")}
      </InlineNotice>
    );
  const menuItems = [
    {
      key: "export",
      label: t("agent.hub.exportSkill"),
      disabled: pending,
      onClick: () => void exportPackage(),
    },
    ...(owned && canPublish && skill.runtimeStatus !== "revoked"
      ? [
          { type: "divider" as const },
          {
            key: "revoke",
            label: t("agent.hub.revokeSkill"),
            danger: true,
            disabled: pending,
            onClick: () =>
              void modal.confirm({
                title: t("agent.hub.revokeSkillConfirm"),
                okText: t("agent.hub.revokeSkill"),
                okButtonProps: { danger: true },
                onOk: () => changeStatus(skill, "revoked"),
              }),
          },
        ]
      : []),
  ];
  return (
    <>
      {modalContext}
      <SkillDetailContent
        source={{
          kind: "published",
          id: skill.id,
          revisionId: skill.skillRevisionId,
        }}
        status={
          <StatusTag tone={availability.tone}>
            {t(availability.labelKey)}
          </StatusTag>
        }
        detail={skill}
        workspaceId={workspaceId}
        canReadAssets={canReadAssets}
        selection={selection}
        renderExampleRequest={(request) => (
          <ActionLink
            block
            classNames={{ content: "whitespace-normal text-left leading-5" }}
            color="default"
            disabled={
              !canUse ||
              (availability.kind !== "usable" &&
                availability.kind !== "usable_with_changes")
            }
            icon={<ArrowRightOutlined />}
            iconPlacement="end"
            params={{ workspaceId }}
            search={{
              skillRevisionId: skill.skillRevisionId,
              initialPrompt: request,
            }}
            to="/w/$workspaceId/agent"
            variant="filled"
          >
            {request}
          </ActionLink>
        )}
        actions={
          <>
            <ResourceActions
              workspaceId={workspaceId}
              csrfToken={csrfToken}
              kind="skill"
              id={skill.id}
              additionalItems={menuItems}
              showStatus={false}
            />
            {editable && (
              <Button
                icon={<EditOutlined />}
                onClick={() => onEdit(editable.id)}
              >
                {t("agent.hub.editSkill")}
              </Button>
            )}
            {availability.kind === "disabled" &&
            owned &&
            canPublish &&
            !resourceStates.isPending &&
            !resourceStates.isError &&
            (resourceState?.state !== "disabled" ||
              (resourceState.canManage && resourceState.canEnable)) ? (
              <Button
                type="primary"
                icon={<PoweroffOutlined />}
                loading={pending}
                onClick={() => void enableSkill(skill)}
              >
                {t("agent.hub.enableSkill")}
              </Button>
            ) : null}
            {(availability.kind === "usable" ||
              availability.kind === "usable_with_changes") &&
              canUse && (
                <ActionLink
                  params={{ workspaceId }}
                  search={{ skillRevisionId: skill.skillRevisionId }}
                  to="/w/$workspaceId/agent"
                  color="primary"
                  variant="solid"
                >
                  {t("agent.hub.useSkill")}
                </ActionLink>
              )}
          </>
        }
        feedback={feedback}
      />
    </>
  );
}

export function skillReadErrorKey(error: unknown): string {
  if (!(error instanceof ApiProblem))
    return "agent.skillWorkbench.readServiceError";
  if (error.status === httpStatus.forbidden)
    return "agent.skillWorkbench.readDenied";
  if (error.status === httpStatus.notFound)
    return "agent.skillWorkbench.readMissing";
  if (error.code === "skill_library.integrity")
    return "agent.skillWorkbench.readContentMissing";
  return "agent.skillWorkbench.readServiceError";
}
