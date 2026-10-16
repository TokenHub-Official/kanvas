import type { TFunction } from "i18next";
import type { Dispatch, SetStateAction } from "react";

import {
  ApiProblem,
  downloadArtifact,
  fetchCanvasDraft,
  fetchCurrentHumanContext,
} from "../../api/transport.js";
import { canvasOperationReplacementSafetyV1 } from "./canvas-operation-auto-apply-v1.js";
import { readCanvasImageUrlSize } from "./canvas-image-size.js";
import {
  canvasOperationApplyFailureV1,
  canvasOperationApplicationAuthorizedV1,
  canvasOperationSourceCompatibilityV1,
  chooseCanvasOperationOutputDispositionV1,
  currentCanvasOperationSourceV1,
  markCanvasOperationApplyFailedV1,
  markCanvasOperationAppliedV1,
  markCanvasOperationConflictV1,
  type CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";
import {
  hydrateEditorRuntimeDocumentV1,
  normalizeEditorDocumentV1,
  type HydratedEditorDocumentV1,
} from "./editor-document-v1.js";
import { applyEditorNodeInsertionV1 } from "./editor-insertion-transaction-v1.js";
import {
  createEditorStateV1,
  editorReducerV1,
  type EditorActionV1,
  type EditorStateV1,
} from "./editor-state-v1.js";
import { activePage } from "./canvas-workspace-model-v1.js";
import type { CanvasSaveStatusV1 } from "./canvas-workspace-view-model-v1.js";

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const apiForbiddenStatus = 403;
const apiConflictStatus = 409;

type RuntimeResources = HydratedEditorDocumentV1["resources"];
type OutputDisposition = "add_node" | "replace_content" | "set_background";

export interface CanvasOperationApplicationControllerV1 {
  readonly authoritativeDraftId?: string;
  readonly createdUrls: Set<string>;
  readonly currentDraftVersion?: number;
  readonly effectiveSaveStatus: CanvasSaveStatusV1;
  readonly finalizingOperationIds: Set<string>;
  readonly getLatestRuntime: () => {
    readonly canEdit: boolean;
    readonly state: EditorStateV1;
  };
  readonly initialState: EditorStateV1;
  readonly mutate: (action: EditorActionV1) => void;
  readonly pendingDiagnosticsLength: number;
  readonly persistOperationSession: (
    session: CanvasOperationSessionV1,
  ) => Promise<void>;
  readonly previewUrl?: string;
  readonly session?: CanvasOperationSessionV1;
  readonly setDraftSaveError: Dispatch<SetStateAction<string | undefined>>;
  readonly setOperationMessage: Dispatch<SetStateAction<string | undefined>>;
  readonly setOperationSession: Dispatch<
    SetStateAction<CanvasOperationSessionV1 | undefined>
  >;
  readonly setResources: Dispatch<SetStateAction<RuntimeResources>>;
  readonly setSaveStatus: Dispatch<SetStateAction<CanvasSaveStatusV1>>;
  readonly setState: Dispatch<SetStateAction<EditorStateV1>>;
  readonly setTitle: Dispatch<SetStateAction<string>>;
  readonly t: TFunction;
  readonly updateDraftRuntime: (update: {
    readonly lastSavedFingerprint?: string;
    readonly version?: number;
  }) => void;
  readonly workspaceId: string;
}

async function restoreAuthoritativeDraftV1({
  controller,
  document,
  title,
  version,
}: {
  readonly controller: CanvasOperationApplicationControllerV1;
  readonly document: Parameters<typeof normalizeEditorDocumentV1>[0];
  readonly title: string;
  readonly version: number;
}) {
  const hydrated = await hydrateEditorRuntimeDocumentV1(
    document,
    async (sourceArtifactId) => {
      const blob = await downloadArtifact(
        controller.workspaceId,
        sourceArtifactId,
      );
      const url = URL.createObjectURL(blob);
      controller.createdUrls.add(url);
      return url;
    },
  );
  controller.setState(createEditorStateV1(hydrated.document));
  controller.setResources(hydrated.resources);
  controller.setTitle(title);
  controller.updateDraftRuntime({
    lastSavedFingerprint: JSON.stringify({
      title,
      document: hydrated.document,
    }),
    version,
  });
  controller.setSaveStatus("saved");
  controller.setDraftSaveError(undefined);
}

export async function applyCanvasOperationPreviewV1(
  controller: CanvasOperationApplicationControllerV1,
  disposition: OutputDisposition,
) {
  const session = controller.session;
  const artifactId = session?.previewArtifactId;
  const operationPreviewUrl = controller.previewUrl;
  if (!session || !artifactId || !operationPreviewUrl) {
    return;
  }

  let documentApplied = false;
  let appliedSession: CanvasOperationSessionV1 | undefined;
  let applicationSession = session;
  try {
    const [humanContext, reauthorizedArtifact, authoritativeDraft] =
      await Promise.all([
        fetchCurrentHumanContext(),
        downloadArtifact(controller.workspaceId, artifactId),
        disposition === "replace_content" && controller.authoritativeDraftId
          ? fetchCanvasDraft(
              controller.workspaceId,
              controller.authoritativeDraftId,
            )
          : Promise.resolve(undefined),
      ]);
    const latestCanvasRuntime = controller.getLatestRuntime();
    if (!latestCanvasRuntime.canEdit) {
      throw new ApiProblem(
        apiForbiddenStatus,
        "canvas_operation_apply_forbidden",
        controller.t("canvas.messages.applyForbidden"),
      );
    }
    if (
      !canvasOperationApplicationAuthorizedV1(
        humanContext,
        controller.workspaceId,
      )
    ) {
      throw new ApiProblem(
        apiForbiddenStatus,
        "canvas_operation_apply_forbidden",
        controller.t("canvas.messages.applyForbidden"),
      );
    }
    const resultMediaType = reauthorizedArtifact.type;
    if (!supportedImageTypes.has(resultMediaType)) {
      throw new ApiProblem(
        apiConflictStatus,
        "canvas_operation_result_invalid",
        controller.t("canvas.messages.invalidOperationResult"),
      );
    }
    const selectedDisposition = chooseCanvasOperationOutputDispositionV1(
      session,
      disposition,
    );
    applicationSession = selectedDisposition;
    const latestDocument = latestCanvasRuntime.state.document;
    const authoritativeDocument = authoritativeDraft
      ? normalizeEditorDocumentV1(authoritativeDraft.document)
      : undefined;
    const compatibility = canvasOperationSourceCompatibilityV1(
      selectedDisposition,
      currentCanvasOperationSourceV1(latestDocument, selectedDisposition),
    );
    const authoritativeCompatibility = authoritativeDocument
      ? canvasOperationSourceCompatibilityV1(
          selectedDisposition,
          currentCanvasOperationSourceV1(
            authoritativeDocument,
            selectedDisposition,
          ),
        )
      : compatibility;
    const replacementSafety =
      disposition === "replace_content"
        ? canvasOperationReplacementSafetyV1({
            canEdit: latestCanvasRuntime.canEdit,
            document: latestDocument,
            expectedArtifactId: selectedDisposition.source.artifactId,
            session: selectedDisposition,
          })
        : "ready";
    const authoritativeReplacementSafety =
      disposition === "replace_content" && authoritativeDocument
        ? canvasOperationReplacementSafetyV1({
            canEdit: latestCanvasRuntime.canEdit,
            document: authoritativeDocument,
            expectedArtifactId: selectedDisposition.source.artifactId,
            session: selectedDisposition,
          })
        : replacementSafety;
    if (
      disposition === "replace_content" &&
      (compatibility !== "compatible" ||
        authoritativeCompatibility !== "compatible" ||
        replacementSafety !== "ready" ||
        authoritativeReplacementSafety !== "ready")
    ) {
      if (
        authoritativeDraft &&
        authoritativeDraft.version !== controller.currentDraftVersion &&
        controller.effectiveSaveStatus === "saved" &&
        controller.pendingDiagnosticsLength === 0
      ) {
        await restoreAuthoritativeDraftV1({
          controller,
          document: authoritativeDraft.document,
          title: authoritativeDraft.document.title,
          version: authoritativeDraft.version,
        });
      }
      await controller.persistOperationSession(
        markCanvasOperationConflictV1(
          selectedDisposition,
          authoritativeCompatibility === "missing"
            ? controller.t("canvas.messages.sourceMissingConflict")
            : controller.t("canvas.messages.sourceChangedConflict"),
        ),
      );
      return;
    }
    const originalUrl = URL.createObjectURL(reauthorizedArtifact);
    controller.createdUrls.add(originalUrl);
    const intrinsicSize = await readCanvasImageUrlSize(originalUrl);
    controller.setResources((current) => {
      const next = new Map(current);
      next.set(artifactId, {
        artifactId,
        sourceQuality: "original",
        sourceUrl: originalUrl,
        sourceUnavailable: false,
      });
      return next;
    });
    if (disposition === "replace_content") {
      const finalCanvasRuntime = controller.getLatestRuntime();
      const finalCompatibility = canvasOperationSourceCompatibilityV1(
        selectedDisposition,
        currentCanvasOperationSourceV1(
          finalCanvasRuntime.state.document,
          selectedDisposition,
        ),
      );
      const sourcePage = finalCanvasRuntime.state.document.pages.find(
        (page) => page.id === session.source.pageId,
      );
      const sourceNode = sourcePage?.nodes.find(
        (node) => node.id === session.source.nodeId,
      );
      if (finalCompatibility !== "compatible" || !finalCanvasRuntime.canEdit) {
        await controller.persistOperationSession(
          markCanvasOperationConflictV1(
            selectedDisposition,
            controller.t("canvas.messages.sourceChangedConflict"),
          ),
        );
        return;
      }
      if (!sourcePage || sourceNode?.kind !== "image") {
        await controller.persistOperationSession(
          markCanvasOperationConflictV1(
            selectedDisposition,
            controller.t("canvas.messages.sourceMissingConflict"),
          ),
        );
        return;
      }
      if (sourceNode.locked) {
        await controller.persistOperationSession(
          markCanvasOperationConflictV1(
            selectedDisposition,
            controller.t("canvas.messages.sourceChangedConflict"),
          ),
        );
        return;
      }
      documentApplied = true;
      controller.setState(
        editorReducerV1(finalCanvasRuntime.state, {
          type: "set_image_content",
          pageId: sourcePage.id,
          nodeId: sourceNode.id,
          image: {
            ...sourceNode.image,
            source: {
              kind: "artifact",
              artifactId,
            },
            intrinsicWidth: intrinsicSize.width,
            intrinsicHeight: intrinsicSize.height,
            mediaType: resultMediaType as
              "image/jpeg" | "image/png" | "image/webp",
          },
        }),
      );
    } else if (disposition === "set_background") {
      controller.mutate({
        type: "set_page_background",
        pageId: controller.initialState.activePageId,
        background: {
          kind: "image",
          image: {
            source: {
              kind: "artifact",
              artifactId,
            },
            intrinsicWidth: intrinsicSize.width,
            intrinsicHeight: intrinsicSize.height,
            mediaType: resultMediaType as
              "image/jpeg" | "image/png" | "image/webp",
            crop: {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
            },
            fit: "cover",
            focalPoint: {
              x: 0.5,
              y: 0.5,
            },
          },
          opacity: 1,
        },
      });
      documentApplied = true;
    } else {
      const pageId = controller.initialState.document.pages.some(
        (page) => page.id === session.source.pageId,
      )
        ? session.source.pageId
        : controller.initialState.activePageId;
      const requestId = crypto.randomUUID();
      controller.setState((current) => {
        const sourcePage = current.document.pages.find(
          (page) => page.id === session.source.pageId,
        );
        const sourceNode = sourcePage?.nodes.find(
          (node) => node.id === session.source.nodeId,
        );
        const targetPage =
          sourcePage ??
          current.document.pages.find((page) => page.id === pageId) ??
          activePage(current);
        const visiblePageRect = {
          x: 0,
          y: 0,
          width: targetPage.width,
          height: targetPage.height,
        };
        return applyEditorNodeInsertionV1(current, {
          requestId,
          payload: {
            kind: "image",
            source: {
              kind: "generated_result",
              reference: {
                kind: "artifact",
                artifactId,
              },
              runId: session.capabilityRunId!,
            },
            intrinsicSize,
          },
          target: sourceNode
            ? {
                kind: "canvas_adjacent",
                pageId: targetPage.id,
                sourceRect: sourceNode.transform,
                visiblePageRect,
              }
            : {
                kind: "canvas_center",
                pageId: targetPage.id,
                visiblePageRect,
              },
        });
      });
      documentApplied = true;
    }
    appliedSession = markCanvasOperationAppliedV1(selectedDisposition);
    controller.finalizingOperationIds.add(session.id);
    await controller.persistOperationSession(appliedSession);
    controller.setOperationMessage(
      session.completionBehavior === "auto_replace_safe"
        ? controller.t("canvas.messages.autoApplied")
        : undefined,
    );
  } catch (error) {
    if (documentApplied && appliedSession) {
      controller.setOperationSession(appliedSession);
      controller.setOperationMessage(
        controller.t("canvas.messages.appliedRecoveryError"),
      );
      return;
    }
    await controller.persistOperationSession(
      markCanvasOperationApplyFailedV1(
        applicationSession,
        canvasOperationApplyFailureV1(error),
      ),
    );
  }
}
