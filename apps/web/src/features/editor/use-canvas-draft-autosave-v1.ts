import { useEffect, useRef } from "react";

import { createEditorDraftContentV1 } from "./editor-document-v1.js";
import type { EditorRuntimeDocumentV1 } from "./editor-runtime-v1.js";

const canvasAutosaveDelayMs = 800;

export function canvasDraftInitialCreationAllowedV1({
  canEdit,
  initialCreationRequested,
  initialDraftExists,
}: {
  readonly canEdit: boolean;
  readonly initialCreationRequested: boolean;
  readonly initialDraftExists: boolean;
}): boolean {
  return canEdit && !initialDraftExists && !initialCreationRequested;
}

export function canvasDraftAutosaveAllowedV1({
  canEdit,
  fingerprintMatchesSaved,
  pendingUploadCount,
  saveConflictActive,
}: {
  readonly canEdit: boolean;
  readonly fingerprintMatchesSaved: boolean;
  readonly pendingUploadCount: number;
  readonly saveConflictActive: boolean;
}): boolean {
  return (
    canEdit &&
    !saveConflictActive &&
    !fingerprintMatchesSaved &&
    pendingUploadCount === 0
  );
}

export function useCanvasDraftAutosaveV1({
  canEdit,
  document,
  fingerprint,
  fingerprintMatchesSaved,
  initialDraftExists,
  pendingUploadCount,
  persistCanvasDraft,
  saveConflictActive,
  title,
}: {
  readonly canEdit: boolean;
  readonly document: EditorRuntimeDocumentV1;
  readonly fingerprint: string;
  readonly fingerprintMatchesSaved: boolean;
  readonly initialDraftExists: boolean;
  readonly pendingUploadCount: number;
  readonly persistCanvasDraft: (
    fingerprint: string,
    content: ReturnType<typeof createEditorDraftContentV1>,
  ) => Promise<void>;
  readonly saveConflictActive: boolean;
  readonly title: string;
}): void {
  const initialCreationRequestedRef = useRef(false);

  useEffect(() => {
    if (
      !canvasDraftInitialCreationAllowedV1({
        canEdit,
        initialCreationRequested: initialCreationRequestedRef.current,
        initialDraftExists,
      })
    ) {
      return;
    }
    initialCreationRequestedRef.current = true;
    void persistCanvasDraft(
      fingerprint,
      createEditorDraftContentV1(document, title),
    ).catch(() => undefined);
  }, [
    canEdit,
    document,
    fingerprint,
    initialDraftExists,
    persistCanvasDraft,
    title,
  ]);

  useEffect(() => {
    if (
      !canvasDraftAutosaveAllowedV1({
        canEdit,
        fingerprintMatchesSaved,
        pendingUploadCount,
        saveConflictActive,
      })
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void persistCanvasDraft(
        fingerprint,
        createEditorDraftContentV1(document, title),
      ).catch(() => undefined);
    }, canvasAutosaveDelayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    canEdit,
    document,
    fingerprint,
    fingerprintMatchesSaved,
    pendingUploadCount,
    persistCanvasDraft,
    saveConflictActive,
    title,
  ]);
}
