import { ResourceActions, ResourceUnavailable } from "./resource-lifecycle.js";
import { EditOutlined } from "@ant-design/icons";
import type { AgentHubSkill } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import { useTranslation } from "react-i18next";
import { fetchSkillDraft } from "../api/transport.js";
import { InlineNotice } from "./feedback.js";
import { SkillDetailContent } from "./skill-detail-content.js";
import { SkillDraftActions } from "./skill-draft-actions.js";
import type { SkillFileSelection } from "./skill-content-browser.js";
import { StatusTag } from "./status-tag.js";
import { skillAvailability } from "./skill-availability.js";

export function SkillDraftDetailPanel({
  workspaceId,
  draftId,
  csrfToken,
  canReadAssets,
  canPublish,
  imported = false,
  published,
  resourceState,
  onEdit,
  selection,
}: {
  readonly workspaceId: string;
  readonly draftId: string;
  readonly csrfToken: string;
  readonly canReadAssets: boolean;
  readonly canPublish: boolean;
  readonly imported?: boolean;
  readonly published?: AgentHubSkill;
  readonly resourceState?: "enabled" | "disabled" | "deleted";
  readonly onEdit: (id: string) => void;
  readonly selection: SkillFileSelection;
}): React.JSX.Element {
  const { t } = useTranslation();
  const result = useQuery({
    queryKey: ["skill-draft", workspaceId, draftId],
    queryFn: () => fetchSkillDraft(workspaceId, draftId),
    retry: false,
  });
  if (result.isPending)
    return (
      <div className="p-6">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  if (!result.data)
    return (
      <div className="p-6">
        <ResourceUnavailable
          workspaceId={workspaceId}
          csrfToken={csrfToken}
          kind="skill"
          id={draftId}
        >
          <InlineNotice
            title={t("agent.hub.skillUnavailable")}
            action={
              <Button onClick={() => void result.refetch()}>
                {t("agent.editor.retry")}
              </Button>
            }
            tone="danger"
          />
        </ResourceUnavailable>
      </div>
    );
  const draft = result.data;
  const availability = skillAvailability({
    draft,
    ...(published ? { published } : {}),
    ...(resourceState ? { resourceState } : {}),
  });
  const notice = (() => {
    if (availability.kind === "needs_publish")
      return {
        title: t(
          imported
            ? "agent.skillWorkbench.importedDraftTitle"
            : "agent.skillWorkbench.needsPublishTitle",
        ),
        description: t("agent.skillWorkbench.needsPublishDescription"),
        tone: "info" as const,
      };
    if (availability.kind === "usable_with_changes")
      return {
        title: t("agent.skillWorkbench.publishedVersionUsableTitle"),
        description: t(
          "agent.skillWorkbench.publishedVersionUsableDescription",
        ),
        tone: "info" as const,
      };
    if (availability.kind === "disabled")
      return {
        title: t("agent.skillWorkbench.disabledTitle"),
        description: t(
          published
            ? "agent.skillWorkbench.disabledDescription"
            : "agent.skillWorkbench.disabledDraftDescription",
        ),
        tone: "warning" as const,
      };
    return undefined;
  })();
  return (
    <SkillDetailContent
      detail={draft}
      workspaceId={workspaceId}
      canReadAssets={canReadAssets}
      selection={selection}
      source={{ kind: "draft", id: draft.id, version: draft.draftVersion }}
      status={
        <StatusTag tone={availability.tone}>
          {t(availability.labelKey)}
        </StatusTag>
      }
      feedback={
        notice ? (
          <InlineNotice
            className="mx-4 mt-3"
            title={notice.title}
            tone={notice.tone}
          >
            {notice.description}
          </InlineNotice>
        ) : undefined
      }
      actions={
        <>
          <ResourceActions
            workspaceId={workspaceId}
            csrfToken={csrfToken}
            kind="skill"
            id={draft.skillDefinitionId}
            showStatus={false}
          />
          <Button icon={<EditOutlined />} onClick={() => onEdit(draft.id)}>
            {t("agent.hub.editSkill")}
          </Button>
          <SkillDraftActions
            draft={draft}
            workspaceId={workspaceId}
            csrfToken={csrfToken}
            canPublish={canPublish}
            disabled={false}
          />
        </>
      }
    />
  );
}
