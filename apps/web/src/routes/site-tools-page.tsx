import { StatusTag } from "../components/status-tag.js";
import { ToolListActions } from "../features/external-tools/tool-list-actions.js";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import { ToolEditor } from "../features/external-tools/tool-editor.js";
import { useCommand } from "../features/external-tools/use-tool-command.js";
const unauthenticatedStatus = 401;
const notFoundStatus = 404;
const minimumSlugLength = 3;
const suggestedSlugSuffixLength = 8;
import type {
  CurrentHumanContext,
  ToolPresentation,
} from "@kanvas/contracts/api";
import {
  PlusOutlined,
  ArrowLeftOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getRouteApi,
  Link,
  Navigate,
  useNavigate,
} from "@tanstack/react-router";
import { Alert, Button, Empty, Input, Select, Spin } from "antd";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiProblem, fetchCurrentHumanContext } from "../api/transport.js";
import { AccountSettingsShell } from "../components/account-settings-shell.js";
import {
  fileBase64,
  toolLibrary,
} from "../features/external-tools/library-api.js";
import { ToolArtwork } from "../features/external-tools/tool-artwork.js";

function AdminBoundary({
  children,
}: {
  children: (context: CurrentHumanContext) => ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    retry: false,
  });
  if (context.isPending)
    return (
      <div className="p-10">
        <Spin />
      </div>
    );
  if (
    context.error instanceof ApiProblem &&
    context.error.status === unauthenticatedStatus
  )
    return <Navigate to="/login" search={{ returnTo: "/admin/tools" }} />;
  return (
    <AccountSettingsShell scope="site">
      {context.data?.instanceAdministrator ? (
        children(context.data)
      ) : (
        <Alert type="error" title={t("studio.tools.adminOnly")} />
      )}
    </AccountSettingsShell>
  );
}
export function SiteToolsPage(): React.JSX.Element {
  return (
    <AdminBoundary>
      {(context) => <AdminList context={context} />}
    </AdminBoundary>
  );
}
function AdminList({
  context,
}: {
  context: CurrentHumanContext;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const tools = useQuery({
    queryKey: ["site-tools", context.human.principalId],
    queryFn: toolLibrary.adminList,
    retry: false,
  });
  const items =
    tools.data?.items.filter(
      (tool) =>
        (state === "all" || tool.state === state) &&
        `${tool.displayName} ${tool.slug}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  const client = useQueryClient();
  async function refresh() {
    await tools.refetch();
    await client.invalidateQueries({ queryKey: ["site-tool"] });
    await client.invalidateQueries({ queryKey: ["tools"] });
  }
  function retry() {
    void tools.refetch();
  }
  function clearFilters() {
    setSearch("");
    setState("all");
  }
  const empty = tools.data?.items.length === 0;
  const columns =
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_112px_100px] md:gap-5";
  return (
    <section className="w-full min-w-0">
      <div className="mb-7 flex items-center justify-between gap-4">
        <h1 className="m-0 text-2xl font-semibold">
          {t("studio.tools.management")}
        </h1>
        <Link
          to="/admin/tools/new"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-white no-underline hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-primary"
        >
          <PlusOutlined aria-hidden="true" />
          {t("studio.tools.add")}
        </Link>
      </div>
      {!empty ? (
        <div className="mb-6 flex items-center gap-3">
          <Input
            className="min-w-0 max-w-[280px]"
            prefix={<SearchOutlined className="text-muted" />}
            aria-label={t("studio.tools.list.search")}
            placeholder={t("studio.tools.list.search")}
            allowClear
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            className="w-32 shrink-0"
            variant="filled"
            aria-label={t("studio.tools.list.statusFilter")}
            value={state}
            onChange={setState}
            options={[
              { value: "all", label: t("studio.tools.list.all") },
              ...(["enabled", "disabled", "draft"] as const).map((value) => ({
                value,
                label: t(
                  value === "draft"
                    ? "studio.tools.list.unpublished"
                    : `studio.tools.states.${value}`,
                ),
              })),
            ]}
          />
          {!tools.isPending && !tools.isError ? (
            <span className="ml-auto hidden shrink-0 text-xs text-muted sm:block">
              {t("studio.tools.list.count", { count: items.length })}
            </span>
          ) : null}
        </div>
      ) : null}
      {tools.isPending ? (
        <div
          className="flex justify-center py-20"
          role="status"
          aria-label={t("studio.tools.list.loading")}
        >
          <Spin />
        </div>
      ) : null}
      {tools.isError ? (
        <Alert
          type="error"
          title={t("studio.tools.loadError")}
          action={<Button onClick={retry}>{t("studio.tools.retry")}</Button>}
        />
      ) : null}
      {!tools.isPending && !tools.isError && !items.length ? (
        <div className="py-16">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <p className="mb-2 text-base font-medium text-ink">
                  {t(
                    empty
                      ? "studio.tools.list.empty"
                      : "studio.tools.noMatches",
                  )}
                </p>
                <p className="text-sm text-muted">
                  {t(
                    empty
                      ? "studio.tools.list.emptyHelp"
                      : "studio.tools.list.noMatchesHelp",
                  )}
                </p>
              </div>
            }
          >
            {!empty ? (
              <Button onClick={clearFilters}>
                {t("studio.tools.list.clear")}
              </Button>
            ) : null}
          </Empty>
        </div>
      ) : null}
      {!tools.isPending && !tools.isError && items.length ? (
        <div className="overflow-hidden rounded-xl bg-paper">
          <div
            className={`${columns} bg-mist/50 px-4 py-3 text-xs text-muted max-md:hidden`}
            aria-hidden="true"
          >
            <span>{t("studio.tools.list.tool")}</span>
            <span>{t("studio.tools.list.statusFilter")}</span>
            <span className="pr-3 text-right">
              {t("studio.tools.list.actions")}
            </span>
          </div>
          <ul className="m-0 list-none p-0">
            {items.map((tool) => (
              <li
                key={tool.id}
                className={`${columns} min-h-[76px] px-4 py-3 hover:bg-mist focus-within:bg-mist`}
              >
                <Link
                  to="/admin/tools/$toolId"
                  params={{ toolId: tool.id }}
                  className="flex min-w-0 items-center gap-3 text-ink no-underline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-mist">
                    <ToolArtwork
                      symbol={tool.symbol}
                      imageId={tool.logoImageId}
                      compact
                    />
                  </div>
                  <div className="min-w-0">
                    <div
                      className="break-words text-sm font-semibold sm:truncate"
                      title={tool.displayName}
                    >
                      {tool.displayName}
                    </div>
                    <div
                      className="mt-1 truncate text-xs text-muted"
                      title={tool.slug}
                    >
                      {tool.slug}
                    </div>
                  </div>
                </Link>
                <div className="min-w-0 text-xs max-md:col-start-1 max-md:row-start-2">
                  <StatusTag
                    className="text-xs"
                    tone={
                      (
                        {
                          enabled: "positive",
                          draft: "info",
                          disabled: "neutral",
                        } as const
                      )[tool.state]
                    }
                  >
                    {t(
                      tool.state === "draft"
                        ? "studio.tools.list.unpublished"
                        : `studio.tools.states.${tool.state}`,
                    )}
                  </StatusTag>
                  {tool.draft && tool.publishedRevision ? (
                    <span className="mt-1 block text-muted">
                      {t("studio.tools.editor.unpublished")}
                    </span>
                  ) : null}
                </div>
                <div className="max-md:col-start-2 max-md:row-start-1 max-md:row-span-2">
                  <ToolListActions
                    tool={tool}
                    context={context}
                    refresh={refresh}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const blank: ToolPresentation = {
  slug: "",
  displayName: "",
  summary: "",
  descriptionMarkdown: "",
  logoImageId: null,
  coverImageId: null,
  category: "",
  tags: [],
};
export function SiteToolNewPage(): React.JSX.Element {
  return (
    <AdminBoundary>{(context) => <NewTool context={context} />}</AdminBoundary>
  );
}
function NewTool({
  context,
}: {
  context: CurrentHumanContext;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [value, setValue] = useState({ ...blank });
  const createdRef = useRef<string>(undefined);
  const [createdId, setCreatedId] = useState<string>();
  const leaveBypassRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    const maximumBytes = 2_097_152;
    try {
      if (selected.size > maximumBytes || !/\.html?$/i.test(selected.name))
        throw new Error(t("studio.tools.editor.invalidFile"));
      new TextDecoder("utf-8", { fatal: true }).decode(
        await selected.arrayBuffer(),
      );
      setFile(selected);
      setFileError(undefined);
      const name = selected.name.replace(/\.html?$/i, "");
      const suggested = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      setValue((previous) => ({
        ...previous,
        displayName: previous.displayName || name,
        slug:
          previous.slug ||
          (suggested.length >= minimumSlugLength
            ? suggested
            : `tool-${crypto.randomUUID().slice(0, suggestedSlugSuffixLength)}`),
      }));
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : t("studio.tools.editor.invalidFile"),
      );
    }
  }
  const command = useCommand(async () => {
    if (createdRef.current) {
      leaveBypassRef.current = true;
      await navigate({
        to: "/admin/tools/$toolId",
        params: { toolId: createdRef.current },
      });
    }
  });
  function continueCreated() {
    if (!createdRef.current) return;
    leaveBypassRef.current = true;
    void navigate({
      to: "/admin/tools/$toolId",
      params: { toolId: createdRef.current },
    });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || createdRef.current) return;
    const body = { ...value },
      selected = file;
    const createKey = crypto.randomUUID(),
      uploadKey = crypto.randomUUID(),
      checkKey = crypto.randomUUID();
    command.run(async () => {
      const created = await toolLibrary.create(
        context.csrfToken,
        body,
        createKey,
      );
      createdRef.current = created.toolId;
      setCreatedId(created.toolId);
      const uploaded = await toolLibrary.change(
        context.csrfToken,
        created.toolId,
        "html",
        {
          expectedVersion: created.version,
          filename: selected.name,
          contentBase64: await fileBase64(selected),
        },
        uploadKey,
      );
      await toolLibrary.change(
        context.csrfToken,
        created.toolId,
        "check",
        { expectedVersion: uploaded.version },
        checkKey,
      );
    });
  }
  return (
    <section>
      <Link
        to="/admin/tools"
        className="mb-5 inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeftOutlined />
        {t("studio.tools.management")}
      </Link>
      <h1 className="mb-2 text-2xl font-semibold">{t("studio.tools.add")}</h1>
      <UnsavedChangesGuard
        active={Boolean(
          file || value.displayName || value.slug || command.busy,
        )}
        bypass={leaveBypassRef}
        title={t("studio.tools.editor.leaveTitle")}
        actionLabel={t("studio.tools.editor.leaveDiscard")}
        cancelLabel={t("studio.tools.editor.stay")}
      >
        {t("studio.tools.editor.leaveHelp")}
      </UnsavedChangesGuard>
      <form onSubmit={submit} className="mt-6 max-w-2xl space-y-5">
        <div className="flex items-center gap-3 rounded-control bg-paper p-5">
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".html,.htm,text/html"
            onChange={(event) => void chooseFile(event)}
            aria-label={t("studio.tools.editor.upload")}
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {file?.name ?? t("studio.tools.editor.chooseFile")}
          </span>
          <Button
            disabled={command.busy || command.uncertain || Boolean(createdId)}
            onClick={() => fileInputRef.current?.click()}
          >
            {t("studio.tools.editor.upload")}
          </Button>
        </div>
        {fileError ? <Alert type="error" title={fileError} /> : null}
        <label className="block text-sm font-medium">
          {t("studio.tools.name")}
          <Input
            required
            maxLength={160}
            value={value.displayName}
            onChange={(e) =>
              setValue({ ...value, displayName: e.target.value })
            }
            className="mt-2"
            disabled={command.busy || command.uncertain}
          />
        </label>
        <label className="block text-sm font-medium">
          {t("studio.tools.editor.address")}
          <Input
            required
            minLength={3}
            maxLength={80}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={value.slug}
            onChange={(e) => setValue({ ...value, slug: e.target.value })}
            className="mt-2"
            disabled={command.busy || command.uncertain}
          />
        </label>
        <p className="text-xs text-muted">{t("studio.tools.slugHelp")}</p>
        {command.error ? <Alert type="error" title={command.error} /> : null}
        {command.error && createdId && !command.uncertain ? (
          <Button onClick={continueCreated}>
            {t("studio.tools.editor.continueEditing")}
          </Button>
        ) : null}
        {command.uncertain ? (
          <Button
            onClick={() => {
              void command.retry();
            }}
          >
            {t("studio.tools.retryOperation")}
          </Button>
        ) : (
          <Button
            type="primary"
            htmlType="submit"
            loading={command.busy}
            disabled={!file || Boolean(createdId)}
          >
            {t("studio.tools.editor.createDraft")}
          </Button>
        )}
      </form>
    </section>
  );
}
const editRoute = getRouteApi("/admin/tools/$toolId");
export function SiteToolEditPage(): React.JSX.Element {
  const { toolId } = editRoute.useParams();
  return (
    <AdminBoundary>
      {(context) => <EditTool context={context} toolId={toolId} />}
    </AdminBoundary>
  );
}
function EditTool({
  context,
  toolId,
}: {
  context: CurrentHumanContext;
  toolId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [editorTab, setEditorTab] = useState<"preview" | "html" | "settings">(
    "preview",
  );
  const query = useQuery({
    queryKey: ["site-tool", toolId],
    queryFn: () => toolLibrary.detail(toolId),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const missing =
    query.error instanceof ApiProblem && query.error.status === notFoundStatus;
  const client = useQueryClient();
  async function refresh() {
    await query.refetch();
    await client.invalidateQueries({ queryKey: ["site-tools"] });
    await client.invalidateQueries({ queryKey: ["tools"] });
  }
  return (
    <section>
      <Link
        to="/admin/tools"
        className="mb-5 inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeftOutlined />
        {t("studio.tools.management")}
      </Link>
      {query.isPending ? <Spin /> : null}
      {query.isError ? (
        <Alert
          type="error"
          title={t(
            missing
              ? "studio.tools.deletion.missing"
              : "studio.tools.loadError",
          )}
          action={
            missing ? undefined : (
              <Button
                onClick={() => {
                  void refresh();
                }}
              >
                {t("studio.tools.retry")}
              </Button>
            )
          }
        />
      ) : null}
      {!query.isPending && !query.isError && query.data ? (
        <ToolEditor
          key={query.data.tool.version}
          context={context}
          tool={query.data.tool}
          refresh={refresh}
          initialTab={editorTab}
          onTabChange={setEditorTab}
        />
      ) : null}
    </section>
  );
}
