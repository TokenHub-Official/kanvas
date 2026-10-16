import {
  BgColorsOutlined,
  BranchesOutlined,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  FileOutlined,
  FileImageOutlined,
  LayoutOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type {
  AgentThreadView,
  CapabilityRunDetails,
  EffectiveInvocationSchema,
} from "@kanvas/contracts/api";
import { projectWorkflowAuthoringGraph } from "@kanvas/contracts/workflow-authoring";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  ConfigProvider,
  Empty,
  Skeleton,
  Tabs,
} from "antd";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  fetchBrandKitRevision,
  fetchCanvasDraft,
  downloadArtifact,
  fetchWorkflowAuthoringCapabilities,
  fetchWorkflowRun,
  fetchWorkflowTemplate,
} from "../../api/transport.js";
import { taskArtifactFilename } from "./agent-result-actions.js";
import { defaultCapabilityFieldLabel } from "../capability-definitions/capability-field-labels.js";
import { AgentTaskFailure } from "./agent-task-failure.js";
import { agentCapabilityTaskQueryOptions } from "./agent-capability-task-query.js";
import { agentTaskDisplayText } from "./agent-task-presentation.js";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import { ActionLink } from "../../components/action-link.js";
import { artifactPreviewQueryOptionsV1 } from "../../components/artifact-preview-query.js";
import { StatusTag } from "../../components/status-tag.js";
import { RunOutputValue } from "../../components/run-output-value.js";
import { cn } from "../../lib/cn.js";
import {
  agentCardClassName,
  agentCardIconClassName,
  agentTaskPresentationStatus,
  agentTaskStatusTone,
} from "./agent-presentation.js";
import { CanvasPageV1 } from "../editor/canvas-node-renderer-v1.js";
import { CanvasViewControlsV1 } from "../editor/canvas-view-controls-v1.js";
import {
  editorDocumentV1ArtifactIds,
  normalizeEditorDocumentV1,
  type EditorArtifactRuntimeResourceV1,
} from "../editor/editor-document-v1.js";
import { createEditorRuntimeDocumentV1 } from "../editor/editor-runtime-v1.js";
import { useCanvasViewportV1 } from "../editor/use-canvas-viewport-v1.js";
import {
  workflowRunCompletedStepCountV1,
  workflowRunDisplayOutputFields,
  workflowRunPollIntervalV1,
} from "../workflows/workflow-run-session-v1.js";

const WorkflowReadonlyGraphV1 = lazy(async () => {
  const module =
    await import("../workflows/workflow-authoring-workspace-v1.js");
  return { default: module.WorkflowReadonlyGraphV1 };
});

export type AgentWorkbenchResource = AgentThreadView["relatedContent"][number];
export type AgentWorkbenchTask = AgentThreadView["tasks"][number];
export type AgentWorkbenchEntry =
  | {
      readonly entryKind: "resource";
      readonly resource: AgentWorkbenchResource;
    }
  | { readonly entryKind: "task"; readonly task: AgentWorkbenchTask };

export function agentWorkbenchResourceKey(
  item: AgentWorkbenchResource,
): string {
  return `${item.kind}:${item.resourceId}`;
}

export function agentWorkbenchEntryKey(entry: AgentWorkbenchEntry): string {
  return entry.entryKind === "resource"
    ? agentWorkbenchResourceKey(entry.resource)
    : `task:${entry.task.id}`;
}

export function currentAgentWorkbenchEntries(
  opened: readonly AgentWorkbenchEntry[],
  available: readonly AgentWorkbenchEntry[],
): readonly AgentWorkbenchEntry[] {
  const currentByKey = new Map(
    available.map((entry) => [agentWorkbenchEntryKey(entry), entry]),
  );
  return opened.map(
    (entry) => currentByKey.get(agentWorkbenchEntryKey(entry)) ?? entry,
  );
}

export function agentWorkbenchResourceEntry(
  resource: AgentWorkbenchResource,
): AgentWorkbenchEntry {
  return { entryKind: "resource", resource };
}

export function agentWorkbenchTaskEntry(
  task: AgentWorkbenchTask,
): AgentWorkbenchEntry {
  return { entryKind: "task", task };
}

function WorkbenchEntryIcon({
  entry,
}: {
  readonly entry: AgentWorkbenchEntry;
}): React.JSX.Element {
  if (entry.entryKind === "task") {
    return <ThunderboltOutlined aria-hidden="true" />;
  }
  if (entry.resource.kind === "canvas") {
    return <LayoutOutlined aria-hidden="true" />;
  }
  if (entry.resource.kind === "workflow") {
    return <BranchesOutlined aria-hidden="true" />;
  }
  if (entry.resource.kind === "brand") {
    return <BgColorsOutlined aria-hidden="true" />;
  }
  return <FileImageOutlined aria-hidden="true" />;
}

export function agentTabIndexAfterKey(
  currentIndex: number,
  itemCount: number,
  key: string,
): number | undefined {
  if (itemCount < 1) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % itemCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + itemCount) % itemCount;
  return undefined;
}

function stopEventPropagation(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

function ReadonlyCanvasViewport({
  documentId,
  page,
  resources,
  workspaceId,
}: {
  readonly documentId: string;
  readonly page: ReturnType<
    typeof createEditorRuntimeDocumentV1
  >["pages"][number];
  readonly resources: ReadonlyMap<string, EditorArtifactRuntimeResourceV1>;
  readonly workspaceId: string;
}): React.JSX.Element {
  const {
    beginPan,
    changeZoom,
    connectStage,
    finishPan,
    fitViewport,
    handleWheel,
    pan,
    panning,
    updatePan,
    zoom,
  } = useCanvasViewportV1({
    documentId: `agent-preview:${documentId}`,
    pageHeight: page.height,
    pageId: page.id,
    pageWidth: page.width,
    persist: false,
    spaceHeld: true,
    workspaceId,
  });
  function handlePreviewWheel(event: React.WheelEvent<HTMLElement>): void {
    event.stopPropagation();
    handleWheel(event);
  }
  return (
    <div
      className={cn(
        "relative size-full overscroll-contain touch-none overflow-hidden bg-mist",
        panning ? "cursor-grabbing" : "cursor-grab",
      )}
      onDoubleClick={fitViewport}
      onPointerCancel={finishPan}
      onPointerDown={beginPan}
      onPointerMove={updatePan}
      onPointerUp={finishPan}
      onWheel={handlePreviewWheel}
      ref={connectStage}
      style={
        {
          "--canvas-v1-stage-safe-top": "24px",
          "--canvas-v1-stage-safe-inline": "24px",
          "--canvas-v1-stage-safe-bottom": "72px",
        } as React.CSSProperties
      }
    >
      <div
        className="absolute top-1/2 left-1/2 origin-center bg-white shadow-[0_20px_60px_rgb(0_0_0_/_28%)]"
        style={{
          height: page.height,
          transform: `translate(-50%, -50%) translate(${String(pan.x)}px, ${String(pan.y)}px) scale(${String(zoom)})`,
          width: page.width,
        }}
      >
        <CanvasPageV1 clipToPage page={page} resources={resources} />
      </div>
      <div
        className="absolute right-3 bottom-3 z-10"
        onDoubleClick={stopEventPropagation}
        onPointerDown={stopEventPropagation}
      >
        <CanvasViewControlsV1
          onFit={fitViewport}
          onShortcutsOpenChange={() => undefined}
          onZoomChange={changeZoom}
          shortcutsOpen={false}
          showShortcuts={false}
          zoom={zoom}
        />
      </div>
    </div>
  );
}

function CanvasResourceViewer({
  item,
  workspaceId,
}: {
  readonly item: AgentWorkbenchResource;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pageIndex, setPageIndex] = useState(0);
  const draft = useQuery({
    queryKey: [
      "agent-canvas-workbench",
      workspaceId,
      item.resourceId,
      "current",
    ],
    queryFn: async () => {
      const result = await fetchCanvasDraft(workspaceId, item.resourceId);
      return { document: result.document };
    },
    enabled: item.state === "available",
    retry: false,
    staleTime: 30_000,
  });
  const sourceDocument = useMemo(
    () =>
      draft.data ? normalizeEditorDocumentV1(draft.data.document) : undefined,
    [draft.data],
  );
  const runtimeDocument = useMemo(
    () =>
      sourceDocument
        ? createEditorRuntimeDocumentV1(sourceDocument)
        : undefined,
    [sourceDocument],
  );
  const [resources, setResources] = useState<
    ReadonlyMap<string, EditorArtifactRuntimeResourceV1>
  >(() => new Map());

  useEffect(() => {
    if (!sourceDocument) return;
    let disposed = false;
    const urls = new Set<string>();
    void Promise.all(
      editorDocumentV1ArtifactIds(sourceDocument).map(async (artifactId) => {
        try {
          const blob = await queryClient.fetchQuery(
            artifactPreviewQueryOptionsV1(workspaceId, artifactId),
          );
          const sourceUrl = URL.createObjectURL(blob);
          if (disposed) {
            URL.revokeObjectURL(sourceUrl);
            return;
          }
          urls.add(sourceUrl);
          setResources((current) =>
            new Map(current).set(artifactId, {
              artifactId,
              sourceQuality: "preview",
              sourceUnavailable: false,
              sourceUrl,
            }),
          );
        } catch {
          if (!disposed) {
            setResources((current) =>
              new Map(current).set(artifactId, {
                artifactId,
                sourceUnavailable: true,
              }),
            );
          }
        }
      }),
    );
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [queryClient, sourceDocument, workspaceId]);

  if (item.state !== "available") {
    return <Empty description={t("agent.canvasUnavailable")} />;
  }
  if (draft.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (draft.isError || !runtimeDocument) {
    return <Empty description={t("agent.canvasUnavailable")} />;
  }
  const page =
    runtimeDocument.pages[
      Math.min(pageIndex, runtimeDocument.pages.length - 1)
    ];
  if (!page) return <Empty description={t("agent.canvasUnavailable")} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        aria-labelledby={
          runtimeDocument.pages.length > 1
            ? `agent-canvas-page-tab-${page.id}`
            : undefined
        }
        className="min-h-0 flex-1"
        id={`agent-canvas-page-panel-${page.id}`}
        role={runtimeDocument.pages.length > 1 ? "tabpanel" : undefined}
      >
        <ReadonlyCanvasViewport
          documentId={runtimeDocument.documentId}
          page={page}
          resources={resources}
          workspaceId={workspaceId}
        />
      </div>
      {runtimeDocument.pages.length > 1 ? (
        <div
          aria-label={t("agent.canvasPages", {
            count: runtimeDocument.pages.length,
          })}
          className="flex shrink-0 gap-2 overflow-x-auto border-t border-line p-3"
          role="tablist"
        >
          {runtimeDocument.pages.map((candidate, index) => (
            <button
              aria-controls={`agent-canvas-page-panel-${candidate.id}`}
              aria-selected={index === pageIndex}
              className={cn(
                "w-20 shrink-0 overflow-hidden rounded-[9px] border bg-paper p-1",
                index === pageIndex ? "border-primary" : "border-line",
              )}
              id={`agent-canvas-page-tab-${candidate.id}`}
              key={candidate.id}
              onClick={() => setPageIndex(index)}
              onKeyDown={(event) => {
                const nextIndex = agentTabIndexAfterKey(
                  index,
                  runtimeDocument.pages.length,
                  event.key,
                );
                if (nextIndex === undefined) return;
                event.preventDefault();
                setPageIndex(nextIndex);
                requestAnimationFrame(() => {
                  const nextPage = runtimeDocument.pages[nextIndex];
                  if (nextPage) {
                    document
                      .getElementById(`agent-canvas-page-tab-${nextPage.id}`)
                      ?.focus();
                  }
                });
              }}
              role="tab"
              tabIndex={index === pageIndex ? 0 : -1}
              type="button"
            >
              <span className="block aspect-[4/3] overflow-hidden [&>svg]:size-full">
                <CanvasPageV1
                  clipToPage
                  page={candidate}
                  resources={resources}
                />
              </span>
              <span className="mt-1 block truncate text-xs text-ink-muted">
                {candidate.name}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowResourceViewer({
  item,
  workspaceId,
}: {
  readonly item: AgentWorkbenchResource;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const template = useQuery({
    queryKey: ["workflow-template", workspaceId, item.resourceId],
    queryFn: () => fetchWorkflowTemplate(workspaceId, item.resourceId),
    enabled: item.state === "available",
    retry: false,
    staleTime: 30_000,
  });
  const capabilities = useQuery({
    queryKey: ["workflow-authoring-capabilities", workspaceId],
    queryFn: () => fetchWorkflowAuthoringCapabilities(workspaceId),
    enabled: item.state === "available",
    retry: false,
    staleTime: 60_000,
  });
  const graph = useMemo(
    () =>
      template.data
        ? projectWorkflowAuthoringGraph({
            schemaVersion: 1,
            inputSchema: template.data.inputSchema,
            outputSchema: template.data.outputSchema,
            topology: template.data.topology,
          })
        : undefined,
    [template.data],
  );
  function retryWorkflowResources(): void {
    void template.refetch();
    void capabilities.refetch();
  }
  if (item.state !== "available") {
    return <Empty description={t("agent.resourceUnavailable")} />;
  }
  if (template.isPending || capabilities.isPending) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }
  if (template.isError || capabilities.isError || !graph) {
    return (
      <Alert
        type="error"
        title={t("agent.resourceUnavailable")}
        action={
          <Button onClick={retryWorkflowResources}>{t("agent.retry")}</Button>
        }
      />
    );
  }
  return (
    <div
      className="h-full min-h-0 overscroll-contain bg-mist"
      onWheel={stopEventPropagation}
    >
      <Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
        <WorkflowReadonlyGraphV1
          capabilities={capabilities.data.items}
          graph={graph}
        />
      </Suspense>
    </div>
  );
}

function ArtifactResourceViewer({
  item,
  workspaceId,
  canDownloadArtifact,
}: {
  readonly item: AgentWorkbenchResource;
  readonly canDownloadArtifact: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { notification } = App.useApp();
  const [downloading, setDownloading] = useState(false);
  async function download(): Promise<void> {
    if (!item.artifactId || !canDownloadArtifact || downloading) return;
    setDownloading(true);
    try {
      const blob = await downloadArtifact(workspaceId, item.artifactId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = taskArtifactFilename(blob, item.title ?? "export");
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      notification.error({ title: t("agent.taskDownloadError") });
    } finally {
      setDownloading(false);
    }
  }
  if (!item.artifactId || item.state !== "available") {
    return <Empty description={t("agent.resourceUnavailable")} />;
  }
  return (
    <div className="grid h-full place-items-center bg-canvas p-4">
      {canDownloadArtifact ? (
        <Button
          icon={<DownloadOutlined />}
          loading={downloading}
          onClick={() => void download()}
        >
          {t("agent.download")}
        </Button>
      ) : null}
      <ArtifactPreview
        alt={item.title ?? t("agent.resourceKind.asset")}
        artifactId={item.artifactId}
        className="grid max-h-full w-full place-items-center"
        imageClassName="max-h-full max-w-full rounded-[12px] object-contain shadow-sm"
        previewable
        retryLabel={t("assets.detail.reload")}
        unavailableLabel={t("assets.detail.previewUnavailable")}
        workspaceId={workspaceId}
      />
    </div>
  );
}

export function BrandResourceViewer({
  item,
  workspaceId,
}: {
  readonly item: AgentWorkbenchResource;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const revision = useQuery({
    queryKey: [
      "agent-brand-resource",
      workspaceId,
      item.resourceId,
      item.brandKitRevisionId,
    ],
    queryFn: () =>
      fetchBrandKitRevision(
        workspaceId,
        item.resourceId,
        item.brandKitRevisionId!,
      ),
    enabled: item.state === "available" && Boolean(item.brandKitRevisionId),
    retry: false,
    staleTime: 30_000,
  });
  const brand = revision.data;
  return (
    <div className="h-full overflow-y-auto bg-paper p-4 sm:p-5">
      <div className="grid gap-5">
        <header className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-mist text-lg text-primary">
            <BgColorsOutlined aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <h2 className="m-0 text-base font-bold text-ink">
              {brand?.name ?? item.title ?? t("agent.resourceKind.brand")}
            </h2>
            {(brand?.description ?? item.description) ? (
              <p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">
                {brand?.description ?? item.description}
              </p>
            ) : null}
          </span>
        </header>

        {revision.isPending && item.brandKitRevisionId ? (
          <Skeleton active paragraph={{ rows: 6 }} title={false} />
        ) : null}

        {revision.isError ? (
          <Alert
            type="error"
            title={t("agent.resourceUnavailable")}
            action={
              <Button onClick={() => void revision.refetch()}>
                {t("agent.retry")}
              </Button>
            }
          />
        ) : null}
        {brand ? (
          <>
            <section className="grid gap-2" aria-labelledby="agent-brand-logos">
              <h3
                className="m-0 text-xs font-bold text-ink-muted"
                id="agent-brand-logos"
              >
                {t("brand.logos")}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {brand.logos.map((logo) => (
                  <div
                    className="grid min-w-0 gap-2 rounded-[12px] bg-mist p-2"
                    key={logo.key}
                  >
                    <span className="relative grid h-20 place-items-center overflow-hidden rounded-[9px] bg-paper">
                      <ArtifactPreview
                        alt=""
                        artifactId={logo.artifactId}
                        imageClassName="absolute inset-0 size-full object-contain p-2"
                        thumbnail
                        workspaceId={workspaceId}
                      />
                    </span>
                    <strong className="truncate px-0.5 text-xs text-ink">
                      {logo.name}
                    </strong>
                  </div>
                ))}
              </div>
            </section>

            <section
              className="grid gap-2"
              aria-labelledby="agent-brand-colors"
            >
              <h3
                className="m-0 text-xs font-bold text-ink-muted"
                id="agent-brand-colors"
              >
                {t("brand.colors")}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {brand.colors.map((color) => (
                  <div
                    className="grid gap-2 rounded-[12px] bg-mist p-2"
                    key={color.key}
                  >
                    <span
                      aria-hidden="true"
                      className="h-12 rounded-[9px] shadow-[inset_0_0_0_1px_rgb(21_21_21_/_8%)]"
                      style={{ backgroundColor: color.value }}
                    />
                    <span className="min-w-0 px-0.5">
                      <strong className="block truncate text-xs text-ink">
                        {color.name}
                      </strong>
                      <span className="block text-xs text-ink-muted">
                        {color.value}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-2" aria-labelledby="agent-brand-type">
              <h3
                className="m-0 text-xs font-bold text-ink-muted"
                id="agent-brand-type"
              >
                {t("brand.textStyles")}
              </h3>
              <div className="grid divide-y divide-line overflow-hidden rounded-[12px] bg-mist">
                {brand.textStyles.map((style) => (
                  <div className="grid gap-1 px-3 py-2.5" key={style.key}>
                    <strong
                      className="truncate text-ink"
                      style={{
                        fontFamily: style.fontFamily,
                        fontWeight: style.fontWeight,
                      }}
                    >
                      {style.name}
                    </strong>
                    <span className="text-xs text-ink-muted">
                      {style.fontFamily} · {String(style.fontSize)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {brand.guidelines.voice ||
            brand.guidelines.principles.length > 0 ||
            brand.guidelines.avoid.length > 0 ? (
              <section
                className="grid gap-2"
                aria-labelledby="agent-brand-guidelines"
              >
                <h3
                  className="m-0 text-xs font-bold text-ink-muted"
                  id="agent-brand-guidelines"
                >
                  {t("brand.guidelines")}
                </h3>
                <div className="grid gap-3 rounded-[12px] bg-mist p-3 text-xs leading-5 text-ink-muted">
                  {brand.guidelines.voice ? (
                    <p className="m-0">{brand.guidelines.voice}</p>
                  ) : null}
                  {brand.guidelines.principles.length > 0 ? (
                    <div>
                      <strong className="text-ink">
                        {t("brand.principles")}
                      </strong>
                      <ul className="m-0 mt-1 grid gap-1 pl-4">
                        {brand.guidelines.principles.map((principle) => (
                          <li key={principle}>{principle}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {brand.guidelines.avoid.length > 0 ? (
                    <div>
                      <strong className="text-ink">{t("brand.avoid")}</strong>
                      <ul className="m-0 mt-1 grid gap-1 pl-4">
                        {brand.guidelines.avoid.map((value) => (
                          <li key={value}>{value}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function TaskArtifactGrid({
  alt,
  artifactIds,
  imageClassName = "size-full object-cover",
  workspaceId,
}: {
  readonly imageClassName?: string;
  readonly alt: string;
  readonly artifactIds: readonly string[];
  readonly workspaceId: string;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      {artifactIds.map((artifactId) => (
        <ArtifactPreview
          alt={alt}
          artifactId={artifactId}
          className="aspect-square overflow-hidden rounded-[12px] bg-mist"
          imageClassName={imageClassName}
          key={artifactId}
          previewable
          thumbnail
          workspaceId={workspaceId}
        />
      ))}
    </div>
  );
}

const internalIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function readableTaskValue(value: unknown): string | boolean | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text && !internalIdPattern.test(text) ? text : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") return value;
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || typeof item === "number")
  ) {
    const items = value
      .map(readableTaskValue)
      .filter(
        (item): item is string => typeof item === "string" && Boolean(item),
      );
    return items.length > 0 ? items.join("、") : undefined;
  }
  return undefined;
}

/** Resource identity and labels come from the pinned invocation contract. */
export function agentTaskResourceFields(
  schema: EffectiveInvocationSchema | undefined,
  input: unknown,
  {
    declarations,
    locale = "en-US",
  }: {
    readonly declarations?: CapabilityRunDetails["inputDeclarations"];
    readonly locale?: string;
  } = {},
): readonly {
  readonly key: string;
  readonly label: string;
  readonly artifactIds: readonly string[];
}[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const values = input as Readonly<Record<string, unknown>>;
  const labelLocale = locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  let fields: readonly { key: string; label: string }[] = [];
  if (declarations) {
    fields = declarations
      .filter(
        (field) =>
          field.semanticType.startsWith("artifact.") &&
          field.exposurePolicy.default !== "hidden_derived",
      )
      .map((field) => ({ key: field.key, label: field.label[labelLocale] }));
  } else if (schema?.availability === "available") {
    fields = schema.fields
      .filter(
        (field) =>
          field.valueType === "artifact" || field.valueType === "artifact_list",
      )
      .map((field) => ({ key: field.key, label: field.label }));
  }
  return fields.flatMap((field) => {
    const value = values[field.key];
    const artifactIds = [
      ...new Set(
        (Array.isArray(value) ? value : [value]).filter(
          (id): id is string =>
            typeof id === "string" && internalIdPattern.test(id),
        ),
      ),
    ];
    return artifactIds.length ? [{ ...field, artifactIds }] : [];
  });
}

export function agentTaskParameterRows(
  schema: EffectiveInvocationSchema | undefined,
  input: unknown,
  promptLabel = "Prompt",
  {
    declarations,
    locale = "en-US",
  }: {
    readonly declarations?: CapabilityRunDetails["inputDeclarations"];
    readonly locale?: string;
  } = {},
): readonly {
  readonly label: string;
  readonly value: string | boolean;
}[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  const values = input as Readonly<Record<string, unknown>>;
  const labelLocale = locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  if (declarations) {
    return declarations.flatMap((field) => {
      if (
        field.semanticType.startsWith("artifact.") ||
        field.exposurePolicy.default === "hidden_derived"
      )
        return [];
      const value = readableTaskValue(values[field.key]);
      return value === undefined
        ? []
        : [
            {
              label: field.label[labelLocale],
              value,
            },
          ];
    });
  }
  if (schema?.availability !== "available") {
    return Object.entries(values).flatMap(([key, fieldValue]) => {
      const value = readableTaskValue(fieldValue);
      return value === undefined
        ? []
        : [
            {
              label:
                key === "prompt"
                  ? promptLabel
                  : defaultCapabilityFieldLabel(key)[labelLocale],
              value,
            },
          ];
    });
  }
  return schema.fields.flatMap((field) => {
    if (
      field.valueType === "artifact" ||
      field.valueType === "artifact_list" ||
      field.valueType === "constant"
    ) {
      return [];
    }
    const value = readableTaskValue(values[field.key]);
    return value === undefined
      ? []
      : [
          {
            label:
              field.key === "prompt" && field.label.toLowerCase() === "prompt"
                ? promptLabel
                : field.label,
            value,
          },
        ];
  });
}

export interface AgentTaskOutputField {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly primary: boolean;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly value: unknown;
  readonly visibility: "advanced" | "author";
}

function outputRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function outputPropertySchema(
  schema: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  return outputRecord(outputRecord(schema?.properties)?.[key]);
}

function outputValueIsOnlyArtifactReferences(value: unknown): boolean {
  if (typeof value === "string") return internalIdPattern.test(value);
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) => typeof item === "string" && internalIdPattern.test(item),
    )
  );
}

export function agentCapabilityTaskOutputFields(
  output: unknown,
  declarations: CapabilityRunDetails["outputDeclarations"],
  language: string,
): readonly AgentTaskOutputField[] {
  const values = outputRecord(output);
  if (declarations) {
    if (!values) return [];
    const locale = language.toLocaleLowerCase().startsWith("zh")
      ? "zh-CN"
      : "en-US";
    return declarations
      .filter(
        (declaration) =>
          declaration.visibility !== "hidden" &&
          !declaration.semanticType.startsWith("artifact.") &&
          Object.hasOwn(values, declaration.key),
      )
      .toSorted((left, right) => Number(right.primary) - Number(left.primary))
      .map((declaration) => ({
        key: declaration.key,
        label: declaration.label[locale],
        ...(declaration.description
          ? { description: declaration.description[locale] }
          : {}),
        primary: declaration.primary,
        value: values[declaration.key],
        visibility:
          declaration.visibility === "advanced" ? "advanced" : "author",
      }));
  }
  return workflowRunDisplayOutputFields(output)
    .filter((field) => !outputValueIsOnlyArtifactReferences(field.value))
    .map((field) => ({
      key: field.key,
      label: field.label ?? field.key,
      primary: field.key === "output",
      value: field.value,
      visibility: "author",
    }));
}

export function agentWorkflowTaskOutputFields(
  output: unknown,
  outputSchema: Readonly<Record<string, unknown>> | undefined,
): readonly AgentTaskOutputField[] {
  return workflowRunDisplayOutputFields(output, outputSchema)
    .filter((field) => !outputValueIsOnlyArtifactReferences(field.value))
    .map((field) => {
      const schema = outputPropertySchema(outputSchema, field.key);
      return {
        key: field.key,
        label: field.label ?? field.key,
        primary: field.key === "output",
        ...(schema ? { schema } : {}),
        value: field.value,
        visibility: "author",
      };
    });
}

function AgentTaskOutputFieldValue({
  className,
  field,
  noLabel,
  yesLabel,
}: {
  readonly className?: string;
  readonly field: AgentTaskOutputField;
  readonly noLabel: string;
  readonly yesLabel: string;
}): React.JSX.Element {
  return (
    <section className={cn("grid gap-1.5", className)}>
      <h4 className="m-0 text-xs font-semibold text-ink">{field.label}</h4>
      {field.description ? (
        <p className="m-0 text-xs leading-5 text-ink-muted">
          {field.description}
        </p>
      ) : null}
      <RunOutputValue
        className="bg-mist"
        noLabel={noLabel}
        {...(field.schema ? { schema: field.schema } : {})}
        value={field.value}
        yesLabel={yesLabel}
      />
    </section>
  );
}

function TaskViewer({
  onCancel,
  canReadCapabilities,
  canManageModels,
  canDownloadArtifact,
  task,
  workspaceId,
}: {
  readonly onCancel?: (task: AgentWorkbenchTask) => Promise<void>;
  readonly canReadCapabilities: boolean;
  readonly canManageModels: boolean;
  readonly canDownloadArtifact: boolean;
  readonly task: AgentWorkbenchTask;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const taskDisplay = agentTaskDisplayText(task, t);
  const { notification } = App.useApp();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string>();
  const run = useQuery({
    queryKey: ["agent-workflow-task", workspaceId, task.workflowRunId],
    queryFn: () => fetchWorkflowRun(workspaceId, task.workflowRunId!),
    enabled: Boolean(task.workflowRunId),
    refetchInterval: (query) => workflowRunPollIntervalV1(query.state.data),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const capabilityRun = useQuery(
    agentCapabilityTaskQueryOptions(
      workspaceId,
      task.capabilityRunId,
      canReadCapabilities,
    ),
  );

  const workflowRevisionId =
    run.data?.workflowRevisionId ?? task.workflowRevisionId;
  const template = useQuery({
    queryKey: ["workflow-template", workspaceId, workflowRevisionId],
    queryFn: () => fetchWorkflowTemplate(workspaceId, workflowRevisionId!),
    enabled: Boolean(workflowRevisionId),
    retry: false,
    staleTime: 30_000,
  });
  const taskInput = run.data?.input ?? capabilityRun.data?.input ?? task.input;
  const inputResources = agentTaskResourceFields(
    template.data?.effectiveInvocationSchema,
    taskInput,
    {
      declarations: capabilityRun.data?.inputDeclarations,
      locale: i18n.resolvedLanguage ?? i18n.language,
    },
  );
  const parameterRows = agentTaskParameterRows(
    template.data?.effectiveInvocationSchema,
    taskInput,
    t("agent.taskPrompt"),
    {
      declarations: capabilityRun.data?.inputDeclarations,
      locale: i18n.resolvedLanguage ?? i18n.language,
    },
  );
  const outputArtifactIds =
    task.resultArtifacts?.flatMap((artifact) =>
      artifact.kind === "image" && artifact.state === "available"
        ? [artifact.resourceId]
        : [],
    ) ?? [];
  const otherOutputs =
    task.resultArtifacts?.filter(
      (artifact) => artifact.kind === "other" && artifact.state === "available",
    ) ?? [];
  const availableOutputs =
    task.resultArtifacts?.filter(
      (artifact) => artifact.state === "available",
    ) ?? [];
  const outputFields = capabilityRun.data
    ? agentCapabilityTaskOutputFields(
        capabilityRun.data.output,
        capabilityRun.data.outputDeclarations,
        i18n.resolvedLanguage ?? i18n.language,
      )
    : agentWorkflowTaskOutputFields(
        run.data?.output,
        template.data?.outputSchema,
      );
  const authorOutputFields = outputFields.filter(
    (field) => field.visibility === "author",
  );
  const advancedOutputFields = outputFields.filter(
    (field) => field.visibility === "advanced",
  );
  const completedSteps = run.data
    ? workflowRunCompletedStepCountV1(run.data.nodes)
    : 0;
  const statusKey = agentTaskPresentationStatus(
    run.isError || capabilityRun.isError ? "unavailable" : task.lifecycleStatus,
    run.data?.lifecycleStatus,
    task.kind,
    capabilityRun.data?.lifecycleStatus ?? task.capabilityRunStatus,
  );
  async function refreshTask(): Promise<void> {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId],
        }),
        ...(task.workflowRunId ? [run.refetch()] : []),
        ...(task.capabilityRunId && canReadCapabilities
          ? [capabilityRun.refetch()]
          : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }
  async function cancelTask(): Promise<void> {
    if (!onCancel || cancelling) return;
    setCancelling(true);
    try {
      await onCancel(task);
    } catch {
      notification.error({ title: t("agent.threadActionError") });
    } finally {
      setCancelling(false);
    }
  }
  const showOutput =
    statusKey === "completed" ||
    statusKey === "succeeded" ||
    outputArtifactIds.length > 0 ||
    otherOutputs.length > 0 ||
    outputFields.length > 0;

  async function downloadResult(
    artifact: NonNullable<AgentWorkbenchTask["resultArtifacts"]>[number],
    index: number,
  ): Promise<void> {
    if (!canDownloadArtifact || downloadingArtifactId) return;
    setDownloadingArtifactId(artifact.resourceId);
    try {
      const blob = await downloadArtifact(workspaceId, artifact.resourceId);
      const title =
        artifact.title ?? t("agent.taskResultNumber", { count: index + 1 });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = taskArtifactFilename(blob, title);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      notification.error({ title: t("agent.taskDownloadError") });
    } finally {
      setDownloadingArtifactId(undefined);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className="grid w-full gap-5">
        <header className="grid gap-2">
          <div className="flex items-start justify-between gap-3">
            <h2 className="m-0 text-base font-bold text-ink">
              {taskDisplay.title}
            </h2>
            <StatusTag
              tone={
                capabilityRun.data?.externalResultUrls?.length
                  ? "warning"
                  : agentTaskStatusTone(statusKey)
              }
            >
              {t(
                capabilityRun.data?.externalResultUrls?.length
                  ? "agent.taskFailure.externalResultTitle"
                  : `agent.taskStatus.${statusKey}`,
              )}
            </StatusTag>
          </div>
          {!showOutput && taskDisplay.description ? (
            <p className="m-0 text-sm leading-6 text-ink-muted">
              {taskDisplay.description}
            </p>
          ) : null}
          {run.data &&
          ["queued", "working", "waiting", "cancelling"].includes(statusKey) ? (
            <span className="text-xs text-ink-muted">
              {t("agent.taskProgress", {
                completed: completedSteps,
                total: run.data.nodes.length,
              })}
            </span>
          ) : null}
        </header>

        {statusKey === "failed" ? (
          <AgentTaskFailure
            agentRunId={task.agentRunId}
            workflowRunId={task.workflowRunId}
            {...(task.capabilityRunId
              ? { capabilityRunId: task.capabilityRunId }
              : {})}
            {...(run.data ? { run: run.data } : {})}
            workspaceId={workspaceId}
            canReadCapabilities={canReadCapabilities}
            canManageModels={canManageModels}
          />
        ) : null}

        {onCancel &&
        (task.workflowRunId || task.capabilityRunId) &&
        ["queued", "running", "working", "waiting", "unavailable"].includes(
          statusKey,
        ) ? (
          <Button onClick={() => void cancelTask()} loading={cancelling}>
            {t("agent.question.endTask")}
          </Button>
        ) : null}
        {task.workflowRunId && (run.data?.pendingApprovals?.length ?? 0) > 0 ? (
          <ActionLink
            className="w-fit"
            color="primary"
            params={{
              workspaceId,
              workflowRunId: task.workflowRunId,
            }}
            to="/w/$workspaceId/workflow-runs/$workflowRunId"
            variant="solid"
          >
            {t("workflows.candidate.openApprovalRun")}
          </ActionLink>
        ) : null}
        {statusKey === "unavailable" || run.isError || capabilityRun.isError ? (
          <Empty description={t("agent.taskStatusUnavailable")}>
            <Button onClick={() => void refreshTask()} loading={refreshing}>
              {t("agent.taskStatusRetry")}
            </Button>
          </Empty>
        ) : (
          <>
            {showOutput ? (
              <section
                className="grid gap-2 rounded-[12px] bg-mist p-3"
                aria-labelledby="agent-task-output"
              >
                <h3
                  className="m-0 text-xs font-bold text-ink-muted"
                  id="agent-task-output"
                >
                  {t("agent.taskOutput")}
                </h3>
                {outputArtifactIds.length > 0 ? (
                  <TaskArtifactGrid
                    alt={t("agent.taskOutputImage")}
                    artifactIds={outputArtifactIds}
                    workspaceId={workspaceId}
                  />
                ) : null}
                {task.skillDraftId ? (
                  <ActionLink
                    to="/w/$workspaceId/skills/drafts/$skillDraftId"
                    params={{ workspaceId, skillDraftId: task.skillDraftId }}
                  >
                    {t("agent.openSkillDraft")}
                  </ActionLink>
                ) : null}
                {task.brandKitId ? (
                  <ActionLink
                    to="/w/$workspaceId/brand"
                    params={{ workspaceId }}
                  >
                    {t("agent.openBrand")}
                  </ActionLink>
                ) : null}
                {authorOutputFields.map((field) => (
                  <AgentTaskOutputFieldValue
                    className="rounded-[10px] bg-paper p-3"
                    field={field}
                    key={field.key}
                    noLabel={t("agent.taskNo")}
                    yesLabel={t("agent.taskYes")}
                  />
                ))}
                {advancedOutputFields.length > 0 ? (
                  <details className="rounded-[10px] bg-paper p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      {t("workflows.runSession.technicalDetails")}
                    </summary>
                    <div className="mt-3 grid gap-3 border-t border-line pt-3">
                      {advancedOutputFields.map((field) => (
                        <AgentTaskOutputFieldValue
                          field={field}
                          key={field.key}
                          noLabel={t("agent.taskNo")}
                          yesLabel={t("agent.taskYes")}
                        />
                      ))}
                    </div>
                  </details>
                ) : null}
                {!task.skillDraftId &&
                !task.brandKitId &&
                outputArtifactIds.length === 0 &&
                otherOutputs.length === 0 &&
                outputFields.length === 0 ? (
                  <span className="text-sm text-ink-muted">
                    {t("agent.taskOutputPending")}
                  </span>
                ) : null}
                {otherOutputs.map((artifact) => (
                  <div
                    key={artifact.resourceId}
                    className="flex items-center gap-2 rounded-[10px] bg-paper px-3 py-2.5 text-sm text-ink"
                  >
                    <FileOutlined aria-hidden="true" className="text-primary" />
                    <span className="truncate">
                      {artifact.title ?? t("agent.taskOutputFile")}
                    </span>
                  </div>
                ))}
                {canDownloadArtifact && availableOutputs.length > 0 ? (
                  <div
                    aria-label={t("agent.taskActions")}
                    className="mt-1 flex flex-wrap gap-2 border-t border-line pt-3"
                    role="group"
                  >
                    {canDownloadArtifact
                      ? availableOutputs.map((artifact, index) => {
                          const title =
                            artifact.title ??
                            t("agent.taskResultNumber", {
                              count: index + 1,
                            });
                          return (
                            <Button
                              aria-label={t("agent.downloadTaskResult", {
                                title,
                              })}
                              icon={<DownloadOutlined />}
                              key={artifact.resourceId}
                              loading={
                                downloadingArtifactId === artifact.resourceId
                              }
                              onClick={() =>
                                void downloadResult(artifact, index)
                              }
                              size="small"
                            >
                              {availableOutputs.length === 1
                                ? t("agent.download")
                                : title}
                            </Button>
                          );
                        })
                      : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            {inputResources.length > 0 ? (
              <section
                className="grid gap-3 rounded-[12px] bg-mist p-3"
                aria-labelledby="agent-task-input"
              >
                <h3
                  className="m-0 text-xs font-bold text-ink-muted"
                  id="agent-task-input"
                >
                  {t("agent.taskInput")}
                </h3>
                {inputResources.map((field) => (
                  <div className="grid gap-2" key={field.key}>
                    <h4 className="m-0 text-xs font-semibold text-ink">
                      {field.label}
                    </h4>
                    <TaskArtifactGrid
                      alt={field.label}
                      artifactIds={field.artifactIds}
                      imageClassName="size-full object-contain"
                      workspaceId={workspaceId}
                    />
                  </div>
                ))}
              </section>
            ) : null}
            {parameterRows.length > 0 || run.data?.brand ? (
              <details
                className="rounded-[12px] bg-mist p-3"
                open={!showOutput}
                aria-labelledby="agent-task-requirements"
              >
                <summary
                  className="cursor-pointer text-xs font-semibold text-muted"
                  id="agent-task-requirements"
                >
                  {t(
                    task.kind === "capability"
                      ? "agent.taskInvocationInput"
                      : "agent.taskRequirements",
                  )}
                </summary>
                <dl className="m-0 mt-3 grid gap-3">
                  {parameterRows.map((row) => (
                    <div className="grid gap-1" key={row.label}>
                      <dt className="text-xs text-ink-muted">{row.label}</dt>
                      <dd className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-ink">
                        {typeof row.value === "boolean"
                          ? t(row.value ? "agent.taskYes" : "agent.taskNo")
                          : row.value}
                      </dd>
                    </div>
                  ))}
                  {run.data?.brand ? (
                    <div className="grid gap-1">
                      <dt className="text-xs text-ink-muted">
                        {t("agent.taskBrandLabel")}
                      </dt>
                      <dd className="m-0 text-sm text-ink">
                        {run.data.brand.name}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </details>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ResourceViewer({
  item,
  workspaceId,
  canDownloadArtifact,
}: {
  readonly item: AgentWorkbenchResource;
  readonly canDownloadArtifact: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  if (item.kind === "canvas") {
    return <CanvasResourceViewer item={item} workspaceId={workspaceId} />;
  }
  if (item.kind === "workflow") {
    return <WorkflowResourceViewer item={item} workspaceId={workspaceId} />;
  }
  if (item.kind === "asset" || item.kind === "artifact") {
    return (
      <ArtifactResourceViewer
        item={item}
        workspaceId={workspaceId}
        canDownloadArtifact={canDownloadArtifact}
      />
    );
  }
  return <BrandResourceViewer item={item} workspaceId={workspaceId} />;
}

function WorkbenchEmpty({
  availableEntries,
  onOpenEntry,
}: {
  readonly availableEntries: readonly AgentWorkbenchEntry[];
  readonly onOpenEntry: (entry: AgentWorkbenchEntry) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (availableEntries.length === 0) {
    return (
      <Empty
        className="mt-16"
        description={t("agent.noRelatedContent")}
        image={<FileImageOutlined className="text-3xl text-muted" />}
      />
    );
  }
  const resources = availableEntries.filter(
    (entry) => entry.entryKind === "resource",
  );
  const tasks = availableEntries.filter((entry) => entry.entryKind === "task");
  const quickEntries = (items: readonly AgentWorkbenchEntry[]) =>
    items.map((entry) => {
      const title =
        entry.entryKind === "resource"
          ? (entry.resource.title ??
            t(`agent.resourceKind.${entry.resource.kind}`))
          : agentTaskDisplayText(entry.task, t).title;
      return (
        <button
          className={cn(
            agentCardClassName,
            "w-full bg-mist hover:bg-mist-deep",
          )}
          key={agentWorkbenchEntryKey(entry)}
          onClick={() => onOpenEntry(entry)}
          type="button"
        >
          <span className={agentCardIconClassName}>
            <WorkbenchEntryIcon entry={entry} />
          </span>
          <strong className="min-w-0 flex-1 truncate text-sm text-ink">
            {title}
          </strong>
          <RightOutlined aria-hidden="true" className="text-muted" />
        </button>
      );
    });
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className="grid w-full gap-5">
        <header>
          <h2 className="m-0 text-base font-bold text-ink">
            {t("agent.workbenchEmptyTitle")}
          </h2>
          <p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">
            {t("agent.workbenchEmptyDescription")}
          </p>
        </header>
        {resources.length > 0 ? (
          <section className="grid gap-1.5">
            <h3 className="m-0 text-xs font-bold text-ink-muted">
              {t("agent.contextResources")}
            </h3>
            {quickEntries(resources)}
          </section>
        ) : null}
        {tasks.length > 0 ? (
          <section className="grid gap-1.5">
            <h3 className="m-0 text-xs font-bold text-ink-muted">
              {t("agent.contextTasks")}
            </h3>
            {quickEntries(tasks)}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function AgentResourceWorkbench({
  onCancelTask,
  canReadCapabilities = false,
  canManageModels = false,
  activeKey,
  availableEntries,
  canDownloadArtifact,
  canEdit,
  entries,
  onActiveChange,
  onClose,
  onCloseItem,
  onEdit,
  onOpenEntry,
  workspaceId,
}: {
  readonly onCancelTask?: (task: AgentWorkbenchTask) => Promise<void>;
  readonly canReadCapabilities?: boolean;
  readonly canManageModels?: boolean;
  readonly activeKey?: string;
  readonly availableEntries: readonly AgentWorkbenchEntry[];
  readonly canDownloadArtifact: boolean;
  readonly canEdit: boolean;
  readonly entries: readonly AgentWorkbenchEntry[];
  readonly onActiveChange: (key: string) => void;
  readonly onClose: () => void;
  readonly onCloseItem: (key: string) => void;
  readonly onEdit: (item: AgentWorkbenchResource) => void;
  readonly onOpenEntry: (entry: AgentWorkbenchEntry) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const active =
    entries.find((entry) => agentWorkbenchEntryKey(entry) === activeKey) ??
    entries[0];
  const currentKey = active ? agentWorkbenchEntryKey(active) : undefined;
  const activeResource =
    active?.entryKind === "resource" ? active.resource : undefined;
  function editActiveResource(): void {
    if (activeResource) onEdit(activeResource);
  }
  let activeTitle: string | undefined;
  if (active?.entryKind === "resource") {
    activeTitle =
      active.resource.title ?? t(`agent.resourceKind.${active.resource.kind}`);
  } else if (active?.entryKind === "task") {
    activeTitle = agentTaskDisplayText(active.task, t).title;
  }
  const tabs = entries.map((entry) => {
    const title =
      entry.entryKind === "resource"
        ? (entry.resource.title ??
          t(`agent.resourceKind.${entry.resource.kind}`))
        : agentTaskDisplayText(entry.task, t).title;
    return {
      key: agentWorkbenchEntryKey(entry),
      label: (
        <span className="inline-flex max-w-44 items-center gap-1.5 truncate">
          <WorkbenchEntryIcon entry={entry} />
          <span className="truncate">{title}</span>
        </span>
      ),
    };
  });
  let activeContent = (
    <WorkbenchEmpty
      availableEntries={availableEntries}
      onOpenEntry={onOpenEntry}
    />
  );
  if (active?.entryKind === "resource") {
    activeContent = (
      <ResourceViewer
        canDownloadArtifact={canDownloadArtifact}
        item={active.resource}
        key={agentWorkbenchEntryKey(active)}
        workspaceId={workspaceId}
      />
    );
  } else if (active?.entryKind === "task") {
    activeContent = (
      <TaskViewer
        key={agentWorkbenchEntryKey(active)}
        {...(onCancelTask ? { onCancel: onCancelTask } : {})}
        canReadCapabilities={canReadCapabilities}
        canManageModels={canManageModels}
        canDownloadArtifact={canDownloadArtifact}
        task={active.task}
        workspaceId={workspaceId}
      />
    );
  }
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-paper"
      id="agent-resource-workbench"
    >
      <header className="flex h-16 min-h-16 shrink-0 items-center gap-1 border-b border-line px-2">
        <ConfigProvider
          theme={{
            components: {
              Tabs: {
                cardBg: "transparent",
                cardPaddingSM: "6px 12px",
                horizontalMargin: "0",
                colorBorderSecondary: "transparent",
              },
            },
          }}
        >
          <Tabs
            {...(currentKey ? { activeKey: currentKey } : {})}
            aria-label={t("agent.resourceTabs")}
            className="min-w-0 flex-1"
            classNames={{
              body: "hidden",
              header: "mb-0",
              item: "rounded-control",
            }}
            hideAdd
            items={tabs}
            onChange={onActiveChange}
            onEdit={(targetKey, action) => {
              if (action === "remove" && typeof targetKey === "string") {
                onCloseItem(targetKey);
              }
            }}
            size="small"
            type="editable-card"
          />
        </ConfigProvider>
        <Button
          aria-label={t("agent.closeInspector")}
          icon={<CloseOutlined />}
          onClick={onClose}
          size="small"
          type="text"
        />
      </header>
      <div
        aria-label={activeTitle}
        className="relative min-h-0 flex-1 animate-[studio-page-in_180ms_var(--ease-out-studio)] motion-reduce:animate-none"
        role={currentKey ? "region" : undefined}
      >
        {activeResource && canEdit ? (
          <Button
            aria-label={t("agent.editResource")}
            className="absolute top-3 right-3 z-20 rounded-[10px] bg-paper/90 shadow-sm backdrop-blur-md"
            icon={<EditOutlined />}
            onClick={editActiveResource}
          >
            {t("agent.editResource")}
          </Button>
        ) : null}
        {activeContent}
      </div>
    </section>
  );
}
