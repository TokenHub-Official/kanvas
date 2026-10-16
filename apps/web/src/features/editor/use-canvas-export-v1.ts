import type {
  AllocateCanvasExportBody,
  CanvasExportTarget,
  CommittedCanvasExport,
  WorkspaceAssetSummary,
} from "@kanvas/contracts/api";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  allocateCanvasExport,
  ApiProblem,
  commitCanvasExport,
  downloadArtifact,
  fetchCanvasExport,
  uploadCanvasExport,
} from "../../api/transport.js";
import { httpStatus } from "../../api/http-status.js";
import { canvasExportFailureMessageV1 } from "./canvas-export-feedback-v1.js";
import type {
  CanvasExportPhase,
  CanvasExportResultView,
  CanvasExportSettings,
} from "./canvas-export-panel.js";
import {
  loadCanvasExportRecovery,
  agentCanvasExportRecoveryMatches,
  recoverCanvasExports,
  removeCanvasExportRecovery,
  saveCanvasExportRecovery,
  type PersistedCanvasExportRecovery,
  type AgentExportRecoveryScope,
} from "./canvas-export-recovery.js";
import {
  CANVAS_EXPORT_DEFAULT_QUALITY,
  CANVAS_EXPORT_MAX_DIMENSION,
  CANVAS_EXPORT_MIN_DIMENSION,
  canvasExportFilenameV1,
  downloadCanvasBlobV1,
  renderSvgPageBlobV1,
} from "./canvas-export-v1.js";
import type { EditorRuntimeDocumentV1 } from "./editor-runtime-v1.js";

interface PendingCanvasExportV1 {
  readonly agentActionReceiptId?: string;
  readonly allocationKey: string;
  blob?: Blob;
  readonly filename: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly quality: number;
  readonly request: AllocateCanvasExportBody;
  result?: CommittedCanvasExport;
  readonly target: CanvasExportTarget;
  uploadCompleted: boolean;
  exportSessionId?: string;
}
const DEFAULT_CUSTOM_EXPORT_WIDTH = 1080;
const PROGRESS_PERCENT_SCALE = 100;

export interface CanvasExportSnapshotV1 {
  readonly canvasDraftId: string;
  readonly documentVersion: number;
}

export interface AgentCanvasPngExportRequestV1 {
  readonly actionReceiptId: string;
  readonly canvasDraftId: string;
  readonly documentVersion: number;
  readonly pageId: string;
}

export type AgentCanvasPngExportResultV1 =
  | {
      readonly status: "succeeded";
      readonly results: readonly CanvasExportResultView[];
    }
  | { readonly status: "failed"; readonly error: unknown };

export function useCanvasExportV1({
  agentExportScope,
  activePageId,
  canDownloadExport,
  canExport,
  csrfToken,
  document,
  draftId,
  ensureSnapshot,
  title,
  workspaceId,
}: {
  readonly agentExportScope?: AgentExportRecoveryScope;
  readonly activePageId: string;
  readonly canDownloadExport: boolean;
  readonly canExport: boolean;
  readonly csrfToken: string;
  readonly document: EditorRuntimeDocumentV1;
  readonly draftId: RefObject<string | undefined>;
  readonly ensureSnapshot: () => Promise<CanvasExportSnapshotV1>;
  readonly title: string;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const activePage =
    document.pages.find((page) => page.id === activePageId) ??
    document.pages[0]!;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<CanvasExportPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [retryable, setRetryable] = useState(true);
  const [results, setResults] = useState<readonly CanvasExportResultView[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<readonly string[]>([
    document.pages[0]?.id ?? "",
  ]);
  const [settings, setSettings] = useState<CanvasExportSettings>({
    destination: "download",
    format: "png",
    quality: CANVAS_EXPORT_DEFAULT_QUALITY,
    scale: 1,
    customWidth: document.pages[0]?.width ?? DEFAULT_CUSTOM_EXPORT_WIDTH,
    transparentBackground: true,
  });
  const [existingAsset, setExistingAsset] = useState<WorkspaceAssetSummary>();
  const exportSvgs = useRef(new Map<string, SVGSVGElement>());
  const pendingExports = useRef<PendingCanvasExportV1[]>([]);
  const exportAbort = useRef<AbortController | undefined>(undefined);
  const suppressRecoveryOnce = useRef(false);

  const removeRecovery = async () => {
    if (!draftId.current) {
      return;
    }
    await removeCanvasExportRecovery(
      workspaceId,
      draftId.current,
      agentExportScope,
    );
  };

  const persistPendingExports = async () => {
    if (!draftId.current) {
      return;
    }
    const recovery = pendingExports.current.flatMap(
      (pending): readonly PersistedCanvasExportRecovery[] =>
        pending.exportSessionId
          ? [
              {
                ...pending,
                exportSessionId: pending.exportSessionId,
              },
            ]
          : [],
    );
    if (recovery.length === 0) {
      await removeRecovery();
      return;
    }
    await saveCanvasExportRecovery(
      workspaceId,
      draftId.current,
      recovery,
      agentExportScope,
    );
  };

  const restoreRecovery = async (
    saved?: readonly PersistedCanvasExportRecovery[],
  ) => {
    if (!draftId.current) {
      return false;
    }
    const recovery =
      saved ??
      (await loadCanvasExportRecovery(
        workspaceId,
        draftId.current,
        agentExportScope,
      ));
    if (recovery.length === 0) {
      return false;
    }
    const projection = await recoverCanvasExports(recovery, (exportSessionId) =>
      fetchCanvasExport({ workspaceId }, exportSessionId),
    );
    pendingExports.current = projection.pending.map((pending) => ({
      ...pending,
    }));
    await persistPendingExports();
    const recoveredPageIds = projection.pending
      .map((pending) => pending.pageId)
      .filter((pageId) => document.pages.some((page) => page.id === pageId));
    if (recoveredPageIds.length > 0) {
      setSelectedPageIds(recoveredPageIds);
    }
    const first = projection.pending[0];
    if (first) {
      const sourcePage = document.pages.find(
        (page) => page.id === first.pageId,
      );
      let recoveredScale: CanvasExportSettings["scale"] = "custom";
      if (sourcePage && first.request.width === sourcePage.width) {
        recoveredScale = 1;
      } else if (sourcePage && first.request.width === sourcePage.width * 2) {
        recoveredScale = 2;
      }
      let destination: CanvasExportSettings["destination"] = "existing_asset";
      if (first.target.kind === "artifact_only") {
        destination = "download";
      } else if (first.target.kind === "new_asset") {
        destination = "new_asset";
      }
      setSettings({
        destination,
        format: first.request.format,
        quality: first.quality,
        scale: recoveredScale,
        customWidth: first.request.width,
        transparentBackground: first.request.transparentBackground,
      });
    }
    setExistingAsset(undefined);
    setResults(projection.results);
    const unfinished = projection.pending.some((pending) => !pending.result);
    setRetryable(unfinished);
    if (!unfinished && projection.results.length > 0) {
      setPhase("success");
      setError(
        projection.unavailableCount > 0
          ? t("canvas.messages.exportPartialStatus")
          : undefined,
      );
    } else {
      setPhase("error");
      setError(
        projection.unavailableCount > 0
          ? t("canvas.messages.exportRecoveredPartial")
          : t("canvas.messages.exportRecovered"),
      );
    }
    return true;
  };

  const openExport = async () => {
    setSelectedPageIds([activePageId]);
    setSettings((current) => ({
      ...current,
      destination: canDownloadExport ? current.destination : "new_asset",
      customWidth: activePage.width,
      transparentBackground: activePage.background.kind === "transparent",
    }));
    setPhase("idle");
    setProgress(0);
    setError(undefined);
    setRetryable(true);
    setResults([]);
    pendingExports.current = [];
    setOpen(true);
    if (suppressRecoveryOnce.current) {
      suppressRecoveryOnce.current = false;
      await removeRecovery().catch(() => undefined);
      return;
    }
    await restoreRecovery().catch(() => {
      setPhase("error");
      setRetryable(false);
      setError(t("canvas.messages.exportRecoveryError"));
    });
  };

  const downloadResult = async (result: CanvasExportResultView) => {
    const blob = await downloadArtifact(workspaceId, result.artifactId);
    downloadCanvasBlobV1(blob, result.filename);
  };

  const runExport = async (
    reusePending: boolean,
    agentRequest?: AgentCanvasPngExportRequestV1,
  ): Promise<AgentCanvasPngExportResultV1> => {
    if (
      agentRequest &&
      (exportAbort.current || pendingExports.current.length > 0)
    ) {
      return {
        status: "failed",
        error: new Error(
          "A Canvas export is already active or awaiting recovery.",
        ),
      };
    }
    const exportSettings = agentRequest
      ? {
          ...settings,
          format: "png" as const,
          scale: 1 as const,
          destination: "download" as const,
        }
      : settings;
    const exportPageIds = agentRequest
      ? [agentRequest.pageId]
      : selectedPageIds;
    if (!canExport) {
      setPhase("error");
      setRetryable(false);
      setError(t("canvas.messages.exportForbidden"));
      return {
        status: "failed",
        error: new Error(t("canvas.messages.exportForbidden")),
      };
    }
    exportAbort.current?.abort();
    const controller = new AbortController();
    exportAbort.current = controller;
    setError(undefined);
    setRetryable(true);
    setResults([]);
    setProgress(0);
    setPhase("preparing");
    if (!reusePending) {
      pendingExports.current = [];
    }
    try {
      if (agentRequest) {
        const recovery = await loadCanvasExportRecovery(
          workspaceId,
          agentRequest.canvasDraftId,
          agentExportScope,
        );
        const otherExports = recovery.filter(
          (item) => !agentCanvasExportRecoveryMatches(item, agentRequest),
        );
        if (otherExports.length > 0) {
          const states = await Promise.all(
            otherExports.map((item) =>
              fetchCanvasExport({ workspaceId }, item.exportSessionId),
            ),
          );
          if (
            states.some((state) => state.state !== "committed" || !state.result)
          ) {
            throw new Error(
              "Another Canvas export awaits recovery; finish it before starting this export.",
            );
          }
        }
        const matching = recovery.filter((item) =>
          agentCanvasExportRecoveryMatches(item, agentRequest),
        );
        if (matching.length > 0) {
          await restoreRecovery(matching);
          reusePending = true;
        }
      }
      if (!reusePending) {
        await removeRecovery();
      }
      const snapshot = await ensureSnapshot();
      if (
        agentRequest &&
        (snapshot.canvasDraftId !== agentRequest.canvasDraftId ||
          snapshot.documentVersion !== agentRequest.documentVersion)
      ) {
        throw new Error(t("canvas.messages.exportSnapshotChanged"));
      }
      const pages = document.pages.filter((page) =>
        exportPageIds.includes(page.id),
      );
      if (pages.length === 0) {
        throw new Error(t("canvas.messages.exportSelectPage"));
      }
      if (
        exportSettings.destination === "existing_asset" &&
        (pages.length !== 1 ||
          (!existingAsset &&
            !(
              reusePending &&
              pendingExports.current.some(
                (pending) => pending.target.kind === "existing_asset",
              )
            )))
      ) {
        throw new Error(t("canvas.messages.exportSelectAsset"));
      }
      if (exportSettings.destination === "download" && !canDownloadExport) {
        throw new Error(t("canvas.messages.exportDownloadForbidden"));
      }
      const completed: CanvasExportResultView[] = [];
      for (const [index, page] of pages.entries()) {
        if (controller.signal.aborted) {
          throw new DOMException("Canvas Export was cancelled.", "AbortError");
        }
        let pending = pendingExports.current.find(
          (candidate) => candidate.pageId === page.id,
        );
        if (!pending) {
          const svg = exportSvgs.current.get(page.id);
          if (!svg) {
            throw new Error(
              t("canvas.messages.exportPageUnavailable", {
                page: page.name,
              }),
            );
          }
          setPhase("rendering");
          const width =
            exportSettings.scale === "custom"
              ? Math.max(
                  CANVAS_EXPORT_MIN_DIMENSION,
                  Math.min(
                    CANVAS_EXPORT_MAX_DIMENSION,
                    Math.round(exportSettings.customWidth),
                  ),
                )
              : page.width * exportSettings.scale;
          const height = Math.max(
            CANVAS_EXPORT_MIN_DIMENSION,
            Math.min(
              CANVAS_EXPORT_MAX_DIMENSION,
              Math.round(width * (page.height / page.width)),
            ),
          );
          const filename = canvasExportFilenameV1(
            title,
            page.name,
            exportSettings.format,
          );
          const blob = await renderSvgPageBlobV1(
            svg,
            page,
            exportSettings.format,
            {
              width,
              height,
              quality: exportSettings.quality,
              transparentBackground:
                exportSettings.transparentBackground &&
                page.background.kind === "transparent",
              signal: controller.signal,
            },
          );
          const transparentBackground =
            exportSettings.transparentBackground &&
            page.background.kind === "transparent";
          const request: AllocateCanvasExportBody = {
            canvasDraftId: snapshot.canvasDraftId,
            documentVersion: snapshot.documentVersion,
            pageId: page.id,
            format: exportSettings.format,
            width,
            height,
            transparentBackground,
            displayFilename: filename,
            expectedSize: String(blob.size),
          };
          let target: CanvasExportTarget = {
            kind: "existing_asset",
            assetId: existingAsset?.id ?? "",
            expectedVersion: existingAsset?.version ?? 1,
          };
          if (exportSettings.destination === "download") {
            target = { kind: "artifact_only" };
          } else if (exportSettings.destination === "new_asset") {
            target = {
              kind: "new_asset",
              name: pages.length > 1 ? `${title} - ${page.name}` : title,
              assetType: "image.canvas_export",
            };
          }
          pending = {
            allocationKey: agentRequest?.actionReceiptId ?? crypto.randomUUID(),
            ...(agentRequest
              ? { agentActionReceiptId: agentRequest.actionReceiptId }
              : {}),
            blob,
            filename,
            pageId: page.id,
            pageName: page.name,
            quality: exportSettings.quality,
            request,
            target,
            uploadCompleted: false,
          };
          pendingExports.current = [...pendingExports.current, pending];
        }
        if (!pending.exportSessionId) {
          const allocation = await allocateCanvasExport(
            {
              csrfToken,
              workspaceId,
            },
            pending.request,
            pending.allocationKey,
            { signal: controller.signal },
          );
          pending.exportSessionId = allocation.exportSessionId;
          if (allocation.result) {
            pending.result = allocation.result;
          } else if (allocation.state !== "open") {
            pending.uploadCompleted = true;
          }
          await persistPendingExports();
        } else if (reusePending && !pending.result) {
          const recovered = await fetchCanvasExport(
            { workspaceId },
            pending.exportSessionId,
            { signal: controller.signal },
          );
          if (recovered.result) {
            pending.result = recovered.result;
          } else if (recovered.state !== "open") {
            pending.uploadCompleted = true;
          }
          await persistPendingExports();
        }
        if (!pending.result && !pending.uploadCompleted) {
          if (!pending.blob) {
            if (
              pending.request.canvasDraftId !== snapshot.canvasDraftId ||
              pending.request.documentVersion !== snapshot.documentVersion
            ) {
              setRetryable(false);
              throw new Error(t("canvas.messages.exportSnapshotChanged"));
            }
            const svg = exportSvgs.current.get(page.id);
            if (!svg) {
              setRetryable(false);
              throw new Error(
                t("canvas.messages.exportPageRegenerateError", {
                  page: page.name,
                }),
              );
            }
            setPhase("rendering");
            pending.blob = await renderSvgPageBlobV1(
              svg,
              page,
              pending.request.format,
              {
                width: pending.request.width,
                height: pending.request.height,
                quality: pending.quality,
                transparentBackground: pending.request.transparentBackground,
                signal: controller.signal,
              },
            );
            if (
              pending.request.expectedSize &&
              pending.request.expectedSize !== String(pending.blob.size)
            ) {
              delete pending.blob;
              setRetryable(false);
              throw new Error(t("canvas.messages.exportRenderChanged"));
            }
            await persistPendingExports();
          }
          setPhase("uploading");
          await uploadCanvasExport(
            {
              csrfToken,
              workspaceId,
            },
            pending.exportSessionId,
            pending.blob,
            {
              signal: controller.signal,
              onProgress: ({ loadedBytes, totalBytes }) => {
                const currentProgress =
                  totalBytes > 0 ? loadedBytes / totalBytes : 0;
                setProgress(
                  Math.round(
                    ((index + currentProgress) / pages.length) *
                      PROGRESS_PERCENT_SCALE,
                  ),
                );
              },
            },
          );
          pending.uploadCompleted = true;
          await persistPendingExports();
        }
        if (!pending.result) {
          setPhase("committing");
          try {
            pending.result = await commitCanvasExport(
              {
                csrfToken,
                workspaceId,
              },
              pending.exportSessionId,
              {
                request: pending.request,
                target: pending.target,
              },
              { signal: controller.signal },
            );
          } catch (commitError) {
            const recovered = await fetchCanvasExport(
              { workspaceId },
              pending.exportSessionId,
            ).catch(() => undefined);
            if (recovered?.result) {
              pending.result = recovered.result;
            } else {
              throw commitError;
            }
          }
          await persistPendingExports();
        }
        const result: CanvasExportResultView = {
          exportSessionId: pending.exportSessionId,
          artifactId: pending.result.artifactId,
          ...(pending.result.assetId
            ? { assetId: pending.result.assetId }
            : {}),
          ...(pending.result.assetVersion
            ? { assetVersion: pending.result.assetVersion }
            : {}),
          filename: pending.filename,
          pageName: pending.pageName,
        };
        const committedAssetVersion = result.assetVersion;
        if (pending.target.kind === "existing_asset" && committedAssetVersion) {
          setExistingAsset((current) => {
            if (!current || current.id !== result.assetId) {
              return current;
            }
            return {
              ...current,
              version: committedAssetVersion,
            };
          });
        }
        completed.push(result);
        setResults([...completed]);
        setProgress(
          Math.round(((index + 1) / pages.length) * PROGRESS_PERCENT_SCALE),
        );
      }
      setPhase("success");
      if (exportSettings.destination === "download" && !agentRequest) {
        const downloads = await Promise.allSettled(
          completed.map((result) => downloadResult(result)),
        );
        const failedDownloads = downloads.filter(
          (download) => download.status === "rejected",
        ).length;
        if (failedDownloads > 0) {
          setError(
            t("canvas.messages.exportDownloadFailed", {
              count: failedDownloads,
            }),
          );
        }
      } else {
        void queryClient.invalidateQueries({
          queryKey: ["workspace-assets", workspaceId],
        });
      }
      return { status: "succeeded", results: completed };
    } catch (runError) {
      setPhase("error");
      if (
        runError instanceof ApiProblem &&
        runError.status === httpStatus.forbidden
      ) {
        setRetryable(false);
        void queryClient.invalidateQueries({
          queryKey: ["authentication", "current-human-context"],
        });
        setError(t("canvas.messages.exportPermissionChanged"));
        return { status: "failed", error: runError };
      }
      if (
        runError instanceof ApiProblem &&
        runError.status === httpStatus.conflict &&
        exportSettings.destination === "existing_asset"
      ) {
        pendingExports.current = [];
        setExistingAsset(undefined);
        setRetryable(false);
        await removeRecovery().catch(() => undefined);
        void queryClient.invalidateQueries({
          queryKey: ["workspace-assets", workspaceId],
        });
        setError(t("canvas.messages.exportAssetConflict"));
        return { status: "failed", error: runError };
      }
      setError(
        runError instanceof DOMException && runError.name === "AbortError"
          ? t("canvas.messages.exportStopped")
          : canvasExportFailureMessageV1(runError),
      );
      return { status: "failed", error: runError };
    } finally {
      if (exportAbort.current === controller) {
        exportAbort.current = undefined;
      }
    }
  };

  const cancelExport = () => {
    exportAbort.current?.abort();
  };

  const closeExport = () => {
    exportAbort.current?.abort();
    if (phase === "success") {
      suppressRecoveryOnce.current = true;
      pendingExports.current = [];
      void removeRecovery().catch(() => undefined);
    }
    setOpen(false);
    setPhase("idle");
    setError(undefined);
  };

  const downloadExportResult = (result: CanvasExportResultView) => {
    if (!canDownloadExport) {
      return;
    }
    setError(undefined);
    void downloadResult(result).catch(() => {
      setError(t("canvas.editor.downloadResultError"));
    });
  };

  const changeExistingAsset = (asset: WorkspaceAssetSummary | undefined) => {
    setExistingAsset(asset);
    pendingExports.current = [];
    setRetryable(false);
    setError(undefined);
  };

  const changeSelectedPageIds = (pageIds: readonly string[]) => {
    setSelectedPageIds(pageIds);
    pendingExports.current = [];
    setRetryable(false);
  };

  const changeSettings = (nextSettings: CanvasExportSettings) => {
    setSettings(nextSettings);
    pendingExports.current = [];
    setRetryable(false);
  };

  const viewAssets = (assetId?: string) => {
    void removeRecovery().catch(() => undefined);
    setOpen(false);
    if (assetId) {
      void navigate({
        to: "/w/$workspaceId/assets/$assetId",
        params: { workspaceId, assetId },
      });
    } else {
      void navigate({
        to: "/w/$workspaceId/assets",
        params: { workspaceId },
        search: {},
      });
    }
  };

  const registerExportSource = (pageId: string, node: SVGSVGElement | null) => {
    if (node) {
      exportSvgs.current.set(pageId, node);
    } else {
      exportSvgs.current.delete(pageId);
    }
  };

  return {
    cancelExport,
    exportPngForAgent: (request: AgentCanvasPngExportRequestV1) =>
      runExport(false, request),
    changeExistingAsset,
    changeSelectedPageIds,
    changeSettings,
    closeExport,
    downloadExportResult,
    error,
    existingAsset,
    open,
    openExport,
    phase,
    progress,
    registerExportSource,
    results,
    retryExport: () => {
      void runExport(true);
    },
    retryable,
    runExport: () => {
      void runExport(false);
    },
    selectedPageIds,
    settings,
    viewAssets,
  };
}
