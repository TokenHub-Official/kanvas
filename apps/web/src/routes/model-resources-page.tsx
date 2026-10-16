import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type {
  ModelResourceFormat,
  ModelResourceCatalogCandidateSummary,
  ModelResourceImportSummary,
  ModelResourceSummary,
  StartModelResourceImportBody,
} from "@kanvas/contracts/api";
import { resolveLocalizedTextV1 } from "@kanvas/contracts/capability";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Dropdown,
  Form,
  Progress,
  Segmented,
  Skeleton,
  Upload,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  cancelModelResourceImport,
  fetchModelResourceImport,
  fetchWorkspaceCapabilityDefinitions,
  fetchWorkspaceModelResources,
  publishModelResourceImport,
  setModelResourceStatus,
  startModelResourceImport,
  uploadModelResourceImport,
} from "../api/transport.js";
import { workspaceQueryKeys } from "../api/query-keys.js";
import { EmptyState, InlineNotice } from "../components/feedback.js";
import {
  KanvasInput,
  KanvasSearchInput,
  KanvasTextArea,
} from "../components/kanvas-input.js";
import { KanvasSelect } from "../components/kanvas-select.js";
import { SettingsDirectoryTable } from "../components/settings-directory-table.js";
import {
  SettingsAlertDialog,
  SettingsAlertDialogContent,
  SettingsDialog,
  SettingsDialogContent,
} from "../components/settings-overlay.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { useSettingsNotification } from "../components/settings-notification.js";
import { StatusTag } from "../components/status-tag.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { compatibleRuntimeAdapters } from "../features/capability-definitions/capability-implementation-editor.js";
import {
  modelResourcePublicationBody,
  modelResourcePublicationDraftError,
  modelResourcePublicationDraftFrom,
  type ModelResourcePublicationDraft,
  type ModelResourcePublishTarget,
} from "../features/model-resources/model-resource-import-editor.js";
import { modelResourceDownloadPercent } from "../features/model-resources/model-resource-download-progress.js";

const routeApi = getRouteApi("/w/$workspaceId/settings/model-resources");
const formats: readonly ModelResourceFormat[] = [
  "onnx",
  "safetensors",
  "gguf",
  "tflite",
  "coreml",
  "tesseract_data",
  "wasm_bundle",
  "other",
];
const kibibyteBytes = 1_024;
const mebibyteBytes = kibibyteBytes * kibibyteBytes;
const gibibyteBytes = mebibyteBytes * kibibyteBytes;
const importRefreshIntervalMilliseconds = 1_000;
const activeProgressPercent = 70;
const progressStrokeWidth = 6;

interface ImportEditorState {
  readonly target: ModelResourcePublishTarget;
  readonly sourceKind: "catalog" | "url" | "upload";
  readonly url: string;
  readonly catalogEntryId?: string;
  readonly catalogCandidate?: ModelResourceCatalogCandidateSummary;
  readonly file?: File;
  readonly startRequestKey: string;
  readonly activeImport?: ModelResourceImportSummary;
  readonly publication?: ModelResourcePublicationDraft;
}

type ModelResourceDirectoryRow =
  | Readonly<{
      id: string;
      key: string;
      kind: "published";
      resource: ModelResourceSummary;
    }>
  | Readonly<{
      id: string;
      key: string;
      kind: "catalog";
      candidate: ModelResourceCatalogCandidateSummary;
    }>;
type ModelResourceDirectoryView = "installed" | "recommendations";

function emptyImportEditor(
  target: ModelResourcePublishTarget = { kind: "new" },
): ImportEditorState {
  return Object.freeze({
    target,
    sourceKind: "url",
    url: "",
    startRequestKey: crypto.randomUUID(),
  });
}

function catalogImportEditor(
  candidate: ModelResourceCatalogCandidateSummary,
): ImportEditorState {
  return Object.freeze({
    target: { kind: "new" as const },
    sourceKind: "catalog",
    url: "",
    catalogEntryId: candidate.id,
    catalogCandidate: candidate,
    startRequestKey: crypto.randomUUID(),
  });
}

function restartImportEditor(editor: ImportEditorState): ImportEditorState {
  return Object.freeze({
    target: editor.target,
    sourceKind: editor.sourceKind,
    url: editor.url,
    ...(editor.catalogEntryId ? { catalogEntryId: editor.catalogEntryId } : {}),
    ...(editor.catalogCandidate
      ? { catalogCandidate: editor.catalogCandidate }
      : {}),
    startRequestKey: crypto.randomUUID(),
  });
}

function byteSize(value: string | undefined): string {
  if (!value) return "-";
  const size = Number(value);
  if (!Number.isFinite(size)) return value;
  if (size >= gibibyteBytes) return `${(size / gibibyteBytes).toFixed(1)} GB`;
  if (size >= mebibyteBytes) return `${(size / mebibyteBytes).toFixed(1)} MB`;
  if (size >= kibibyteBytes) return `${(size / kibibyteBytes).toFixed(1)} KB`;
  return `${String(size)} B`;
}

function processing(
  status: ModelResourceImportSummary["status"],
): status is "fetching" | "analyzing" {
  return status === "fetching" || status === "analyzing";
}

function ModelResourceImportProgress({
  cancelRequested,
  cancelling,
  downloadedBytes,
  expectedByteSize,
  onCancel,
  stage,
}: {
  readonly cancelRequested: boolean;
  readonly cancelling: boolean;
  readonly downloadedBytes: string;
  readonly expectedByteSize?: string;
  readonly onCancel?: () => void;
  readonly stage: "fetching" | "analyzing" | "saving";
}): React.JSX.Element {
  const { t } = useTranslation();
  const stages = ["fetching", "analyzing", "saving"] as const;
  const current = stages.indexOf(stage);
  const downloadPercent = modelResourceDownloadPercent(
    downloadedBytes,
    expectedByteSize,
  );
  let descriptionKey = `settings.modelResources.progress.${stage}`;
  if (stage === "fetching" && expectedByteSize) {
    descriptionKey = "settings.modelResources.progress.fetchingSized";
  }
  return (
    <div aria-live="polite" className="grid gap-5 py-3" role="status">
      <div className="grid grid-cols-3 gap-2">
        {stages.map((item, index) => {
          let percent = 0;
          if (index < current) percent = 100;
          else if (index === current) {
            percent =
              item === "fetching" && downloadPercent !== undefined
                ? downloadPercent
                : activeProgressPercent;
          }
          return (
            <div className="grid gap-2" key={item}>
              <Progress
                percent={percent}
                showInfo={false}
                size={["100%", progressStrokeWidth]}
                status={index === current ? "active" : "normal"}
                strokeColor="var(--color-primary)"
                railColor="var(--color-mist)"
              />
              <span
                className={`text-xs ${index === current ? "font-semibold text-ink" : "text-muted"}`}
              >
                {t(`settings.modelResources.progress.stages.${item}`)}
              </span>
            </div>
          );
        })}
      </div>
      <div>
        <p className="m-0 text-sm font-semibold text-ink">
          {t(`settings.modelResources.import.status.${stage}`)}
        </p>
        <p className="mt-1 text-sm leading-6 text-muted">
          {t(descriptionKey, {
            size: expectedByteSize ? byteSize(expectedByteSize) : undefined,
          })}
        </p>
        {stage === "fetching" && downloadPercent !== undefined ? (
          <p className="mt-1 text-sm tabular-nums text-muted">
            {t("settings.modelResources.progress.downloaded", {
              downloaded: byteSize(downloadedBytes),
              size: byteSize(expectedByteSize),
              percent: downloadPercent,
            })}
          </p>
        ) : null}
        {stage === "fetching" && onCancel ? (
          <div className="mt-4 flex justify-end">
            <Button
              disabled={cancelRequested}
              loading={cancelling}
              onClick={onCancel}
            >
              {cancelRequested
                ? t("settings.modelResources.import.cancelling")
                : t("settings.modelResources.import.cancelDownload")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ModelResourcesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = routeApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.modelResources.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="modelResources" workspace={workspace}>
          {workspace.permissions.includes("capability.configure") ? (
            <ModelResourcesContent
              csrfToken={context.csrfToken}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState title={t("settings.modelResources.forbiddenTitle")}>
              {t("settings.modelResources.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function ModelResourcesContent({
  csrfToken,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useSettingsNotification();
  const queryClient = useQueryClient();
  const queryKey = workspaceQueryKeys.modelResources(workspaceId);
  const resources = useQuery({
    queryKey,
    queryFn: () => fetchWorkspaceModelResources(workspaceId),
    retry: false,
  });
  const capabilitySources = useQuery({
    queryKey: workspaceQueryKeys.capabilityDefinitions(workspaceId),
    queryFn: () => fetchWorkspaceCapabilityDefinitions(workspaceId),
    retry: false,
  });
  const context = { csrfToken, workspaceId };
  const [directoryView, setDirectoryView] =
    useState<ModelResourceDirectoryView>("installed");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<ImportEditorState>();
  const [statusTarget, setStatusTarget] = useState<ModelResourceSummary>();
  const autoPublishedCatalogImportIdRef = useRef<string | undefined>(undefined);

  const importQuery = useQuery({
    queryKey: [
      "model-resource-import",
      workspaceId,
      editor?.activeImport?.id ?? "closed",
    ],
    queryFn: () =>
      fetchModelResourceImport(workspaceId, editor!.activeImport!.id),
    enabled: Boolean(editor?.activeImport),
    initialData: editor?.activeImport,
    refetchInterval: (query) =>
      query.state.data && processing(query.state.data.status)
        ? importRefreshIntervalMilliseconds
        : false,
    retry: false,
  });
  const analysis = importQuery.data ?? editor?.activeImport;

  const editorForDialog = useMemo(() => {
    if (
      !editor ||
      editor.publication ||
      !analysis ||
      (analysis.status !== "ready" && analysis.status !== "needs_input")
    ) {
      return editor;
    }
    const publication = modelResourcePublicationDraftFrom(
      analysis,
      editor.target,
    );
    return {
      ...editor,
      publication: editor.catalogCandidate
        ? {
            ...publication,
            displayName: resolveLocalizedTextV1(
              editor.catalogCandidate.displayName,
              i18n.resolvedLanguage ?? "zh-CN",
            ),
            description: editor.catalogCandidate.description
              ? resolveLocalizedTextV1(
                  editor.catalogCandidate.description,
                  i18n.resolvedLanguage ?? "zh-CN",
                )
              : publication.description,
          }
        : publication,
    };
  }, [analysis, editor, i18n.resolvedLanguage]);

  const start = useMutation({
    mutationFn: async () => {
      if (!editor) throw new Error("modelResourceImport.closed");
      let source: StartModelResourceImportBody["source"];
      if (editor.sourceKind === "catalog") {
        if (!editor.catalogEntryId) {
          throw new Error("modelResourceImport.catalogRequired");
        }
        source = { kind: "catalog", catalogEntryId: editor.catalogEntryId };
      } else if (editor.sourceKind === "url") {
        if (!editor.url.trim()) {
          throw new Error("modelResourceImport.urlRequired");
        }
        source = { kind: "url", url: editor.url.trim() };
      } else {
        if (!editor.file) {
          throw new Error("modelResourceImport.fileRequired");
        }
        source = { kind: "upload", fileName: editor.file.name };
      }
      const started = await startModelResourceImport(
        context,
        { source },
        editor.startRequestKey,
      );
      setEditor({ ...editor, activeImport: started });
      if (editor.sourceKind === "upload") {
        await uploadModelResourceImport(context, started.id, editor.file!);
      }
      return fetchModelResourceImport(workspaceId, started.id);
    },
    onSuccess: (result) => {
      setEditor((current) =>
        current ? { ...current, activeImport: result } : current,
      );
    },
    onError: () =>
      toast.notify({
        title: t("settings.modelResources.toast.importFailed"),
        description: t("settings.modelResources.toast.importFailedDescription"),
        tone: "danger",
      }),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!analysis || analysis.status !== "fetching") {
        throw new Error("modelResourceImport.notFetching");
      }
      return cancelModelResourceImport(
        context,
        analysis.id,
        crypto.randomUUID(),
      );
    },
    onSuccess: (result) => {
      setEditor((current) =>
        current ? { ...current, activeImport: result } : current,
      );
      queryClient.setQueryData(
        ["model-resource-import", workspaceId, result.id],
        result,
      );
    },
    onError: () =>
      toast.notify({
        title: t("settings.modelResources.toast.cancelFailed"),
        description: t("settings.modelResources.toast.cancelFailedDescription"),
        tone: "danger",
      }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!editorForDialog?.publication || !analysis) {
        throw new Error("modelResourceImport.notReady");
      }
      return publishModelResourceImport(
        context,
        analysis.id,
        modelResourcePublicationBody(editorForDialog.publication, analysis),
        editorForDialog.publication.requestKey,
      );
    },
    onSuccess: async () => {
      setEditor(undefined);
      await queryClient.invalidateQueries({ queryKey });
      toast.notify({
        title: t("settings.modelResources.toast.saved"),
        tone: "positive",
      });
    },
    onError: () =>
      toast.notify({
        title: t("settings.modelResources.toast.saveFailed"),
        description: t("settings.modelResources.toast.saveFailedDescription"),
        tone: "danger",
      }),
  });

  useEffect(() => {
    if (
      !editorForDialog?.catalogEntryId ||
      !editorForDialog.publication ||
      !analysis ||
      (analysis.status !== "ready" && analysis.status !== "needs_input") ||
      modelResourcePublicationDraftError(editorForDialog.publication) ||
      autoPublishedCatalogImportIdRef.current === analysis.id
    ) {
      return;
    }
    autoPublishedCatalogImportIdRef.current = analysis.id;
    publish.mutate();
  }, [analysis, editorForDialog, publish]);

  const openEditor = (next: ImportEditorState) => {
    autoPublishedCatalogImportIdRef.current = undefined;
    publish.reset();
    setEditor(next);
  };

  const setStatus = useMutation({
    mutationFn: (resource: ModelResourceSummary) =>
      setModelResourceStatus(context, resource.id, {
        expectedVersion: resource.version,
        status: resource.status === "active" ? "archived" : "active",
      }),
    onSuccess: async () => {
      setStatusTarget(undefined);
      await queryClient.invalidateQueries({ queryKey });
      toast.notify({
        title: t("settings.modelResources.toast.statusUpdated"),
        tone: "positive",
      });
    },
    onError: () =>
      toast.notify({
        title: t("settings.modelResources.toast.statusFailed"),
        description: t("settings.modelResources.toast.statusFailedDescription"),
        tone: "danger",
      }),
  });

  const rows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    const published: ModelResourceDirectoryRow[] = (
      resources.data?.resources ?? []
    ).map((resource) => ({
      id: resource.id,
      key: resource.id,
      kind: "published",
      resource,
    }));
    const candidates: ModelResourceDirectoryRow[] = (
      resources.data?.catalogCandidates ?? []
    )
      .filter((candidate) => !candidate.installed)
      .map((candidate) => ({
        id: `catalog:${candidate.id}`,
        key: `catalog:${candidate.id}`,
        kind: "catalog",
        candidate,
      }));
    const visible = directoryView === "installed" ? published : candidates;
    return visible.filter((row) => {
      const values =
        row.kind === "published"
          ? [row.resource.displayName, row.resource.description]
          : [
              resolveLocalizedTextV1(
                row.candidate.displayName,
                i18n.resolvedLanguage ?? "zh-CN",
              ),
              row.candidate.description
                ? resolveLocalizedTextV1(
                    row.candidate.description,
                    i18n.resolvedLanguage ?? "zh-CN",
                  )
                : undefined,
            ];
      return normalized
        ? values.some((value) =>
            value?.toLocaleLowerCase().includes(normalized),
          )
        : true;
    });
  }, [directoryView, i18n.resolvedLanguage, resources.data, search]);

  const columns: TableColumnsType<ModelResourceDirectoryRow> = [
    {
      title: t("settings.modelResources.columns.model"),
      key: "model",
      width: 560,
      render: (_, row) => {
        const name =
          row.kind === "published"
            ? row.resource.displayName
            : resolveLocalizedTextV1(
                row.candidate.displayName,
                i18n.resolvedLanguage ?? "zh-CN",
              );
        let description: string | undefined;
        if (row.kind === "published") {
          description = row.resource.description;
        } else if (row.candidate.description) {
          description = resolveLocalizedTextV1(
            row.candidate.description,
            i18n.resolvedLanguage ?? "zh-CN",
          );
        }
        return (
          <div className="min-w-0">
            <div className="font-semibold text-ink">{name}</div>
            {description ? (
              <div className="mt-1 line-clamp-2 text-sm text-muted">
                {description}
              </div>
            ) : null}
            {row.kind === "catalog" ? (
              <div className="mt-2 text-xs font-medium text-muted">
                {[
                  row.candidate.executionTargets
                    .map((target) =>
                      t(`settings.modelResources.targets.${target}`),
                    )
                    .join(" / "),
                  byteSize(row.candidate.expectedByteSize),
                ].join(" · ")}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t("settings.modelResources.columns.status"),
      key: "status",
      width: 140,
      render: (_, row) => (
        <StatusTag
          tone={
            row.kind === "published" && row.resource.status === "active"
              ? "positive"
              : "neutral"
          }
        >
          {row.kind === "catalog"
            ? t("settings.modelResources.status.notAdded")
            : t(`settings.modelResources.status.${row.resource.status}`)}
        </StatusTag>
      ),
    },
    {
      title: t("settings.modelResources.columns.actions"),
      key: "actions",
      fixed: "right",
      width: 180,
      render: (_, row) => {
        if (row.kind === "catalog") {
          return (
            <Button
              onClick={() => openEditor(catalogImportEditor(row.candidate))}
              size="small"
              type="primary"
            >
              {t("settings.modelResources.catalog.import")}
            </Button>
          );
        }
        const resource = row.resource;
        const items: MenuProps["items"] = [
          {
            key: "revision",
            icon: <PlusOutlined />,
            label: t("settings.modelResources.actions.newRevision"),
          },
          {
            key: "status",
            icon:
              resource.status === "active" ? (
                <DeleteOutlined />
              ) : (
                <UndoOutlined />
              ),
            danger: resource.status === "active",
            label:
              resource.status === "active"
                ? t("settings.modelResources.actions.archive")
                : t("settings.modelResources.actions.restore"),
          },
        ];
        return (
          <div className="flex justify-end gap-2">
            {resource.status === "active" &&
            resource.nativeInterfaceDigest &&
            compatibleRuntimeAdapters(
              { kind: "model_resource", id: resource.revisionId },
              resources.data?.resources ?? [],
              capabilitySources.data?.providerRoutes ?? [],
              capabilitySources.data?.runtimeAdapters ?? [],
            ).length > 0 ? (
              <Button
                onClick={() =>
                  void navigate({
                    to: "/w/$workspaceId/settings/capabilities",
                    params: { workspaceId },
                    search: {
                      source: `model_resource:${resource.revisionId}`,
                    },
                  })
                }
                size="small"
              >
                {t("settings.modelResources.actions.createCapability")}
              </Button>
            ) : null}
            <Dropdown
              menu={{
                items,
                onClick: ({ key }) => {
                  if (key === "revision") {
                    openEditor(
                      emptyImportEditor({
                        kind: "new_revision",
                        modelResourceId: resource.id,
                        expectedResourceVersion: resource.version,
                        key: resource.key,
                      }),
                    );
                  } else {
                    setStatusTarget(resource);
                  }
                },
              }}
              placement="bottomRight"
              trigger={["click"]}
            >
              <Button size="small">
                {t("settings.modelResources.actions.more")}
              </Button>
            </Dropdown>
          </div>
        );
      },
    },
  ];

  return (
    <div className="w-full">
      <SettingsPageHeader
        action={
          <Button
            icon={<PlusOutlined />}
            onClick={() => openEditor(emptyImportEditor())}
          >
            {t("settings.modelResources.addCustom")}
          </Button>
        }
        title={t("settings.modelResources.title")}
      />
      {resources.isPending ? (
        <div className="rounded-[20px] bg-paper p-5">
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : null}
      {resources.isError ? (
        <InlineNotice
          title={t("settings.modelResources.loadError")}
          tone="danger"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("settings.modelResources.loadErrorDescription")}</span>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void resources.refetch()}
              size="small"
            >
              {t("settings.modelResources.reload")}
            </Button>
          </div>
        </InlineNotice>
      ) : null}
      {resources.data ? (
        <SettingsDirectoryTable
          columns={columns}
          dataSource={rows}
          emptyText={
            directoryView === "installed" ? (
              <EmptyState
                action={() => setDirectoryView("recommendations")}
                actionLabel={t("settings.modelResources.viewRecommendations")}
                title={t("settings.modelResources.emptyInstalledTitle")}
              >
                {t("settings.modelResources.emptyInstalledDescription")}
              </EmptyState>
            ) : (
              <EmptyState
                title={t("settings.modelResources.emptyRecommendationsTitle")}
              >
                {t("settings.modelResources.emptyRecommendationsDescription")}
              </EmptyState>
            )
          }
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-3">
              <Segmented<ModelResourceDirectoryView>
                onChange={setDirectoryView}
                options={[
                  {
                    label: t("settings.modelResources.views.installed", {
                      count: resources.data.resources.length,
                    }),
                    value: "installed",
                  },
                  {
                    label: t("settings.modelResources.views.recommendations", {
                      count: resources.data.catalogCandidates.filter(
                        (candidate) => !candidate.installed,
                      ).length,
                    }),
                    value: "recommendations",
                  },
                ]}
                value={directoryView}
              />
              <KanvasSearchInput
                allowClear
                className="w-full sm:ml-auto sm:max-w-90"
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("settings.modelResources.search")}
                value={search}
              />
            </div>
          }
        />
      ) : null}
      <ModelResourceImportDialog
        analysis={analysis}
        editor={editorForDialog}
        loading={
          start.isPending || (analysis ? processing(analysis.status) : false)
        }
        onChange={setEditor}
        onCancel={() => cancel.mutate()}
        onPublish={() => publish.mutate()}
        onStart={() => start.mutate()}
        publicationFailed={publish.isError}
        publishing={publish.isPending}
        cancelling={cancel.isPending}
      />
      <SettingsAlertDialog
        onOpenChange={(open) => {
          if (!open) setStatusTarget(undefined);
        }}
        open={Boolean(statusTarget)}
      >
        <SettingsAlertDialogContent
          actionLabel={
            statusTarget?.status === "active"
              ? t("settings.modelResources.actions.archive")
              : t("settings.modelResources.actions.restore")
          }
          actionVariant={
            statusTarget?.status === "active" ? "danger" : "primary"
          }
          cancelLabel={t("settings.modelResources.cancel")}
          onAction={() => {
            if (statusTarget) setStatus.mutate(statusTarget);
          }}
          title={
            statusTarget?.status === "active"
              ? t("settings.modelResources.archiveTitle")
              : t("settings.modelResources.restoreTitle")
          }
        >
          {statusTarget?.status === "active"
            ? t("settings.modelResources.archiveDescription")
            : t("settings.modelResources.restoreDescription")}
        </SettingsAlertDialogContent>
      </SettingsAlertDialog>
    </div>
  );
}

function ModelResourceImportDialog({
  analysis,
  cancelling,
  editor,
  loading,
  onChange,
  onCancel,
  onPublish,
  onStart,
  publicationFailed,
  publishing,
}: {
  readonly analysis: ModelResourceImportSummary | undefined;
  readonly cancelling: boolean;
  readonly editor: ImportEditorState | undefined;
  readonly loading: boolean;
  readonly onChange: (value: ImportEditorState | undefined) => void;
  readonly onCancel: () => void;
  readonly onPublish: () => void;
  readonly onStart: () => void;
  readonly publicationFailed: boolean;
  readonly publishing: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const update = (value: Partial<ImportEditorState>) =>
    onChange(editor ? { ...editor, ...value } : editor);
  const updatePublication = (
    value: Partial<ModelResourcePublicationDraft>,
  ): void => {
    if (editor?.publication) {
      update({ publication: { ...editor.publication, ...value } });
    }
  };
  function removeUploadFile(): void {
    if (!editor) return;
    const { file, ...next } = editor;
    void file;
    onChange(next);
  }
  let sourceInput: React.JSX.Element | undefined;
  if (editor?.sourceKind === "url") {
    sourceInput = (
      <Form.Item
        label={t("settings.modelResources.fields.url")}
        name="url"
        rules={[
          {
            required: true,
            message: t("settings.modelResources.validation.url"),
          },
        ]}
      >
        <KanvasInput
          onChange={(event) => update({ url: event.target.value })}
          placeholder={t("settings.modelResources.placeholders.url")}
        />
      </Form.Item>
    );
  } else if (editor?.sourceKind === "upload") {
    sourceInput = (
      <Form.Item
        extra={t("settings.modelResources.help.file")}
        getValueFromEvent={(event: { fileList?: unknown[] }) => event.fileList}
        label={t("settings.modelResources.fields.file")}
        name="file"
        rules={[
          {
            required: true,
            message: t("settings.modelResources.validation.file"),
          },
        ]}
        valuePropName="fileList"
      >
        <Upload
          beforeUpload={(file) => {
            update({ file });
            return false;
          }}
          maxCount={1}
          onRemove={removeUploadFile}
        >
          <Button icon={<UploadOutlined />}>
            {t("settings.modelResources.import.chooseFile")}
          </Button>
        </Upload>
      </Form.Item>
    );
  }
  let dialogTitle = t("settings.modelResources.addTitle");
  if (editor?.catalogEntryId) {
    dialogTitle = t("settings.modelResources.addRecommendedTitle");
  } else if (editor?.target.kind === "new_revision") {
    dialogTitle = t("settings.modelResources.newRevisionTitle");
  }
  let catalogCompletion: React.JSX.Element | undefined;
  if (
    editor?.catalogEntryId &&
    editor.publication &&
    analysis &&
    (analysis.status === "ready" || analysis.status === "needs_input")
  ) {
    if (publicationFailed) {
      catalogCompletion = (
        <div className="space-y-4">
          <InlineNotice
            title={t("settings.modelResources.catalog.addFailed")}
            tone="danger"
          >
            {t("settings.modelResources.catalog.addFailedDescription")}
          </InlineNotice>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => onChange(undefined)}>
              {t("settings.modelResources.cancel")}
            </Button>
            <Button onClick={onPublish} type="primary">
              {t("settings.modelResources.catalog.retry")}
            </Button>
          </div>
        </div>
      );
    } else {
      catalogCompletion = (
        <ModelResourceImportProgress
          cancelRequested={false}
          cancelling={false}
          downloadedBytes={analysis.downloadedBytes}
          stage="saving"
        />
      );
    }
  }
  const progressExpectedByteSize =
    analysis?.expectedByteSize ?? editor?.catalogCandidate?.expectedByteSize;
  return (
    <SettingsDialog
      onOpenChange={(open) => {
        if (!open && !loading && !publishing) onChange(undefined);
      }}
      open={Boolean(editor)}
    >
      <SettingsDialogContent
        closeLabel={t("settings.modelResources.close")}
        dismissible={!loading && !publishing}
        title={dialogTitle}
        width={640}
      >
        {editor && !editor.activeImport ? (
          <div className="space-y-5">
            {editor.sourceKind === "catalog" && editor.catalogCandidate ? (
              <section className="grid gap-3 py-1">
                <h3 className="m-0 text-base font-semibold text-ink">
                  {resolveLocalizedTextV1(
                    editor.catalogCandidate.displayName,
                    i18n.resolvedLanguage ?? "zh-CN",
                  )}
                </h3>
                <p className="m-0 text-sm leading-6 text-muted">
                  {editor.catalogCandidate.description
                    ? resolveLocalizedTextV1(
                        editor.catalogCandidate.description,
                        i18n.resolvedLanguage ?? "zh-CN",
                      )
                    : t("settings.modelResources.catalog.importDescription")}
                </p>
                {editor.catalogCandidate.expectedByteSize ? (
                  <div className="flex items-center justify-between rounded-control bg-mist px-4 py-3 text-sm">
                    <span className="text-muted">
                      {t("settings.modelResources.catalog.downloadSize")}
                    </span>
                    <span className="font-medium text-ink">
                      {byteSize(editor.catalogCandidate.expectedByteSize)}
                    </span>
                  </div>
                ) : null}
              </section>
            ) : (
              <Segmented
                block
                onChange={(value) =>
                  update({ sourceKind: value as "url" | "upload" })
                }
                options={[
                  {
                    label: t("settings.modelResources.import.url"),
                    value: "url",
                  },
                  {
                    label: t("settings.modelResources.import.upload"),
                    value: "upload",
                  },
                ]}
                value={editor.sourceKind}
              />
            )}
            {editor.sourceKind === "catalog" ? (
              <div className="flex justify-end gap-2 pt-2">
                <Button disabled={loading} onClick={() => onChange(undefined)}>
                  {t("settings.modelResources.cancel")}
                </Button>
                <Button loading={loading} onClick={onStart} type="primary">
                  {t("settings.modelResources.catalog.import")}
                </Button>
              </div>
            ) : (
              <Form
                initialValues={{ url: editor.url }}
                key={`${editor.sourceKind}:${editor.startRequestKey}`}
                layout="vertical"
                onFinish={onStart}
                validateTrigger={[]}
              >
                {sourceInput}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    disabled={loading}
                    onClick={() => onChange(undefined)}
                  >
                    {t("settings.modelResources.cancel")}
                  </Button>
                  <Button htmlType="submit" loading={loading} type="primary">
                    {t("settings.modelResources.import.continue")}
                  </Button>
                </div>
              </Form>
            )}
          </div>
        ) : null}

        {editor?.activeImport && analysis && processing(analysis.status) ? (
          <ModelResourceImportProgress
            cancelRequested={Boolean(analysis.cancelRequestedAt)}
            cancelling={cancelling}
            downloadedBytes={analysis.downloadedBytes}
            {...(progressExpectedByteSize
              ? { expectedByteSize: progressExpectedByteSize }
              : {})}
            {...(analysis.status === "fetching" &&
            editor.sourceKind !== "upload"
              ? { onCancel }
              : {})}
            stage={analysis.status}
          />
        ) : null}

        {editor && analysis?.status === "cancelled" ? (
          <div className="space-y-4">
            <InlineNotice
              title={t("settings.modelResources.import.cancelledTitle")}
            >
              {t("settings.modelResources.import.cancelledDescription")}
            </InlineNotice>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => onChange(undefined)}>
                {t("settings.modelResources.close")}
              </Button>
              <Button
                onClick={() => onChange(restartImportEditor(editor))}
                type="primary"
              >
                {t("settings.modelResources.import.retry")}
              </Button>
            </div>
          </div>
        ) : null}

        {editor && analysis?.status === "failed" ? (
          <div className="space-y-4">
            <InlineNotice
              title={t("settings.modelResources.import.status.failed")}
              tone="danger"
            >
              {t(
                `settings.modelResources.import.failures.${analysis.failure?.code.replaceAll(".", "_") ?? "unknown"}`,
                { defaultValue: analysis.failure?.message },
              )}
            </InlineNotice>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => onChange(undefined)}>
                {t("settings.modelResources.cancel")}
              </Button>
              <Button
                onClick={() => onChange(restartImportEditor(editor))}
                type="primary"
              >
                {t("settings.modelResources.import.retry")}
              </Button>
            </div>
          </div>
        ) : null}

        {catalogCompletion}

        {!editor?.catalogEntryId &&
        editor?.publication &&
        analysis &&
        (analysis.status === "ready" || analysis.status === "needs_input") ? (
          <Form
            className="space-y-6"
            initialValues={{
              displayName: editor.publication.displayName,
              description: editor.publication.description,
              format: editor.publication.format,
            }}
            key={analysis.id}
            layout="vertical"
            onFinish={onPublish}
            validateTrigger={[]}
          >
            <p className="m-0 text-sm leading-6 text-muted">
              {t("settings.modelResources.import.readyDescription")}
            </p>
            <div className="grid gap-4">
              <Form.Item
                label={t("settings.modelResources.fields.name")}
                name="displayName"
                rules={[
                  {
                    required: true,
                    message: t("settings.modelResources.validation.name"),
                  },
                ]}
              >
                <KanvasInput
                  onChange={(event) =>
                    updatePublication({ displayName: event.target.value })
                  }
                  placeholder={t("settings.modelResources.placeholders.name")}
                />
              </Form.Item>
              <Form.Item
                label={t("settings.modelResources.fields.description")}
                name="description"
              >
                <KanvasTextArea
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  onChange={(event) =>
                    updatePublication({ description: event.target.value })
                  }
                />
              </Form.Item>
              {analysis.requiredUserInputs.includes("format") ? (
                <Form.Item
                  label={t("settings.modelResources.fields.format")}
                  name="format"
                  rules={[{ required: true }]}
                >
                  <KanvasSelect
                    onChange={(format) =>
                      updatePublication({
                        format: format as ModelResourceFormat,
                      })
                    }
                    options={formats.map((format) => ({
                      label: format,
                      value: format,
                    }))}
                  />
                </Form.Item>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button disabled={publishing} onClick={() => onChange(undefined)}>
                {t("settings.modelResources.cancel")}
              </Button>
              <Button htmlType="submit" loading={publishing} type="primary">
                {t("settings.modelResources.finish")}
              </Button>
            </div>
          </Form>
        ) : null}
      </SettingsDialogContent>
    </SettingsDialog>
  );
}
