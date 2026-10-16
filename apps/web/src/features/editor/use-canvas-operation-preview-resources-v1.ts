import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import { downloadArtifactPreview } from "../../api/transport.js";
import type { CanvasOperationSessionPhaseV1 } from "./canvas-operation-runtime-v1.js";
import type { HydratedEditorDocumentV1 } from "./editor-document-v1.js";

type RuntimeResources = HydratedEditorDocumentV1["resources"];

function useCanvasOperationArtifactPreviewResourceV1({
  artifactId,
  available,
  createdUrlsRef,
  enabled,
  reloadRevision,
  reportError,
  setOperationPreviewError,
  setResources,
  unavailableMessage,
  workspaceId,
}: {
  readonly artifactId: string | undefined;
  readonly available: boolean;
  readonly createdUrlsRef: RefObject<Set<string>>;
  readonly enabled: boolean;
  readonly reloadRevision: number;
  readonly reportError: boolean;
  readonly setOperationPreviewError: Dispatch<
    SetStateAction<string | undefined>
  >;
  readonly setResources: Dispatch<SetStateAction<RuntimeResources>>;
  readonly unavailableMessage: string;
  readonly workspaceId: string;
}): void {
  useEffect(() => {
    if (!enabled || !artifactId || available) return;
    const controller = new AbortController();
    void downloadArtifactPreview(
      workspaceId,
      artifactId,
      fetch,
      controller.signal,
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        const sourceUrl = URL.createObjectURL(blob);
        createdUrlsRef.current.add(sourceUrl);
        setResources((current) => {
          if (current.get(artifactId)?.sourceQuality === "original") {
            return current;
          }
          const next = new Map(current);
          next.set(artifactId, {
            artifactId,
            sourceQuality: "preview",
            sourceUrl,
            sourceUnavailable: false,
          });
          return next;
        });
        if (reportError) setOperationPreviewError(undefined);
      })
      .catch(() => {
        if (!controller.signal.aborted && reportError) {
          setOperationPreviewError(unavailableMessage);
        }
      });
    return () => controller.abort();
  }, [
    artifactId,
    available,
    createdUrlsRef,
    enabled,
    reloadRevision,
    reportError,
    setOperationPreviewError,
    setResources,
    unavailableMessage,
    workspaceId,
  ]);
}

export function useCanvasOperationPreviewResourcesV1({
  createdUrlsRef,
  maskArtifactId,
  maskUrlAvailable,
  phase,
  previewArtifactId,
  previewUrlAvailable,
  reloadRevision,
  setOperationPreviewError,
  setResources,
  unavailableMessage,
  workspaceId,
}: {
  readonly createdUrlsRef: RefObject<Set<string>>;
  readonly maskArtifactId: string | undefined;
  readonly maskUrlAvailable: boolean;
  readonly phase: CanvasOperationSessionPhaseV1 | undefined;
  readonly previewArtifactId: string | undefined;
  readonly previewUrlAvailable: boolean;
  readonly reloadRevision: number;
  readonly setOperationPreviewError: Dispatch<
    SetStateAction<string | undefined>
  >;
  readonly setResources: Dispatch<SetStateAction<RuntimeResources>>;
  readonly unavailableMessage: string;
  readonly workspaceId: string;
}): void {
  const enabled = phase === "preview_ready" || phase === "conflict";
  useCanvasOperationArtifactPreviewResourceV1({
    artifactId: previewArtifactId,
    available: previewUrlAvailable,
    createdUrlsRef,
    enabled,
    reloadRevision,
    reportError: true,
    setOperationPreviewError,
    setResources,
    unavailableMessage,
    workspaceId,
  });
  useCanvasOperationArtifactPreviewResourceV1({
    artifactId: maskArtifactId,
    available: maskUrlAvailable,
    createdUrlsRef,
    enabled,
    reloadRevision,
    reportError: false,
    setOperationPreviewError,
    setResources,
    unavailableMessage,
    workspaceId,
  });
}
