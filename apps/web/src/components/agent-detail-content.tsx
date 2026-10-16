import { Link } from "@tanstack/react-router";
import { AgentLibraryPicker } from "../features/resource-libraries/agent-library-picker.js";
import {
  BgColorsOutlined,
  BranchesOutlined,
  LockOutlined,
  ReadOutlined,
  RightOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type {
  AgentHubAgentDetail,
  AgentHubSkills,
} from "@kanvas/contracts/api";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, Form, Input, Radio } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";
import type {
  fetchBrandKits,
  fetchWorkflowDefinitions,
} from "../api/transport.js";
import { AgentAvatar } from "./agent-avatar.js";
import { AgentAvatarEditor } from "./agent-avatar-editor.js";
import { AgentResourcePicker } from "./agent-resource-picker.js";
import { InlineNotice } from "./feedback.js";
import { MarkdownEditor } from "./markdown-editor.js";
import { StatusTag } from "./status-tag.js";
import { privateSkillIdsForWorkspaceAgent } from "../features/agent/agent-sharing.js";
import { agentDisplaySummary } from "../features/agent/agent-presentation.js";

const linkedResourceClassName =
  "inline-flex max-w-full items-center gap-2 rounded-control border border-line bg-mist/50 px-2.5 py-1.5 text-left text-sm text-ink no-underline hover:bg-primary-soft hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

type ResourceQuery<T> = Pick<
  UseQueryResult<T>,
  "data" | "isPending" | "isError"
>;
type AgentEditorContent = {
  readonly workspaceId: string;
  readonly csrfToken: string;
  readonly current?: AgentHubAgentDetail;
  readonly canSave: boolean;
  readonly saving: boolean;
  readonly canReadAssets: boolean;
  readonly canReadSkills: boolean;
  readonly canReadBrand: boolean;
  readonly canReadLibraries?: boolean;
  readonly canReadWorkflow: boolean;
  readonly canUploadAvatar: boolean;
  readonly skills: ResourceQuery<AgentHubSkills>;
  readonly brands: ResourceQuery<Awaited<ReturnType<typeof fetchBrandKits>>>;
  readonly workflows: ResourceQuery<
    Awaited<ReturnType<typeof fetchWorkflowDefinitions>>
  >;
  readonly retryResources: () => void;
};
export type AgentLinkedResource = {
  readonly kind: "skill" | "brand" | "workflow";
  readonly id: string;
  readonly name: string;
};

type AgentReadContent = {
  readonly mode?: "read";
  readonly detail: AgentHubAgentDetail;
  readonly workspaceId: string;
  readonly creatorName?: string;
  readonly resourceReturnTo?: string;
  readonly onOpenResource?: (resource: AgentLinkedResource) => void;
  readonly permissions: {
    readonly assets: boolean;
    readonly brands: boolean;
    readonly libraries?: boolean;
    readonly skills: boolean;
    readonly workflows: boolean;
  };
  readonly actions?: ReactNode;
};

export function AgentDetailContent(
  props:
    | AgentReadContent
    | { readonly mode: "edit"; readonly editor: AgentEditorContent },
): React.JSX.Element {
  return props.mode === "edit" ? (
    <AgentEditableBody {...props.editor} />
  ) : (
    <AgentReadBody {...props} />
  );
}
function AgentEditableBody({
  workspaceId,
  csrfToken,
  current,
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
}: AgentEditorContent): React.JSX.Element {
  const { t } = useTranslation();
  const watchedVisibility = Form.useWatch("visibility") as
    "private" | "workspace" | undefined;
  const watchedSkillDefinitionIds = Form.useWatch("skillDefinitionIds") as
    readonly string[] | undefined;
  const visibility = watchedVisibility ?? current?.visibility ?? "private";
  const selectedSkillDefinitionIds =
    watchedSkillDefinitionIds ??
    current?.boundSkills.map((skill) => skill.id) ??
    [];
  const privateSkillIds = privateSkillIdsForWorkspaceAgent(
    selectedSkillDefinitionIds,
    skills.data?.items ?? [],
    current?.boundSkills ?? [],
  );
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 gap-5">
        <section className="grid gap-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
            <Form.Item name="avatar" noStyle>
              <AgentAvatarEditor
                disabled={saving || !canSave}
                canReadAssets={canReadAssets}
                canUpload={canUploadAvatar}
                csrfToken={csrfToken}
                workspaceId={workspaceId}
              />
            </Form.Item>
            <Form.Item
              className="mb-2"
              label={t("agent.hub.name")}
              name="displayName"
              rules={[{ required: true, whitespace: true, max: 160 }]}
            >
              <Input
                maxLength={160}
                placeholder={t("agent.authoring.agentName")}
              />
            </Form.Item>
          </div>
          <div className="grid gap-4">
            <Form.Item
              className="mb-2"
              label={t("agent.hub.summary")}
              name="summary"
              rules={[{ required: true, whitespace: true, max: 600 }]}
            >
              <Input.TextArea
                placeholder={t("agent.editor.summaryPlaceholder")}
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={600}
              />
            </Form.Item>
          </div>
        </section>

        <section className="grid gap-3">
          <Form.Item
            label={t("agent.editor.coreInstructions")}
            name="instructions"
            rules={[{ required: true, whitespace: true, min: 24, max: 8_000 }]}
          >
            <MarkdownEditor
              maxLength={8_000}
              disabled={saving || !canSave}
              readOnly={!canSave}
              defaultMode={current ? "preview" : "edit"}
            />
          </Form.Item>
        </section>
      </div>
      <aside className="grid min-w-0 gap-5 xl:sticky xl:top-40">
        <section className="grid gap-4 rounded-xl bg-paper p-4">
          <div>
            <h2 className="m-0 text-sm font-semibold text-ink">
              {t("agent.editor.abilities")}
            </h2>
          </div>
          {(canReadSkills && skills.isError) ||
          (canReadBrand && brands.isError) ||
          (canReadWorkflow && workflows.isError) ? (
            <InlineNotice
              title={t("agent.editor.resourceLoadError")}
              action={
                <Button onClick={retryResources} size="small">
                  {t("agent.editor.retry")}
                </Button>
              }
              tone="danger"
            />
          ) : null}
          {canReadSkills ? (
            <>
              {visibility === "workspace" && privateSkillIds.length > 0 ? (
                <InlineNotice
                  title={t("agent.editor.privateSkillShareTitle")}
                  tone="warning"
                >
                  {t("agent.editor.privateSkillShareDescription", {
                    count: privateSkillIds.length,
                  })}
                </InlineNotice>
              ) : null}
              <Form.Item className="mb-0" name="skillDefinitionIds">
                <AgentResourcePicker
                  kind="skills"
                  workspaceId={workspaceId}
                  canReadAssets={canReadAssets}
                  disabled={saving || !canSave}
                  loading={skills.isPending}
                  resources={[
                    ...(skills.data?.items ?? [])
                      .filter((skill) => skill.runtimeStatus === "enabled")
                      .map((skill) => ({
                        ...skill,
                        summary:
                          skill.visibility === "private"
                            ? `${t("agent.editor.boundSkillAvailability.private")} · ${skill.summary}`
                            : skill.summary,
                      })),
                    ...(current?.boundSkills ?? [])
                      .filter(
                        (bound) =>
                          !(skills.data?.items ?? []).some(
                            (skill) =>
                              skill.id === bound.id &&
                              skill.runtimeStatus === "enabled",
                          ),
                      )
                      .map((bound) => ({
                        id: bound.id,
                        displayName:
                          bound.displayName ??
                          t("agent.editor.unavailableSkillName"),
                        summary: `${t(`agent.editor.boundSkillAvailability.${bound.workspaceAvailability}`)}${bound.summary ? ` · ${bound.summary}` : ""}`,
                      })),
                  ]}
                />
              </Form.Item>
            </>
          ) : null}
          {canReadLibraries ? (
            <Form.Item className="mb-0" name="libraryIds">
              <AgentLibraryPicker
                workspaceId={workspaceId}
                disabled={saving || !canSave}
                bound={current?.boundLibraries ?? []}
              />
            </Form.Item>
          ) : null}
          {canReadBrand ? (
            <Form.Item className="mb-0" name="brandKitIds">
              <AgentResourcePicker
                kind="brands"
                workspaceId={workspaceId}
                canReadAssets={canReadAssets}
                disabled={saving || !canSave}
                loading={brands.isPending}
                resources={[
                  ...(brands.data?.items ?? []).map((brand) => ({
                    id: brand.id,
                    displayName: brand.name,
                    ...(brand.description
                      ? { summary: brand.description }
                      : {}),
                  })),
                  ...(current?.boundBrands ?? [])
                    .filter(
                      (bound) =>
                        !(brands.data?.items ?? []).some(
                          (brand) => brand.id === bound.id,
                        ),
                    )
                    .map((brand) => ({
                      id: brand.id,
                      displayName: brand.displayName,
                      ...(brand.description
                        ? { summary: brand.description }
                        : {}),
                    })),
                ]}
              />
            </Form.Item>
          ) : null}
          {canReadWorkflow ? (
            <Form.Item className="mb-0" name="workflowDefinitionIds">
              <AgentResourcePicker
                kind="workflows"
                workspaceId={workspaceId}
                canReadAssets={canReadAssets}
                disabled={saving || !canSave}
                loading={workflows.isPending}
                resources={[
                  ...(workflows.data?.items ?? [])
                    .filter((workflow) => workflow.lifecycleStatus === "active")
                    .map((workflow) => ({
                      id: workflow.id,
                      displayName: workflow.displayName,
                      ...(workflow.description
                        ? { summary: workflow.description }
                        : {}),
                    })),
                  ...(current?.boundWorkflows ?? [])
                    .filter(
                      (bound) =>
                        !(workflows.data?.items ?? []).some(
                          (workflow) =>
                            workflow.id === bound.id &&
                            workflow.lifecycleStatus === "active",
                        ),
                    )
                    .map((workflow) => ({
                      id: workflow.id,
                      displayName: workflow.displayName,
                      ...(workflow.description
                        ? { summary: workflow.description }
                        : {}),
                    })),
                ]}
              />
            </Form.Item>
          ) : null}
        </section>
        <section className="px-4">
          <Form.Item
            className="mb-0"
            label={t("agent.hub.visibilityLabel")}
            name="visibility"
          >
            <Radio.Group
              className="grid gap-3"
              options={[
                {
                  value: "private",
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <LockOutlined />
                      {t("agent.hub.visibility.private")}
                    </span>
                  ),
                },
                {
                  value: "workspace",
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <TeamOutlined />
                      {t("agent.hub.visibility.workspace")}
                    </span>
                  ),
                },
              ]}
            />
          </Form.Item>
        </section>
      </aside>
    </div>
  );
}
function AgentReadBody({
  detail,
  workspaceId,
  creatorName,
  resourceReturnTo,
  onOpenResource,
  permissions,
  actions,
}: AgentReadContent): React.JSX.Element {
  const { t } = useTranslation();
  const hasBoundResources =
    detail.boundSkills.length +
      (detail.boundLibraries?.length ?? 0) +
      detail.boundBrands.length +
      detail.boundWorkflows.length >
    0;
  let identityStatus: React.JSX.Element | null = null;
  if (
    detail.resourceState === "disabled" ||
    detail.resourceState === "deleted"
  ) {
    identityStatus = (
      <StatusTag
        tone={detail.resourceState === "deleted" ? "danger" : "warning"}
      >
        {t(`agent.lifecycle.${detail.resourceState}`)}
      </StatusTag>
    );
  } else if (detail.isDefault) {
    identityStatus = <StatusTag>{t("agent.hub.systemDefault")}</StatusTag>;
  }
  return (
    <div className="@container/agent-detail grid min-w-0 gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <AgentAvatar
          alt={detail.displayName}
          isDefault={detail.isDefault}
          {...(detail.avatar ? { avatar: detail.avatar } : {})}
          canReadAssets={permissions.assets}
          workspaceId={workspaceId}
          className="size-14 rounded-2xl text-xl"
        />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 break-words text-lg font-semibold">
            {detail.displayName}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
            {identityStatus}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {detail.visibility === "workspace" ? (
                <TeamOutlined aria-hidden="true" />
              ) : (
                <LockOutlined aria-hidden="true" />
              )}
              {t(`agent.hub.visibility.${detail.visibility}`)}
            </span>
            {!detail.isDefault && creatorName ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <span className="text-muted">{t("agent.hub.creator")}</span>
                <span className="truncate text-ink">{creatorName}</span>
              </span>
            ) : null}
          </div>
          <p className="mt-3 mb-0 max-w-[65ch] text-sm leading-6 text-muted">
            {agentDisplaySummary(detail, t("agent.hub.defaultAgentSummary"))}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div
        className={
          hasBoundResources
            ? "grid items-start gap-6 @[48rem]/agent-detail:grid-cols-[minmax(0,1fr)_320px]"
            : "grid items-start gap-6"
        }
      >
        <div className="grid min-w-0 gap-6">
          <section className="max-w-[75ch]">
            <h3 className="mt-0 mb-4 text-xs font-medium text-muted">
              {t("agent.editor.coreInstructions")}
            </h3>
            <Streamdown mode="static" className="agent-markdown max-w-[75ch]">
              {detail.instructions}
            </Streamdown>
          </section>
        </div>
        {hasBoundResources ? (
          <aside className="grid min-w-0 gap-5">
            <h3 className="m-0 text-base font-semibold">
              {t("agent.editor.abilities")}
            </h3>
            <p className="m-0 text-sm leading-5 text-muted">
              {t("agent.hub.boundResourcesDescription")}
            </p>
            {(detail.boundLibraries?.length ?? 0) > 0 && (
              <section>
                <h4 className="mt-0 mb-2 text-xs font-medium text-muted">
                  {t("libraries.title")}
                </h4>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {(detail.boundLibraries ?? []).map((library) => (
                    <li className="max-w-full" key={library.id}>
                      {permissions.libraries ? (
                        <Link
                          className={linkedResourceClassName}
                          to="/w/$workspaceId/libraries/$libraryId"
                          params={{ workspaceId, libraryId: library.id }}
                        >
                          <ReadOutlined aria-hidden="true" />
                          <span className="line-clamp-2 min-w-0 break-words">
                            {library.displayName}
                          </span>
                          <RightOutlined
                            aria-hidden="true"
                            className="shrink-0 text-[10px] text-muted"
                          />
                        </Link>
                      ) : (
                        <span className="text-sm text-muted">
                          {library.displayName}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {[
              {
                key: "skillsTitle",
                kind: "skill" as const,
                icon: <ReadOutlined aria-hidden="true" />,
                items: detail.boundSkills,
                allowed: permissions.skills,
                href: (id: string) => `/w/${workspaceId}/skills/${id}`,
              },
              {
                key: "brands",
                kind: "brand" as const,
                icon: <BgColorsOutlined aria-hidden="true" />,
                items: detail.boundBrands,
                allowed: permissions.brands,
                href: (id: string) =>
                  `/w/${workspaceId}/brand?brandKitId=${id}`,
              },
              {
                key: "workflows",
                kind: "workflow" as const,
                icon: <BranchesOutlined aria-hidden="true" />,
                items: detail.boundWorkflows,
                allowed: permissions.workflows,
                href: (id: string) => `/w/${workspaceId}/workflows/${id}`,
              },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <section key={group.key}>
                  <h4 className="mt-0 mb-2 text-xs font-medium text-muted">
                    {t(`agent.hub.${group.key}`)}
                  </h4>
                  <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                    {group.items.map((item) => {
                      const workspaceAvailability =
                        "workspaceAvailability" in item
                          ? item.workspaceAvailability
                          : "available";
                      const itemName =
                        item.displayName ??
                        t("agent.editor.unavailableSkillName");
                      const availabilityLabel =
                        workspaceAvailability !== "available"
                          ? t(
                              `agent.editor.boundSkillAvailability.${workspaceAvailability}`,
                            )
                          : undefined;
                      const readable =
                        workspaceAvailability === "available" ||
                        (workspaceAvailability === "private" &&
                          Boolean(item.displayName));
                      const content = (
                        <>
                          {group.icon}
                          <span className="line-clamp-2 min-w-0 break-words">
                            {itemName}
                            {availabilityLabel ? (
                              <span className="ml-2 text-xs text-muted">
                                {availabilityLabel}
                              </span>
                            ) : null}
                          </span>
                          {readable ? (
                            <RightOutlined
                              aria-hidden="true"
                              className="shrink-0 text-[10px] text-muted"
                            />
                          ) : null}
                        </>
                      );
                      const className = linkedResourceClassName;
                      let entry = (
                        <span className="inline-flex max-w-full items-center gap-2 text-sm text-muted">
                          {content}
                        </span>
                      );
                      if (group.allowed && readable) {
                        entry = onOpenResource ? (
                          <button
                            className={className}
                            onClick={() =>
                              onOpenResource({
                                kind: group.kind,
                                id: item.id,
                                name: itemName,
                              })
                            }
                            type="button"
                          >
                            {content}
                          </button>
                        ) : (
                          <a
                            className={className}
                            href={`${group.href(item.id)}${group.key === "brands" ? "&" : "?"}returnTo=${encodeURIComponent(resourceReturnTo ?? `/w/${workspaceId}/agents/${detail.id}`)}`}
                          >
                            {content}
                          </a>
                        );
                      }
                      return (
                        <li className="max-w-full" key={item.id}>
                          {entry}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
