import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  allocateUserImport,
  ApiProblem,
  commitUserImport,
  uploadUserImport,
} from "../../api/transport.js";
import { httpStatus } from "../../api/http-status.js";
import type { WorkspaceAssetUploadItem } from "../assets/workspace-asset-picker.js";
import { readCanvasImageFileSize } from "./canvas-image-size.js";
import { isSupportedCanvasImportFile } from "./canvas-import-file-validation.js";
import {
  canvasImportErrorOnStart,
  canvasImportFailureMessage,
  canvasImportResumeAction,
} from "./canvas-import-upload-resume.js";
import {
  loadCanvasRuntimeRecoveryV1,
  removeCanvasRuntimeRecoveryV1,
  saveCanvasRuntimeRecoveryV1,
} from "./canvas-runtime-recovery-v1.js";
import type { EditorPointV1 } from "./editor-geometry-v1.js";
import type {
  EditorNodeInsertionPayload,
  EditorNodeInsertionTarget,
} from "./editor-node-insertion.js";
import type { EditorArtifactRuntimeResourceV1 } from "./editor-document-v1.js";
import {
  restoreEditorLocalImagePreviewV1,
  type EditorRuntimeNodeV1,
  type EditorRuntimePageV1,
} from "./editor-runtime-v1.js";
import {
  createEditorStateV1,
  type EditorActionV1,
  type EditorStateV1,
} from "./editor-state-v1.js";
import { activePage } from "./canvas-workspace-model-v1.js";

interface PendingUploadV1 {
  abortController?: AbortController;
  cancelled: boolean;
  readonly file: File;
  readonly localId: string;
  readonly name: string;
  readonly previewUrl: string;
  progress: number;
  status: "failed" | "processing" | "uploading";
  uploadCompleted: boolean;
  uploadSessionId?: string;
}
const UPLOAD_TRANSFER_PROGRESS_MAX = 100;
const PLACED_IMAGE_CASCADE_OFFSET = 32;
const RECOVERY_SAVE_DEBOUNCE_MS = 250;

export function canvasUploadFileSignatureV1(
  file: Pick<File, "lastModified" | "name" | "size" | "type">,
): string {
  return [
    file.name,
    file.type,
    String(file.size),
    String(file.lastModified),
  ].join(":");
}

export function queueCanvasImportFilesV1(
  files: readonly File[],
  pendingSignatures: Set<string>,
): {
  readonly accepted: readonly File[];
  readonly duplicateCount: number;
} {
  let duplicateCount = 0;
  const accepted = files.filter((file) => {
    const signature = canvasUploadFileSignatureV1(file);
    if (pendingSignatures.has(signature)) {
      duplicateCount += 1;
      return false;
    }
    if (!isSupportedCanvasImportFile(file)) {
      return false;
    }
    pendingSignatures.add(signature);
    return true;
  });
  return {
    accepted,
    duplicateCount,
  };
}

export function canvasPendingUploadRemovalActionV1(
  page: EditorRuntimePageV1,
  localId: string,
): EditorActionV1 | undefined {
  const actionForNodes = (
    nodes: readonly EditorRuntimeNodeV1[],
  ): EditorActionV1 | undefined => {
    for (const node of nodes) {
      if (
        node.kind === "image" &&
        node.image.source.kind === "local" &&
        node.image.source.localId === localId
      ) {
        return { type: "delete_nodes", ids: [node.id], pageId: page.id };
      }
      if (
        node.kind === "frame" &&
        node.content?.image.source.kind === "local" &&
        node.content.image.source.localId === localId
      ) {
        return {
          type: "remove_frame_content",
          frameId: node.id,
          pageId: page.id,
        };
      }
      if (node.kind === "grid") {
        const cell = node.cells.find(
          (candidate) =>
            candidate.content?.image.source.kind === "local" &&
            candidate.content.image.source.localId === localId,
        );
        if (cell) {
          return {
            type: "remove_grid_cell_content",
            gridId: node.id,
            pageId: page.id,
            slotId: cell.slotId,
          };
        }
      }
      if (node.kind === "group") {
        const childAction = actionForNodes(node.children);
        if (childAction) return childAction;
      }
    }
    return undefined;
  };
  return actionForNodes(page.nodes);
}

type RuntimeResources = ReadonlyMap<string, EditorArtifactRuntimeResourceV1>;

export function useCanvasImageUploadsV1({
  canEdit,
  createdUrls,
  csrfToken,
  initialImportFiles,
  insertImage,
  mutate,
  onInitialImportFilesConsumed,
  recoveryId,
  setOperationMessage,
  setResources,
  setSaveError,
  setState,
  setTitle,
  state,
  t,
  title,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly createdUrls: RefObject<Set<string>>;
  readonly csrfToken: string;
  readonly initialImportFiles: readonly File[];
  readonly insertImage: (
    payload: Extract<EditorNodeInsertionPayload, { kind: "image" }>,
    point?: EditorPointV1,
    target?: EditorNodeInsertionTarget,
  ) => void;
  readonly mutate: (action: EditorActionV1) => void;
  readonly onInitialImportFilesConsumed: (() => void) | undefined;
  readonly recoveryId: RefObject<string>;
  readonly setOperationMessage: Dispatch<SetStateAction<string | undefined>>;
  readonly setResources: Dispatch<SetStateAction<RuntimeResources>>;
  readonly setSaveError: Dispatch<SetStateAction<string | undefined>>;
  readonly setState: Dispatch<SetStateAction<EditorStateV1>>;
  readonly setTitle: Dispatch<SetStateAction<string>>;
  readonly state: EditorStateV1;
  readonly t: TFunction;
  readonly title: string;
  readonly workspaceId: string;
}) {
  const queryClient = useQueryClient();
  const pendingUploads = useRef(new Map<string, PendingUploadV1>());
  const pendingFileSignatures = useRef(new Set<string>());
  const initialImportStarted = useRef(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [uploadRevision, setUploadRevision] = useState(0);

  const uploadLocalImage = useCallback(
    async (upload: PendingUploadV1) => {
      const previousStatus = upload.status;
      setSaveError((current) =>
        canvasImportErrorOnStart(previousStatus, current),
      );
      const abortController = new AbortController();
      upload.abortController = abortController;
      upload.cancelled = false;
      upload.status = "uploading";
      upload.progress = 0;
      setUploadRevision((value) => value + 1);
      try {
        const allocation = await allocateUserImport(
          {
            csrfToken,
            workspaceId,
          },
          {
            expectedMediaType: upload.file.type as
              "image/jpeg" | "image/png" | "image/webp",
            expectedSize: String(upload.file.size),
          },
          upload.localId,
        );
        if (
          upload.uploadSessionId &&
          upload.uploadSessionId !== allocation.uploadSessionId
        ) {
          throw new Error(t("canvas.messages.uploadSessionMismatch"));
        }
        upload.uploadSessionId = allocation.uploadSessionId;
        setUploadRevision((value) => value + 1);
        const resumeAction = canvasImportResumeAction(
          allocation.state,
          upload.uploadCompleted,
        );
        if (resumeAction === "wait") {
          throw new Error(t("canvas.messages.uploadVerifying"));
        }
        if (resumeAction === "upload") {
          await uploadUserImport(
            {
              csrfToken,
              workspaceId,
            },
            allocation.uploadSessionId,
            upload.file,
            {
              signal: abortController.signal,
              onProgress: ({ loadedBytes, totalBytes }) => {
                upload.progress =
                  totalBytes > 0
                    ? Math.min(
                        UPLOAD_TRANSFER_PROGRESS_MAX,
                        Math.round(
                          (loadedBytes / totalBytes) *
                            UPLOAD_TRANSFER_PROGRESS_MAX,
                        ),
                      )
                    : 0;
                if (totalBytes > 0 && loadedBytes >= totalBytes) {
                  upload.status = "processing";
                }
                setUploadRevision((value) => value + 1);
              },
            },
          );
          upload.uploadCompleted = true;
          delete upload.abortController;
          upload.progress = 100;
          upload.status = "processing";
          setUploadRevision((value) => value + 1);
        }
        delete upload.abortController;
        setUploadRevision((value) => value + 1);
        if (upload.cancelled) {
          return;
        }
        const committed = await commitUserImport(
          {
            csrfToken,
            workspaceId,
          },
          allocation.uploadSessionId,
          {
            artifactType: "image.source",
            dataClassification: "internal",
            displayFilename: upload.name,
            metadata: {
              importedFrom: "canvas-v1",
            },
            asset: {
              name: upload.name,
              assetType: "image.source",
            },
          },
        );
        const reference = {
          kind: "artifact" as const,
          artifactId: committed.artifactId,
          ...(committed.assetId ? { assetId: committed.assetId } : {}),
        };
        mutate({
          type: "commit_local_image",
          localId: upload.localId,
          reference,
        });
        setResources((current) => {
          const next = new Map(current);
          next.set(committed.artifactId, {
            artifactId: committed.artifactId,
            sourceUrl: upload.previewUrl,
            sourceUnavailable: false,
          });
          return next;
        });
        pendingUploads.current.delete(upload.localId);
        pendingFileSignatures.current.delete(
          canvasUploadFileSignatureV1(upload.file),
        );
        void queryClient.invalidateQueries({
          queryKey: ["workspace-assets", workspaceId],
        });
        setUploadRevision((value) => value + 1);
      } catch (error) {
        delete upload.abortController;
        if (
          upload.cancelled ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        upload.status = "failed";
        upload.progress = 0;
        mutate({
          type: "fail_local_image",
          localId: upload.localId,
        });
        if (
          error instanceof ApiProblem &&
          error.status === httpStatus.forbidden
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["authentication", "current-human-context"],
          });
        }
        setUploadRevision((value) => value + 1);
        setSaveError(canvasImportFailureMessage(error, upload.uploadCompleted));
      }
    },
    [
      csrfToken,
      mutate,
      queryClient,
      setResources,
      setSaveError,
      t,
      workspaceId,
    ],
  );

  const addFiles = useCallback(
    async (
      files: readonly File[],
      point?: EditorPointV1,
      target?: EditorNodeInsertionTarget,
      signal?: AbortSignal,
    ): Promise<boolean> => {
      const placementFiles = target ? files.slice(0, 1) : files;
      const { accepted, duplicateCount } = queueCanvasImportFilesV1(
        placementFiles,
        pendingFileSignatures.current,
      );
      if (accepted.length !== placementFiles.length) {
        setSaveError(
          duplicateCount > 0
            ? t("canvas.messages.duplicateUploads", {
                count: duplicateCount,
              })
            : t("canvas.messages.unsupportedUpload"),
        );
      } else if (accepted.length > 0) {
        setSaveError(undefined);
      }
      if (accepted.length === 0) {
        return true;
      }
      const preparedResults = await Promise.allSettled(
        accepted.map(async (file, index) => {
          const intrinsicSize = await readCanvasImageFileSize(file);
          if (signal?.aborted) {
            throw new DOMException(
              t("canvas.messages.importStopped"),
              "AbortError",
            );
          }
          const localId = crypto.randomUUID();
          const previewUrl = URL.createObjectURL(file);
          createdUrls.current.add(previewUrl);
          return {
            upload: {
              cancelled: false,
              file,
              localId,
              name: file.name,
              previewUrl,
              progress: 0,
              status: "uploading" as const,
              uploadCompleted: false,
            },
            intrinsicSize,
            point: point
              ? {
                  x: point.x + index * PLACED_IMAGE_CASCADE_OFFSET,
                  y: point.y + index * PLACED_IMAGE_CASCADE_OFFSET,
                }
              : undefined,
          };
        }),
      );
      const prepared = preparedResults.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = preparedResults.find(
        (result) => result.status === "rejected",
      );
      if (signal?.aborted || failed) {
        for (const file of accepted) {
          pendingFileSignatures.current.delete(
            canvasUploadFileSignatureV1(file),
          );
        }
        for (const item of prepared) {
          URL.revokeObjectURL(item.upload.previewUrl);
          createdUrls.current.delete(item.upload.previewUrl);
        }
        if (signal?.aborted) {
          return false;
        }
        setSaveError(t("canvas.messages.imageReadFailed"));
        return true;
      }
      for (const item of prepared) {
        pendingUploads.current.set(item.upload.localId, item.upload);
        insertImage(
          {
            kind: "image",
            source: {
              kind: "local_file",
              localId: item.upload.localId,
              name: item.upload.name,
              mediaType: item.upload.file.type as
                "image/jpeg" | "image/png" | "image/webp",
              size: item.upload.file.size,
              previewUrl: item.upload.previewUrl,
            },
            intrinsicSize: item.intrinsicSize,
          },
          item.point,
          target,
        );
        void uploadLocalImage(item.upload);
      }
      setUploadRevision((value) => value + 1);
      return true;
    },
    [createdUrls, insertImage, setSaveError, t, uploadLocalImage],
  );

  useEffect(() => {
    if (
      !canEdit ||
      initialImportStarted.current ||
      initialImportFiles.length === 0
    ) {
      return;
    }
    const controller = new AbortController();
    let completed = false;
    initialImportStarted.current = true;
    void addFiles(
      initialImportFiles,
      undefined,
      undefined,
      controller.signal,
    ).then((handled) => {
      completed = handled;
      if (handled) {
        onInitialImportFilesConsumed?.();
      }
    });
    return () => {
      controller.abort();
      if (!completed) {
        for (const file of initialImportFiles) {
          pendingFileSignatures.current.delete(
            canvasUploadFileSignatureV1(file),
          );
        }
        initialImportStarted.current = false;
      }
    };
  }, [addFiles, canEdit, initialImportFiles, onInitialImportFilesConsumed]);

  useEffect(() => {
    let cancelled = false;
    void loadCanvasRuntimeRecoveryV1(workspaceId, recoveryId.current)
      .then((record) => {
        if (!record || cancelled) {
          return;
        }
        let document = record.document;
        const restored: PendingUploadV1[] = [];
        for (const item of record.files) {
          const previewUrl = URL.createObjectURL(item.file);
          createdUrls.current.add(previewUrl);
          document = restoreEditorLocalImagePreviewV1(
            document,
            item.localId,
            previewUrl,
          );
          const upload: PendingUploadV1 = {
            cancelled: false,
            file: item.file,
            localId: item.localId,
            name: item.name,
            previewUrl,
            progress: 0,
            status: "uploading",
            uploadCompleted: item.uploadCompleted ?? false,
            ...(item.uploadSessionId
              ? { uploadSessionId: item.uploadSessionId }
              : {}),
          };
          pendingUploads.current.set(item.localId, upload);
          pendingFileSignatures.current.add(
            canvasUploadFileSignatureV1(item.file),
          );
          restored.push(upload);
        }
        if (restored.length === 0) {
          return;
        }
        setState(createEditorStateV1(document));
        setTitle(document.title);
        setUploadRevision((value) => value + 1);
        setOperationMessage(
          t("canvas.messages.uploadsRestored", {
            count: restored.length,
          }),
        );
        for (const upload of restored) {
          void uploadLocalImage(upload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSaveError(t("canvas.messages.uploadRecoveryError"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRecoveryReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    createdUrls,
    recoveryId,
    setOperationMessage,
    setSaveError,
    setState,
    setTitle,
    t,
    uploadLocalImage,
    workspaceId,
  ]);

  useEffect(() => {
    if (!recoveryReady) {
      return;
    }
    const files = [...pendingUploads.current.values()].map((upload) => ({
      localId: upload.localId,
      name: upload.name,
      file: upload.file,
      uploadCompleted: upload.uploadCompleted,
      ...(upload.uploadSessionId
        ? { uploadSessionId: upload.uploadSessionId }
        : {}),
    }));
    const timer = window.setTimeout(() => {
      if (files.length === 0) {
        void removeCanvasRuntimeRecoveryV1(workspaceId, recoveryId.current);
        return;
      }
      void saveCanvasRuntimeRecoveryV1({
        workspaceId,
        recoveryId: recoveryId.current,
        document: {
          ...state.document,
          title,
        },
        files,
      }).catch(() => {
        setSaveError(t("canvas.messages.uploadRecoverySaveError"));
      });
    }, RECOVERY_SAVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    recoveryId,
    recoveryReady,
    setSaveError,
    state.document,
    t,
    title,
    uploadRevision,
    workspaceId,
  ]);

  const cancelUpload = useCallback(
    (localId: string) => {
      const upload = pendingUploads.current.get(localId);
      if (!upload) {
        return;
      }
      upload.cancelled = true;
      upload.abortController?.abort();
      pendingUploads.current.delete(localId);
      pendingFileSignatures.current.delete(
        canvasUploadFileSignatureV1(upload.file),
      );
      const removalAction = canvasPendingUploadRemovalActionV1(
        activePage(state),
        localId,
      );
      if (removalAction) {
        mutate(removalAction);
      }
      setOperationMessage(
        t("canvas.messages.uploadCancelled", {
          name: upload.name,
        }),
      );
      setUploadRevision((value) => value + 1);
    },
    [mutate, setOperationMessage, state, t],
  );

  const retryUpload = useCallback(
    (localId: string) => {
      const upload = pendingUploads.current.get(localId);
      if (upload) {
        void uploadLocalImage(upload);
      }
    },
    [uploadLocalImage],
  );

  const uploadItems: readonly WorkspaceAssetUploadItem[] = useMemo(() => {
    void uploadRevision;
    return [...pendingUploads.current.values()].map((upload) => ({
      canCancel: Boolean(upload.abortController) && !upload.uploadCompleted,
      id: upload.localId,
      name: upload.name,
      previewUrl: upload.previewUrl,
      progress: upload.progress,
      status: upload.status,
    }));
  }, [uploadRevision]);

  return {
    addFiles,
    cancelUpload,
    hasPendingUploads: uploadItems.length > 0,
    retryUpload,
    uploadItems,
  };
}
