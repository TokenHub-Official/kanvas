import {
  catalogGridClassName,
  catalogRowLayoutClassName,
  catalogRowClassName,
  catalogEntryLinkClassName,
  catalogActionClassName,
} from "../components/catalog-layout.js";
import {
  ResourceActions,
  ResourceTrash,
  useResourceStates,
} from "../components/resource-lifecycle.js";
import {
  ArrowLeftOutlined,
  RightOutlined,
  PlusOutlined,
  ReadOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type {
  AgentHubSkill,
  AgentHubSkills,
  SkillDraftSummary,
} from "@kanvas/contracts/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Upload,
} from "antd";
import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchAgentHubSkills,
  fetchSkillDrafts,
  importSkillPackage,
} from "../api/transport.js";
import { ActionLink } from "../components/action-link.js";
import { AssetArtwork } from "../components/asset-artwork.js";
import { SkillDetailPanel } from "../components/skill-detail-panel.js";
import { SkillDraftDetailPanel } from "../components/skill-draft-detail-panel.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { skillErrorKey } from "../components/skill-error.js";
import {
  skillAvailability,
  type SkillAvailability,
  skillPublicationStage,
  type SkillPublicationStage,
} from "../components/skill-availability.js";
import { StatusTag } from "../components/status-tag.js";
import { SkillEditor } from "./skill-editor-page.js";

const maximumSkillArchiveBytes = 67_108_864;

export function skillMatchesQuery(
  item: { displayName: string; summary: string; tags: readonly string[] },
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return [item.displayName, item.summary, ...item.tags].some((value) =>
    value.toLocaleLowerCase().includes(normalized),
  );
}
type SkillView =
  { kind: "published" | "draft"; id: string } | { kind: "edit"; id?: string };
type SkillEntry = {
  kind: "published" | "draft";
  id: string;
  item: AgentHubSkills["items"][number] | SkillDraftSummary;
  availability: SkillAvailability;
  publicationStage: SkillPublicationStage;
  published?: AgentHubSkill;
};
export function SkillsPage(): React.JSX.Element {
  return <SkillsHubPage />;
}
export function SkillDetailPage(): React.JSX.Element {
  const { skillDefinitionId } = useParams({ strict: false });
  if (!skillDefinitionId) throw new Error("Skill route requires an id.");
  return (
    <SkillsHubPage initialView={{ kind: "published", id: skillDefinitionId }} />
  );
}
export function SkillDraftPage(): React.JSX.Element {
  const { skillDraftId } = useParams({ strict: false });
  if (!skillDraftId) throw new Error("Skill draft route requires an id.");
  return <SkillsHubPage initialView={{ kind: "draft", id: skillDraftId }} />;
}
export function NewSkillPage(): React.JSX.Element {
  return <SkillsHubPage initialView={{ kind: "edit" }} />;
}
export function EditSkillPage(): React.JSX.Element {
  const { skillDraftId } = useParams({ strict: false });
  if (!skillDraftId) throw new Error("Skill editor route requires an id.");
  return <SkillsHubPage initialView={{ kind: "edit", id: skillDraftId }} />;
}
function SkillsHubPage({
  initialView,
}: {
  readonly initialView?: SkillView;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = useParams({ strict: false });
  if (!workspaceId) throw new Error("Skills require a workspace.");
  return (
    <WorkspacePage
      pageTitle={t("agent.hub.skillsTitle")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SkillsContent
          key={
            initialView
              ? `${initialView.kind}:${initialView.id ?? "new"}`
              : "list"
          }
          workspaceId={workspaceId}
          csrfToken={context.csrfToken}
          principalId={context.human.principalId}
          canManage={workspace.permissions.includes("skill.manage")}
          canPublish={workspace.permissions.includes("skill.publish")}
          canUse={
            workspace.permissions.includes("agent.run") &&
            workspace.permissions.includes("skill.use")
          }
          canReadAssets={workspace.permissions.includes("asset.read")}
          canUploadAssets={workspace.permissions.includes("asset.write")}
          {...(initialView ? { initialView } : {})}
        />
      )}
    </WorkspacePage>
  );
}
function SkillsContent({
  workspaceId,
  csrfToken,
  principalId,
  canManage,
  canPublish,
  canUse,
  canReadAssets,
  canUploadAssets,
  initialView,
}: {
  readonly workspaceId: string;
  readonly csrfToken: string;
  readonly principalId: string;
  readonly canManage: boolean;
  readonly canPublish: boolean;
  readonly canUse: boolean;
  readonly canReadAssets: boolean;
  readonly canUploadAssets: boolean;
  readonly initialView?: SkillView;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const queryClient = useQueryClient();
  const view = initialView;
  const [file, setFile] = useState(search.file ?? "SKILL.md");
  const [query, setQuery] = useState(search.q ?? "");
  const mine = search.scope === "mine";
  const statusFilter = search.status ?? "all";
  const [editState, setEditState] = useState({ dirty: false, saving: false });
  const [uploading, setUploading] = useState(false);
  const [importFile, setImportFile] = useState<File>();
  const [filenameEncoding, setFilenameEncoding] = useState("auto");
  const [error, setError] = useState<string>();
  const resourceStates = useResourceStates(workspaceId, "skill");
  const skills = useQuery({
    queryKey: ["agent-hub-skills", workspaceId],
    queryFn: () => fetchAgentHubSkills(workspaceId),
    retry: false,
  });
  const drafts = useQuery({
    queryKey: ["skill-drafts", workspaceId],
    queryFn: () => fetchSkillDrafts(workspaceId),
    enabled: canManage,
    retry: false,
  });
  const searchState = {
    ...(mine ? { scope: "mine" as const } : {}),
    ...(query ? { q: query } : {}),
    ...(search.returnTo ? { returnTo: search.returnTo } : {}),
    ...(search.status ? { status: search.status } : {}),
  };
  function filterSkills(next: {
    q?: string | undefined;
    scope?: "mine" | undefined;
    status?: string | undefined;
    returnTo?: string | undefined;
  }): void {
    void navigate({
      to: "/w/$workspaceId/skills",
      params: { workspaceId },
      search: {
        ...(next.q ? { q: next.q } : {}),
        ...(next.scope ? { scope: next.scope } : {}),
        ...(next.status ? { status: next.status } : {}),
        ...(next.returnTo ? { returnTo: next.returnTo } : {}),
      },
      replace: true,
      resetScroll: false,
    });
  }
  function open(
    next: SkillView | undefined,
    resetFile = true,
    replace = false,
    notice?: "imported",
  ): void {
    if (editState.saving) return;
    const nextSearch = {
      ...searchState,
      ...(!resetFile && file !== "SKILL.md" ? { file } : {}),
      ...(notice ? { notice } : {}),
    };
    if (!next) {
      void navigate({
        to: "/w/$workspaceId/skills",
        params: { workspaceId },
        search: searchState,
        replace,
      });
    } else if (next.kind === "published") {
      void navigate({
        to: "/w/$workspaceId/skills/$skillDefinitionId",
        params: { workspaceId, skillDefinitionId: next.id },
        search: nextSearch,
        replace,
      });
    } else if (next.kind === "draft") {
      void navigate({
        to: "/w/$workspaceId/skills/drafts/$skillDraftId",
        params: { workspaceId, skillDraftId: next.id },
        search: nextSearch,
        replace,
      });
    } else if (next.id) {
      void navigate({
        to: "/w/$workspaceId/skills/drafts/$skillDraftId/edit",
        params: { workspaceId, skillDraftId: next.id },
        search: nextSearch,
        replace,
      });
    } else {
      void navigate({
        to: "/w/$workspaceId/skills/new",
        params: { workspaceId },
        search: searchState,
        replace,
      });
    }
  }
  async function upload(file: File): Promise<void> {
    if (file.size === 0 || file.size > maximumSkillArchiveBytes) {
      setError(t("agent.skillErrors.limit"));
      return;
    }
    setUploading(true);
    setError(undefined);
    try {
      const imported = await importSkillPackage(
        { csrfToken, workspaceId },
        file,
        `skill-import:${crypto.randomUUID()}`,
        undefined,
        filenameEncoding,
      );
      await queryClient.invalidateQueries({
        queryKey: ["skill-drafts", workspaceId],
      });
      setImportFile(undefined);
      open({ kind: "draft", id: imported.id }, true, false, "imported");
    } catch (error) {
      setError(t(skillErrorKey(error)));
    } finally {
      setUploading(false);
    }
  }
  function handleSavedSkillDraft(saved: SkillDraftSummary): void {
    setEditState({ dirty: false, saving: false });
    if (view?.kind !== "edit" || view.id) return;
    void navigate({
      to: "/w/$workspaceId/skills/drafts/$skillDraftId/edit",
      params: { workspaceId, skillDraftId: saved.id },
      search: {
        ...searchState,
        ...(file !== "SKILL.md" ? { file } : {}),
      },
      replace: true,
    });
  }
  function changeSkillQuery(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setQuery(value);
    filterSkills({ ...searchState, q: value });
  }
  function retrySkillDirectory(): void {
    void skills.refetch();
    if (canManage) void drafts.refetch();
  }
  const draftByDefinition = new Map(
    (drafts.data?.items ?? []).map((d) => [d.skillDefinitionId, d]),
  );
  const entries: SkillEntry[] = [];
  const included = new Set<string>();
  const resourceState = (definitionId: string) =>
    resourceStates.data?.items.find((item) => item.id === definitionId)?.state;
  for (const item of skills.data?.items ?? []) {
    if (mine && item.ownerPrincipalId !== principalId) continue;
    const draft = draftByDefinition.get(item.id);
    included.add(item.id);
    if (draft && !draft.publishedCurrent) {
      entries.push({
        kind: "draft",
        id: draft.id,
        item: draft,
        availability: skillAvailability({
          draft,
          published: item,
          resourceState: resourceState(item.id),
        }),
        publicationStage: skillPublicationStage({ draft, published: item }),
        published: item,
      });
    } else
      entries.push({
        kind: "published",
        id: item.id,
        item,
        availability: skillAvailability({
          published: item,
          resourceState: resourceState(item.id),
        }),
        publicationStage: skillPublicationStage({ published: item }),
        published: item,
      });
  }
  for (const draft of drafts.data?.items ?? [])
    if (!included.has(draft.skillDefinitionId))
      entries.push({
        kind: "draft",
        id: draft.id,
        item: draft,
        availability: skillAvailability({
          draft,
          resourceState: resourceState(draft.skillDefinitionId),
        }),
        publicationStage: skillPublicationStage({ draft }),
      });
  const filtered = entries.filter(
    (entry) =>
      skillMatchesQuery(entry.item, query) &&
      (statusFilter === "all" ||
        (statusFilter === "draft" && entry.publicationStage === "draft") ||
        (statusFilter === "published" && Boolean(entry.published)) ||
        (statusFilter === "changes" && entry.publicationStage === "changes") ||
        (statusFilter === "unavailable" &&
          (entry.availability.kind === "disabled" ||
            entry.availability.kind === "revoked" ||
            entry.availability.kind === "unavailable"))),
  );
  const loading = skills.isPending || (canManage && drafts.isPending);
  const failed = skills.isError || (canManage && drafts.isError);
  const selection = { path: file, onChange: setFile };
  const selectedDraft =
    view?.kind === "draft"
      ? drafts.data?.items.find((draft) => draft.id === view.id)
      : undefined;
  const selectedPublished = selectedDraft
    ? skills.data?.items.find(
        (skill) => skill.id === selectedDraft.skillDefinitionId,
      )
    : undefined;
  const selectedResourceState = selectedDraft
    ? resourceState(selectedDraft.skillDefinitionId)
    : undefined;
  if (view)
    return (
      <div className="mx-auto w-full max-w-[1320px]">
        <Button
          className="mb-4"
          type="text"
          icon={<ArrowLeftOutlined />}
          disabled={editState.saving}
          onClick={() => {
            if (search.returnTo) void navigate({ href: search.returnTo });
            else open(undefined);
          }}
        >
          {t(
            search.returnTo
              ? "agent.editor.returnSource"
              : "agent.hub.backToSkills",
          )}
        </Button>
        <section className="h-[calc(100dvh-196px)] min-h-[420px] overflow-hidden rounded-xl bg-paper">
          {view?.kind === "published" && (
            <SkillDetailPanel
              workspaceId={workspaceId}
              definitionId={view.id}
              {...(skills.data?.items.find((item) => item.id === view.id)
                ? {
                    summary: skills.data.items.find(
                      (item) => item.id === view.id,
                    )!,
                  }
                : {})}
              csrfToken={csrfToken}
              principalId={principalId}
              canManage={canManage}
              canPublish={canPublish}
              canUse={canUse}
              canReadAssets={canReadAssets}
              onEdit={(id) => open({ kind: "edit", id }, false)}
              selection={selection}
            />
          )}
          {view?.kind === "draft" && (
            <SkillDraftDetailPanel
              workspaceId={workspaceId}
              draftId={view.id}
              csrfToken={csrfToken}
              canPublish={canPublish}
              canReadAssets={canReadAssets}
              imported={search.notice === "imported"}
              {...(selectedPublished ? { published: selectedPublished } : {})}
              {...(selectedResourceState
                ? { resourceState: selectedResourceState }
                : {})}
              onEdit={(id) => open({ kind: "edit", id }, false)}
              selection={selection}
            />
          )}
          {view?.kind === "edit" && (
            <SkillEditor
              workspaceId={workspaceId}
              csrfToken={csrfToken}
              canManage={canManage}
              canPublish={canPublish}
              canReadAssets={canReadAssets}
              canUploadAssets={canUploadAssets}
              mode={view.id ? "edit" : "create"}
              {...(view.id ? { skillDraftId: view.id } : {})}
              selection={selection}
              onStateChange={setEditState}
              onSaved={handleSavedSkillDraft}
              onCancel={() =>
                open(
                  view.id ? { kind: "draft", id: view.id } : undefined,
                  false,
                )
              }
            />
          )}
        </section>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            size="middle"
            className="!w-96 max-w-full"
            value={query}
            onChange={changeSkillQuery}
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("agent.editor.searchSkills")}
            aria-label={t("agent.editor.searchSkills")}
          />
          <Segmented
            size="middle"
            value={mine ? "mine" : "all"}
            onChange={(value) =>
              filterSkills({
                ...searchState,
                scope: value === "mine" ? "mine" : undefined,
              })
            }
            options={[
              { value: "all", label: t("agent.skillWorkbench.allSkills") },
              { value: "mine", label: t("agent.hub.mine") },
            ]}
          />
          <Select
            size="middle"
            className="min-w-32"
            aria-label={t("agent.skillWorkbench.status")}
            value={statusFilter}
            onChange={(value) =>
              filterSkills({
                ...searchState,
                status: value === "all" ? undefined : value,
              })
            }
            options={[
              { value: "all", label: t("agent.skillWorkbench.allStatuses") },
              {
                value: "published",
                label: t("agent.hub.skillStatus.published"),
              },
              { value: "draft", label: t("agent.hub.skillStatus.draft") },
              {
                value: "changes",
                label: t("agent.skillWorkbench.unpublishedChanges"),
              },
              {
                value: "unavailable",
                label: t("agent.skillWorkbench.unavailable"),
              },
            ]}
          />
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <ResourceTrash
              workspaceId={workspaceId}
              csrfToken={csrfToken}
              kind="skill"
            />
            <Upload
              accept=".zip,.skill,application/zip"
              beforeUpload={(file) => {
                setError(undefined);
                setFilenameEncoding("auto");
                setImportFile(file);
                return false;
              }}
              disabled={uploading}
              showUploadList={false}
            >
              <Button
                size="middle"
                icon={<UploadOutlined />}
                loading={uploading}
              >
                {t("agent.hub.importSkill")}
              </Button>
            </Upload>
            <Button
              size="middle"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => open({ kind: "edit" })}
            >
              {t("agent.hub.createSkill")}
            </Button>
          </div>
        )}
      </div>
      <Modal
        open={Boolean(importFile)}
        title={t("agent.hub.importSkill")}
        okText={t(
          uploading ? "agent.skillImport.importing" : "agent.hub.importSkill",
        )}
        cancelText={t("agent.cancel")}
        confirmLoading={uploading}
        closable={!uploading}
        cancelButtonProps={{ disabled: uploading }}
        onCancel={() => {
          if (!uploading) {
            setImportFile(undefined);
            setError(undefined);
          }
        }}
        onOk={() => {
          if (importFile && !uploading) void upload(importFile);
        }}
      >
        <div className="grid gap-4 py-2">
          <span className="break-all">{importFile?.name}</span>
          {error && (
            <>
              <Alert type="error" showIcon title={error} />
              <Upload
                accept=".zip,.skill,application/zip"
                showUploadList={false}
                disabled={uploading}
                beforeUpload={(file) => {
                  setImportFile(file);
                  setError(undefined);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} disabled={uploading}>
                  {t("agent.skillImport.chooseAgain")}
                </Button>
              </Upload>
            </>
          )}
          <label className="grid gap-2">
            <span>{t("agent.skillImport.filenameEncoding")}</span>
            <Select
              value={filenameEncoding}
              disabled={uploading}
              onChange={setFilenameEncoding}
              aria-label={t("agent.skillImport.filenameEncoding")}
              options={[
                { value: "auto", label: t("agent.skillImport.autoEncoding") },
                { value: "utf-8", label: "UTF-8" },
                { value: "gb18030", label: "GB18030 / GBK" },
                { value: "big5", label: "Big5" },
                { value: "shift_jis", label: "Shift JIS" },
                { value: "cp437", label: "CP437" },
              ]}
            />
          </label>
          <span className="text-sm text-muted">
            {t("agent.skillImport.reviewHint")}
          </span>
        </div>
      </Modal>
      {error && !importFile && (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(undefined) }}
        />
      )}
      {loading && <Skeleton active paragraph={{ rows: 6 }} />}
      {failed && (
        <Alert
          type="error"
          showIcon
          title={t("agent.hub.loadError")}
          action={
            <Button onClick={retrySkillDirectory}>
              {t("agent.editor.retry")}
            </Button>
          }
        />
      )}
      {!loading && !failed && filtered.length === 0 && (
        <Empty
          description={t(
            query || mine || statusFilter !== "all"
              ? "agent.editor.noMatchingSkills"
              : "agent.hub.emptySkills",
          )}
        />
      )}
      {!loading && !failed && filtered.length > 0 && (
        <div
          className={`${catalogGridClassName} overflow-hidden rounded-xl bg-paper`}
        >
          <div
            className={`${catalogRowLayoutClassName} bg-mist/50 text-xs text-muted max-[767px]:hidden`}
          >
            <span>{t("agent.design.skillPurpose")}</span>
            <span>{t("agent.skillWorkbench.status")}</span>
            <span className="max-[1100px]:hidden">
              {t("agent.hub.updated")}
            </span>
            <span />
          </div>
          {filtered.map((entry) => (
            <article
              key={`${entry.kind}:${entry.id}`}
              className={catalogRowClassName}
            >
              <div className="flex min-w-0 items-start gap-3">
                <AssetArtwork
                  workspaceId={workspaceId}
                  alt=""
                  {...(canReadAssets && entry.item.coverAssetId
                    ? { assetId: entry.item.coverAssetId }
                    : {})}
                  className="size-9 shrink-0 rounded-lg bg-mist text-base text-muted"
                >
                  <ReadOutlined />
                </AssetArtwork>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <Link
                      to={
                        entry.kind === "published"
                          ? "/w/$workspaceId/skills/$skillDefinitionId"
                          : "/w/$workspaceId/skills/drafts/$skillDraftId"
                      }
                      params={{
                        workspaceId,
                        skillDefinitionId: entry.id,
                        skillDraftId: entry.id,
                      }}
                      search={searchState}
                      aria-label={t("agent.polish.openDetails", {
                        name: entry.item.displayName,
                      })}
                      title={entry.item.displayName}
                      className={`${catalogEntryLinkClassName} inline-flex min-w-0 items-center gap-2 rounded text-sm font-semibold text-ink no-underline hover:text-primary`}
                    >
                      <span className="truncate">{entry.item.displayName}</span>
                      <RightOutlined
                        aria-hidden="true"
                        className="shrink-0 text-xs text-muted"
                      />
                    </Link>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                      {t(`agent.hub.visibility.${entry.item.visibility}`)}
                    </span>
                  </div>
                  <p
                    className="m-0 mt-1 max-w-[60ch] truncate text-sm leading-5 text-muted"
                    title={entry.item.summary}
                  >
                    {entry.item.summary}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 max-[767px]:col-start-1 max-[767px]:row-start-2">
                <StatusTag className="text-xs" tone={entry.availability.tone}>
                  {t(entry.availability.labelKey)}
                </StatusTag>
              </div>
              <span className="text-xs text-muted max-[1100px]:hidden">
                {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                }).format(new Date(entry.item.updatedAt))}
              </span>
              <div
                className={`${catalogActionClassName} flex items-center gap-1`}
              >
                <ResourceActions
                  showStatus={false}
                  workspaceId={workspaceId}
                  csrfToken={csrfToken}
                  kind="skill"
                  id={
                    entry.kind === "draft" && "skillDefinitionId" in entry.item
                      ? entry.item.skillDefinitionId
                      : entry.item.id
                  }
                />
                {(entry.availability.kind === "usable" ||
                  entry.availability.kind === "usable_with_changes") &&
                canUse &&
                entry.availability.publishedRevisionId ? (
                  <ActionLink
                    size="small"
                    color="primary"
                    variant="filled"
                    to="/w/$workspaceId/agent"
                    params={{ workspaceId }}
                    search={{
                      skillRevisionId: entry.availability.publishedRevisionId,
                    }}
                  >
                    {t("agent.design.use")}
                  </ActionLink>
                ) : null}
                {entry.availability.kind === "usable_with_changes" ? (
                  <Button
                    size="small"
                    type="text"
                    onClick={() => open({ kind: "draft", id: entry.id })}
                  >
                    {t("agent.skillWorkbench.reviewChanges")}
                  </Button>
                ) : null}
                {entry.availability.kind === "needs_publish" ? (
                  <Button
                    size="small"
                    type={canPublish ? "primary" : "text"}
                    onClick={() => open({ kind: "draft", id: entry.id })}
                  >
                    {t(
                      canPublish
                        ? "agent.skillWorkbench.reviewAndPublish"
                        : "agent.skillWorkbench.reviewDraft",
                    )}
                  </Button>
                ) : null}
                {(entry.availability.kind === "disabled" ||
                  entry.availability.kind === "revoked" ||
                  entry.availability.kind === "unavailable" ||
                  (entry.availability.kind === "usable" && !canUse)) && (
                  <Button
                    size="small"
                    type="text"
                    onClick={() =>
                      open(
                        entry.published
                          ? { kind: "published", id: entry.published.id }
                          : { kind: "draft", id: entry.id },
                      )
                    }
                  >
                    {t(
                      entry.availability.kind === "disabled" &&
                        canPublish &&
                        (!entry.published ||
                          entry.published.ownerPrincipalId === principalId)
                        ? "agent.skillWorkbench.viewAndEnable"
                        : "agent.design.view",
                    )}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
