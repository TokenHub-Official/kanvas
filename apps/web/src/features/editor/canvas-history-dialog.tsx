import type { CanvasDraftRevisionSummary } from "@kanvas/contracts/api";
import {
  CheckOutlined,
  HistoryOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { Button, Modal } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  fetchCanvasDraftRevision,
  fetchCanvasDraftRevisions,
} from "../../api/transport.js";
import { artifactPreviewQueryOptionsV1 } from "../../components/artifact-preview-query.js";
import { cn } from "../../lib/cn.js";
import { CanvasPageV1 } from "./canvas-node-renderer-v1.js";
import {
  normalizeEditorDocumentV1,
  type EditorArtifactRuntimeResourceV1,
} from "./editor-document-v1.js";
import {
  createEditorRuntimeDocumentV1,
  editorRuntimePageArtifactIdsV1,
  type EditorRuntimePageV1,
} from "./editor-runtime-v1.js";

const revisionDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function revisionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : revisionDateFormatter.format(date);
}

function revisionAction(revision: CanvasDraftRevisionSummary): string {
  return revision.kind === "restore" && revision.restoredFromVersion
    ? `恢复自版本 ${String(revision.restoredFromVersion)}`
    : "保存";
}

export function selectedCanvasHistoryRevision(
  items: readonly CanvasDraftRevisionSummary[],
  version: number | undefined,
  currentVersion: number,
): number | undefined {
  if (version !== undefined && items.some((item) => item.version === version)) {
    return version;
  }
  return (
    items.find((item) => item.version < currentVersion)?.version ??
    items[0]?.version
  );
}

export function canvasHistoryRevisionRelation(
  version: number,
  currentVersion: number,
): "current" | "newer" | "older" {
  if (version === currentVersion) {
    return "current";
  }
  return version > currentVersion ? "newer" : "older";
}

function CanvasHistoryPagePreview({
  page,
  workspaceId,
}: {
  readonly page: EditorRuntimePageV1;
  readonly workspaceId: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [resources, setResources] = useState<
    ReadonlyMap<string, EditorArtifactRuntimeResourceV1>
  >(() => new Map());
  const artifactIds = useMemo(
    () => editorRuntimePageArtifactIdsV1(page),
    [page],
  );
  const artifactScope = artifactIds.toSorted().join(",");

  useEffect(() => {
    if (!artifactScope) return;
    let disposed = false;
    const urls = new Set<string>();
    void Promise.all(
      artifactScope.split(",").map(async (artifactId) => {
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
          setResources((current) => {
            const next = new Map(current);
            next.set(artifactId, {
              artifactId,
              sourceQuality: "preview",
              sourceUnavailable: false,
              sourceUrl,
            });
            return next;
          });
        } catch {
          if (!disposed) {
            setResources((current) => {
              const next = new Map(current);
              next.set(artifactId, {
                artifactId,
                sourceUnavailable: true,
              });
              return next;
            });
          }
        }
      }),
    );
    return () => {
      disposed = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [artifactScope, queryClient, workspaceId]);

  return <CanvasPageV1 clipToPage page={page} resources={resources} />;
}

export function CanvasHistoryDialog({
  canRestore,
  canvasDraftId,
  currentVersion,
  onOpenChange,
  onRestore,
  open,
  restoring,
  workspaceId,
}: {
  readonly canRestore: boolean;
  readonly canvasDraftId?: string;
  readonly currentVersion: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRestore: (version: number) => Promise<void>;
  readonly open: boolean;
  readonly restoring: boolean;
  readonly workspaceId: string;
}): React.JSX.Element {
  const [selection, setSelection] = useState<number>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string>();
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const history = useQuery({
    queryKey: [
      "canvas-draft-revisions",
      workspaceId,
      canvasDraftId,
      currentVersion,
    ],
    queryFn: () =>
      fetchCanvasDraftRevisions(workspaceId, canvasDraftId ?? "", {
        limit: 30,
      }),
    enabled: open && Boolean(canvasDraftId),
    retry: false,
  });
  const selectedVersion = selectedCanvasHistoryRevision(
    history.data?.items ?? [],
    selection,
    currentVersion,
  );
  const detail = useQuery({
    queryKey: [
      "canvas-draft-revision",
      workspaceId,
      canvasDraftId,
      selectedVersion,
    ],
    queryFn: () =>
      fetchCanvasDraftRevision(
        workspaceId,
        canvasDraftId ?? "",
        selectedVersion ?? 1,
      ),
    enabled: open && Boolean(canvasDraftId) && selectedVersion !== undefined,
    retry: false,
  });
  const previewDocument = useMemo(
    () =>
      detail.data
        ? createEditorRuntimeDocumentV1(
            normalizeEditorDocumentV1(detail.data.document),
          )
        : undefined,
    [detail.data],
  );
  const safePreviewPageIndex = Math.min(
    previewPageIndex,
    Math.max(0, (previewDocument?.pages.length ?? 1) - 1),
  );
  const previewPage = previewDocument?.pages[safePreviewPageIndex];

  const selectedSummary = history.data?.items.find(
    (item) => item.version === selectedVersion,
  );
  const selectedRelation = selectedSummary
    ? canvasHistoryRevisionRelation(selectedSummary.version, currentVersion)
    : undefined;
  const isCurrent = selectedRelation === "current";
  const isNewer = selectedRelation === "newer";
  const olderCount =
    history.data?.items.filter((item) => item.version < currentVersion)
      .length ?? 0;

  async function restoreSelected(): Promise<void> {
    if (selectedVersion === undefined || selectedVersion >= currentVersion) {
      throw new Error("只能恢复当前画板之前保存的版本。");
    }
    setRestoreError(undefined);
    try {
      await onRestore(selectedVersion);
      setConfirmationOpen(false);
    } catch (error) {
      setRestoreError(
        error instanceof Error ? error.message : "暂时无法恢复这个版本。",
      );
    }
  }

  function updateDialogVisibility(nextOpen: boolean): void {
    if (!nextOpen) {
      setConfirmationOpen(false);
      setRestoreError(undefined);
    }
    onOpenChange(nextOpen);
  }

  function selectRevision(version: number): void {
    setSelection(version);
    setPreviewPageIndex(0);
    setRestoreError(undefined);
  }

  return (
    <>
      <Modal
        centered
        classNames={{
          body: "max-h-[min(76vh,720px)] overflow-y-auto",
          container: "overflow-hidden",
          header: "pr-10",
        }}
        footer={null}
        focusable={{ focusTriggerAfterClose: true, trap: true }}
        onCancel={() => updateDialogVisibility(false)}
        open={open}
        title={
          <div className="grid gap-1">
            <span>版本历史</span>
            <span className="text-xs font-normal leading-5 text-[var(--muted)]">
              恢复会生成一个新版本，当前内容仍会保留。
            </span>
          </div>
        }
        width={760}
      >
        <div className="pt-2">
          {(() => {
            if (!canvasDraftId) {
              return (
                <div className="grid min-h-[220px] place-items-center content-center gap-2.5 text-center text-[var(--muted)]">
                  <HistoryOutlined aria-hidden="true" className="text-3xl" />
                  <strong>保存画板后会在这里保留版本</strong>
                </div>
              );
            }
            if (history.isPending) {
              return (
                <div
                  aria-live="polite"
                  className="grid min-h-[220px] place-items-center content-center gap-2.5 text-center text-[var(--muted)]"
                >
                  <LoadingOutlined
                    aria-hidden="true"
                    className="animate-spin text-3xl"
                  />
                  <strong>正在读取版本</strong>
                </div>
              );
            }
            if (history.isError) {
              return (
                <div
                  className="grid min-h-[220px] place-items-center content-center gap-2.5 text-center text-[var(--muted)]"
                  role="alert"
                >
                  <strong>暂时无法读取版本</strong>
                  <Button
                    onClick={() => {
                      void history.refetch();
                    }}
                    size="small"
                  >
                    重新读取
                  </Button>
                </div>
              );
            }
            return (
              <div className="grid min-h-[390px] grid-cols-[290px_minmax(0,1fr)] overflow-hidden rounded-xl border border-[var(--line)] max-[720px]:grid-cols-1">
                <ol
                  aria-label="画板版本"
                  className="m-0 max-h-[440px] list-none overflow-auto border-r border-[var(--line)] bg-[var(--mist)] p-2 max-[720px]:max-h-[180px] max-[720px]:border-r-0 max-[720px]:border-b"
                >
                  {(history.data?.items ?? []).map((revision) => {
                    const active = revision.version === selectedVersion;
                    const relation = canvasHistoryRevisionRelation(
                      revision.version,
                      currentVersion,
                    );
                    const current = relation === "current";
                    return (
                      <li key={revision.version}>
                        <button
                          aria-current={current ? "true" : undefined}
                          className={cn(
                            "mt-[3px] grid min-h-[58px] w-full min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left text-[var(--ink)] first:mt-0 hover:bg-white/70 focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                            active &&
                              "bg-[var(--paper)] shadow-[0_1px_5px_rgb(24_24_30_/_8%)]",
                          )}
                          onClick={() => selectRevision(revision.version)}
                          type="button"
                        >
                          <span
                            className={cn(
                              "grid size-5 place-items-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-white",
                              current &&
                                "border-[var(--primary)] bg-[var(--primary)]",
                            )}
                          >
                            {current ? (
                              <CheckOutlined aria-hidden="true" />
                            ) : (
                              <span aria-hidden="true" />
                            )}
                          </span>
                          <span className="grid min-w-0 gap-0.5">
                            <strong className="truncate text-xs">
                              {current
                                ? "当前版本"
                                : `版本 ${String(revision.version)}`}
                            </strong>
                            <span className="truncate text-xs text-[var(--muted)]">
                              {revisionTime(revision.createdAt)}
                            </span>
                          </span>
                          <span className="max-w-[84px] truncate text-xs text-[var(--muted)]">
                            {relation === "newer"
                              ? "其他窗口保存"
                              : revisionAction(revision)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>

                <section
                  aria-live="polite"
                  className="flex min-w-0 flex-col p-6 max-[720px]:p-4"
                >
                  {selectedSummary ? (
                    <>
                      <div>
                        <span className="text-xs font-bold text-[var(--muted)]">
                          {isCurrent
                            ? "当前版本"
                            : `版本 ${String(selectedSummary.version)}`}
                        </span>
                        <h3 className="mt-[7px] mb-0 text-xl leading-tight font-bold tracking-[-0.025em] [overflow-wrap:anywhere]">
                          {selectedSummary.title}
                        </h3>
                        <p className="mt-[7px] mb-0 text-xs leading-relaxed text-[var(--muted)]">
                          {revisionTime(selectedSummary.createdAt)}
                          {" · "}
                          {isNewer
                            ? "其他窗口保存"
                            : revisionAction(selectedSummary)}
                        </p>
                      </div>
                      <div
                        aria-label="版本内容预览"
                        className="mt-6 flex min-h-[190px] flex-col items-center justify-center gap-2.5 rounded-[var(--radius-control)] bg-[var(--mist)] p-3.5 text-[13px] font-bold text-[var(--muted)]"
                      >
                        {(() => {
                          if (detail.isPending) {
                            return (
                              <span role="status">正在读取内容与图片</span>
                            );
                          }
                          if (detail.isError) {
                            return (
                              <>
                                <span role="alert">内容暂时无法预览</span>
                                <Button
                                  onClick={() => {
                                    void detail.refetch();
                                  }}
                                  size="small"
                                >
                                  重新读取
                                </Button>
                              </>
                            );
                          }
                          if (previewPage) {
                            return (
                              <>
                                <div className="grid h-[150px] w-full place-items-center [&>svg]:h-auto [&>svg]:max-h-[150px] [&>svg]:w-auto [&>svg]:max-w-full [&>svg]:rounded-[3px] [&>svg]:bg-[var(--paper)] [&>svg]:shadow-[0_5px_18px_rgb(24_24_30_/_14%)]">
                                  <CanvasHistoryPagePreview
                                    key={`${String(selectedVersion)}:${previewPage.id}`}
                                    page={previewPage}
                                    workspaceId={workspaceId}
                                  />
                                </div>
                                <div className="flex w-full justify-between gap-3 text-[11px] font-semibold [&>span:last-child]:truncate">
                                  <span>
                                    第 {String(safePreviewPageIndex + 1)} /{" "}
                                    {String(previewDocument.pages.length)} 页
                                  </span>
                                  <span>
                                    {String(previewPage.width)} ×{" "}
                                    {String(previewPage.height)}
                                    {" · "}
                                    {String(previewPage.nodes.length)} 个图层
                                  </span>
                                </div>
                                {previewDocument.pages.length > 1 ? (
                                  <div
                                    aria-label="选择预览页面"
                                    className="flex max-w-full gap-1.5 overflow-x-auto"
                                    role="group"
                                  >
                                    {previewDocument.pages.map(
                                      (page, index) => (
                                        <Button
                                          aria-pressed={
                                            index === safePreviewPageIndex
                                          }
                                          color={
                                            index === safePreviewPageIndex
                                              ? "primary"
                                              : "default"
                                          }
                                          key={page.id}
                                          onClick={() => {
                                            setPreviewPageIndex(index);
                                          }}
                                          shape="circle"
                                          size="small"
                                          variant={
                                            index === safePreviewPageIndex
                                              ? "filled"
                                              : "outlined"
                                          }
                                        >
                                          {index + 1}
                                        </Button>
                                      ),
                                    )}
                                  </div>
                                ) : null}
                              </>
                            );
                          }
                          return <span>内容暂时无法预览</span>;
                        })()}
                      </div>
                      {isNewer ? (
                        <p className="mt-auto mb-0 pt-6 text-xs leading-relaxed text-[var(--muted)]">
                          {
                            "这是其他窗口保存的较新版本。关闭版本历史后继续编辑或保存时，系统会先让你选择要保留的内容。"
                          }
                        </p>
                      ) : null}
                      {!isNewer && !isCurrent ? (
                        <div className="mt-auto flex items-end justify-between gap-4 pt-6">
                          {!canRestore ? (
                            <p className="m-0 max-w-[250px] text-xs leading-relaxed text-[var(--muted)]">
                              请先处理未保存修改或未完成图片，再恢复版本。
                            </p>
                          ) : null}
                          {restoreError ? (
                            <p
                              className="m-0 max-w-[250px] text-xs leading-relaxed text-[var(--danger)]"
                              role="alert"
                            >
                              {restoreError}
                            </p>
                          ) : null}
                          <Button
                            disabled={!canRestore}
                            loading={restoring}
                            onClick={() => {
                              setConfirmationOpen(true);
                            }}
                            type="primary"
                          >
                            <HistoryOutlined aria-hidden="true" />
                            恢复此版本
                          </Button>
                        </div>
                      ) : null}
                      {isCurrent ? (
                        <p className="mt-auto mb-0 pt-6 text-xs leading-relaxed text-[var(--muted)]">
                          这是画板最近成功保存的内容。
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {!selectedSummary && olderCount === 0 ? (
                    <div className="grid min-h-[220px] place-items-center content-center gap-2.5 text-center text-[var(--muted)]">
                      <HistoryOutlined
                        aria-hidden="true"
                        className="text-3xl"
                      />
                      <strong>还没有更早的版本</strong>
                    </div>
                  ) : null}
                </section>
              </div>
            );
          })()}
        </div>
      </Modal>

      <Modal
        cancelText="取消"
        centered
        confirmLoading={restoring}
        okText="恢复为新版本"
        onCancel={() => setConfirmationOpen(false)}
        onOk={() => {
          void restoreSelected();
        }}
        open={confirmationOpen}
        title="恢复这个版本？"
      >
        <p className="m-0 leading-6 text-[var(--muted)]">
          当前内容不会被删除。恢复后的内容会作为一个新版本保存，你仍可从版本历史返回。
        </p>
        {restoreError ? (
          <p className="mt-3 mb-0 text-[var(--danger)]" role="alert">
            {restoreError}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
