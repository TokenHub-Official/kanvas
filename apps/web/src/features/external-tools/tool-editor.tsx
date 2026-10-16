import { ToolIconEditor, type ToolIconSelection } from "./tool-icon-editor.js";
import { CoverPickerDialog } from "../../components/cover-picker-dialog.js";
import { createSiteCoverUploader } from "./site-cover-upload.js";
import { StatusTag } from "../../components/status-tag.js";
import { ActionLink } from "../../components/action-link.js";
import { HtmlSourceEditor } from "./html-source-editor.js";
import { DeleteToolAction } from "./delete-tool-action.js";
import type {
  CurrentHumanContext,
  SiteTool,
  ToolPresentation,
} from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Input,
  Alert,
  Select,
  Modal,
  Dropdown,
  Spin,
  Tabs,
  Form,
  Tooltip,
} from "antd";
import {
  DownloadOutlined,
  UploadOutlined,
  MoreOutlined,
  ReloadOutlined,
  FullscreenOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnsavedChangesGuard } from "../../components/unsaved-changes-guard.js";
import { toolLibrary, fileBase64, toolRequest } from "./library-api.js";
import { useCommand } from "./use-tool-command.js";
import { ToolArtwork } from "./tool-artwork.js";
import { RuntimeSurface } from "./runtime-surface.js";

const bytesPerKiB = 1024;
const maximumBytes = 2 * bytesPerKiB * bytesPerKiB;
const revokeDelay = 1000;
type ArtworkField = "logoImageId" | "coverImageId";
const artworkDimensions = {
  logoImageId: { width: 64, height: 64 },
  coverImageId: { width: 128, height: 80 },
} as const;
type PendingArtwork = { file: File; contentBase64: string };

export function ToolEditor({
  context,
  tool,
  refresh,
  initialTab = "preview",
  onTabChange,
}: {
  context: CurrentHumanContext;
  tool: SiteTool;
  refresh: () => Promise<unknown>;
  initialTab?: "preview" | "html" | "settings";
  onTabChange?: (tab: "preview" | "html" | "settings") => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const leaveBypassRef = useRef(false);
  const label = (key: string) => t(`studio.tools.editor.${key}`);
  const revision = tool.draft ?? tool.publishedRevision;
  const source = useQuery({
    queryKey: ["site-tool-source", tool.id, revision?.id],
    queryFn: () => toolLibrary.source(tool.id, revision?.id),
    enabled: Boolean(revision),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const integrations = useQuery({
    queryKey: ["tool-integrations", i18n.language],
    queryFn: () => toolLibrary.integrations(i18n.language),
    retry: false,
  });
  const [coverOpen, setCoverOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const covers = useQuery({
    queryKey: ["site-covers", context.human.principalId],
    queryFn: () =>
      toolRequest<{ items: Array<{ id: string; name: string }> }>(
        "/api/v1/instance/covers",
      ),
    enabled: coverOpen,
    retry: false,
  });
  const uploadCover = useMemo(
    () => createSiteCoverUploader(context.csrfToken),
    [context.csrfToken],
  );
  const initialPresentation: ToolPresentation = {
    slug: tool.slug,
    displayName: tool.displayName,
    summary: tool.summary,
    descriptionMarkdown: tool.descriptionMarkdown,
    logoImageId: tool.logoImageId,
    symbol: tool.symbol ?? null,
    coverImageId: tool.coverImageId,
    category: tool.category,
    tags: tool.tags,
  };
  const [value, setValue] = useState<ToolPresentation>(initialPresentation);
  const [text, setText] = useState<string>();
  const [filename, setFilename] = useState(revision?.filename ?? "tool.html");
  const [artwork, setArtwork] = useState<
    Partial<Record<ArtworkField, PendingArtwork>>
  >({});
  const [capabilities, setCapabilities] = useState(
    revision?.allowedContractRevisionIds ?? [],
  );
  const [tab, setTab] = useState<"preview" | "html" | "settings">(
    revision?.checkStatus === "failed" ? "html" : initialTab,
  );
  function changeTab(next: "preview" | "html" | "settings") {
    setTab(next);
    onTabChange?.(next);
  }
  const [focusRequest, setFocusRequest] = useState<{ line: number }>();
  const [previewKey, setPreviewKey] = useState(0);
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<
    "availability" | "discard" | "reload"
  >();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const command = useCommand(refresh);
  const locked = command.busy || command.uncertain;
  const content = text ?? source.data?.content ?? "";
  const sourceDirty =
    text !== undefined &&
    (text !== source.data?.content || filename !== revision?.filename);
  const settingsDirty =
    value.displayName !== tool.displayName ||
    value.slug !== tool.slug ||
    value.descriptionMarkdown !== tool.descriptionMarkdown ||
    value.logoImageId !== tool.logoImageId ||
    JSON.stringify(value.symbol ?? null) !==
      JSON.stringify(tool.symbol ?? null) ||
    value.coverImageId !== tool.coverImageId ||
    Object.keys(artwork).length > 0;
  const capabilityDirty =
    JSON.stringify(capabilities) !==
    JSON.stringify(revision?.allowedContractRevisionIds ?? []);
  const dirty = sourceDirty || settingsDirty || capabilityDirty;
  const workspace = context.workspaces.find((w) =>
    w.permissions.includes("workspace.read"),
  );

  async function selectHtml(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > maximumBytes || !/\.html?$/i.test(file.name))
        throw new Error(label("invalidFile"));
      const bytes = await file.arrayBuffer();
      const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      setText(html);
      setFilename(file.name);
      changeTab("html");
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : label("invalidFile"));
    }
  }
  async function selectArtwork(field: ArtworkField, file: File) {
    try {
      if (
        file.size > maximumBytes ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new Error(label("invalidImage"));
      const contentBase64 = await fileBase64(file);
      setArtwork((previous) => ({
        ...previous,
        [field]: { file, contentBase64 },
      }));
      if (field === "logoImageId")
        setValue((previous) => ({ ...previous, symbol: null }));
      setError(undefined);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : label("invalidImage"));
      return false;
    }
  }
  function removeArtwork(field: ArtworkField) {
    setArtwork((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
    setValue((previous) => ({
      ...previous,
      [field]: null,
      ...(field === "logoImageId" ? { symbol: null } : {}),
    }));
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), revokeDelay);
  }
  function save(publish = false) {
    if (!value.displayName.trim() || !content.trim()) {
      setError(label("required"));
      return;
    }
    if (new TextEncoder().encode(content).length > maximumBytes) {
      setError(label("invalidFile"));
      return;
    }
    const keys = Array.from({ length: 7 }, () => crypto.randomUUID());
    const presentation = { ...value };
    const selectedArtwork = { ...artwork };
    const selectedCapabilities = [...capabilities];
    const selectedContent = content,
      selectedFilename = filename;
    setError(undefined);
    command.run(async () => {
      let version = tool.version;
      for (const [index, field] of (
        ["logoImageId", "coverImageId"] as const
      ).entries()) {
        const pending = selectedArtwork[field];
        if (pending)
          presentation[field] = (
            await toolLibrary.uploadImage(
              context.csrfToken,
              pending.contentBase64,
              keys[index]!,
            )
          ).imageId;
      }
      if (settingsDirty)
        version = (
          await toolLibrary.change(
            context.csrfToken,
            tool.id,
            "presentation",
            { expectedVersion: version, ...presentation },
            keys[2]!,
          )
        ).version;
      const uploadNeeded = sourceDirty || (!tool.draft && capabilityDirty);
      if (uploadNeeded)
        version = (
          await toolLibrary.change(
            context.csrfToken,
            tool.id,
            "html",
            {
              expectedVersion: version,
              filename: selectedFilename,
              contentBase64: await fileBase64(
                new File([selectedContent], selectedFilename),
              ),
            },
            keys[3]!,
          )
        ).version;
      if (uploadNeeded || capabilityDirty)
        version = (
          await toolLibrary.change(
            context.csrfToken,
            tool.id,
            "draft",
            {
              expectedVersion: version,
              versionLabel: revision?.versionLabel ?? "",
              releaseNotes: revision?.releaseNotes ?? "",
              allowedContractRevisionIds: selectedCapabilities,
            },
            keys[4]!,
          )
        ).version;
      if (
        uploadNeeded ||
        capabilityDirty ||
        (tool.draft?.checkStatus !== "passed" && tool.draft)
      ) {
        version = (
          await toolLibrary.change(
            context.csrfToken,
            tool.id,
            "check",
            { expectedVersion: version },
            keys[5]!,
          )
        ).version;
      }
      if (publish) {
        const updated = await toolLibrary.detail(tool.id);
        if (updated.tool.draft?.checkStatus === "passed")
          await toolLibrary.change(
            context.csrfToken,
            tool.id,
            "publish",
            { expectedVersion: version },
            keys[6]!,
          );
      }
    });
  }
  function resetEdits() {
    setText(undefined);
    setFilename(revision?.filename ?? "tool.html");
    setArtwork({});
    setValue(initialPresentation);
    setCapabilities(revision?.allowedContractRevisionIds ?? []);
  }
  function confirmed() {
    const operation = confirmation;
    setConfirmation(undefined);
    if (operation === "reload") {
      command.run(() => Promise.resolve());
      return;
    }
    const key = crypto.randomUUID();
    command.run(() =>
      toolLibrary.change(
        context.csrfToken,
        tool.id,
        operation === "discard" ? "discard-draft" : "availability",
        {
          expectedVersion: tool.version,
          ...(operation === "availability"
            ? { enabled: tool.state === "disabled" }
            : {}),
        },
        key,
      ),
    );
  }
  async function fullscreen() {
    try {
      await previewRef.current?.requestFullscreen();
    } catch {
      setError(t("studio.tools.fullscreenError"));
    }
  }
  function renderArtwork(field: ArtworkField): React.JSX.Element {
    const pending = artwork[field];
    if (pending)
      return (
        <img
          alt=""
          className="h-full w-full object-contain"
          src={`data:${pending.file.type};base64,${pending.contentBase64}`}
        />
      );
    if (field === "coverImageId" && !value[field])
      return (
        <span className="flex h-full items-center justify-center text-xs text-muted">
          {label("noCover")}
        </span>
      );
    return (
      <ToolArtwork
        imageId={value[field]}
        symbol={field === "logoImageId" ? value.symbol : null}
        cover={field === "coverImageId"}
        compact
      />
    );
  }
  function renderContent(): React.JSX.Element {
    if (source.isPending && revision)
      return (
        <div className="p-8">
          <Spin />
        </div>
      );
    if (revision?.checkStatus === "passed")
      return (
        <RuntimeSurface
          key={`${revision.id}:${previewKey}`}
          toolId={tool.id}
          revisionId={revision.id}
          principalId={context.human.principalId}
          csrfToken={context.csrfToken}
          scope={{ kind: "preview" }}
        />
      );
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        {revision ? label("checkRequired") : label("uploadPreview")}
      </div>
    );
  }
  let confirmationTitle = t(
    tool.state !== "disabled" ? "studio.tools.disable" : "studio.tools.enable",
  );
  let confirmationHelp = label("availabilityHelp");
  if (confirmation === "discard") {
    confirmationTitle = label("discardDraft");
    confirmationHelp = label("discardHelp");
  }
  if (confirmation === "reload") {
    confirmationTitle = label("reloadData");
    confirmationHelp = label("reloadHelp");
  }
  let editState = tool.draft ? label("unpublished") : label("saved");
  if (dirty) editState = label("unsaved");
  async function leaveDeletedTool() {
    leaveBypassRef.current = true;
    await navigate({ to: "/admin/tools" });
  }
  function focusIssue(line: number) {
    changeTab("html");
    setFocusRequest({ line });
  }
  async function applyIcon(selection: ToolIconSelection) {
    if (selection.kind === "file")
      return selectArtwork("logoImageId", selection.file);
    setArtwork((previous) => {
      const next = { ...previous };
      delete next.logoImageId;
      return next;
    });
    setValue((previous) => ({
      ...previous,
      logoImageId: null,
      symbol: selection.value,
    }));
    return true;
  }
  async function uploadCoverItem(file: File, signal: AbortSignal) {
    const id = await uploadCover(file, signal);
    void covers.refetch();
    return {
      id,
      name: file.name,
      thumbnail: <ToolArtwork imageId={id} cover />,
    };
  }
  function applyCover(id: string | null) {
    setValue((previous) => ({ ...previous, coverImageId: id }));
    setCoverOpen(false);
  }
  return (
    <div className="space-y-5">
      <UnsavedChangesGuard
        active={dirty || command.busy || command.uncertain}
        bypass={leaveBypassRef}
        title={label("leaveTitle")}
        actionLabel={label("leaveDiscard")}
        cancelLabel={label("stay")}
      >
        {label("leaveHelp")}
      </UnsavedChangesGuard>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 min-w-0 truncate text-2xl font-semibold">
          {tool.displayName}
        </h1>
        <StatusTag
          tone={
            (
              {
                enabled: "positive",
                disabled: "neutral",
                draft: "info",
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
        <span className="flex-1" />
        {workspace && tool.state === "enabled" ? (
          <ActionLink
            size="small"
            color="primary"
            variant="filled"
            to="/w/$workspaceId/tools/$slug"
            params={{ workspaceId: workspace.id, slug: tool.slug }}
          >
            {label("open")}
          </ActionLink>
        ) : null}
        <DeleteToolAction
          tool={tool}
          context={context}
          onDeleted={leaveDeletedTool}
          trigger={(openDelete) => (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  ...(tool.publishedRevision || tool.state !== "disabled"
                    ? [
                        {
                          key: "availability",
                          label: t(
                            tool.state !== "disabled"
                              ? "studio.tools.disable"
                              : "studio.tools.enable",
                          ),
                        },
                      ]
                    : []),
                  ...(tool.state === "disabled"
                    ? [
                        {
                          key: "delete",
                          label: t("studio.tools.deletion.action"),
                          danger: true,
                        },
                      ]
                    : []),
                  ...(tool.draft
                    ? [
                        {
                          key: "discard",
                          label: label("discardDraft"),
                          danger: true,
                        },
                      ]
                    : []),
                ],
                onClick: ({ key }) => {
                  if (key === "delete") openDelete();
                  else setConfirmation(key as "availability" | "discard");
                },
              }}
              disabled={locked}
            >
              <Button
                type="text"
                icon={<MoreOutlined />}
                aria-label={label("more")}
              />
            </Dropdown>
          )}
        />
      </div>
      {error || command.error ? (
        <Alert
          type="error"
          title={error ?? command.error}
          action={
            command.uncertain ? (
              <Button onClick={() => void command.retry()}>
                {t("studio.tools.retryOperation")}
              </Button>
            ) : (
              <Button onClick={() => setConfirmation("reload")}>
                {label("reloadData")}
              </Button>
            )
          }
        />
      ) : null}
      <Tabs
        activeKey={tab}
        onChange={(key) => changeTab(key as "preview" | "html" | "settings")}
        items={[
          { key: "preview", label: label("preview") },
          { key: "html", label: "HTML" },
          { key: "settings", label: label("settings") },
        ]}
      />
      <div>
        <div
          hidden={tab === "settings"}
          className="min-w-0 overflow-hidden rounded-xl bg-paper"
        >
          {tab === "html" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-control bg-paper px-4 py-3 text-sm">
              <strong className="w-full min-w-0 truncate sm:w-auto sm:flex-1">
                {revision || text !== undefined
                  ? filename
                  : label("chooseFile")}
              </strong>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept=".html,.htm,text/html"
                onChange={(event) => void selectHtml(event)}
                aria-label={label("replace")}
                disabled={locked}
              />
              <Button
                type="text"
                icon={<UploadOutlined />}
                disabled={locked}
                onClick={() => fileInputRef.current?.click()}
              >
                {revision ? label("replace") : label("upload")}
              </Button>
              {content ? (
                <Button
                  type="text"
                  icon={<DownloadOutlined />}
                  onClick={download}
                >
                  {label("download")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 bg-mist/50 px-4 py-3 text-xs text-muted">
              <span>
                {tool.draft ? label("draftPreview") : label("publishedPreview")}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => setPreviewKey((key) => key + 1)}
                >
                  {label("reload")}
                </Button>
                <Button
                  type="text"
                  size="small"
                  icon={<FullscreenOutlined />}
                  onClick={() => void fullscreen()}
                >
                  {t("studio.tools.fullscreen")}
                </Button>
              </div>
            </div>
          )}
          {(sourceDirty || capabilityDirty) && tab === "preview" ? (
            <Alert type="info" title={label("previewStale")} />
          ) : null}
          {source.isError ? (
            <Alert
              type="error"
              title={label("sourceError")}
              action={
                <Button onClick={() => void source.refetch()}>
                  {t("studio.tools.retry")}
                </Button>
              }
            />
          ) : null}
          <div
            ref={previewRef}
            hidden={tab !== "preview"}
            className="h-[60dvh] min-h-96 overflow-hidden bg-paper"
          >
            {renderContent()}
          </div>
          <div
            hidden={tab !== "html"}
            className="h-[60dvh] min-h-96 overflow-hidden bg-paper"
          >
            <HtmlSourceEditor
              label={label("source")}
              value={content}
              onChange={setText}
              disabled={locked || (source.isPending && Boolean(revision))}
              {...(focusRequest ? { focusRequest } : {})}
            />
          </div>
          {revision?.check && !revision.check.passed ? (
            <Alert
              type="error"
              title={label("checkFailed")}
              description={
                <ul className="m-0 space-y-2 pl-4">
                  {revision.check.issues.map((issue) => (
                    <li key={`${issue.code}:${issue.line}:${issue.message}`}>
                      {issue.line ? (
                        <button
                          type="button"
                          className="mr-2 text-primary underline"
                          onClick={() => focusIssue(issue.line!)}
                        >
                          {label("line")} {issue.line}
                        </button>
                      ) : null}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
        </div>
        <div
          hidden={tab !== "settings"}
          className="rounded-xl bg-paper p-6 sm:p-8"
        >
          <Form layout="vertical" component="div">
            <div className="grid gap-6 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-8">
              <h2 className="m-0 text-sm font-semibold">
                {t("studio.tools.presentation")}
              </h2>
              <div className="max-w-lg">
                <Form.Item
                  label={t("studio.tools.name")}
                  htmlFor="tool-display-name"
                >
                  <Input
                    id="tool-display-name"
                    placeholder={label("namePlaceholder")}
                    value={value.displayName}
                    maxLength={160}
                    disabled={locked}
                    onChange={(event) =>
                      setValue({ ...value, displayName: event.target.value })
                    }
                  />
                </Form.Item>
                <Form.Item label={label("address")} htmlFor="tool-slug">
                  <Input
                    id="tool-slug"
                    placeholder={label("slugPlaceholder")}
                    readOnly={Boolean(tool.publishedRevision)}
                    disabled={locked}
                    value={value.slug}
                    onChange={(event) =>
                      setValue({ ...value, slug: event.target.value })
                    }
                  />
                </Form.Item>
                <Form.Item label={t("studio.tools.logo")}>
                  <div className="flex items-center gap-4">
                    <Button
                      type="text"
                      disabled={locked}
                      aria-label={label("changeIcon")}
                      onClick={() => setIconOpen(true)}
                      styles={{
                        root: { ...artworkDimensions.logoImageId, padding: 0 },
                        content: {
                          width: "100%",
                          height: "100%",
                          display: "block",
                        },
                      }}
                    >
                      <span className="relative block h-full w-full">
                        <span className="block h-full w-full overflow-hidden rounded-control bg-mist">
                          {renderArtwork("logoImageId")}
                        </span>
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-paper text-sm text-muted"
                        >
                          <EditOutlined />
                        </span>
                      </span>
                    </Button>
                    {value.logoImageId ||
                    value.symbol ||
                    artwork.logoImageId ? (
                      <Button
                        type="text"
                        disabled={locked}
                        onClick={() => removeArtwork("logoImageId")}
                      >
                        {label("remove")}
                      </Button>
                    ) : null}
                  </div>
                </Form.Item>
                <Form.Item label={t("studio.tools.cover")}>
                  <Tooltip title={label("changeCover")}>
                    <Button
                      type="text"
                      disabled={locked}
                      aria-label={label("changeCover")}
                      onClick={() => setCoverOpen(true)}
                      styles={{
                        root: { ...artworkDimensions.coverImageId, padding: 0 },
                        content: {
                          width: "100%",
                          height: "100%",
                          display: "block",
                        },
                      }}
                    >
                      <span className="relative block h-full w-full">
                        <span className="block h-full w-full overflow-hidden rounded-control bg-mist">
                          {renderArtwork("coverImageId")}
                        </span>
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-paper text-sm text-muted"
                        >
                          <EditOutlined />
                        </span>
                      </span>
                    </Button>
                  </Tooltip>
                </Form.Item>
                <Form.Item
                  label={label("instructions")}
                  htmlFor="tool-description"
                >
                  <Input.TextArea
                    id="tool-description"
                    placeholder={label("instructionsPlaceholder")}
                    rows={4}
                    aria-label={label("instructions")}
                    disabled={locked}
                    value={value.descriptionMarkdown}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        descriptionMarkdown: event.target.value,
                      })
                    }
                  />
                </Form.Item>
              </div>
            </div>
            <div className="mt-6 grid gap-6 border-t border-line pt-6 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-8">
              <h2 className="m-0 text-sm font-semibold">
                {label("capabilities")}
              </h2>
              <div className="max-w-lg">
                <Form.Item label={label("allowedCapabilities")}>
                  <Select
                    className="w-full"
                    mode="multiple"
                    placeholder={label("capabilitiesPlaceholder")}
                    loading={integrations.isPending}
                    aria-label={label("capabilities")}
                    disabled={locked || integrations.isError}
                    value={capabilities}
                    onChange={setCapabilities}
                    options={
                      integrations.data?.items.map((item) => ({
                        value: item.contractRevisionId,
                        label: item.displayName,
                      })) ?? []
                    }
                  />
                  {integrations.isError ? (
                    <Alert
                      type="error"
                      title={t("studio.tools.capabilityLoadError")}
                    />
                  ) : null}
                </Form.Item>
              </div>
            </div>
          </Form>
        </div>
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-mist py-4">
        <span className="text-xs text-muted">{editState}</span>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button type="text" disabled={locked} onClick={resetEdits}>
              {label("reset")}
            </Button>
          ) : null}

          <Button
            disabled={
              locked || (!dirty && revision?.checkStatus !== "unchecked")
            }
            loading={command.busy}
            onClick={() => save()}
          >
            {label("save")}
          </Button>
          <Button
            type="primary"
            disabled={
              locked ||
              (!tool.draft && !sourceDirty && !capabilityDirty) ||
              (source.isPending && Boolean(revision)) ||
              (!dirty && revision?.checkStatus === "failed")
            }
            onClick={() => save(true)}
          >
            {label("publish")}
          </Button>
        </div>
        {settingsDirty ? (
          <p className="m-0 w-full text-xs text-muted">
            {label("settingsImmediate")}
          </p>
        ) : null}
      </div>
      {iconOpen ? (
        <ToolIconEditor
          symbol={value.symbol}
          hasImage={Boolean(value.logoImageId || artwork.logoImageId)}
          imagePreview={renderArtwork("logoImageId")}
          onCancel={() => setIconOpen(false)}
          onConfirm={applyIcon}
        />
      ) : null}
      {coverOpen ? (
        <CoverPickerDialog
          initialSelection={value.coverImageId}
          items={(covers.data?.items ?? []).map((image) => ({
            id: image.id,
            name: image.name || label("coverImage"),
            thumbnail: <ToolArtwork imageId={image.id} cover />,
          }))}
          loading={covers.isPending}
          {...(covers.isError ? { loadError: label("sourceError") } : {})}
          canUpload
          onRetry={() => {
            void covers.refetch();
          }}
          onUpload={uploadCoverItem}
          onCancel={() => setCoverOpen(false)}
          onConfirm={applyCover}
        />
      ) : null}
      <Modal
        open={Boolean(confirmation)}
        onCancel={() => setConfirmation(undefined)}
        onOk={confirmed}
        title={confirmationTitle}
        okText={label("confirm")}
        cancelText={label("cancel")}
      >
        <p>{confirmationHelp}</p>
        {dirty ? <p>{label("discardLocalHelp")}</p> : null}
      </Modal>
    </div>
  );
}
