import type { CanvasBrandContext, CanvasDraft } from "@kanvas/contracts/api";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  createCanvasDraft,
  downloadArtifact,
  fetchCanvasDraft,
  updateCanvasDraft,
  updateCanvasDraftBrand,
} from "../../api/transport.js";
import { promoteCanvasOperationSessionsV1 } from "./canvas-operation-recovery-v1.js";
import { useCanvasDraftAutosaveV1 } from "./use-canvas-draft-autosave-v1.js";
import { useCanvasDraftPersistenceStateV1 } from "./use-canvas-draft-persistence-state-v1.js";
import {
  createEditorDraftContentV1,
  hydrateEditorRuntimeDocumentV1,
  type HydratedEditorDocumentV1,
} from "./editor-document-v1.js";
import type { EditorRuntimeDocumentV1 } from "./editor-runtime-v1.js";
import { createEditorStateV1, type EditorStateV1 } from "./editor-state-v1.js";

type RuntimeResources = HydratedEditorDocumentV1["resources"];

const conflictStatus = 409;

export function useCanvasDraftPersistenceControllerV1({
  canEdit,
  canvasNavigationCommittedRef,
  createdUrlsRef,
  csrfToken,
  document,
  exitRequestedRef,
  fingerprint,
  initialDraft,
  initialBrandKitRevisionId,
  onDraftCreated,
  pendingUploadCount,
  recoveryIdRef,
  setBrand,
  setOperationMessage,
  setResources,
  setState,
  setTitle,
  title,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly canvasNavigationCommittedRef: RefObject<boolean>;
  readonly createdUrlsRef: RefObject<Set<string>>;
  readonly csrfToken: string;
  readonly document: EditorRuntimeDocumentV1;
  readonly exitRequestedRef: RefObject<boolean>;
  readonly fingerprint: string;
  readonly initialDraft: CanvasDraft | undefined;
  readonly initialBrandKitRevisionId?: string | null;
  readonly onDraftCreated?: (draftId: string) => Promise<void> | void;
  readonly pendingUploadCount: number;
  readonly recoveryIdRef: RefObject<string>;
  readonly setBrand: Dispatch<SetStateAction<CanvasBrandContext | undefined>>;
  readonly setOperationMessage: Dispatch<SetStateAction<string | undefined>>;
  readonly setResources: Dispatch<SetStateAction<RuntimeResources>>;
  readonly setState: Dispatch<SetStateAction<EditorStateV1>>;
  readonly setTitle: Dispatch<SetStateAction<string>>;
  readonly title: string;
  readonly workspaceId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createKey] = useState(() => crypto.randomUUID());
  const persistence = useCanvasDraftPersistenceStateV1({
    initialDraft,
    initialFingerprint: JSON.stringify({ title, document }),
  });
  const {
    dispatchSaveConflict,
    draftIdRef,
    draftVersionRef,
    saveConflict,
    saveQueueRef,
    setDraftSaveError,
    setSaveStatus,
    updateDraftRuntime,
  } = persistence;

  const readLatestSaveConflict = useCallback(async (): Promise<void> => {
    if (!draftIdRef.current) {
      throw new Error(t("canvas.messages.boardAddressPending"));
    }
    dispatchSaveConflict({ type: "begin_latest_load" });
    try {
      const latest = await fetchCanvasDraft(workspaceId, draftIdRef.current);
      dispatchSaveConflict({ type: "latest_loaded", draft: latest });
    } catch (error: unknown) {
      const message = t("canvas.messages.latestVersionError");
      dispatchSaveConflict({ type: "latest_failed", error: message });
      throw new Error(message, { cause: error });
    }
  }, [dispatchSaveConflict, draftIdRef, t, workspaceId]);

  const adoptBrandRevision = useCallback(
    async (brandKitRevisionId: string): Promise<void> => {
      if (!draftIdRef.current || !draftVersionRef.current) {
        throw new Error(t("canvas.messages.historyRequiresSave"));
      }
      const result = await updateCanvasDraftBrand(
        { csrfToken, workspaceId },
        draftIdRef.current,
        {
          expectedVersion: draftVersionRef.current,
          brandKitRevisionId,
        },
      );
      updateDraftRuntime({ version: result.draft.version });
      setBrand(result.draft.brand);
      setSaveStatus("saved");
      void queryClient.invalidateQueries({
        queryKey: ["canvas-draft-v1", workspaceId, draftIdRef.current],
      });
    },
    [
      csrfToken,
      draftIdRef,
      draftVersionRef,
      queryClient,
      setBrand,
      setSaveStatus,
      t,
      updateDraftRuntime,
      workspaceId,
    ],
  );

  const persistCanvasDraft = useCallback(
    (
      nextFingerprint: string,
      content: ReturnType<typeof createEditorDraftContentV1>,
    ): Promise<void> => {
      const save = async (): Promise<void> => {
        if (!canEdit) {
          throw new Error(t("canvas.messages.boardEditForbidden"));
        }
        setSaveStatus("saving");
        setDraftSaveError(undefined);
        const context = { csrfToken, workspaceId };
        const pending = draftIdRef.current
          ? updateCanvasDraft(context, draftIdRef.current, {
              expectedVersion: draftVersionRef.current ?? 1,
              document: content,
            })
          : createCanvasDraft(
              context,
              {
                document: content,
                ...(initialBrandKitRevisionId !== undefined
                  ? { brandKitRevisionId: initialBrandKitRevisionId }
                  : {}),
              },
              createKey,
            );
        try {
          const result = await pending;
          const wasNew = !draftIdRef.current;
          updateDraftRuntime({
            id: result.draft.id,
            lastSavedFingerprint: nextFingerprint,
            version: result.draft.version,
          });
          setBrand(result.draft.brand);
          setSaveStatus("saved");
          setDraftSaveError(undefined);
          dispatchSaveConflict({ type: "clear" });
          void queryClient.invalidateQueries({
            queryKey: ["canvas-drafts", workspaceId],
          });
          if (wasNew) {
            const previousRecoveryId = recoveryIdRef.current;
            recoveryIdRef.current = result.draft.id;
            try {
              await promoteCanvasOperationSessionsV1(
                workspaceId,
                previousRecoveryId,
                result.draft.id,
              );
            } catch {
              setOperationMessage(
                t("canvas.messages.operationProgressSyncError"),
              );
            }
            if (!exitRequestedRef.current) {
              canvasNavigationCommittedRef.current = true;
              try {
                await onDraftCreated?.(result.draft.id);
              } finally {
                canvasNavigationCommittedRef.current = false;
              }
            }
          }
        } catch (error: unknown) {
          const isVersionConflict =
            error instanceof ApiProblem &&
            error.status === conflictStatus &&
            Boolean(draftIdRef.current);
          setSaveStatus("error");
          let saveErrorMessage = t("canvas.messages.boardSaveError");
          if (isVersionConflict) {
            saveErrorMessage = t("canvas.messages.versionConflict");
          } else if (error instanceof ApiProblem) {
            saveErrorMessage = error.message;
          }
          setDraftSaveError(saveErrorMessage);
          if (isVersionConflict) {
            dispatchSaveConflict({ type: "activate" });
            void readLatestSaveConflict().catch(() => undefined);
          }
          throw error;
        }
      };
      const queued = saveQueueRef.current.catch(() => undefined).then(save);
      saveQueueRef.current = queued;
      return queued;
    },
    [
      canEdit,
      canvasNavigationCommittedRef,
      createKey,
      csrfToken,
      dispatchSaveConflict,
      draftIdRef,
      draftVersionRef,
      exitRequestedRef,
      initialBrandKitRevisionId,
      onDraftCreated,
      queryClient,
      readLatestSaveConflict,
      recoveryIdRef,
      saveQueueRef,
      setDraftSaveError,
      setBrand,
      setOperationMessage,
      setSaveStatus,
      t,
      updateDraftRuntime,
      workspaceId,
    ],
  );

  useCanvasDraftAutosaveV1({
    canEdit,
    document,
    fingerprint,
    fingerprintMatchesSaved:
      fingerprint === persistence.draftRuntime.lastSavedFingerprint,
    initialDraftExists: Boolean(initialDraft),
    pendingUploadCount,
    persistCanvasDraft,
    saveConflictActive: saveConflict.active,
    title,
  });

  const keepLocalAfterSaveConflict = async (): Promise<void> => {
    if (!draftIdRef.current || !saveConflict.draft) {
      throw new Error(t("canvas.messages.latestVersionRequired"));
    }
    const localFingerprint = fingerprint;
    const localDocument = createEditorDraftContentV1(document, title);
    dispatchSaveConflict({
      type: "begin_resolution",
      resolution: "keep_local",
    });
    setSaveStatus("saving");
    try {
      await saveQueueRef.current.catch(() => undefined);
      const result = await updateCanvasDraft(
        { csrfToken, workspaceId },
        draftIdRef.current,
        {
          expectedVersion: saveConflict.draft.version,
          document: localDocument,
        },
      );
      updateDraftRuntime({
        lastSavedFingerprint: localFingerprint,
        version: result.draft.version,
      });
      setSaveStatus("saved");
      setDraftSaveError(undefined);
      dispatchSaveConflict({ type: "clear" });
      void queryClient.invalidateQueries({
        queryKey: ["canvas-drafts", workspaceId],
      });
    } catch (error) {
      setSaveStatus("error");
      if (error instanceof ApiProblem && error.status === conflictStatus) {
        dispatchSaveConflict({
          type: "latest_failed",
          error: t("canvas.messages.versionChangedAgain"),
        });
        await readLatestSaveConflict().catch(() => undefined);
      }
      throw error;
    } finally {
      dispatchSaveConflict({ type: "finish_resolution" });
    }
  };

  const applyLatestAfterSaveConflict = async (): Promise<void> => {
    if (!draftIdRef.current || !saveConflict.draft) {
      throw new Error(t("canvas.messages.latestVersionRequired"));
    }
    if (pendingUploadCount > 0) {
      throw new Error(t("canvas.messages.waitUploadsBeforeVersion"));
    }
    dispatchSaveConflict({
      type: "begin_resolution",
      resolution: "use_latest",
    });
    try {
      const latestDraft = saveConflict.draft;
      const hydrated = await hydrateEditorRuntimeDocumentV1(
        latestDraft.document,
        async (artifactId) => {
          const blob = await downloadArtifact(workspaceId, artifactId);
          const url = URL.createObjectURL(blob);
          createdUrlsRef.current.add(url);
          return url;
        },
      );
      setState(createEditorStateV1(hydrated.document));
      setResources(hydrated.resources);
      setTitle(latestDraft.document.title);
      updateDraftRuntime({
        lastSavedFingerprint: JSON.stringify({
          title: latestDraft.document.title,
          document: hydrated.document,
        }),
        version: latestDraft.version,
      });
      setSaveStatus("saved");
      setDraftSaveError(undefined);
      dispatchSaveConflict({ type: "clear" });
      void queryClient.invalidateQueries({
        queryKey: ["canvas-drafts", workspaceId],
      });
    } finally {
      dispatchSaveConflict({ type: "finish_resolution" });
    }
  };

  return {
    ...persistence,
    adoptBrandRevision,
    applyLatestAfterSaveConflict,
    keepLocalAfterSaveConflict,
    persistCanvasDraft,
    readLatestSaveConflict,
  };
}
