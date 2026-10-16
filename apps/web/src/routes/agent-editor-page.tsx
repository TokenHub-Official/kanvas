import {
  ResourceActions,
  ResourceUnavailable,
} from "../components/resource-lifecycle.js";
import { AgentDetailContent } from "../components/agent-detail-content.js";
import { ActionLink } from "../components/action-link.js";
import { InlineNotice } from "../components/feedback.js";
import {
  ArrowLeftOutlined,
  EditOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import type { CreateAgentHubAgentBody } from "@kanvas/contracts/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Alert, App, Button, Form, Skeleton, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createAgentHubAgent,
  ApiProblem,
  fetchAgentHubAgent,
  fetchAgentHubSkills,
  fetchBrandKits,
  fetchWorkflowDefinitions,
  updateAgentHubAgent,
} from "../api/transport.js";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import { httpStatus } from "../api/http-status.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { privateSkillIdsForWorkspaceAgent } from "../features/agent/agent-sharing.js";

type AgentEditorValue = Omit<CreateAgentHubAgentBody, "coverAssetId">;

export function NewAgentPage(): React.JSX.Element {
  return <AgentEditorRoute mode="create" />;
}

export function EditAgentPage(): React.JSX.Element {
  const { agentDefinitionId } = useParams({ strict: false });
  if (!agentDefinitionId)
    throw new Error("Agent editor route requires an Agent.");
  return <AgentEditorRoute agentDefinitionId={agentDefinitionId} mode="edit" />;
}

export function ReadAgentPage(): React.JSX.Element {
  const { agentDefinitionId } = useParams({ strict: false });
  if (!agentDefinitionId) throw new Error("Agent detail requires an Agent.");
  return <AgentEditorRoute agentDefinitionId={agentDefinitionId} mode="read" />;
}

function AgentEditorRoute({
  agentDefinitionId,
  mode,
}: {
  readonly agentDefinitionId?: string;
  readonly mode: "create" | "edit" | "read";
}): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = useParams({ strict: false });
  if (!workspaceId) throw new Error("Agent editor requires a Workspace.");
  return (
    <WorkspacePage
      pageTitle={t(
        mode === "create" ? "agent.hub.createAgent" : "agent.editor.profile",
      )}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <AgentEditor
          canCreate={
            workspace.permissions.includes("agent.manage") &&
            workspace.permissions.includes("agent.publish")
          }
          canRun={workspace.permissions.includes("agent.run")}
          canReadBrand={workspace.permissions.includes("brand.read")}
          canReadLibraries={workspace.permissions.includes("library.read")}
          canReadAssets={workspace.permissions.includes("asset.read")}
          canReadSkills={workspace.permissions.includes("skill.read")}
          canReadWorkflow={workspace.permissions.includes("workflow.read")}
          canUploadAvatar={
            workspace.permissions.includes("asset.read") &&
            workspace.permissions.includes("asset.write") &&
            workspace.permissions.includes("canvas.write")
          }
          csrfToken={context.csrfToken}
          {...(agentDefinitionId ? { agentDefinitionId } : {})}
          mode={mode}
          workspaceId={workspaceId}
        />
      )}
    </WorkspacePage>
  );
}

function AgentEditor({
  agentDefinitionId,
  canCreate,
  canRun,
  canReadBrand,
  canReadLibraries,
  canReadAssets,
  canReadSkills,
  canReadWorkflow,
  canUploadAvatar,
  csrfToken,
  mode,
  workspaceId,
}: {
  readonly agentDefinitionId?: string;
  readonly canCreate: boolean;
  readonly canRun: boolean;
  readonly canReadBrand: boolean;
  readonly canReadLibraries: boolean;
  readonly canReadAssets: boolean;
  readonly canReadSkills: boolean;
  readonly canReadWorkflow: boolean;
  readonly canUploadAvatar: boolean;
  readonly csrfToken: string;
  readonly mode: "create" | "edit" | "read";
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listSearch = useSearch({ strict: false });
  const { notification } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AgentEditorValue>();
  const watchedName = Form.useWatch("displayName", form);
  const watchedVisibility = Form.useWatch("visibility", form);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const leaveBypassRef = useRef(false);
  function markDirty(): void {
    setError(undefined);
    setDirty(true);
    setSaveComplete(false);
    leaveBypassRef.current = false;
  }
  function showFirstError({
    errorFields,
  }: {
    errorFields: { name: (string | number)[] }[];
  }): void {
    const first = errorFields[0];
    if (!first) return;

    requestAnimationFrame(() =>
      form.scrollToField(first.name, { focus: true, block: "center" }),
    );
  }
  const detail = useQuery({
    queryKey: ["agent-hub-agent", workspaceId, agentDefinitionId],
    queryFn: () => fetchAgentHubAgent(workspaceId, agentDefinitionId!),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: mode !== "create" && Boolean(agentDefinitionId),
    retry: false,
  });
  const skills = useQuery({
    queryKey: ["agent-hub-skills", workspaceId],
    queryFn: () => fetchAgentHubSkills(workspaceId),
    enabled: mode !== "read" && canReadSkills,
    retry: false,
  });
  const brands = useQuery({
    queryKey: ["brand-kits", workspaceId, "active"],
    queryFn: () => fetchBrandKits(workspaceId, { lifecycleStatus: "active" }),
    enabled: mode !== "read" && canReadBrand,
    retry: false,
  });
  const workflows = useQuery({
    queryKey: ["workflow-definitions", workspaceId, "agent-editor"],
    queryFn: () => fetchWorkflowDefinitions(workspaceId, { limit: 100 }),
    enabled: mode !== "read" && canReadWorkflow,
    retry: false,
  });
  function retryResources(): void {
    if (canReadSkills && skills.isError) void skills.refetch();
    if (canReadBrand && brands.isError) void brands.refetch();
    if (canReadWorkflow && workflows.isError) void workflows.refetch();
  }
  const current = detail.data;
  const canSave = mode === "create" ? canCreate : Boolean(current?.canEdit);

  if (mode !== "create" && detail.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1320px]">
        <Skeleton active paragraph={{ rows: 14 }} />
      </div>
    );
  }
  if (mode !== "create" && (detail.isError || !current)) {
    return (
      <div className="mx-auto w-full max-w-[1320px]">
        <ResourceUnavailable
          workspaceId={workspaceId}
          csrfToken={csrfToken}
          kind="agent"
          id={agentDefinitionId!}
        >
          <Alert
            action={
              <ActionLink
                params={{ workspaceId }}
                to="/w/$workspaceId/agents"
                size="small"
              >
                {t("agent.hub.backToAgents")}
              </ActionLink>
            }
            title={t("agent.hub.agentLoadError")}
            showIcon
            type="error"
          />
        </ResourceUnavailable>
      </div>
    );
  }
  if (mode === "create" && !canSave) {
    return (
      <div className="mx-auto w-full max-w-[1320px]">
        <Alert title={t("agent.hub.editorForbidden")} showIcon type="warning" />
      </div>
    );
  }

  const initialValues: AgentEditorValue = current
    ? {
        displayName: current.displayName,
        summary: current.summary,

        instructions: current.instructions,
        avatar: current.avatar ?? {
          kind: "icon",
          value: "robot",
          backgroundColor: "#EEF2FF",
        },
        visibility: current.visibility,
        ...(current.category ? { category: current.category } : {}),
        tags: [...current.tags],
        skillDefinitionIds: current.boundSkills.map((skill) => skill.id),
        brandKitIds: current.boundBrands.map((brand) => brand.id),
        libraryIds: (current.boundLibraries ?? []).map((library) => library.id),
        workflowDefinitionIds: current.boundWorkflows.map(
          (workflow) => workflow.id,
        ),
      }
    : {
        displayName: "",
        summary: "",

        instructions: "",
        avatar: {
          kind: "icon",
          value: "robot",
          backgroundColor: "#EEF2FF",
        },
        visibility: "private",
        tags: [],
        skillDefinitionIds: [],
        brandKitIds: [],
        libraryIds: [],
        workflowDefinitionIds: [],
      };

  async function save(value: AgentEditorValue): Promise<void> {
    if (!canSave) return;
    const privateSkillIds = privateSkillIdsForWorkspaceAgent(
      value.skillDefinitionIds,
      skills.data?.items ?? [],
      current?.boundSkills ?? [],
    );
    if (value.visibility === "workspace" && privateSkillIds.length > 0) {
      setError(
        t("agent.editor.privateSkillShareDescription", {
          count: privateSkillIds.length,
        }),
      );
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const body = {
        displayName: value.displayName.trim(),
        summary: value.summary.trim(),

        instructions: value.instructions.trim(),
        ...(value.avatar ? { avatar: value.avatar } : {}),
        visibility: value.visibility,
        ...(current?.coverAssetId
          ? { coverAssetId: current.coverAssetId }
          : {}),
        ...(current?.category ? { category: current.category } : {}),
        tags: current?.tags ?? [],
        skillDefinitionIds: canReadSkills
          ? value.skillDefinitionIds
          : (current?.boundSkills.map((skill) => skill.id) ?? []),
        libraryIds: canReadLibraries
          ? (value.libraryIds ?? [])
          : (current?.boundLibraries?.map((library) => library.id) ?? []),
        brandKitIds: canReadBrand
          ? value.brandKitIds
          : (current?.boundBrands.map((brand) => brand.id) ?? []),
        workflowDefinitionIds: canReadWorkflow
          ? value.workflowDefinitionIds
          : (current?.boundWorkflows.map((workflow) => workflow.id) ?? []),
      } as const;
      const saved = current
        ? await updateAgentHubAgent({ csrfToken, workspaceId }, current.id, {
            ...body,
            expectedVersion: current.version,
          })
        : await createAgentHubAgent(
            { csrfToken, workspaceId },
            body,
            `agent-create:${crypto.randomUUID()}`,
          );
      if (current && "boundSkills" in saved) {
        queryClient.setQueryData(
          ["agent-hub-agent", workspaceId, saved.id],
          saved,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["agent-hub-agents", workspaceId],
      });
      setDirty(false);
      setSaveComplete(true);
      notification.success({
        title: t(
          current && value.visibility === "workspace"
            ? "agent.editor.publishedUpdate"
            : "agent.editor.saved",
        ),
      });
      if (!current) {
        leaveBypassRef.current = true;
        await navigate({
          params: { workspaceId, agentDefinitionId: saved.id },
          to: "/w/$workspaceId/agents/$agentDefinitionId",
          search: {
            ...(listSearch.q ? { q: listSearch.q } : {}),
            ...(listSearch.scope === "mine" ? { scope: "mine" as const } : {}),
          },
          replace: true,
        });
      }
    } catch (error) {
      let messageKey = current
        ? "agent.hub.updateError"
        : "agent.hub.createError";
      if (
        error instanceof ApiProblem &&
        error.status >= httpStatus.internalServerError
      )
        messageKey = "agent.editor.serviceUnavailable";
      if (error instanceof ApiProblem && error.status === httpStatus.conflict)
        messageKey = "agent.editor.versionConflict";
      if (
        error instanceof ApiProblem &&
        error.code === "agent_profile_publication.skill_unavailable"
      )
        messageKey = "agent.editor.skillUnavailable";
      if (
        error instanceof ApiProblem &&
        error.code ===
          "agent_profile_publication.skill_workspace_visibility_required"
      )
        messageKey = "agent.editor.privateSkillShareError";
      setError(t(messageKey));
    } finally {
      setSaving(false);
    }
  }

  const preservedSearch = {
    ...(listSearch.q ? { q: listSearch.q } : {}),
    ...(listSearch.scope === "mine" ? { scope: "mine" as const } : {}),
  };
  const backTarget =
    current && mode === "edit"
      ? {
          to: "/w/$workspaceId/agents/$agentDefinitionId" as const,
          params: { workspaceId, agentDefinitionId: current.id },
          search: preservedSearch,
        }
      : {
          to: "/w/$workspaceId/agents" as const,
          params: { workspaceId },
          search: preservedSearch,
        };
  const publishingWorkspaceUpdate = Boolean(
    current && (watchedVisibility ?? current.visibility) === "workspace",
  );
  let saveActionKey = current
    ? "agent.editor.saveChanges"
    : "agent.hub.createAgent";
  if (publishingWorkspaceUpdate) {
    saveActionKey = "agent.editor.publishUpdate";
  }
  if ((mode === "read" || (mode === "edit" && current?.isDefault)) && current) {
    return (
      <div className="mx-auto w-full max-w-[1320px]">
        <ActionLink
          {...backTarget}
          variant="text"
          color="default"
          className="mb-4"
          icon={<ArrowLeftOutlined />}
        >
          {t("agent.hub.backToAgents")}
        </ActionLink>
        <div className="rounded-xl bg-paper p-5 sm:p-6">
          <AgentDetailContent
            detail={current}
            workspaceId={workspaceId}
            resourceReturnTo={`/w/${workspaceId}/agents/${current.id}?${new URLSearchParams(preservedSearch).toString()}`}
            {...(!current.isDefault
              ? {
                  creatorName:
                    current.creatorDisplayName ?? t("agent.hub.teamMember"),
                }
              : {})}
            permissions={{
              assets: canReadAssets,
              brands: canReadBrand,
              libraries: canReadLibraries,
              skills: canReadSkills,
              workflows: canReadWorkflow,
            }}
            actions={
              <>
                <ResourceActions
                  workspaceId={workspaceId}
                  csrfToken={csrfToken}
                  kind="agent"
                  id={current.id}
                />
                {current.canEdit && (
                  <ActionLink
                    to="/w/$workspaceId/agents/$agentDefinitionId/edit"
                    params={{ workspaceId, agentDefinitionId: current.id }}
                    search={preservedSearch}
                    icon={<EditOutlined />}
                  >
                    {t("agent.hub.editAgent")}
                  </ActionLink>
                )}
                {canRun && current.resourceState === "enabled" && (
                  <ActionLink
                    to="/w/$workspaceId/agent"
                    params={{ workspaceId }}
                    search={{ agentDefinitionId: current.id }}
                    color="primary"
                    variant="solid"
                  >
                    {t("agent.hub.useAgent")}
                  </ActionLink>
                )}
              </>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <Form<AgentEditorValue>
        form={form}
        initialValues={initialValues}
        key={current ? `${current.id}:${String(current.version)}` : "new-agent"}
        disabled={saving || !canSave}
        onValuesChange={markDirty}
        onFinishFailed={showFirstError}
        layout="vertical"
        onFinish={(value) => void save(value)}
      >
        <div className="sticky top-[62px] z-20 mb-4 flex flex-wrap items-center justify-between gap-3 bg-mist/95 py-2 backdrop-blur-sm">
          <div>
            <ActionLink
              {...backTarget}
              color="default"
              variant="text"
              className="mb-2"
              icon={<ArrowLeftOutlined />}
            >
              {t(
                current ? "agent.design.backDetails" : "agent.hub.backToAgents",
              )}
            </ActionLink>
            <h1 className="m-0 max-w-[70vw] truncate text-lg font-semibold text-ink sm:max-w-xl">
              {watchedName ||
                current?.displayName ||
                t("agent.hub.createAgent")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span role="status" className="text-xs text-muted">
              {dirty && t("agent.editor.unsaved")}
              {!dirty &&
                saveComplete &&
                t(
                  publishingWorkspaceUpdate
                    ? "agent.editor.publishedUpdate"
                    : "agent.editor.saved",
                )}
            </span>
            {!canSave && <Tag>{t("agent.editor.readOnly")}</Tag>}
            {current && canRun ? (
              <ActionLink
                params={{ workspaceId }}
                search={{ agentDefinitionId: current.id }}
                to="/w/$workspaceId/agent"
                disabled={saving || dirty}
                title={dirty ? t("agent.editor.saveBeforeChat") : undefined}
              >
                {t("agent.hub.useAgent")}
              </ActionLink>
            ) : null}
            {canSave ? (
              <Button
                disabled={Boolean(current) && !dirty}
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saving}
                type="primary"
              >
                {t(saveActionKey)}
              </Button>
            ) : null}
          </div>
        </div>

        {publishingWorkspaceUpdate ? (
          <InlineNotice
            className="mb-5"
            title={t("agent.editor.publishUpdate")}
            tone="info"
          >
            {t("agent.editor.publishUpdateDescription")}
          </InlineNotice>
        ) : null}

        {error ? (
          <InlineNotice className="mb-5" title={error} tone="danger" />
        ) : null}

        <AgentDetailContent
          mode="edit"
          editor={{
            workspaceId,
            csrfToken,
            ...(current ? { current } : {}),
            canSave,
            saving,
            canReadAssets,
            canReadSkills,
            canReadBrand,
            canReadLibraries,
            canReadWorkflow,
            canUploadAvatar,
            skills,
            brands,
            workflows,
            retryResources,
          }}
        />
      </Form>
      <UnsavedChangesGuard
        active={dirty || saving}
        bypass={leaveBypassRef}
        title={t("agent.editor.leaveTitle")}
        actionLabel={t("agent.editor.discard")}
        cancelLabel={t("agent.editor.keepEditing")}
      >
        {t("agent.editor.leaveDescription")}
      </UnsavedChangesGuard>
    </div>
  );
}
