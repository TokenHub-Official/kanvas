import "./canvas-workspace-v1.css";

import type {
  BrandKitLogo,
  BrandKitTextStyle,
  CanvasDraft,
  ResourceAdoptionResult,
  WorkspaceAssetSummary,
} from "@kanvas/contracts/api";
import type {
  ResourceArtTextCandidate,
  ResourceFontCandidate,
  ResourceImageCandidate,
} from "@kanvas/contracts/resource-source";
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Divider,
  Dropdown,
  InputNumber,
  Tooltip,
  type MenuProps,
  type ThemeConfig,
} from "antd";
import {
  ArrowLeftOutlined,
  BgColorsOutlined,
  BlockOutlined,
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  MessageOutlined,
  PictureOutlined,
  RedoOutlined,
  ScissorOutlined,
  SlidersOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowRight,
  Copy,
  FolderOpen,
  Group,
  History,
  Lock,
  LockOpen,
  Plus,
  Ruler,
  SlidersHorizontal,
  Trash2,
  Ungroup,
} from "./canvas-icons-v1.js";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type ChangeEvent,
  type ComponentProps,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";
import {
  cancelCapabilityRun,
  createWorkspaceAssetFromArtifact,
  downloadArtifact,
  restoreCanvasDraft,
} from "../../api/transport.js";
import { Brand } from "../../components/brand.js";
import { artifactPreviewQueryOptionsV1 } from "../../components/artifact-preview-query.js";
import { SkipLink } from "../../components/skip-link.js";
import { useDocumentTitle } from "../../components/use-document-title.js";
import { UnsavedChangesGuard } from "../../components/unsaved-changes-guard.js";
import { cn } from "../../lib/cn.js";
import { kanvasInverseControlTheme } from "../../theme/kanvas-inverse-control-theme.js";
import {
  WorkspaceAssetPicker,
  type WorkspaceAssetPickIntent,
  type WorkspaceAssetPickResult,
} from "../assets/workspace-asset-picker.js";
import { ResourceCatalogPicker } from "../assets/resource-catalog-picker.js";
import { ResourceCatalogTextPicker } from "../assets/resource-catalog-text-picker.js";
import { useCanvasFontResources } from "./canvas-font-resources.js";
import {
  canvasExternalTextInsertionOptionsV1,
  useCanvasArtTextResources,
} from "./canvas-art-text-resources.js";
import { loadCanvasArtifactResourcesV1 } from "./canvas-artifact-resource-loader-v1.js";
import { useCanvasBrowserRuntimesV1 } from "./use-canvas-browser-runtimes-v1.js";
import { CanvasLeftPanelV1 } from "./canvas-left-panel-v1.js";
import { CanvasSelectionOverlayV1 } from "./canvas-selection-overlay-v1.js";
import { CanvasImageCropOverlayV1 } from "./canvas-image-crop-overlay-v1.js";
import {
  canvasImageCropSourcePreviewNodeV1,
  canvasImageNodeWithCropFrameMoveV1,
  canvasImageNodeWithFreeCropFrameV1,
} from "./canvas-image-crop-direct-v1.js";
import type { LayersInspectorV1 } from "./canvas-layers-inspector-v1.js";
import type { CanvasInspectorContentV1 as CanvasInspectorContentComponentV1 } from "./canvas-inspector-content-v1.js";
import { CanvasColorPickerV1 } from "./canvas-color-picker-v1.js";
import { canvasBrandColorTargetV1 } from "./canvas-brand-color-application-v1.js";
import { canvasLockControlV1 } from "./canvas-operation-bars-model.js";
import type { CanvasOperationOutputMode } from "./canvas-operation-registry.js";
import {
  canvasEditorActionAllowedV1,
  canvasPageForTextEditingV1,
  canvasSelectionChangeClosesOverlaysV1,
  focusCanvasStageAfterPanelActionV1,
  focusCanvasTextEditorAtEndV1,
  stopCanvasChromePointerDownV1,
  stopCanvasChromeWheelV1,
} from "./canvas-interaction-boundary-v1.js";
import {
  canvasTextFormattingV1,
  updateCanvasTextRunsV1,
} from "./canvas-text-formatting-v1.js";
import {
  browserCanvasTextMeasureV1,
  canvasTextEditorVerticalOffsetV1,
} from "./canvas-text-node-v1.js";
import { canvasDocumentTextStylesV1 } from "./canvas-text-style-v1.js";
import { CanvasTextAlignmentPopoverV1 } from "./canvas-text-alignment-popover-v1.js";
import {
  canvasInspectorCloseTriggerV1,
  canvasInspectorModeAfterSelectionV1,
  toggleCanvasInspectorModeV1,
  type CanvasInspectorModeV1,
} from "./canvas-inspector-state-v1.js";
import {
  CanvasImagePanelV1,
  type CanvasImageCropModeV1,
  type CanvasImagePanelViewV1,
} from "./canvas-image-panel-v1.js";
import {
  canvasExternalImagePreviewInsertionV1,
  createCanvasInsertionCommandsV1,
} from "./canvas-insertion-commands-v1.js";
import { readCanvasImageUrlSize } from "./canvas-image-size.js";
import { CanvasHistoryDialog } from "./canvas-history-dialog.js";
import { CanvasGroupIsolationPanelV1 } from "./canvas-group-isolation-panel-v1.js";
import { CanvasSaveConflictDialog } from "./canvas-save-conflict-dialog.js";
import { CanvasExportPanel } from "./canvas-export-panel.js";
import { CanvasMediaContainerPanelV1 } from "./canvas-media-container-panel-v1.js";
import {
  canvasMediaTargetNodeWithImageV1,
  canvasMediaTargetImageV1,
  type CanvasMediaContentTargetV1,
} from "./canvas-media-container-v1.js";
import {
  canvasToolDefaultParametersV1,
  type CanvasImageCapabilityTool,
} from "./canvas-capability-tools.js";
import {
  canvasOperationAutoApplyDecisionV1,
  normalizeCanvasOperationAutoApplyRecoveryV1,
} from "./canvas-operation-auto-apply-v1.js";
import { applyCanvasOperationPreviewV1 } from "./canvas-operation-application-controller-v1.js";
import { CanvasOperationParametersV1 } from "./canvas-operation-parameters-v1.js";
import {
  listCanvasOperationSessionsV1,
  removeCanvasOperationSessionV1,
  saveCanvasOperationSessionV1,
} from "./canvas-operation-recovery-v1.js";
import { CanvasOperationReviewV1 } from "./canvas-operation-review-v1.js";
import { CanvasOperationStatusV1 } from "./canvas-operation-status-v1.js";
import {
  canvasOperationReviewOpenV1,
  canvasOperationSurfaceProjectionV1,
} from "./canvas-operation-surface-v1.js";
import { canvasOperationUserMessageV1 } from "./canvas-operation-feedback-v1.js";
import {
  canvasOperationBlocksNewRunV1,
  canvasOperationSessionRecoverableV1,
  canvasOperationSourceCompatibilityV1,
  canvasOperationStatusFailureMessageV1,
  createCanvasOperationSessionV1,
  currentCanvasOperationSourceV1,
  isCanvasOperationFinalizationPhaseV1,
  markCanvasOperationAppliedV1,
  markCanvasOperationAssetSavedV1,
  markCanvasOperationDiscardedV1,
  pinCanvasOperationAssetAdoptionV1,
  requestCanvasOperationCancellationV1,
  retryCanvasOperationStartV1,
  type CanvasOperationSessionV1,
} from "./canvas-operation-runtime-v1.js";
import { canvasRuntimeRecoveryIdV1 } from "./canvas-runtime-recovery-v1.js";
import type { CanvasLeftRailId } from "./canvas-left-rail-model.js";
import { CanvasPageV1 } from "./canvas-node-renderer-v1.js";
import { CanvasPageStripV1 } from "./canvas-page-strip-v1.js";
import { CanvasSaveStatusIndicatorV1 } from "./canvas-save-status-indicator-v1.js";
import { CanvasNodeContextMenuV1 } from "./canvas-node-context-menu-v1.js";
import {
  canvasBrushSettingsForStyleV1,
  canvasFreehandPreviewPathV1,
  type CanvasBrushSettingsV1,
  type CanvasQuickToolIdV1,
} from "./canvas-quick-tools-v1.js";
import { createCanvasPageCommandsV1 } from "./canvas-page-commands-v1.js";
import { CanvasViewControlsV1 } from "./canvas-view-controls-v1.js";
import { useCanvasViewportV1 } from "./use-canvas-viewport-v1.js";
import { useCanvasDraftPersistenceControllerV1 } from "./use-canvas-draft-persistence-controller-v1.js";
import { useCanvasOperationCatalogV1 } from "./use-canvas-operation-catalog-v1.js";
import { useCanvasOperationDispatcherV1 } from "./use-canvas-operation-dispatcher-v1.js";
import { useCanvasOperationPreviewResourcesV1 } from "./use-canvas-operation-preview-resources-v1.js";
import { useCanvasOperationRunReconciliationV1 } from "./use-canvas-operation-run-reconciliation-v1.js";
import { useCanvasOperationSessionStorageV1 } from "./use-canvas-operation-session-storage-v1.js";
import { createEditorDocumentV1 } from "./editor-document-factory-v1.js";
import {
  createEditorDraftContentV1,
  hydrateEditorRuntimeDocumentV1,
  type EditorArtifactRuntimeResourceV1,
  type HydratedEditorDocumentV1,
} from "./editor-document-v1.js";
import {
  canvasFontDefinitionV1,
  prioritizeCanvasFontsV1,
} from "./font-catalog-v1.js";
import { CanvasFontSelectV1 } from "./canvas-font-select-v1.js";
import { canvasGraphicDefinitionV1 } from "./graphic-catalog-v1.js";
import { canvasLineRotationHandleV1 } from "./canvas-line-editing-v1.js";
import { canvasPageConnectionAnchorsV1 } from "./canvas-line-connection-v1.js";
import type {
  EditorPointV1,
  EditorResizeHandleV1,
} from "./editor-geometry-v1.js";
import { canvasImageInsertionTargetAtPointV1 } from "./editor-drop-target-v1.js";
import { canvasAssetInsertionTargetV1 } from "./canvas-asset-intent-v1.js";
import { applyEditorNodeInsertionV1 } from "./editor-insertion-transaction-v1.js";
import type {
  EditorNodeInsertionPayload,
  EditorNodeInsertionTarget,
} from "./editor-node-insertion.js";
import {
  editorRuntimePageArtifactIdsV1,
  editorRuntimeSerializationDiagnosticsV1,
  type EditorRuntimeDocumentV1,
  type EditorRuntimeNodeV1,
  type EditorRuntimePlacedImageV1,
} from "./editor-runtime-v1.js";
import {
  createEditorStateV1,
  editorReducerV1,
  type EditorActionV1,
} from "./editor-state-v1.js";
import {
  activePage,
  canvasMediaContentTargetForEventV1,
  editableTextNodeV1,
  findCanvasNodeV1,
  mapTextNodeRuns,
  nodeWithEditedTextV1,
  nodeWithTextNodeV1,
  pageDocumentColorsV1,
  paintColor,
  shapeTextNodeForEditingV1,
  topLevelNode,
} from "./canvas-workspace-model-v1.js";
import { canvasGridDefinitionV1 } from "./frame-grid-catalog-v1.js";
import { useCanvasImageUploadsV1 } from "./use-canvas-image-uploads-v1.js";
import { useCanvasExportV1 } from "./use-canvas-export-v1.js";
import { useCanvasKeyboardShortcutsV1 } from "./use-canvas-keyboard-shortcuts-v1.js";
import { useCanvasPointerInteractionsV1 } from "./use-canvas-pointer-interactions-v1.js";
import { useCanvasStageInteractionsV1 } from "./use-canvas-stage-interactions-v1.js";
import { CanvasWorkspaceNoticeV1 } from "./canvas-workspace-notice-v1.js";
import {
  canvasInspectorTitleKeyV1,
  canvasSaveStatusMessageKeyV1,
  effectiveCanvasSaveStatusV1,
  preferredCanvasOutputDispositionV1,
  selectedCanvasImagePreviewUrlV1,
} from "./canvas-workspace-view-model-v1.js";

type RuntimeResources = HydratedEditorDocumentV1["resources"];

const selectionOutlineDash = 5;
const selectionOutlineGap = 4;
const selectionOutlineWidth = 1.5;
const defaultCanvasFontSize = 32;
const regularCanvasFontWeight = 400;
const boldCanvasFontWeight = 700;
const defaultCanvasLineHeight = 1.2;
const rotationReadoutOffset = 48;
const CANVAS_ARTIFACT_LOAD_TIMEOUT_MS = 15_000;
const CANVAS_ARTIFACT_LOAD_ATTEMPTS = 3;
const ARTIFACT_SCOPE_SEPARATOR = ",";

const emptyResources: RuntimeResources = new Map();
const emptyArtifactIds: readonly string[] = [];
const canvasTypeToolbarThemeV1: ThemeConfig = {
  components: {
    Button: {
      iconGap: 6,
    },
    Divider: {
      verticalMarginInline: 4,
    },
  },
};

type CanvasInspectorContentModuleV1 = {
  readonly CanvasInspectorContentV1: typeof CanvasInspectorContentComponentV1;
};

type CanvasAssetPickerTaskV1 =
  | { readonly intent: "background" }
  | {
      readonly intent: "fill";
      readonly mediaTarget: CanvasMediaContentTargetV1;
    }
  | { readonly intent: "replace"; readonly nodeId: string };

let canvasInspectorContentPromise:
  Promise<CanvasInspectorContentModuleV1> | undefined;

function loadCanvasInspectorContentV1() {
  canvasInspectorContentPromise ??= import("./canvas-inspector-content-v1.js");
  return canvasInspectorContentPromise;
}

const CanvasInspectorContentV1 = lazy(async () => {
  const module = await loadCanvasInspectorContentV1();
  return { default: module.CanvasInspectorContentV1 };
});

export function CanvasWorkspaceV1({
  canEdit,
  csrfToken,
  embedded = false,
  initialDocument,
  initialDraft,
  initialBrandKitRevisionId,
  initialArtifactIds = emptyArtifactIds,
  initialImportFiles = [],
  initialPanel,
  initialResources = emptyResources,
  onInitialImportFilesConsumed,
  onDraftCreated,
  onExit,
  permissions,
  returnTo,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly csrfToken: string;
  readonly embedded?: boolean;
  readonly initialDocument?: EditorRuntimeDocumentV1;
  readonly initialDraft?: CanvasDraft;
  readonly initialBrandKitRevisionId?: string | null;
  readonly initialArtifactIds?: readonly string[];
  readonly initialImportFiles?: readonly File[];
  readonly initialPanel?: CanvasLeftRailId;
  readonly initialResources?: RuntimeResources;
  readonly onInitialImportFilesConsumed?: () => void;
  readonly onDraftCreated?: (draftId: string) => Promise<void> | void;
  readonly onExit?: () => void;
  readonly permissions: readonly string[];
  readonly returnTo?: string;
  readonly workspaceId: string;
}) {
  const { i18n, t } = useTranslation();
  const { notification } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [state, setState] = useState(() =>
    createEditorStateV1(initialDocument ?? createEditorDocumentV1(workspaceId)),
  );
  const [spaceHeld, setSpaceHeld] = useState(false);
  const durablePage = activePage(state);
  const {
    beginPan: beginViewportPan,
    changeZoom: changeViewportZoom,
    connectStage,
    finishPan: finishViewportPan,
    fitViewport,
    handleWheel: handleStageWheel,
    pan,
    panning: viewportPanning,
    setPan,
    setViewportMode,
    setZoom,
    stage,
    stageElement,
    updatePan: updateViewportPan,
    zoom,
  } = useCanvasViewportV1({
    documentId: embedded
      ? `agent-editor:${state.document.documentId}`
      : state.document.documentId,
    pageHeight: durablePage.height,
    pageId: durablePage.id,
    pageWidth: durablePage.width,
    spaceHeld,
    workspaceId,
  });
  const [resources, setResources] =
    useState<RuntimeResources>(initialResources);
  const [initialArtifactScopesByPage] = useState(
    () =>
      new Map(
        state.document.pages.map((page) => {
          const artifactIds = editorRuntimePageArtifactIdsV1(page);
          return [
            page.id,
            {
              artifactIds,
              scope: artifactIds.toSorted().join(ARTIFACT_SCOPE_SEPARATOR),
            },
          ];
        }),
      ),
  );
  const [allArtifactScope] = useState(() =>
    initialArtifactIds.toSorted().join(ARTIFACT_SCOPE_SEPARATOR),
  );
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;
  const [title, setTitle] = useState(
    () =>
      initialDraft?.document.title ??
      initialDocument?.title ??
      t("canvas.untitled"),
  );
  const [brand, setBrand] = useState(() => initialDraft?.brand);
  useDocumentTitle(
    t("canvas.documentTitle", {
      title: title.trim() || t("canvas.untitled"),
    }),
  );
  const fontResources = useCanvasFontResources(workspaceId);
  const canvasFonts = useMemo(
    () =>
      prioritizeCanvasFontsV1(
        fontResources.fonts,
        i18n.resolvedLanguage ?? i18n.language,
      ),
    [fontResources.fonts, i18n.language, i18n.resolvedLanguage],
  );
  const workspaceArtTextPresets = useCanvasArtTextResources(
    workspaceId,
    canvasFonts,
    i18n.resolvedLanguage ?? i18n.language,
  );
  useCanvasBrowserRuntimesV1({
    canEdit,
    csrfToken,
    workspaceId,
  });
  const [activePanel, setActivePanel] = useState<CanvasLeftRailId | undefined>(
    initialPanel,
  );
  const [activeQuickTool, setActiveQuickTool] =
    useState<CanvasQuickToolIdV1>("select");
  const [brushSettings, setBrushSettings] = useState<CanvasBrushSettingsV1>(
    () => canvasBrushSettingsForStyleV1("fine"),
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const activeArtifactEntry = initialArtifactScopesByPage.get(
    state.activePageId,
  );
  const activeArtifactIds =
    activeArtifactEntry?.artifactIds ?? emptyArtifactIds;
  const activeArtifactScope = activeArtifactEntry?.scope ?? "";
  const artifactResourcesLoading = activeArtifactIds.some((artifactId) => {
    const resource = resources.get(artifactId);
    return !resource || resource.sourceQuality === "preview";
  });
  const artifactResourcesUnavailable = activeArtifactIds.some(
    (artifactId) => resources.get(artifactId)?.sourceUnavailable,
  );
  const hasExportPermission = permissions.includes("asset.write");
  const canExport =
    hasExportPermission &&
    !artifactResourcesLoading &&
    !artifactResourcesUnavailable;
  const canDownloadExport = permissions.includes("artifact.download");
  const canViewExportAssets = permissions.includes("asset.read");
  const [operationMessage, setOperationMessage] = useState<string>();
  const [operationPreviewError, setOperationPreviewError] = useState<string>();
  const [operationArtifactReloadRevision, setOperationArtifactReloadRevision] =
    useState(0);
  const [editingText, setEditingText] = useState<{
    readonly nodeId: string;
    readonly value: string;
  }>();
  const [imageCropGesture, setImageCropGesture] = useState<{
    readonly node: Extract<EditorRuntimeNodeV1, { kind: "image" }>;
    readonly pointerId: number;
    readonly start: EditorPointV1;
  }>();
  const [imageCropFrameGesture, setImageCropFrameGesture] = useState<{
    readonly handle: EditorResizeHandleV1;
    readonly node: Extract<EditorRuntimeNodeV1, { kind: "image" }>;
    readonly pointerId: number;
  }>();
  const [imageCropMode, setImageCropMode] =
    useState<CanvasImageCropModeV1>("free");
  const imageCropOriginNodeRef = useRef<
    Extract<EditorRuntimeNodeV1, { kind: "image" }> | undefined
  >(undefined);
  const [imagePanelView, setImagePanelView] =
    useState<CanvasImagePanelViewV1>();
  const [mediaContentTarget, setMediaContentTarget] =
    useState<CanvasMediaContentTargetV1>();
  const [assetPickerTask, setAssetPickerTask] =
    useState<CanvasAssetPickerTaskV1>();
  const [groupIsolation, setGroupIsolation] = useState<{
    readonly childId?: string;
    readonly groupId: string;
  }>();
  const [inspectorMode, setInspectorMode] = useState<CanvasInspectorModeV1>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRestoring, setHistoryRestoring] = useState(false);
  const [operationSession, setOperationSession] =
    useState<CanvasOperationSessionV1>();
  const [reviewDismissal, setReviewDismissal] = useState<{
    readonly phase: CanvasOperationSessionV1["phase"];
    readonly sessionId: string;
    readonly updatedAt: string;
  }>();
  const reviewDismissedSessionId =
    operationSession &&
    reviewDismissal?.sessionId === operationSession.id &&
    reviewDismissal.phase === operationSession.phase &&
    reviewDismissal.updatedAt === operationSession.updatedAt
      ? reviewDismissal.sessionId
      : undefined;
  const [operationBusy, setOperationBusy] = useState(false);
  const [pendingOperationTool, setPendingOperationTool] =
    useState<CanvasImageCapabilityTool>();
  const pageFrameRef = useRef<HTMLDivElement>(null);
  const focusStageAfterPanelAction = useCallback(() => {
    focusCanvasStageAfterPanelActionV1(stageElement);
  }, [stageElement]);
  const typeToolbarRef = useRef<HTMLDivElement>(null);
  const inspectorTriggerRef = useRef<HTMLElement>(null);
  const operationReviewTriggerRef = useRef<HTMLButtonElement>(null);
  const shortcutsTriggerRef = useRef<HTMLButtonElement>(null);
  const fileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const previousSelectionIdsRef = useRef(state.selectedIds);
  const draggedAssetRef = useRef<WorkspaceAssetSummary | null>(null);
  const draggedCatalogNodeRef = useRef<EditorNodeInsertionPayload | null>(null);
  const createdUrlsRef = useRef(new Set<string>());
  const exitRequestedRef = useRef(false);

  useEffect(() => {
    const currentResources = resourcesRef.current;
    const scopedActiveIds = activeArtifactScope
      ? activeArtifactScope.split(ARTIFACT_SCOPE_SEPARATOR)
      : [];
    const scopedAllIds = allArtifactScope
      ? allArtifactScope.split(ARTIFACT_SCOPE_SEPARATOR)
      : [];
    const activeIdSet = new Set(scopedActiveIds);
    const activeIds = scopedActiveIds.filter((artifactId) => {
      const resource = currentResources.get(artifactId);
      return !resource || resource.sourceQuality === "preview";
    });
    const backgroundPreviewIds = scopedAllIds.filter(
      (artifactId) =>
        !activeIdSet.has(artifactId) &&
        !currentResources.get(artifactId)?.sourceUrl,
    );
    if (activeIds.length === 0 && backgroundPreviewIds.length === 0) {
      return undefined;
    }
    const controller = new AbortController();
    const onResource = (resource: EditorArtifactRuntimeResourceV1) => {
      setResources((current) => {
        const next = new Map(current);
        next.set(resource.artifactId, resource);
        return next;
      });
    };
    const resolveArtifactPreview = async (
      artifactId: string,
      signal: AbortSignal,
    ) => {
      const blob = await queryClient.fetchQuery(
        artifactPreviewQueryOptionsV1(workspaceId, artifactId),
      );
      if (signal.aborted) {
        throw new DOMException("Canvas preview loading stopped.", "AbortError");
      }
      const sourceUrl = URL.createObjectURL(blob);
      createdUrlsRef.current.add(sourceUrl);
      return sourceUrl;
    };
    const activeLoad = loadCanvasArtifactResourcesV1({
      artifactIds: activeIds,
      onResource: (resource) => {
        onResource(resource);
      },
      resolveArtifactPreview,
      resolveArtifactSource: async (artifactId, signal) => {
        let lastError: unknown;
        for (
          let attempt = 0;
          attempt < CANVAS_ARTIFACT_LOAD_ATTEMPTS;
          attempt += 1
        ) {
          const timeoutController = new AbortController();
          const timeout = window.setTimeout(
            () => timeoutController.abort(),
            CANVAS_ARTIFACT_LOAD_TIMEOUT_MS,
          );
          try {
            const blob = await downloadArtifact(
              workspaceId,
              artifactId,
              fetch,
              AbortSignal.any([signal, timeoutController.signal]),
            );
            const sourceUrl = URL.createObjectURL(blob);
            createdUrlsRef.current.add(sourceUrl);
            return sourceUrl;
          } catch (error) {
            lastError = error;
            if (signal.aborted) throw error;
          } finally {
            window.clearTimeout(timeout);
          }
        }
        throw lastError;
      },
      signal: controller.signal,
    });
    const backgroundLoad = loadCanvasArtifactResourcesV1({
      artifactIds: backgroundPreviewIds,
      concurrency: 2,
      onResource,
      resolveArtifactPreview,
      signal: controller.signal,
    });
    void Promise.all([activeLoad, backgroundLoad]);
    return () => controller.abort();
  }, [activeArtifactScope, allArtifactScope, queryClient, workspaceId]);
  const canvasNavigationCommittedRef = useRef(false);
  const recoveryIdRef = useRef(
    canvasRuntimeRecoveryIdV1(workspaceId, initialDraft?.id),
  );
  const operationFallbackRecoveryIdRef = useRef(
    canvasRuntimeRecoveryIdV1(workspaceId, undefined),
  );
  const getOperationRecoveryDocument = useEffectEvent(() => state.document);
  const latestCanvasRuntimeRef = useRef({
    canEdit,
    state,
  });
  useEffect(() => {
    latestCanvasRuntimeRef.current = {
      canEdit,
      state,
    };
  }, [canEdit, state]);
  const dispatchingOperationIdsRef = useRef(new Set<string>());
  const finalizingOperationIdsRef = useRef(new Set<string>());
  const pendingOperationCancellationIdsRef = useRef(new Set<string>());
  const sourceDeletionCancellationIdsRef = useRef(new Set<string>());
  const autoApplyAttemptedOperationIdsRef = useRef(new Set<string>());
  const mutate = useCallback(
    (action: EditorActionV1) => {
      if (!canvasEditorActionAllowedV1(canEdit, action.type)) {
        return;
      }
      // This reducer dispatch is an event callback, not an effect.
      // eslint-disable-next-line @eslint-react/set-state-in-effect
      setState((current) => editorReducerV1(current, action));
    },
    [canEdit],
  );
  const commitPreview = useCallback(() => {
    mutate({ type: "commit_preview" });
  }, [mutate]);
  const pagePoint = useCallback(
    (clientX: number, clientY: number): EditorPointV1 => {
      const bounds = pageFrameRef.current?.getBoundingClientRect();
      if (!bounds) {
        return { x: 0, y: 0 };
      }
      return {
        x: ((clientX - bounds.left) / bounds.width) * durablePage.width,
        y: ((clientY - bounds.top) / bounds.height) * durablePage.height,
      };
    },
    [durablePage.height, durablePage.width],
  );
  const hideEditorPanels = useCallback(() => {
    setInspectorMode(undefined);
    setImagePanelView(undefined);
    setGroupIsolation(undefined);
  }, []);
  const pointerInteractions = useCanvasPointerInteractionsV1({
    activeQuickTool,
    brushStyle: brushSettings,
    canEdit,
    commitPreview,
    hideEditorPanels,
    mutate,
    page: durablePage,
    pagePoint,
    setState,
    stage,
    state,
    t,
    zoom,
  });
  const {
    beginHandlePointer,
    beginLinePointPointer,
    beginNodePointer,
    cancelDrawing,
    drawingGesture,
    eraserGesture,
    endGesture,
    gesture,
    guides,
    marquee,
    updateGesture,
  } = pointerInteractions;
  const displayState = useMemo(() => {
    let previewState = state;
    if (eraserGesture && eraserGesture.nodeIds.length > 0) {
      previewState = editorReducerV1(previewState, {
        type: "delete_nodes",
        ids: eraserGesture.nodeIds,
        pageId: state.activePageId,
      });
    }
    for (const node of pointerInteractions.previewNodes.values()) {
      previewState = editorReducerV1(previewState, {
        type: "preview_replace_node",
        node,
      });
    }
    if (pointerInteractions.previewTransforms.size === 0) {
      return previewState;
    }
    return editorReducerV1(previewState, {
      type: "transform_nodes",
      pageId: state.activePageId,
      transforms: [...pointerInteractions.previewTransforms].map(
        ([id, transform]) => ({
          id,
          transform,
        }),
      ),
    });
  }, [
    eraserGesture,
    pointerInteractions.previewNodes,
    pointerInteractions.previewTransforms,
    state,
  ]);
  const page = activePage(displayState);
  const renderedPage = useMemo(
    () => canvasPageForTextEditingV1(page, editingText),
    [editingText, page],
  );
  const documentColors = useMemo(
    () => pageDocumentColorsV1(durablePage),
    [durablePage],
  );
  const documentTextStyles = useMemo(
    () => canvasDocumentTextStylesV1(durablePage),
    [durablePage],
  );
  const { selectedNodes, selectionHasLocked } = useMemo(() => {
    const selectedIds = new Set(state.selectedIds);
    const nodes = page.nodes.filter((node) => selectedIds.has(node.id));
    return {
      selectedNodes: nodes,
      selectionHasLocked: nodes.some((node) => node.locked),
    };
  }, [page.nodes, state.selectedIds]);
  useEffect(() => {
    if (selectedNodes.length > 0) {
      void loadCanvasInspectorContentV1();
    }
  }, [selectedNodes.length]);
  const {
    applyContextMenuImageAsBackground,
    beginTextEditing,
    bringContextMenuNodeToFront,
    closeContextMenu,
    contextMenu,
    contextMenuNode,
    deleteContextMenuNode,
    duplicateContextMenuNode,
    handleStagePointerDown,
    openNodeContextMenu,
    sendContextMenuNodeToBack,
  } = useCanvasStageInteractionsV1({
    canEdit,
    commitPreview,
    hideEditorPanels,
    mutate,
    page: durablePage,
    pagePoint,
    selectedNodes,
    setEditingText,
    stage,
    t,
  });
  const {
    activatePage,
    addGuide: addActivePageGuide,
    addPage,
    clearGuides: clearActivePageGuides,
    convertBackgroundImage,
    deletePage: deleteActivePage,
    duplicatePage,
    movePageBackward: moveActivePageBackward,
    movePageForward: moveActivePageForward,
    renamePage: renameActivePage,
    reorderPage,
    previewBackgroundColor,
    previewBackgroundFocalPoint,
    previewBackgroundGradient,
    previewBackgroundImageOpacity,
    resizePage,
    setBackgroundColor,
    setBackgroundGradient,
    setBackgroundImageFit,
    setTransparentBackground,
  } = createCanvasPageCommandsV1({
    commitPreview,
    hideEditorPanels,
    mutate,
    page: durablePage,
    pageCount: state.document.pages.length,
    t,
  });
  const pendingDiagnostics = useMemo(
    () => editorRuntimeSerializationDiagnosticsV1(state.document),
    [state.document],
  );
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        title,
        document: state.document,
      }),
    [state.document, title],
  );
  const {
    adoptBrandRevision,
    applyLatestAfterSaveConflict,
    dispatchSaveConflict,
    draftIdRef,
    draftRuntime,
    draftSaveError,
    draftVersionRef,
    keepLocalAfterSaveConflict,
    lastSavedFingerprintRef,
    persistCanvasDraft,
    readLatestSaveConflict,
    saveConflict,
    saveQueueRef,
    saveStatus,
    setDraftSaveError,
    setSaveStatus,
    updateDraftRuntime,
  } = useCanvasDraftPersistenceControllerV1({
    canEdit,
    canvasNavigationCommittedRef,
    createdUrlsRef,
    csrfToken,
    document: state.document,
    exitRequestedRef,
    fingerprint,
    initialDraft,
    ...(initialBrandKitRevisionId !== undefined
      ? { initialBrandKitRevisionId }
      : {}),
    ...(onDraftCreated ? { onDraftCreated } : {}),
    pendingUploadCount: pendingDiagnostics.length,
    recoveryIdRef,
    setBrand,
    setOperationMessage,
    setResources,
    setState,
    setTitle,
    title,
    workspaceId,
  });
  const {
    active: saveConflictActive,
    draft: saveConflictDraft,
    error: saveConflictError,
    open: saveConflictOpen,
    resolving: saveConflictResolving,
  } = saveConflict;
  const fingerprintMatchesSaved =
    fingerprint === draftRuntime.lastSavedFingerprint;
  const effectiveSaveStatus = effectiveCanvasSaveStatusV1({
    fingerprintMatchesSaved,
    pendingUploadCount: pendingDiagnostics.length,
    status: saveStatus,
  });
  const navigate = useNavigate();
  const {
    canApplyCanvasOperations,
    canRunCanvasOperations,
    executableCapabilityTools,
    capabilityRunQuery,
  } = useCanvasOperationCatalogV1({
    canEdit,
    operationSession,
    permissions,
    workspaceId,
  });

  const { persistOperationSession, removeOperationSessionRecovery } =
    useCanvasOperationSessionStorageV1({
      fallbackRecoveryIdRef: operationFallbackRecoveryIdRef,
      finalizingOperationIdsRef,
      recoveryIdRef,
      setOperationSession,
      workspaceId,
    });
  const dispatchOperationSession = useCanvasOperationDispatcherV1({
    cancelPendingMessage: t("canvas.messages.cancelPending"),
    csrfToken,
    dispatchingOperationIdsRef,
    pendingCancellationIdsRef: pendingOperationCancellationIdsRef,
    persistOperationSession,
    setOperationMessage,
    workspaceId,
  });
  const startCanvasOperation = useCallback(
    async (
      tool: CanvasImageCapabilityTool,
      source?: CanvasOperationSessionV1["source"],
      parameters: Readonly<Record<string, unknown>> = {},
      outputDisposition?: CanvasOperationOutputMode,
    ) => {
      if (!canRunCanvasOperations) {
        setOperationMessage(t("canvas.messages.toolPermission"));
        return;
      }
      const previousSession =
        source === undefined ? operationSession : undefined;
      if (
        previousSession &&
        canvasOperationBlocksNewRunV1(previousSession.phase)
      ) {
        setOperationMessage(t("canvas.messages.operationBusy"));
        return;
      }
      const selected = activePage(state).nodes.find((node) =>
        state.selectedIds.includes(node.id),
      );
      const resolvedSource =
        source ??
        (selected?.kind === "image" && selected.image.source.kind === "artifact"
          ? {
              pageId: state.activePageId,
              nodeId: selected.id,
              artifactId: selected.image.source.artifactId,
              nodeFingerprint: JSON.stringify({
                pageId: state.activePageId,
                nodeId: selected.id,
                artifactId: selected.image.source.artifactId,
              }),
            }
          : undefined);
      if (!resolvedSource) {
        setOperationMessage(t("canvas.messages.selectUploadedImage"));
        return;
      }
      const supportedDisposition = preferredCanvasOutputDispositionV1(
        outputDisposition,
        tool.outputModes,
      );
      if (!supportedDisposition) {
        setOperationMessage(
          t("canvas.messages.unsupportedToolResult", {
            tool: tool.label,
          }),
        );
        return;
      }
      if (previousSession) {
        finalizingOperationIdsRef.current.add(previousSession.id);
        try {
          if (!isCanvasOperationFinalizationPhaseV1(previousSession.phase)) {
            await persistOperationSession(
              markCanvasOperationDiscardedV1(previousSession),
            );
          }
          await removeOperationSessionRecovery(previousSession.id);
          setOperationSession(undefined);
        } catch {
          finalizingOperationIdsRef.current.delete(previousSession.id);
          setOperationMessage(t("canvas.messages.operationCleanupError"));
          return;
        }
      }
      const session = createCanvasOperationSessionV1({
        assetAdoptionId: ulid(),
        workspaceId,
        tool,
        source: resolvedSource,
        parameters,
        outputDisposition: supportedDisposition,
      });
      setOperationMessage(undefined);
      setOperationPreviewError(undefined);
      try {
        await persistOperationSession(session);
        await dispatchOperationSession(session);
      } catch (error) {
        setOperationSession(undefined);
        setOperationMessage(
          canvasOperationUserMessageV1(
            error,
            t("canvas.messages.operationSaveError"),
          ),
        );
      }
    },
    [
      canRunCanvasOperations,
      dispatchOperationSession,
      operationSession,
      persistOperationSession,
      removeOperationSessionRecovery,
      state,
      t,
      workspaceId,
    ],
  );
  const openInspector = useCallback(
    (mode: CanvasInspectorModeV1, trigger: HTMLElement) => {
      commitPreview();
      inspectorTriggerRef.current = trigger;
      setActivePanel(undefined);
      setAssetPickerTask(undefined);
      setGroupIsolation(undefined);
      setImagePanelView(undefined);
      setMediaContentTarget(undefined);
      setInspectorMode((current) => toggleCanvasInspectorModeV1(current, mode));
    },
    [commitPreview],
  );
  const openImagePanel = useCallback(
    (view: CanvasImagePanelViewV1, trigger: HTMLElement) => {
      if (imagePanelView === "crop") {
        mutate({ type: "cancel_preview" });
        imageCropOriginNodeRef.current = undefined;
        setImageCropGesture(undefined);
        setImageCropFrameGesture(undefined);
      } else {
        commitPreview();
      }
      const selectedImage =
        selectedNodes.length === 1 && selectedNodes[0]?.kind === "image"
          ? selectedNodes[0]
          : undefined;
      if (view === "crop" && imagePanelView !== "crop" && selectedImage) {
        imageCropOriginNodeRef.current = selectedImage;
        setImageCropMode("free");
      }
      inspectorTriggerRef.current = trigger;
      setActivePanel(undefined);
      setAssetPickerTask(undefined);
      setGroupIsolation(undefined);
      setInspectorMode(undefined);
      setMediaContentTarget(undefined);
      setImagePanelView(imagePanelView === view ? undefined : view);
    },
    [commitPreview, imagePanelView, mutate, selectedNodes],
  );
  const closeImagePanel = useCallback(
    (restoreTrigger = true) => {
      const actualTrigger = inspectorTriggerRef.current;
      inspectorTriggerRef.current = null;
      if (imagePanelView === "crop") {
        mutate({ type: "cancel_preview" });
        imageCropOriginNodeRef.current = undefined;
        setImageCropGesture(undefined);
        setImageCropFrameGesture(undefined);
      } else {
        commitPreview();
      }
      setImagePanelView(undefined);
      if (!restoreTrigger) {
        return;
      }
      window.requestAnimationFrame(() => {
        const fallback = typeToolbarRef.current?.querySelector<HTMLElement>(
          '[data-canvas-action="edit-image"]',
        );
        canvasInspectorCloseTriggerV1(actualTrigger, fallback)?.focus({
          preventScroll: true,
        });
      });
    },
    [commitPreview, imagePanelView, mutate],
  );
  const closeInspector = useCallback(
    (restoreTrigger = true) => {
      const closingMode = inspectorMode;
      const actualTrigger = inspectorTriggerRef.current;
      inspectorTriggerRef.current = null;
      commitPreview();
      setInspectorMode(undefined);
      if (!restoreTrigger || !closingMode) {
        return;
      }
      window.requestAnimationFrame(() => {
        const triggerMode = closingMode === "layers" ? "position" : closingMode;
        const fallback = typeToolbarRef.current?.querySelector<HTMLElement>(
          `[data-canvas-inspector="${triggerMode}"]`,
        );
        canvasInspectorCloseTriggerV1(actualTrigger, fallback)?.focus({
          preventScroll: true,
        });
      });
    },
    [commitPreview, inspectorMode],
  );
  useEffect(() => {
    if (
      canvasSelectionChangeClosesOverlaysV1(
        previousSelectionIdsRef.current,
        state.selectedIds,
      )
    ) {
      if (imagePanelView === "crop") {
        mutate({ type: "cancel_preview" });
        imageCropOriginNodeRef.current = undefined;
        setImageCropGesture(undefined);
        setImageCropFrameGesture(undefined);
        setImagePanelView(undefined);
      } else {
        commitPreview();
      }
      setInspectorMode((mode) =>
        canvasInspectorModeAfterSelectionV1(mode, selectedNodes),
      );
      setMediaContentTarget((target) =>
        target && state.selectedIds.includes(target.nodeId)
          ? target
          : undefined,
      );
    }
    previousSelectionIdsRef.current = state.selectedIds;
  }, [commitPreview, imagePanelView, mutate, selectedNodes, state.selectedIds]);

  const insert = useCallback(
    (payload: EditorNodeInsertionPayload, point?: EditorPointV1): string => {
      const requestId = crypto.randomUUID();
      if (!canEdit) {
        return `insert:${requestId}`;
      }
      setState((current) =>
        applyEditorNodeInsertionV1(current, {
          requestId,
          payload,
          target: point
            ? {
                kind: "canvas_point",
                pageId: current.activePageId,
                point,
              }
            : {
                kind: "canvas_center",
                pageId: current.activePageId,
                visiblePageRect: {
                  x: 0,
                  y: 0,
                  width: activePage(current).width,
                  height: activePage(current).height,
                },
              },
        }),
      );
      return `insert:${requestId}`;
    },
    [canEdit],
  );

  const insertImage = useCallback(
    (
      payload: Extract<EditorNodeInsertionPayload, { kind: "image" }>,
      point?: EditorPointV1,
      target?: EditorNodeInsertionTarget,
    ) => {
      if (!canEdit) {
        return;
      }
      const requestId = crypto.randomUUID();
      setState((current) =>
        applyEditorNodeInsertionV1(current, {
          requestId,
          payload,
          target:
            target ??
            (point
              ? canvasImageInsertionTargetAtPointV1(activePage(current), point)
              : {
                  kind: "canvas_center",
                  pageId: current.activePageId,
                  visiblePageRect: {
                    x: 0,
                    y: 0,
                    width: activePage(current).width,
                    height: activePage(current).height,
                  },
                }),
        }),
      );
    },
    [canEdit],
  );

  const {
    addFiles,
    cancelUpload,
    hasPendingUploads,
    retryUpload,
    uploadItems,
  } = useCanvasImageUploadsV1({
    canEdit,
    createdUrls: createdUrlsRef,
    csrfToken,
    initialImportFiles,
    insertImage,
    mutate,
    onInitialImportFilesConsumed,
    recoveryId: recoveryIdRef,
    setOperationMessage,
    setResources,
    setSaveError,
    setState,
    setTitle,
    state,
    t,
    title,
    workspaceId,
  });

  const insertWorkspaceAsset = useCallback(
    async (
      asset: {
        readonly id?: string;
        readonly name: string;
        readonly currentArtifact?: { readonly id: string };
      },
      point?: EditorPointV1,
      target?: EditorNodeInsertionTarget,
    ) => {
      const artifact = asset.currentArtifact;
      if (!artifact) {
        throw new Error(t("canvas.messages.assetFileMissing"));
      }
      const existing = resources.get(artifact.id);
      const existingQuality =
        existing?.sourceQuality ??
        (existing?.sourceUrl ? "original" : undefined);
      let sourceUrl = existing?.sourceUrl;
      if (!sourceUrl) {
        const preview = await queryClient.fetchQuery(
          artifactPreviewQueryOptionsV1(workspaceId, artifact.id),
        );
        sourceUrl = URL.createObjectURL(preview);
        createdUrlsRef.current.add(sourceUrl);
      }
      const intrinsicSize = await readCanvasImageUrlSize(sourceUrl);
      setResources((current) => {
        const next = new Map(current);
        next.set(artifact.id, {
          artifactId: artifact.id,
          sourceQuality: existingQuality ?? "preview",
          sourceUrl,
          sourceUnavailable: false,
        });
        return next;
      });
      const payload = {
        kind: "image" as const,
        source: {
          kind: "artifact" as const,
          reference: {
            kind: "artifact" as const,
            artifactId: artifact.id,
            ...(asset.id ? { assetId: asset.id } : {}),
          },
        },
        intrinsicSize,
      };
      if (target) {
        setState((current) =>
          applyEditorNodeInsertionV1(current, {
            requestId: crypto.randomUUID(),
            payload,
            target,
          }),
        );
      } else if (point) {
        insertImage(payload, point);
      } else {
        insert(payload);
      }
      if (existingQuality !== "original") {
        void downloadArtifact(workspaceId, artifact.id)
          .then((blob) => {
            const originalUrl = URL.createObjectURL(blob);
            createdUrlsRef.current.add(originalUrl);
            setResources((current) => {
              const next = new Map(current);
              next.set(artifact.id, {
                artifactId: artifact.id,
                sourceQuality: "original",
                sourceUrl: originalUrl,
                sourceUnavailable: false,
              });
              return next;
            });
          })
          .catch(() => undefined);
      }
    },
    [insert, insertImage, queryClient, resources, t, workspaceId],
  );

  const insertBrandLogo = useCallback(
    async (logo: BrandKitLogo): Promise<void> => {
      await insertWorkspaceAsset({
        id: logo.assetId,
        name: logo.name,
        currentArtifact: { id: logo.artifactId },
      });
      focusStageAfterPanelAction();
    },
    [focusStageAfterPanelAction, insertWorkspaceAsset],
  );

  const insertExternalImagePreview = useCallback(
    (candidate: ResourceImageCandidate): string | undefined => {
      const previewId = crypto.randomUUID();
      const payload = canvasExternalImagePreviewInsertionV1(
        candidate,
        previewId,
      );
      if (!payload) return undefined;
      insertImage(payload);
      focusStageAfterPanelAction();
      return previewId;
    },
    [focusStageAfterPanelAction, insertImage],
  );

  const failExternalImagePreview = useCallback(
    (previewId?: string): void => {
      if (previewId) mutate({ type: "fail_local_image", localId: previewId });
    },
    [mutate],
  );

  const offerExternalImageAssetSave = useCallback(
    (artifactId: string, name: string): void => {
      const assetId = ulid();
      const key = `external-asset:${artifactId}`;
      const save = async (): Promise<void> => {
        notification.info({
          actions: (
            <Button disabled loading size="small">
              {t("canvas.messages.saveExternalAsset")}
            </Button>
          ),
          duration: false,
          key,
          placement: "bottomRight",
          role: "status",
          title: t("canvas.messages.externalAssetSaving"),
        });
        try {
          await createWorkspaceAssetFromArtifact(
            { csrfToken, workspaceId },
            { artifactId, assetId, name },
          );
          await queryClient.invalidateQueries({
            queryKey: ["workspace-assets", workspaceId],
          });
          notification.success({
            duration: 4.5,
            key,
            placement: "bottomRight",
            role: "status",
            title: t("canvas.messages.externalAssetSaved", { name }),
          });
        } catch {
          notification.error({
            actions: (
              <Button
                onClick={() => {
                  void save();
                }}
                size="small"
                type="primary"
              >
                {t("canvas.messages.saveExternalAsset")}
              </Button>
            ),
            description: t("canvas.messages.externalAssetSaveError"),
            duration: false,
            key,
            placement: "bottomRight",
            role: "alert",
            title: t("canvas.messages.externalAdded", { name }),
          });
        }
      };
      notification.success({
        actions: (
          <Button
            onClick={() => {
              void save();
            }}
            size="small"
            type="primary"
          >
            {t("canvas.messages.saveExternalAsset")}
          </Button>
        ),
        duration: false,
        key,
        placement: "bottomRight",
        role: "status",
        title: t("canvas.messages.externalAdded", { name }),
      });
    },
    [csrfToken, notification, queryClient, t, workspaceId],
  );

  const insertAdoptedExternalImage = useCallback(
    async (
      result: ResourceAdoptionResult,
      candidate: ResourceImageCandidate,
      previewId?: string,
    ): Promise<void> => {
      if (result.kind !== "artifact") {
        throw new Error(t("canvas.messages.assetInsertError"));
      }
      if (previewId) {
        mutate({
          type: "commit_local_image",
          localId: previewId,
          reference: {
            kind: "artifact",
            artifactId: result.artifactId,
          },
        });
        setResources((current) => {
          const next = new Map(current);
          next.set(result.artifactId, {
            artifactId: result.artifactId,
            sourceQuality: "preview",
            sourceUrl: candidate.preview.url,
            sourceUnavailable: false,
          });
          return next;
        });
        void downloadArtifact(workspaceId, result.artifactId)
          .then((blob) => {
            const originalUrl = URL.createObjectURL(blob);
            createdUrlsRef.current.add(originalUrl);
            setResources((current) => {
              const next = new Map(current);
              next.set(result.artifactId, {
                artifactId: result.artifactId,
                sourceQuality: "original",
                sourceUrl: originalUrl,
                sourceUnavailable: false,
              });
              return next;
            });
          })
          .catch(() => undefined);
        offerExternalImageAssetSave(result.artifactId, candidate.title);
        return;
      }
      await insertWorkspaceAsset({
        name: candidate.title,
        currentArtifact: { id: result.artifactId },
      });
      focusStageAfterPanelAction();
      offerExternalImageAssetSave(result.artifactId, candidate.title);
    },
    [
      focusStageAfterPanelAction,
      insertWorkspaceAsset,
      mutate,
      offerExternalImageAssetSave,
      t,
      workspaceId,
    ],
  );

  const pickAssets = useCallback(
    async (
      assets: readonly WorkspaceAssetSummary[],
      intent: WorkspaceAssetPickIntent,
    ): Promise<WorkspaceAssetPickResult> => {
      focusStageAfterPanelAction();
      const succeededIds: string[] = [];
      const failed: Array<{
        readonly assetId: string;
        readonly message: string;
      }> = [];
      let selectedNodeId: string | undefined;
      if (assetPickerTask?.intent === "replace") {
        selectedNodeId = assetPickerTask.nodeId;
      } else if (state.selectedIds.length === 1) {
        selectedNodeId = state.selectedIds[0];
      }
      const selectedNode = selectedNodeId
        ? activePage(state).nodes.find((node) => node.id === selectedNodeId)
        : undefined;
      let insertionTarget: EditorNodeInsertionTarget | undefined;
      try {
        insertionTarget = canvasAssetInsertionTargetV1({
          intent,
          ...(assetPickerTask?.intent === "fill"
            ? { mediaTarget: assetPickerTask.mediaTarget }
            : {}),
          pageId: state.activePageId,
          ...(selectedNode ? { selectedNode } : {}),
        });
      } catch (error) {
        return {
          failed: assets.map((asset) => ({
            assetId: asset.id,
            message:
              error instanceof Error
                ? error.message
                : t("canvas.messages.assetInsertError"),
          })),
          succeededIds,
        };
      }
      for (const asset of intent === "add" ? assets : assets.slice(0, 1)) {
        try {
          await insertWorkspaceAsset(asset, undefined, insertionTarget);
          succeededIds.push(asset.id);
        } catch (error) {
          failed.push({
            assetId: asset.id,
            message:
              error instanceof Error
                ? error.message
                : t("canvas.messages.assetInsertError"),
          });
        }
      }
      if (assetPickerTask && succeededIds.length > 0) {
        setAssetPickerTask(undefined);
        if (assetPickerTask.intent === "fill") {
          setMediaContentTarget(assetPickerTask.mediaTarget);
        } else if (assetPickerTask.intent === "replace") {
          setImagePanelView("home");
        } else {
          setActivePanel("design");
        }
      }
      return { succeededIds, failed };
    },
    [
      focusStageAfterPanelAction,
      insertWorkspaceAsset,
      assetPickerTask,
      state,
      t,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const durableRecoveryId = recoveryIdRef.current;
    const pendingRecoveryId = operationFallbackRecoveryIdRef.current;
    void Promise.all([
      listCanvasOperationSessionsV1(workspaceId, durableRecoveryId),
      pendingRecoveryId && pendingRecoveryId !== durableRecoveryId
        ? listCanvasOperationSessionsV1(workspaceId, pendingRecoveryId)
        : Promise.resolve([]),
    ])
      .then(async ([storedSessions, storedPendingSessions]) => {
        if (cancelled) {
          return;
        }
        const normalizeRecoveredSession = (session: CanvasOperationSessionV1) =>
          normalizeCanvasOperationAutoApplyRecoveryV1({
            session,
            document: getOperationRecoveryDocument(),
            conflictMessage: t("canvas.messages.sourceChangedConflict"),
          });
        const sessions = storedSessions.map(normalizeRecoveredSession);
        const pendingSessions = storedPendingSessions.map(
          normalizeRecoveredSession,
        );
        const pendingResumable = pendingSessions.filter(
          (session) =>
            canvasOperationSessionRecoverableV1(session) &&
            (session.phase === "conflict" ||
              (session.phase === "applied" &&
                session.completionBehavior === "auto_replace_safe") ||
              canvasOperationSourceCompatibilityV1(
                session,
                currentCanvasOperationSourceV1(
                  getOperationRecoveryDocument(),
                  session,
                ),
              ) === "compatible"),
        );
        const resumable = [...sessions, ...pendingResumable]
          .filter(canvasOperationSessionRecoverableV1)
          .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          )[0];
        if (resumable) {
          await saveCanvasOperationSessionV1({
            workspaceId,
            recoveryId: durableRecoveryId,
            session: resumable,
          });
        }
        if (
          pendingRecoveryId &&
          pendingRecoveryId !== durableRecoveryId &&
          resumable &&
          pendingSessions.some((session) => session.id === resumable.id)
        ) {
          await removeCanvasOperationSessionV1(
            workspaceId,
            pendingRecoveryId,
            resumable.id,
          );
        }
        if (resumable) {
          setOperationSession(resumable);
          if (resumable.phase === "starting" && !resumable.capabilityRunId) {
            void dispatchOperationSession(resumable);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOperationMessage(t("canvas.messages.operationRecoveryError"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dispatchOperationSession, initialDraft, t, workspaceId]);

  useCanvasOperationRunReconciliationV1({
    cleanupErrorMessage: t("canvas.messages.operationCleanupError"),
    operationSession,
    persistOperationSession,
    recoverySaveErrorMessage: t("canvas.messages.operationRecoverySaveError"),
    removeOperationSessionRecovery,
    setOperationMessage,
    capabilityRun: capabilityRunQuery.data,
  });

  const previewArtifactId = operationSession?.previewArtifactId;
  const previewMaskArtifactId = operationSession?.previewMaskArtifactId;
  useCanvasOperationPreviewResourcesV1({
    createdUrlsRef,
    maskArtifactId: previewMaskArtifactId,
    maskUrlAvailable: Boolean(
      previewMaskArtifactId && resources.get(previewMaskArtifactId)?.sourceUrl,
    ),
    phase: operationSession?.phase,
    previewArtifactId,
    previewUrlAvailable: Boolean(
      previewArtifactId && resources.get(previewArtifactId)?.sourceUrl,
    ),
    reloadRevision: operationArtifactReloadRevision,
    setOperationPreviewError,
    setResources,
    unavailableMessage: t("canvas.messages.operationPreviewError"),
    workspaceId,
  });

  useEffect(() => {
    const createdUrls = createdUrlsRef.current;
    return () => {
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const hasUnsavedWork =
    fingerprint !== draftRuntime.lastSavedFingerprint ||
    pendingDiagnostics.length > 0 ||
    effectiveSaveStatus === "saving" ||
    effectiveSaveStatus === "error";

  const closePendingOperationTool = useCallback(() => {
    setPendingOperationTool(undefined);
  }, []);
  const cancelImageCropToHome = useCallback(() => {
    mutate({ type: "cancel_preview" });
    imageCropOriginNodeRef.current = undefined;
    setImageCropGesture(undefined);
    setImageCropFrameGesture(undefined);
    setImagePanelView("home");
  }, [mutate]);
  const showImagePanelHome = useCallback(() => {
    setImagePanelView("home");
  }, []);
  const showActualSize = useCallback(() => {
    setViewportMode("manual");
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [setPan, setViewportMode, setZoom]);
  const dismissCanvasUi = useCallback(() => {
    commitPreview();
    setActivePanel(undefined);
    setActiveQuickTool("select");
    cancelDrawing();
    closeContextMenu();
    setInspectorMode(undefined);
    setImagePanelView(undefined);
    setShortcutsOpen(false);
    setPendingOperationTool(undefined);
    mutate({ type: "clear_selection" });
    window.requestAnimationFrame(() => {
      stageElement?.focus();
    });
  }, [cancelDrawing, closeContextMenu, commitPreview, mutate, stageElement]);
  const { duplicateSelected } = useCanvasKeyboardShortcutsV1({
    addFiles,
    canEdit,
    closeImagePanel,
    closeInspector,
    commitPreview,
    contextMenuOpen: Boolean(contextMenu),
    fitViewport,
    imagePanelView,
    insert,
    inspectorOpen: Boolean(inspectorMode),
    mutate,
    onCloseContextMenu: closeContextMenu,
    onClosePendingOperationTool: closePendingOperationTool,
    onCancelImageCrop: cancelImageCropToHome,
    onDismissCanvasUi: dismissCanvasUi,
    onShowImagePanelHome: showImagePanelHome,
    pendingOperationToolOpen: Boolean(pendingOperationTool),
    selectionHasLocked,
    setShortcutsOpen,
    setSpaceHeld,
    setState,
    shortcutsOpen,
    shortcutsTrigger: shortcutsTriggerRef,
    showActualSize,
    stage,
    state,
    t,
    typeToolbar: typeToolbarRef,
  });

  const replaceNode = (node: EditorRuntimeNodeV1) => {
    const current = topLevelNode(durablePage, node.id);
    if (!canEdit || (current?.locked && current.locked === node.locked)) {
      return;
    }
    mutate({ type: "replace_node", node });
  };
  const previewNode = (node: EditorRuntimeNodeV1) => {
    const current = topLevelNode(durablePage, node.id);
    if (!canEdit || current?.locked) {
      return;
    }
    mutate({ type: "preview_replace_node", node });
  };
  const finishTextEditing = (commit: boolean) => {
    if (!editingText) {
      return;
    }
    if (commit) {
      const node = topLevelNode(durablePage, editingText.nodeId);
      if (node && shapeTextNodeForEditingV1(node)) {
        replaceNode(nodeWithEditedTextV1(node, editingText.value));
      }
    }
    setEditingText(undefined);
    window.requestAnimationFrame(() => {
      focusCanvasStageAfterPanelActionV1(stage.current);
    });
  };
  const connectTextEditor = useCallback(
    (editor: HTMLTextAreaElement | null) => {
      focusCanvasTextEditorAtEndV1(editor);
    },
    [],
  );

  const selected = selectedNodes[0];
  const imageCropSourcePreviewNode =
    imagePanelView === "crop" && selected?.kind === "image"
      ? canvasImageCropSourcePreviewNodeV1(selected)
      : undefined;
  const canvasRenderedPage = imageCropSourcePreviewNode
    ? {
        ...renderedPage,
        nodes: renderedPage.nodes.map((node) =>
          node.id === imageCropSourcePreviewNode.id
            ? imageCropSourcePreviewNode
            : node,
        ),
      }
    : renderedPage;
  const beginImageCropPan = (event: PointerEvent<SVGRectElement>) => {
    if (
      !canEdit ||
      imagePanelView !== "crop" ||
      selected?.kind !== "image" ||
      selected.locked
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setImageCropGesture({
      node: selected,
      pointerId: event.pointerId,
      start: pagePoint(event.clientX, event.clientY),
    });
    event.preventDefault();
    event.stopPropagation();
  };
  const updateImageCropPan = (event: PointerEvent<SVGRectElement>) => {
    if (!imageCropGesture || event.pointerId !== imageCropGesture.pointerId) {
      return;
    }
    const point = pagePoint(event.clientX, event.clientY);
    previewNode(
      canvasImageNodeWithCropFrameMoveV1(imageCropGesture.node, {
        x: point.x - imageCropGesture.start.x,
        y: point.y - imageCropGesture.start.y,
      }),
    );
    event.preventDefault();
    event.stopPropagation();
  };
  const finishImageCropPan = (event: PointerEvent<SVGRectElement>) => {
    if (!imageCropGesture || event.pointerId !== imageCropGesture.pointerId) {
      return;
    }
    setImageCropGesture(undefined);
    event.preventDefault();
    event.stopPropagation();
  };
  const beginImageCropFrameResize = (
    event: PointerEvent<SVGRectElement>,
    handle: EditorResizeHandleV1,
  ) => {
    if (
      !canEdit ||
      imagePanelView !== "crop" ||
      imageCropMode !== "free" ||
      selected?.kind !== "image" ||
      selected.locked
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setImageCropFrameGesture({
      handle,
      node: selected,
      pointerId: event.pointerId,
    });
    event.preventDefault();
    event.stopPropagation();
  };
  const updateImageCropFrameResize = (event: PointerEvent<SVGRectElement>) => {
    if (
      !imageCropFrameGesture ||
      event.pointerId !== imageCropFrameGesture.pointerId
    ) {
      return;
    }
    previewNode(
      canvasImageNodeWithFreeCropFrameV1(
        imageCropFrameGesture.node,
        imageCropFrameGesture.handle,
        pagePoint(event.clientX, event.clientY),
      ),
    );
    event.preventDefault();
    event.stopPropagation();
  };
  const finishImageCropFrameResize = (event: PointerEvent<SVGRectElement>) => {
    if (
      !imageCropFrameGesture ||
      event.pointerId !== imageCropFrameGesture.pointerId
    ) {
      return;
    }
    setImageCropFrameGesture(undefined);
    event.preventDefault();
    event.stopPropagation();
  };
  let rotationReadoutPoint:
    { readonly x: number; readonly y: number } | undefined;
  if (selected?.kind === "line" && selected.role === "design") {
    rotationReadoutPoint = canvasLineRotationHandleV1(
      selected,
      rotationReadoutOffset / zoom,
    ).handle;
  } else if (selected) {
    rotationReadoutPoint = {
      x: selected.transform.x + selected.transform.width / 2,
      y:
        selected.transform.y +
        selected.transform.height +
        rotationReadoutOffset / zoom,
    };
  }
  const selectedImagePreviewUrl = selectedCanvasImagePreviewUrlV1(
    selected,
    (artifactId) => resources.get(artifactId)?.sourceUrl,
  );
  const operationSource = operationSession
    ? currentCanvasOperationSourceV1(state.document, operationSession)
    : undefined;
  const processingSourceNode =
    operationSession &&
    (operationSession.phase === "starting" ||
      operationSession.phase === "running") &&
    operationSession.source.pageId === durablePage.id
      ? topLevelNode(durablePage, operationSession.source.nodeId)
      : undefined;
  const operationSourceCompatibility = operationSession
    ? canvasOperationSourceCompatibilityV1(operationSession, operationSource)
    : "missing";
  const operationPreviewUrl = operationSession?.previewArtifactId
    ? resources.get(operationSession.previewArtifactId)?.sourceUrl
    : undefined;
  const operationSurfaceProjection = canvasOperationSurfaceProjectionV1(
    operationSession,
    operationSourceCompatibility,
  );
  const operationReviewSession =
    operationSurfaceProjection.surface === "review"
      ? operationSession
      : undefined;
  const operationGlobalStatusSession =
    operationSurfaceProjection.surface === "global_status"
      ? operationSession
      : undefined;
  const operationReviewOpen = canvasOperationReviewOpenV1(
    operationSurfaceProjection,
    operationReviewSession?.id,
    reviewDismissedSessionId,
  );
  const operationStatusError = capabilityRunQuery.isError
    ? canvasOperationStatusFailureMessageV1(
        capabilityRunQuery.error,
        "run",
        (key) => t(key),
      )
    : undefined;
  const operationMaskUrl = operationSession?.previewMaskArtifactId
    ? resources.get(operationSession.previewMaskArtifactId)?.sourceUrl
    : undefined;
  const operationSourceUrl = operationSession
    ? resources.get(operationSession.source.artifactId)?.sourceUrl
    : undefined;
  const restoreOperationTriggerFocus = (session: CanvasOperationSessionV1) => {
    const currentSource = currentCanvasOperationSourceV1(
      state.document,
      session,
    );
    if (currentSource && currentSource.pageId === state.activePageId) {
      mutate({
        type: "select",
        id: currentSource.nodeId,
      });
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const trigger = typeToolbarRef.current?.querySelector<HTMLElement>(
          '[data-canvas-action="edit-image"]',
        );
        (trigger ?? stage.current)?.focus();
      });
    });
  };
  const discardCanvasOperation = async () => {
    const session = operationSession;
    if (!session) {
      return;
    }
    setOperationBusy(true);
    try {
      finalizingOperationIdsRef.current.add(session.id);
      if (session.phase === "applied") {
        await removeOperationSessionRecovery(session.id);
        setOperationSession(undefined);
        restoreOperationTriggerFocus(session);
        return;
      }
      const discarded = markCanvasOperationDiscardedV1(session);
      await persistOperationSession(discarded);
      await removeOperationSessionRecovery(session.id);
      setOperationSession(undefined);
      restoreOperationTriggerFocus(session);
    } finally {
      setOperationBusy(false);
    }
  };
  const cancelCanvasOperation = async () => {
    if (!operationSession) {
      return;
    }
    if (!operationSession.capabilityRunId) {
      pendingOperationCancellationIdsRef.current.add(operationSession.id);
      setOperationBusy(true);
      try {
        await persistOperationSession(
          requestCanvasOperationCancellationV1(operationSession),
        );
        setOperationMessage(t("canvas.messages.cancelQueued"));
      } catch {
        setOperationMessage(t("canvas.messages.cancelQueuedTemporary"));
      } finally {
        setOperationBusy(false);
      }
      return;
    }
    setOperationBusy(true);
    try {
      await cancelCapabilityRun(
        {
          csrfToken,
          workspaceId,
        },
        operationSession.capabilityRunId,
        `canvas-cancel:${operationSession.id}`,
      );
      await capabilityRunQuery.refetch();
    } catch {
      setOperationMessage(t("canvas.messages.cancelPending"));
    } finally {
      setOperationBusy(false);
    }
  };
  const sourceDeletionCancellationPending = Boolean(
    operationSession &&
    (operationSession.phase === "starting" ||
      operationSession.phase === "running") &&
    !currentCanvasOperationSourceV1(state.document, operationSession),
  );
  const cancelCanvasOperationEvent = useEffectEvent(cancelCanvasOperation);
  useEffect(() => {
    const session = operationSession;
    if (
      !session ||
      !sourceDeletionCancellationPending ||
      sourceDeletionCancellationIdsRef.current.has(session.id)
    ) {
      return;
    }
    sourceDeletionCancellationIdsRef.current.add(session.id);
    void cancelCanvasOperationEvent();
  }, [operationSession, sourceDeletionCancellationPending]);
  const retryCanvasOperation = async () => {
    const session = operationSession;
    if (!session) {
      return;
    }
    if (!canRunCanvasOperations) {
      setOperationMessage(t("canvas.messages.operationRetryForbidden"));
      return;
    }
    if (
      session.phase === "failed" &&
      !session.capabilityRunId &&
      session.failure?.code === "canvas_operation_start_failed"
    ) {
      const retrying = retryCanvasOperationStartV1(session);
      setOperationMessage(undefined);
      await persistOperationSession(retrying);
      await dispatchOperationSession(retrying);
      return;
    }
    const tool = executableCapabilityTools.find(
      (candidate) => candidate.id === session.toolId,
    );
    if (!tool) {
      setOperationMessage(t("canvas.messages.toolUnavailable"));
      return;
    }
    const currentSource = currentCanvasOperationSourceV1(
      state.document,
      session,
    );
    await discardCanvasOperation();
    await startCanvasOperation(
      tool,
      currentSource
        ? {
            ...currentSource,
            nodeFingerprint: JSON.stringify(currentSource),
          }
        : session.source,
      session.parameters,
      session.outputDisposition,
    );
  };
  const applyCanvasOperationCore = async (
    disposition: "add_node" | "replace_content" | "set_background",
  ) => {
    try {
      await applyCanvasOperationPreviewV1(
        {
          ...(draftIdRef.current
            ? { authoritativeDraftId: draftIdRef.current }
            : {}),
          createdUrls: createdUrlsRef.current,
          ...(draftVersionRef.current
            ? { currentDraftVersion: draftVersionRef.current }
            : {}),
          effectiveSaveStatus,
          finalizingOperationIds: finalizingOperationIdsRef.current,
          getLatestRuntime: () => latestCanvasRuntimeRef.current,
          initialState: state,
          mutate,
          pendingDiagnosticsLength: pendingDiagnostics.length,
          persistOperationSession,
          ...(operationPreviewUrl ? { previewUrl: operationPreviewUrl } : {}),
          ...(operationSession ? { session: operationSession } : {}),
          setDraftSaveError,
          setOperationMessage,
          setOperationSession,
          setResources,
          setSaveStatus,
          setState,
          setTitle,
          t,
          updateDraftRuntime,
          workspaceId,
        },
        disposition,
      );
    } finally {
      setOperationBusy(false);
    }
  };
  const applyCanvasOperation = async (
    disposition: "add_node" | "replace_content" | "set_background",
  ) => {
    if (
      !operationSession ||
      !operationSession.previewArtifactId ||
      !operationPreviewUrl
    ) {
      return;
    }
    setOperationBusy(true);
    await applyCanvasOperationCore(disposition);
  };
  const applyCanvasOperationFromEffect = useEffectEvent(
    applyCanvasOperationCore,
  );
  useEffect(() => {
    const session = operationSession;
    if (!session) {
      return;
    }
    const decision = canvasOperationAutoApplyDecisionV1({
      canEdit,
      document: state.document,
      previewUrlReady: Boolean(operationPreviewUrl),
      session,
    });
    if (autoApplyAttemptedOperationIdsRef.current.has(session.id)) {
      return;
    }
    if (decision === "review") {
      return;
    }
    autoApplyAttemptedOperationIdsRef.current.add(session.id);
    if (decision === "reconcile_applied") {
      finalizingOperationIdsRef.current.add(session.id);
      void persistOperationSession(markCanvasOperationAppliedV1(session))
        .then(() => {
          setOperationMessage(t("canvas.messages.autoApplied"));
        })
        .catch(() => {
          finalizingOperationIdsRef.current.delete(session.id);
        });
      return;
    }
    void applyCanvasOperationFromEffect("replace_content");
  }, [
    canEdit,
    operationPreviewUrl,
    operationSession,
    persistOperationSession,
    state.document,
    t,
  ]);
  const saveCanvasOperationAsset = async () => {
    const session = operationSession;
    const artifactId = session?.previewArtifactId;
    if (!session || !artifactId) {
      return;
    }
    setOperationBusy(true);
    try {
      const pinnedSession = session.assetAdoptionId
        ? session
        : pinCanvasOperationAssetAdoptionV1(session, ulid());
      // Persist the pinned identity before adoption. A lost Asset
      // response can then be replayed after refresh without creating
      // a second Asset.
      await persistOperationSession(pinnedSession);
      const assetId = pinnedSession.assetAdoptionId!;
      await createWorkspaceAssetFromArtifact(
        {
          workspaceId,
          csrfToken,
        },
        {
          assetId,
          artifactId,
          name: t("canvas.names.operationResult", {
            name: session.label,
          }),
        },
      );
      const savedSession = markCanvasOperationAssetSavedV1(
        pinnedSession,
        assetId,
      );
      await persistOperationSession(savedSession);
      await queryClient.invalidateQueries({
        queryKey: ["workspace-assets", workspaceId],
      });
      setOperationMessage(
        t("canvas.messages.resultSaved", {
          name: session.label,
        }),
      );
    } catch (error) {
      setOperationMessage(
        canvasOperationUserMessageV1(
          error,
          t("canvas.messages.resultSaveError"),
        ),
      );
    } finally {
      setOperationBusy(false);
    }
  };
  const selectedTextNode = selected ? editableTextNodeV1(selected) : undefined;
  const brandColorTarget = canvasBrandColorTargetV1(selectedNodes);
  const applyBrandColor = (color: string): void => {
    if (
      brandColorTarget === "text" &&
      selected &&
      selectedTextNode &&
      selected.kind === "text"
    ) {
      replaceNode(
        nodeWithTextNodeV1(
          selected,
          mapTextNodeRuns(selectedTextNode, (run) => ({
            ...run,
            fill: { kind: "solid", color },
          })),
        ),
      );
      return;
    }
    if (brandColorTarget === "shape" && selected?.kind === "shape") {
      replaceNode({
        ...selected,
        fill: { kind: "solid", color },
      });
      return;
    }
    setBackgroundColor(color);
  };
  const selectedTextFormatting = selectedTextNode
    ? canvasTextFormattingV1(selectedTextNode)
    : undefined;
  const selectedGraphicDefinition =
    selected?.kind === "graphic" && selected.source.kind === "catalog"
      ? canvasGraphicDefinitionV1(
          selected.source.catalogId,
          selected.source.resourceId,
          selected.source.revision,
        )
      : undefined;
  const ensureCanvasExportSnapshot = useCallback(async () => {
    if (pendingDiagnostics.length > 0) {
      throw new Error(t("canvas.messages.exportWaitUploads"));
    }
    await saveQueueRef.current.catch(() => undefined);
    if (saveConflictActive) {
      throw new Error(t("canvas.messages.exportResolveConflict"));
    }
    if (
      !draftIdRef.current ||
      fingerprint !== lastSavedFingerprintRef.current
    ) {
      await persistCanvasDraft(
        fingerprint,
        createEditorDraftContentV1(state.document, title),
      );
    }
    if (
      !draftIdRef.current ||
      !draftVersionRef.current ||
      fingerprint !== lastSavedFingerprintRef.current
    ) {
      throw new Error(t("canvas.messages.exportWaitSave"));
    }
    return {
      canvasDraftId: draftIdRef.current,
      documentVersion: draftVersionRef.current,
    };
  }, [
    fingerprint,
    draftIdRef,
    draftVersionRef,
    lastSavedFingerprintRef,
    pendingDiagnostics.length,
    persistCanvasDraft,
    saveQueueRef,
    saveConflictActive,
    state.document,
    t,
    title,
  ]);
  const canvasExport = useCanvasExportV1({
    activePageId: state.activePageId,
    canDownloadExport,
    canExport,
    csrfToken,
    document: state.document,
    draftId: draftIdRef,
    ensureSnapshot: ensureCanvasExportSnapshot,
    title,
    workspaceId,
  });

  const restoreRevision = async (version: number) => {
    if (!draftIdRef.current || !draftVersionRef.current) {
      throw new Error(t("canvas.messages.historyRequiresSave"));
    }
    setHistoryRestoring(true);
    try {
      const result = await restoreCanvasDraft(
        {
          csrfToken,
          workspaceId,
        },
        draftIdRef.current,
        {
          expectedVersion: draftVersionRef.current,
          sourceVersion: version,
        },
      );
      const hydrated = await hydrateEditorRuntimeDocumentV1(
        result.draft.document,
        async (artifactId) => {
          const blob = await downloadArtifact(workspaceId, artifactId);
          const url = URL.createObjectURL(blob);
          createdUrlsRef.current.add(url);
          return url;
        },
      );
      const next = createEditorStateV1(hydrated.document);
      setState(next);
      setResources(hydrated.resources);
      setTitle(result.draft.document.title);
      setBrand(result.draft.brand);
      updateDraftRuntime({
        lastSavedFingerprint: JSON.stringify({
          title: result.draft.document.title,
          document: hydrated.document,
        }),
        version: result.draft.version,
      });
      setSaveStatus("saved");
      setHistoryOpen(false);
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : t("canvas.shell.restoreError"),
        { cause: error },
      );
    } finally {
      setHistoryRestoring(false);
    }
  };

  const exitCanvas = async () => {
    exitRequestedRef.current = true;
    if (pendingDiagnostics.length > 0) {
      setSaveStatus("uploading");
      setSaveError(t("canvas.shell.pendingUploadExit"));
      exitRequestedRef.current = false;
      return;
    }
    try {
      await saveQueueRef.current.catch(() => undefined);
      if (
        !draftIdRef.current ||
        fingerprint !== lastSavedFingerprintRef.current
      ) {
        await persistCanvasDraft(
          fingerprint,
          createEditorDraftContentV1(state.document, title),
        );
      }
      await queryClient.invalidateQueries({
        queryKey: ["canvas-drafts", workspaceId],
      });
      canvasNavigationCommittedRef.current = true;
      if (onExit) {
        onExit();
      } else if (returnTo) {
        window.location.assign(returnTo);
      } else {
        await navigate({
          params: { workspaceId },
          to: "/w/$workspaceId",
        });
      }
    } catch {
      canvasNavigationCommittedRef.current = false;
      exitRequestedRef.current = false;
    }
  };

  const saveStatusMessage = t(
    canvasSaveStatusMessageKeyV1(canEdit, effectiveSaveStatus),
  );
  let imagePanelOnBack: (() => void) | undefined;
  if (pendingOperationTool) {
    imagePanelOnBack = () => {
      setPendingOperationTool(undefined);
      setImagePanelView("home");
    };
  } else if (imagePanelView && imagePanelView !== "home") {
    imagePanelOnBack =
      imagePanelView === "crop"
        ? cancelImageCropToHome
        : () => {
            commitPreview();
            setImagePanelView("home");
          };
  }
  let imagePanelTitle = t("canvas.image.title");
  if (pendingOperationTool) {
    imagePanelTitle = pendingOperationTool.label;
  } else if (imagePanelView && imagePanelView !== "home") {
    imagePanelTitle = t(`canvas.image.sections.${imagePanelView}`);
  }
  const resolveSaveConflict = () => {
    dispatchSaveConflict({ type: "activate" });
    if (!saveConflictDraft) {
      void readLatestSaveConflict().catch(() => undefined);
    }
  };
  const updateSaveConflictDialogVisibility = (open: boolean) => {
    dispatchSaveConflict({ type: open ? "activate" : "close_dialog" });
  };
  const retryDraftSave = () => {
    void persistCanvasDraft(
      fingerprint,
      createEditorDraftContentV1(state.document, title),
    ).catch(() => undefined);
  };
  const handleWorkspaceDrop = (event: DragEvent<HTMLElement>) => {
    if (!canEdit) {
      return;
    }
    const point = pagePoint(event.clientX, event.clientY);
    if (event.dataTransfer.files.length > 0) {
      event.preventDefault();
      setDropActive(false);
      void addFiles([...event.dataTransfer.files], point);
      return;
    }
    const asset = draggedAssetRef.current;
    if (asset) {
      event.preventDefault();
      setDropActive(false);
      draggedAssetRef.current = null;
      void insertWorkspaceAsset(asset, point).catch((error: unknown) => {
        setSaveError(
          error instanceof Error
            ? error.message
            : t("canvas.shell.assetInsertError"),
        );
      });
      return;
    }
    const catalogNode = draggedCatalogNodeRef.current;
    if (catalogNode) {
      event.preventDefault();
      setDropActive(false);
      draggedCatalogNodeRef.current = null;
      insert(catalogNode, point);
    }
  };
  const handleExitCanvas = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void exitCanvas();
  };
  const continueInAgent = () => {
    if (!draftRuntime.id || !draftRuntime.version) return;
    canvasNavigationCommittedRef.current = true;
    const relatedThreadId = returnTo
      ? new RegExp(
          `^/w/${workspaceId}/agent/([0-7][0-9A-HJKMNP-TV-Z]{25})$`,
          "u",
        ).exec(returnTo)?.[1]
      : undefined;
    void navigate({
      params: relatedThreadId
        ? { workspaceId, threadId: relatedThreadId }
        : { workspaceId },
      search: {
        canvasDraftId: draftRuntime.id,
        canvasDraftVersion: draftRuntime.version,
        pageKey: durablePage.id,
        selectedElementKeys: state.selectedIds,
        returnTo: `/w/${workspaceId}/boards/${draftRuntime.id}`,
      },
      to: relatedThreadId
        ? "/w/$workspaceId/agent/$threadId"
        : "/w/$workspaceId/agent",
    });
  };
  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
  };
  const handleOperationParametersSubmit: ComponentProps<
    typeof CanvasOperationParametersV1
  >["onSubmit"] = (parameters) => {
    const tool = pendingOperationTool;
    if (!tool) {
      return;
    }
    setPendingOperationTool(undefined);
    setImagePanelView(undefined);
    void startCanvasOperation(tool, undefined, parameters);
  };
  const handleImageTool: ComponentProps<typeof CanvasImagePanelV1>["onTool"] = (
    toolId,
  ) => {
    const tool = executableCapabilityTools.find(
      (candidate) => candidate.id === toolId,
    );
    if (!tool) {
      return;
    }
    if (
      operationSession &&
      (operationSession.phase === "starting" ||
        operationSession.phase === "running") &&
      operationSession.toolId === tool.id
    ) {
      void cancelCanvasOperation();
      return;
    }
    const directParameters = canvasToolDefaultParametersV1(tool);
    if (directParameters) {
      setOperationMessage(undefined);
      void startCanvasOperation(tool, undefined, directParameters);
      return;
    }
    commitPreview();
    setPendingOperationTool(tool);
  };
  const handleImageViewChange: ComponentProps<
    typeof CanvasImagePanelV1
  >["onViewChange"] = (view) => {
    commitPreview();
    setImagePanelView(view);
  };
  const cancelImageCrop = () => {
    mutate({ type: "cancel_preview" });
    imageCropOriginNodeRef.current = undefined;
    setImageCropGesture(undefined);
    setImageCropFrameGesture(undefined);
    setImagePanelView(undefined);
    focusStageAfterPanelAction();
  };
  const confirmImageCrop = () => {
    commitPreview();
    imageCropOriginNodeRef.current = undefined;
    setImageCropGesture(undefined);
    setImageCropFrameGesture(undefined);
    setImagePanelView(undefined);
    focusStageAfterPanelAction();
  };
  const closeImageEditor = () => {
    setPendingOperationTool(undefined);
    if (imagePanelView === "crop") {
      cancelImageCrop();
      return;
    }
    closeImagePanel();
  };
  const dismissContextPanelFromStage = (event: PointerEvent<HTMLElement>) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[role="toolbar"], [data-canvas-wheel-owner]')
    ) {
      return;
    }
    if (imagePanelView === "crop") {
      return;
    }
    if (pendingOperationTool || imagePanelView) {
      setPendingOperationTool(undefined);
      closeImagePanel(false);
      return;
    }
    if (inspectorMode) {
      closeInspector(false);
    }
  };
  const handleActivePanelChange: ComponentProps<
    typeof CanvasLeftPanelV1
  >["onActiveChange"] = (panel) => {
    if (imagePanelView === "crop") {
      mutate({ type: "cancel_preview" });
      imageCropOriginNodeRef.current = undefined;
      setImageCropGesture(undefined);
      setImageCropFrameGesture(undefined);
    } else {
      commitPreview();
    }
    setInspectorMode(undefined);
    setImagePanelView(undefined);
    setMediaContentTarget(undefined);
    setAssetPickerTask(undefined);
    setGroupIsolation(undefined);
    setActivePanel(panel);
    if (panel !== "tools") {
      setActiveQuickTool("select");
      cancelDrawing();
    }
  };
  const {
    applySelectedImageAsBackground,
    insertFrame,
    insertGraphic,
    insertGrid,
    insertLine,
    insertNote,
    insertShape,
    insertText,
    selectUpload,
  } = createCanvasInsertionCommandsV1({
    beginTextEditing: (nodeId, value) => {
      setEditingText({ nodeId, value });
    },
    focusStage: focusStageAfterPanelAction,
    insert,
    mutate,
    page: durablePage,
    selectedNodes,
    t,
  });
  const insertAdoptedExternalText = useCallback(
    (
      result: ResourceAdoptionResult,
      candidate: ResourceArtTextCandidate | ResourceFontCandidate,
    ): Promise<void> => {
      const options = canvasExternalTextInsertionOptionsV1(
        result,
        candidate,
        canvasFonts,
        i18n.resolvedLanguage ?? i18n.language,
      );
      if (!options) {
        throw new Error(t("canvas.messages.assetInsertError"));
      }
      insertText(options);
      focusStageAfterPanelAction();
      return Promise.resolve();
    },
    [canvasFonts, focusStageAfterPanelAction, i18n, insertText, t],
  );
  const insertBrandTextStyle = useCallback(
    (style: BrandKitTextStyle, color: string): void => {
      insertText({
        editImmediately: true,
        text: style.name,
        style: {
          align: style.role === "display" ? "center" : "left",
          decoration: { underline: false, strikeThrough: false },
          effects: [],
          fill: { kind: "solid", color },
          font: {
            source: "builtin",
            fontId: style.fontId,
            family: style.fontFamily,
            revision: style.fontRevision,
          },
          fontSize: style.fontSize,
          fontStyle: "normal",
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          lineHeight: style.lineHeight,
          spaceAfter: 0,
          spaceBefore: 0,
          verticalAlign: "top",
        },
      });
      focusStageAfterPanelAction();
    },
    [focusStageAfterPanelAction, insertText],
  );
  const openAssetPickerTask = (task: CanvasAssetPickerTaskV1) => {
    commitPreview();
    setActivePanel(undefined);
    setAssetPickerTask(task);
    setGroupIsolation(undefined);
    setImagePanelView(undefined);
    setInspectorMode(undefined);
    setMediaContentTarget(undefined);
  };
  const handleQuickToolChange: ComponentProps<
    typeof CanvasLeftPanelV1
  >["onQuickToolChange"] = (tool) => {
    setActiveQuickTool(tool);
    if (tool !== "draw" && tool !== "erase") {
      cancelDrawing();
      return;
    }
    commitPreview();
    setInspectorMode(undefined);
    setImagePanelView(undefined);
    setMediaContentTarget(undefined);
    setAssetPickerTask(undefined);
    setGroupIsolation(undefined);
    mutate({ type: "clear_selection" });
    stage.current?.focus();
  };
  const openMediaContentTarget = (
    target: CanvasMediaContentTargetV1,
    trigger?: HTMLElement,
  ) => {
    commitPreview();
    inspectorTriggerRef.current = trigger ?? null;
    setActivePanel(undefined);
    setAssetPickerTask(undefined);
    setGroupIsolation(undefined);
    setInspectorMode(undefined);
    setImagePanelView(undefined);
    mutate({ type: "select", id: target.nodeId });
    setMediaContentTarget(target);
  };
  const handlePageDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    let target = canvasMediaContentTargetForEventV1(event, durablePage);
    const selectedMediaNode =
      selectedNodes.length === 1 ? selectedNodes[0] : undefined;
    if (!target && selectedMediaNode?.kind === "frame") {
      target = { kind: "frame", nodeId: selectedMediaNode.id };
    } else if (!target && selectedMediaNode?.kind === "grid") {
      const insertionTarget = canvasImageInsertionTargetAtPointV1(
        durablePage,
        pagePoint(event.clientX, event.clientY),
      );
      if (
        insertionTarget.kind === "grid_cell" &&
        insertionTarget.gridId === selectedMediaNode.id
      ) {
        target = {
          kind: "grid",
          nodeId: selectedMediaNode.id,
          slotId: insertionTarget.slotId,
        };
      }
    }
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      openMediaContentTarget(target);
      return;
    }
    beginTextEditing(event);
  };
  const finishCatalogDrag = () => {
    setDropActive(false);
    draggedCatalogNodeRef.current = null;
  };
  const startCatalogDrag: ComponentProps<
    typeof CanvasLeftPanelV1
  >["onCatalogDragStart"] = (payload) => {
    setDropActive(true);
    draggedCatalogNodeRef.current = payload;
  };
  const finishAssetDrag = () => {
    setDropActive(false);
    draggedAssetRef.current = null;
  };
  const startAssetDrag: ComponentProps<
    typeof CanvasLeftPanelV1
  >["onAssetDragStart"] = (asset) => {
    setDropActive(true);
    draggedAssetRef.current = asset;
  };
  const blockReadonlyToolbarAction = (event: MouseEvent<HTMLDivElement>) => {
    if (
      canEdit ||
      (event.target instanceof Element &&
        event.target.closest("[data-canvas-inspector]"))
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const changeSelectedTextFont = (fontId: string) => {
    if (!selected || !selectedTextNode) {
      return;
    }
    const font =
      canvasFonts.find((candidate) => candidate.id === fontId) ??
      canvasFontDefinitionV1(fontId);
    replaceNode(
      nodeWithTextNodeV1(
        selected,
        mapTextNodeRuns(selectedTextNode, (run) => ({
          ...run,
          font: {
            source: font.source,
            fontId: font.id,
            family: font.family,
            revision: font.revision,
          },
          fontWeight: font.weights.includes(run.fontWeight)
            ? run.fontWeight
            : (font.weights.at(-1) ?? regularCanvasFontWeight),
        })),
      ),
    );
  };
  const changeSelectedTextFontSize = (value: number | null) => {
    if (value === null || !selected || !selectedTextNode) {
      return;
    }
    replaceNode(
      nodeWithTextNodeV1(
        selected,
        updateCanvasTextRunsV1(selectedTextNode, {
          fontSize: Number(value),
        }),
      ),
    );
  };
  const changeEditingText = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (!editingText) {
      return;
    }
    setEditingText({
      nodeId: editingText.nodeId,
      value: event.target.value,
    });
  };
  const handleTextEditingKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finishTextEditing(false);
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      finishTextEditing(true);
    }
    event.stopPropagation();
  };
  const changeInspectorMode: ComponentProps<
    typeof LayersInspectorV1
  >["onModeChange"] = (mode) => {
    commitPreview();
    setInspectorMode(mode);
  };
  const selectInspectorNode: ComponentProps<
    typeof LayersInspectorV1
  >["onSelect"] = (id) => {
    mutate({ type: "select", id });
    focusCanvasStageAfterPanelActionV1(stage.current);
  };
  const retryOperationPreview = () => {
    setOperationPreviewError(undefined);
    setOperationArtifactReloadRevision((value) => value + 1);
  };
  const viewSavedOperationAsset = () => {
    const assetId = operationReviewSession?.savedAssetId;
    if (!assetId) {
      return;
    }
    void navigate({
      to: "/w/$workspaceId/assets/$assetId",
      params: { workspaceId, assetId },
    });
  };
  const handleHistoryOpenChange = (open: boolean) => {
    setHistoryOpen(open);
    if (!open) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          fileMenuTriggerRef.current?.focus();
        });
      });
    }
  };
  const mediaTargetNode = mediaContentTarget
    ? topLevelNode(durablePage, mediaContentTarget.nodeId)
    : undefined;
  const mediaTargetImage =
    mediaContentTarget && mediaTargetNode
      ? canvasMediaTargetImageV1(mediaTargetNode, mediaContentTarget)
      : undefined;
  const mediaGridSlots =
    mediaTargetNode?.kind === "grid"
      ? canvasGridDefinitionV1(mediaTargetNode.definition).slots
      : [];
  const isolatedGroup = groupIsolation
    ? topLevelNode(durablePage, groupIsolation.groupId)
    : undefined;
  const isolatedChild =
    isolatedGroup?.kind === "group" && groupIsolation?.childId
      ? findCanvasNodeV1(isolatedGroup.children, groupIsolation.childId)
      : undefined;
  const replaceMediaTargetImage = (image: EditorRuntimePlacedImageV1) => {
    if (!mediaContentTarget) return;
    if (mediaContentTarget.kind === "frame") {
      mutate({
        type: "set_frame_content",
        pageId: durablePage.id,
        frameId: mediaContentTarget.nodeId,
        image,
      });
    } else {
      mutate({
        type: "set_grid_cell_content",
        pageId: durablePage.id,
        gridId: mediaContentTarget.nodeId,
        slotId: mediaContentTarget.slotId,
        image,
      });
    }
  };
  const previewMediaTargetImage = (image: EditorRuntimePlacedImageV1) => {
    if (!mediaContentTarget || !mediaTargetNode) return;
    previewNode(
      canvasMediaTargetNodeWithImageV1(
        mediaTargetNode,
        mediaContentTarget,
        image,
      ),
    );
  };
  const removeMediaTargetImage = () => {
    if (!mediaContentTarget) return;
    mutate(
      mediaContentTarget.kind === "frame"
        ? {
            type: "remove_frame_content",
            pageId: durablePage.id,
            frameId: mediaContentTarget.nodeId,
          }
        : {
            type: "remove_grid_cell_content",
            pageId: durablePage.id,
            gridId: mediaContentTarget.nodeId,
            slotId: mediaContentTarget.slotId,
          },
    );
  };
  let taskPanel: ComponentProps<typeof CanvasLeftPanelV1>["taskPanel"];
  if (assetPickerTask) {
    const currentTask = assetPickerTask;
    const returnFromAssetPicker = () => {
      setAssetPickerTask(undefined);
      if (currentTask.intent === "fill") {
        setMediaContentTarget(currentTask.mediaTarget);
      } else if (currentTask.intent === "replace") {
        setImagePanelView("home");
      } else {
        setActivePanel("design");
      }
    };
    let returnTarget = t("canvas.leftRail.items.design");
    if (currentTask.intent === "replace") {
      returnTarget = t("canvas.image.title");
    } else if (currentTask.intent === "fill") {
      returnTarget = t(
        currentTask.mediaTarget.kind === "frame"
          ? "canvas.mediaContainer.frameTitle"
          : "canvas.mediaContainer.gridTitle",
      );
    }
    taskPanel = {
      accessibleLabel: t("canvas.assetPicker.chooseImage"),
      backLabel: t("canvas.assetPicker.backTo", { target: returnTarget }),
      content: (
        <WorkspaceAssetPicker
          allowBatch={false}
          canEdit={canEdit}
          importing={hasPendingUploads}
          initialTab="library"
          mode={currentTask.intent === "background" ? "library" : "all"}
          onCancelUpload={cancelUpload}
          onPickAssets={pickAssets}
          onRetryUpload={retryUpload}
          onSelectUpload={selectUpload}
          onUploadFiles={(files) => {
            const currentState = latestCanvasRuntimeRef.current.state;
            const page = activePage(currentState);
            const selectedNode =
              currentTask.intent === "replace"
                ? page.nodes.find((node) => node.id === currentTask.nodeId)
                : undefined;
            let target: EditorNodeInsertionTarget;
            try {
              target = canvasAssetInsertionTargetV1({
                intent: currentTask.intent,
                ...(currentTask.intent === "fill"
                  ? { mediaTarget: currentTask.mediaTarget }
                  : {}),
                pageId: page.id,
                ...(selectedNode ? { selectedNode } : {}),
              })!;
            } catch (error) {
              setSaveError(
                error instanceof Error
                  ? error.message
                  : t("canvas.messages.assetInsertError"),
              );
              return;
            }
            void addFiles(files, undefined, target).then((handled) => {
              if (handled) returnFromAssetPicker();
            });
          }}
          pickIntent={currentTask.intent}
          {...(saveError ? { uploadError: saveError } : {})}
          uploadItems={uploadItems}
          workspaceId={workspaceId}
        />
      ),
      onBack: returnFromAssetPicker,
      onClose: () => setAssetPickerTask(undefined),
      title: t("canvas.assetPicker.chooseImage"),
    };
  } else if (groupIsolation && isolatedGroup?.kind === "group") {
    taskPanel = {
      content: (
        <CanvasGroupIsolationPanelV1
          canEdit={canEdit && !isolatedGroup.locked}
          group={isolatedGroup}
          onExit={() => setGroupIsolation(undefined)}
          onMove={(id, direction) =>
            mutate({ type: "move_layer", id, move: direction })
          }
          onPreview={previewNode}
          onPreviewCommit={commitPreview}
          onReplace={replaceNode}
          onSelect={(childId) =>
            setGroupIsolation({ groupId: isolatedGroup.id, childId })
          }
          {...(isolatedChild ? { selectedChild: isolatedChild } : {})}
        />
      ),
      onClose: () => setGroupIsolation(undefined),
      title: t("canvas.groupIsolation.title"),
    };
  } else if (mediaContentTarget && mediaTargetNode) {
    taskPanel = {
      content: (
        <CanvasMediaContainerPanelV1
          disabled={!canEdit || mediaTargetNode.locked}
          gridSlots={mediaGridSlots}
          {...(mediaTargetImage ? { image: mediaTargetImage } : {})}
          onBrowseAssets={() => {
            openAssetPickerTask({
              intent: "fill",
              mediaTarget: mediaContentTarget,
            });
          }}
          onChange={replaceMediaTargetImage}
          onCommit={commitPreview}
          onPreview={previewMediaTargetImage}
          onRemove={removeMediaTargetImage}
          onSelectGridSlot={(slotId) => {
            if (mediaTargetNode.kind === "grid") {
              commitPreview();
              setMediaContentTarget({
                kind: "grid",
                nodeId: mediaTargetNode.id,
                slotId,
              });
            }
          }}
          target={mediaContentTarget}
        />
      ),
      onClose: () => {
        commitPreview();
        setMediaContentTarget(undefined);
        setAssetPickerTask(undefined);
      },
      title: t(
        mediaContentTarget.kind === "frame"
          ? "canvas.mediaContainer.frameTitle"
          : "canvas.mediaContainer.gridTitle",
      ),
    };
  } else if (
    (imagePanelView || pendingOperationTool) &&
    selectedNodes.length === 1 &&
    selected?.kind === "image"
  ) {
    taskPanel = {
      content: pendingOperationTool ? (
        <CanvasOperationParametersV1
          busy={operationBusy}
          onSubmit={handleOperationParametersSubmit}
          tool={pendingOperationTool}
        />
      ) : (
        <CanvasImagePanelV1
          cropMode={imageCropMode}
          disabled={!canEdit || selected.locked}
          node={selected}
          onCancelCrop={cancelImageCrop}
          onCommit={commitPreview}
          onConfirmCrop={confirmImageCrop}
          onCropModeChange={setImageCropMode}
          onPreview={previewNode}
          onReplace={replaceNode}
          onRestoreCrop={() => {
            const origin = imageCropOriginNodeRef.current;
            if (origin?.id === selected.id) {
              setImageCropMode("free");
              previewNode(origin);
            }
          }}
          onTool={handleImageTool}
          onViewChange={handleImageViewChange}
          {...(selectedImagePreviewUrl
            ? { previewUrl: selectedImagePreviewUrl }
            : {})}
          tools={executableCapabilityTools.map((tool) => {
            const operationActive =
              operationSession?.phase === "starting" ||
              operationSession?.phase === "running";
            const active =
              operationActive && operationSession.toolId === tool.id;
            return {
              id: tool.id,
              label: tool.label,
              interactionBehavior: tool.interactionBehavior,
              active,
              disabled: operationActive && !active,
            };
          })}
          view={imagePanelView!}
        />
      ),
      ...(imagePanelOnBack ? { onBack: imagePanelOnBack } : {}),
      onClose: closeImageEditor,
      title: imagePanelTitle,
    };
  } else if (inspectorMode) {
    taskPanel = {
      accessibleLabel: t("canvas.inspector.label"),
      content: (
        <Suspense
          fallback={
            <div
              aria-live="polite"
              className="py-6 text-center text-sm text-[var(--muted)]"
              role="status"
            >
              {t("canvas.inspector.loading")}
            </div>
          }
        >
          <CanvasInspectorContentV1
            canEdit={canEdit}
            documentColors={documentColors}
            mode={inspectorMode}
            nodes={durablePage.nodes}
            onAlign={(alignment) => {
              mutate({
                type: "align_selected",
                alignment,
              });
            }}
            onChangeMode={changeInspectorMode}
            onMove={(id, move) => {
              mutate({
                type: "move_layer",
                id,
                move,
              });
            }}
            onPreview={previewNode}
            onPreviewCommit={commitPreview}
            onReplace={replaceNode}
            onSelect={selectInspectorNode}
            pageHeight={durablePage.height}
            pageWidth={durablePage.width}
            {...(selected ? { selected } : {})}
            selectedIds={state.selectedIds}
            selectedNodes={selectedNodes}
            workspaceId={workspaceId}
          />
        </Suspense>
      ),
      onClose: closeInspector,
      title: t(canvasInspectorTitleKeyV1(inspectorMode)),
    };
  }

  const fileMenuItems: MenuProps["items"] = [
    {
      disabled: !canEdit,
      icon: <Plus aria-hidden="true" />,
      key: "add-page",
      label: t("canvas.shell.addPage"),
    },
    {
      disabled: !draftRuntime.id,
      icon: <History aria-hidden="true" />,
      key: "history",
      label: t("canvas.shell.history"),
    },
    {
      disabled: !canEdit,
      icon: <Copy aria-hidden="true" />,
      key: "duplicate-page",
      label: t("canvas.shell.duplicatePage"),
    },
    ...(state.document.pages.length > 1
      ? [
          {
            danger: true,
            disabled: !canEdit,
            icon: <Trash2 aria-hidden="true" />,
            key: "delete-page",
            label: t("canvas.shell.deletePage"),
          },
        ]
      : []),
    { type: "divider" },
    {
      disabled: !canEdit || state.document.pages[0]?.id === durablePage.id,
      icon: <ArrowLeftOutlined aria-hidden="true" />,
      key: "page-backward",
      label: t("canvas.shell.movePageBackward"),
    },
    {
      disabled: !canEdit || state.document.pages.at(-1)?.id === durablePage.id,
      icon: <ArrowRight aria-hidden="true" />,
      key: "page-forward",
      label: t("canvas.shell.movePageForward"),
    },
    { type: "divider" },
    {
      disabled: !canEdit,
      icon: <Ruler aria-hidden="true" />,
      key: "guide-vertical",
      label: t("canvas.shell.addVerticalGuide"),
    },
    {
      disabled: !canEdit,
      icon: <Ruler aria-hidden="true" className="rotate-90" />,
      key: "guide-horizontal",
      label: t("canvas.shell.addHorizontalGuide"),
    },
    ...((durablePage.overlays?.guides?.length ?? 0) > 0
      ? [
          {
            danger: true,
            disabled: !canEdit,
            icon: <Trash2 aria-hidden="true" />,
            key: "guide-clear",
            label: t("canvas.shell.clearGuides"),
          },
        ]
      : []),
  ];
  const fileMenuActions: Readonly<Record<string, () => void>> = {
    "add-page": addPage,
    history: () => setHistoryOpen(true),
    "duplicate-page": duplicatePage,
    "delete-page": deleteActivePage,
    "page-backward": moveActivePageBackward,
    "page-forward": moveActivePageForward,
    "guide-vertical": () => addActivePageGuide("vertical"),
    "guide-horizontal": () => addActivePageGuide("horizontal"),
    "guide-clear": clearActivePageGuides,
  };
  let exportTitle = t("canvas.shell.exportTitle");
  if (!hasExportPermission) {
    exportTitle = t("canvas.shell.exportForbidden");
  } else if (artifactResourcesLoading) {
    exportTitle = t("canvas.shell.exportLoadingAssets");
  } else if (artifactResourcesUnavailable) {
    exportTitle = t("canvas.shell.exportUnavailableAssets");
  }

  return (
    <main
      aria-labelledby="canvas-workspace-title"
      className={cn("canvas-v1-workspace", embedded && "!size-full")}
      onDragEnter={(event) => {
        if (canEdit && [...event.dataTransfer.types].includes("Files")) {
          setDropActive(true);
        }
      }}
      onDragOver={(event) => {
        if (
          canEdit &&
          ([...event.dataTransfer.types].includes("Files") ||
            draggedAssetRef.current ||
            draggedCatalogNodeRef.current)
        ) {
          event.preventDefault();
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDropActive(false);
        }
      }}
      onDrop={handleWorkspaceDrop}
    >
      <UnsavedChangesGuard
        active={hasUnsavedWork}
        bypass={canvasNavigationCommittedRef}
        title={t("canvas.shell.leaveTitle")}
      >
        {t("canvas.shell.leaveDescription")}
      </UnsavedChangesGuard>
      <SkipLink targetId="canvas-design-stage">
        {t("canvas.shell.skipToCanvas")}
      </SkipLink>
      <h1 className="sr-only" id="canvas-workspace-title">
        {t("canvas.documentTitle", {
          title: title.trim() || t("canvas.untitled"),
        })}
      </h1>
      <ConfigProvider theme={kanvasInverseControlTheme}>
        <header className="canvas-v1-topbar border-b border-white/10 bg-[linear-gradient(90deg,#3048f5_0%,#394cf1_55%,#3048f5_100%)] px-3 py-[7px] text-white">
          <div className="canvas-v1-topbar-leading flex min-w-0 items-center gap-1">
            <Link
              aria-label={t(
                embedded
                  ? "canvas.shell.closeWorkspace"
                  : "canvas.shell.exitLabel",
              )}
              className="canvas-v1-exit-link mr-2 inline-flex h-[34px] items-center gap-1.5 rounded-[7px] py-0 pr-[9px] pl-2 text-xs font-semibold text-white no-underline transition-[background-color,transform] duration-150 hover:bg-white/15 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
              onClick={handleExitCanvas}
              params={{ workspaceId }}
              title={t(
                embedded
                  ? "canvas.shell.closeWorkspace"
                  : "canvas.shell.exitLabel",
              )}
              to="/w/$workspaceId"
            >
              {embedded ? (
                <CloseOutlined aria-hidden="true" className="text-[15px]" />
              ) : (
                <ArrowLeftOutlined aria-hidden="true" className="text-[15px]" />
              )}
              <span className="canvas-v1-exit-label">
                {t(
                  embedded
                    ? "canvas.shell.closeWorkspace"
                    : "canvas.shell.exit",
                )}
              </span>
            </Link>
            <Brand
              className="canvas-v1-brand grid size-[34px] place-items-center text-white [&_.brand-mark]:size-[25px] [&_.brand-mark]:shadow-[0_0_0_2px_rgb(255_255_255_/_78%)]"
              compact
            />
            <div className="canvas-v1-file-menu-wrap relative">
              <Dropdown
                menu={{
                  "aria-label": t("canvas.shell.fileActions"),
                  items: fileMenuItems,
                  onClick: ({ key }) => fileMenuActions[key]?.(),
                }}
                popupRender={(menu) => (
                  <div
                    data-canvas-wheel-owner=""
                    onWheel={stopCanvasChromeWheelV1}
                  >
                    {menu}
                  </div>
                )}
                trigger={["click"]}
              >
                <Button
                  className="h-9 gap-1.5 px-2.5"
                  classNames={{ icon: "text-lg" }}
                  color="default"
                  ref={fileMenuTriggerRef}
                  size="small"
                  variant="text"
                >
                  {t("canvas.shell.file")}
                </Button>
              </Dropdown>
            </div>
            <span
              aria-hidden="true"
              className="canvas-v1-topbar-divider mx-1 h-[18px] w-px bg-white/25"
            />
            <input
              aria-label={t("canvas.shell.name")}
              className="canvas-v1-title h-9 w-auto min-w-28 max-w-[320px] rounded-md border border-transparent bg-transparent px-2.5 font-semibold text-white transition-colors [field-sizing:content] hover:border-white/35 hover:bg-white/10 focus:outline-none focus:shadow-none focus-visible:border-white focus-visible:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
              disabled={!canEdit}
              maxLength={240}
              onChange={handleTitleChange}
              value={title}
            />
            {permissions.includes("brand.read") ? (
              <button
                aria-label={t("brand.canvas.openBrandTools", {
                  brand: brand?.name ?? t("brand.canvas.noBrand"),
                })}
                className="inline-flex h-8 min-w-0 max-w-44 items-center gap-1.5 rounded-md border-0 bg-white/12 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
                onClick={() => handleActivePanelChange("brand")}
                title={brand?.name ?? t("brand.canvas.noBrand")}
                type="button"
              >
                <BgColorsOutlined aria-hidden="true" className="shrink-0" />
                <span className="hidden min-w-0 truncate lg:block">
                  {brand?.name ?? t("brand.canvas.noBrand")}
                </span>
              </button>
            ) : null}
            {operationGlobalStatusSession ? null : (
              <CanvasSaveStatusIndicatorV1
                canEdit={canEdit}
                message={saveStatusMessage}
                status={effectiveSaveStatus}
              />
            )}
          </div>
          <div className="canvas-v1-topbar-actions flex items-center gap-2 justify-self-end">
            {operationGlobalStatusSession ? (
              <CanvasOperationStatusV1
                busy={operationBusy}
                {...(capabilityRunQuery.data?.lifecycleStatus
                  ? {
                      lifecycleStatus: capabilityRunQuery.data.lifecycleStatus,
                    }
                  : {})}
                onCancel={() => {
                  void cancelCanvasOperation();
                }}
                onReconnect={() => {
                  void capabilityRunQuery.refetch();
                }}
                session={operationGlobalStatusSession}
                {...(operationStatusError
                  ? { statusError: operationStatusError }
                  : {})}
              />
            ) : null}
            {operationReviewSession && !operationReviewOpen ? (
              <Button
                icon={<EyeOutlined aria-hidden="true" />}
                onClick={() => {
                  setReviewDismissal(undefined);
                }}
                ref={operationReviewTriggerRef}
                size="small"
                type="text"
              >
                {t("canvas.operationReview.reopen")}
              </Button>
            ) : null}
            {permissions.includes("agent.run") ? (
              <button
                aria-label={t("canvas.shell.continueInAgent")}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/30 bg-white/12 px-3 text-xs font-bold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white disabled:opacity-40"
                disabled={
                  !draftRuntime.id ||
                  !draftRuntime.version ||
                  effectiveSaveStatus !== "saved" ||
                  fingerprint !== draftRuntime.lastSavedFingerprint
                }
                onClick={continueInAgent}
                title={t("canvas.shell.continueInAgent")}
                type="button"
              >
                <MessageOutlined aria-hidden="true" />
                <span className="hidden xl:inline">
                  {t("canvas.shell.continueInAgent")}
                </span>
              </button>
            ) : null}
            <div className="canvas-v1-history-actions flex gap-0.5">
              <button
                aria-label={t("canvas.shell.undo")}
                className="inline-flex size-9 items-center justify-center rounded-md border-0 bg-transparent p-0 text-inherit hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white disabled:opacity-35"
                disabled={!canEdit || state.past.length === 0}
                onClick={() => {
                  mutate({ type: "undo" });
                }}
                type="button"
              >
                <UndoOutlined aria-hidden="true" className="text-lg" />
              </button>
              <button
                aria-label={t("canvas.shell.redo")}
                className="inline-flex size-9 items-center justify-center rounded-md border-0 bg-transparent p-0 text-inherit hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white disabled:opacity-35"
                disabled={!canEdit || state.future.length === 0}
                onClick={() => {
                  mutate({ type: "redo" });
                }}
                type="button"
              >
                <RedoOutlined aria-hidden="true" className="text-lg" />
              </button>
            </div>
            <button
              className="canvas-v1-export-trigger inline-flex h-[38px] min-w-[84px] items-center justify-center gap-[7px] rounded-[10px] border border-white/70 bg-white px-[15px] py-0 text-xs font-bold text-[var(--primary)] transition-[background-color,border-color,transform] motion-reduce:transition-none hover:-translate-y-px hover:border-white hover:bg-[var(--paper-hover)] active:translate-y-0 focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]"
              disabled={!canExport}
              onClick={() => {
                void canvasExport.openExport();
              }}
              title={exportTitle}
              type="button"
            >
              <DownloadOutlined aria-hidden="true" />
              {t("canvas.shell.export")}
            </button>
          </div>
        </header>
      </ConfigProvider>

      <CanvasLeftPanelV1
        {...(activePanel ? { active: activePanel } : {})}
        activeQuickTool={activeQuickTool}
        backgroundTransparent={durablePage.background.kind === "transparent"}
        brushSettings={brushSettings}
        {...(durablePage.background.kind === "paint" &&
        durablePage.background.paint.kind === "solid"
          ? { backgroundColor: durablePage.background.paint.color }
          : {})}
        canEdit={canEdit}
        canManageBrand={permissions.includes("brand.manage")}
        canReadBrand={permissions.includes("brand.read")}
        {...(brand ? { brand } : {})}
        brandColorTarget={brandColorTarget}
        documentColors={documentColors}
        documentTextStyles={documentTextStyles}
        externalImageLibrary={
          <ResourceCatalogPicker
            canEdit={canEdit}
            csrfToken={csrfToken}
            onAdopt={insertAdoptedExternalImage}
            onAdoptError={failExternalImagePreview}
            onPreview={insertExternalImagePreview}
            workspaceId={workspaceId}
          />
        }
        externalArtTextLibrary={
          <ResourceCatalogTextPicker
            canEdit={canEdit}
            csrfToken={csrfToken}
            kind="art_text"
            onAdopt={insertAdoptedExternalText}
            workspaceId={workspaceId}
          />
        }
        externalFontLibrary={
          <ResourceCatalogTextPicker
            canEdit={canEdit}
            csrfToken={csrfToken}
            kind="font"
            onAdopt={insertAdoptedExternalText}
            workspaceId={workspaceId}
          />
        }
        fontCatalog={canvasFonts}
        fontCatalogError={fontResources.isError}
        {...(durablePage.background.kind === "paint" &&
        durablePage.background.paint.kind === "linear_gradient"
          ? {
              gradientBackground: {
                angle: durablePage.background.paint.angle,
                first:
                  durablePage.background.paint.stops[0]?.color ?? "#3048f5",
                second:
                  durablePage.background.paint.stops.at(-1)?.color ?? "#3048f5",
              },
            }
          : {})}
        height={durablePage.height}
        {...(taskPanel ? { taskPanel } : {})}
        {...(durablePage.background.kind === "image"
          ? {
              imageBackground: {
                fit: durablePage.background.image.fit,
                focalPoint: durablePage.background.image.focalPoint,
                opacity: durablePage.background.opacity,
              },
            }
          : {})}
        importing={hasPendingUploads}
        onCancelUpload={cancelUpload}
        onActiveChange={handleActivePanelChange}
        onBackgroundColor={setBackgroundColor}
        onBackgroundColorPreview={previewBackgroundColor}
        onBackgroundGradient={setBackgroundGradient}
        onBackgroundGradientPreview={previewBackgroundGradient}
        onBackgroundImageFocalPointPreview={previewBackgroundFocalPoint}
        onBackgroundImageFit={setBackgroundImageFit}
        onBackgroundImageOpacityPreview={previewBackgroundImageOpacity}
        onBackgroundPreviewCommit={commitPreview}
        onBackgroundTransparent={setTransparentBackground}
        onAdoptBrandRevision={adoptBrandRevision}
        onApplyBrandColor={applyBrandColor}
        onBrowseBackgroundImages={() =>
          openAssetPickerTask({ intent: "background" })
        }
        onBrushSettingsChange={setBrushSettings}
        onConvertBackgroundImage={convertBackgroundImage}
        onInsertFrame={insertFrame}
        onInsertGraphic={insertGraphic}
        onInsertGrid={insertGrid}
        onInsertLine={insertLine}
        onInsertBrandLogo={insertBrandLogo}
        onInsertBrandTextStyle={insertBrandTextStyle}
        onInsertNote={insertNote}
        onInsertShape={insertShape}
        onInsertText={insertText}
        onQuickToolChange={handleQuickToolChange}
        onCatalogDragEnd={finishCatalogDrag}
        onCatalogDragStart={startCatalogDrag}
        onAssetDragEnd={finishAssetDrag}
        onAssetDragStart={startAssetDrag}
        onPickAssets={pickAssets}
        onResizePage={resizePage}
        onRenamePage={renameActivePage}
        onRetryUpload={retryUpload}
        onSelectUpload={selectUpload}
        onUploadFiles={(files) => {
          void addFiles(files);
        }}
        onUseSelectedImageAsBackground={applySelectedImageAsBackground}
        selectedImageAvailable={
          selectedNodes.length === 1 &&
          selected?.kind === "image" &&
          !selected.locked
        }
        {...(saveError ? { uploadError: saveError } : {})}
        uploadItems={uploadItems}
        pageName={durablePage.name}
        width={durablePage.width}
        workspaceId={workspaceId}
        workspaceArtTextPresets={workspaceArtTextPresets}
      />

      <section
        aria-label={t("canvas.editor.canvasLabel")}
        className="canvas-v1-stage data-[panning=true]:cursor-grabbing data-[tool=draw]:[&_.canvas-v1-page-frame]:cursor-crosshair data-[tool=erase]:[&_.canvas-v1-page-frame]:cursor-cell focus-visible:shadow-[inset_0_0_0_2px_#bdf248]"
        data-panning={viewportPanning ? "true" : undefined}
        data-tool={activeQuickTool}
        id="canvas-design-stage"
        onPointerDown={handleStagePointerDown}
        onPointerDownCapture={(event) => {
          dismissContextPanelFromStage(event);
          beginViewportPan(event);
        }}
        onPointerMoveCapture={updateViewportPan}
        onPointerUpCapture={finishViewportPan}
        onWheel={handleStageWheel}
        ref={connectStage}
        tabIndex={0}
      >
        <div className="canvas-v1-stage-scroll">
          <CanvasNodeContextMenuV1
            {...(contextMenuNode ? { node: contextMenuNode } : {})}
            onApplyImageAsBackground={applyContextMenuImageAsBackground}
            onBringToFront={bringContextMenuNodeToFront}
            onClose={closeContextMenu}
            onDelete={deleteContextMenuNode}
            onDuplicate={duplicateContextMenuNode}
            onSendToBack={sendContextMenuNodeToBack}
            open={Boolean(contextMenu && canEdit && !contextMenuNode?.locked)}
          >
            <div
              className="canvas-v1-page-frame relative flex-none select-none bg-white shadow-[0_0_0_1px_rgb(21_21_21_/_10%),0_22px_60px_rgb(29_27_45_/_20%)] [will-change:transform] [&>svg:not(.canvas-v1-selection-svg)]:block [&>svg:not(.canvas-v1-selection-svg)]:size-full [&>svg:not(.canvas-v1-selection-svg)]:overflow-visible"
              onContextMenu={openNodeContextMenu}
              onDoubleClick={handlePageDoubleClick}
              onPointerDown={beginNodePointer}
              onPointerMove={updateGesture}
              onPointerCancel={endGesture}
              onPointerUp={endGesture}
              ref={pageFrameRef}
              style={{
                width: durablePage.width * zoom,
                height: durablePage.height * zoom,
                transform: `translate(${String(pan.x)}px, ${String(pan.y)}px)`,
              }}
            >
              <CanvasPageV1
                clipToPage
                {...(editingText
                  ? { editingTextNodeId: editingText.nodeId }
                  : {})}
                {...(mediaContentTarget ? { mediaContentTarget } : {})}
                page={canvasRenderedPage}
                resources={resources}
              />
              {processingSourceNode ? (
                <div
                  aria-atomic="true"
                  aria-label={t("canvas.editor.imageProcessing")}
                  aria-live="polite"
                  className="pointer-events-none absolute z-[9] grid place-items-center overflow-hidden bg-[rgb(29_32_45_/_42%)] text-white [transform-origin:center]"
                  role="status"
                  style={{
                    left: processingSourceNode.transform.x * zoom,
                    top: processingSourceNode.transform.y * zoom,
                    width: processingSourceNode.transform.width * zoom,
                    height: processingSourceNode.transform.height * zoom,
                    transform: `rotate(${String(
                      processingSourceNode.transform.rotation,
                    )}deg)`,
                  }}
                >
                  <i
                    aria-hidden="true"
                    className="absolute inset-0 animate-[canvas-image-buffer_1.35s_ease-in-out_infinite] bg-[linear-gradient(110deg,transparent_12%,rgb(73_99_255_/_42%)_38%,rgb(189_242_72_/_26%)_50%,transparent_72%)] [background-size:240%_100%] motion-reduce:animate-none"
                  />
                  <span className="relative z-[1] rounded-md bg-[rgb(21_23_31_/_68%)] px-2 py-1.5 text-[10px] font-bold backdrop-blur-md">
                    {t("canvas.editor.processing")}
                  </span>
                </div>
              ) : null}
              <svg
                aria-hidden="true"
                className="canvas-v1-selection-svg pointer-events-none absolute inset-0 z-10 block size-full overflow-visible [&_.canvas-v1-handle]:pointer-events-auto [&_.canvas-v1-handle-rotate]:pointer-events-auto"
                height={durablePage.height}
                viewBox={`0 0 ${String(
                  durablePage.width,
                )} ${String(durablePage.height)}`}
                width={durablePage.width}
              >
                {drawingGesture ? (
                  <path
                    className="fill-none [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
                    d={canvasFreehandPreviewPathV1(drawingGesture.points)}
                    opacity={brushSettings.opacity}
                    stroke={brushSettings.color}
                    strokeWidth={brushSettings.width}
                  />
                ) : null}
                {durablePage.overlays?.guides?.map((guide) =>
                  guide.axis === "vertical" ? (
                    <line
                      className="pointer-events-none stroke-[#18a9cf] [stroke-dasharray:5_4] [stroke-width:1] [vector-effect:non-scaling-stroke]"
                      key={guide.id}
                      x1={guide.position}
                      x2={guide.position}
                      y1={0}
                      y2={durablePage.height}
                    />
                  ) : (
                    <line
                      className="pointer-events-none stroke-[#18a9cf] [stroke-dasharray:5_4] [stroke-width:1] [vector-effect:non-scaling-stroke]"
                      key={guide.id}
                      x1={0}
                      x2={durablePage.width}
                      y1={guide.position}
                      y2={guide.position}
                    />
                  ),
                )}
                {guides.x === undefined ? null : (
                  <line
                    className="pointer-events-none stroke-[#ff2f70] [stroke-width:1.5] [vector-effect:non-scaling-stroke]"
                    x1={guides.x}
                    x2={guides.x}
                    y1={-durablePage.height}
                    y2={durablePage.height * 2}
                  />
                )}
                {guides.y === undefined ? null : (
                  <line
                    className="pointer-events-none stroke-[#ff2f70] [stroke-width:1.5] [vector-effect:non-scaling-stroke]"
                    x1={-durablePage.width}
                    x2={durablePage.width * 2}
                    y1={guides.y}
                    y2={guides.y}
                  />
                )}
                {imagePanelView === "crop" && selected?.kind === "image" ? (
                  <CanvasImageCropOverlayV1
                    freeCrop={imageCropMode === "free"}
                    node={selected}
                    onPointerDown={beginImageCropPan}
                    onPointerMove={updateImageCropPan}
                    onPointerUp={finishImageCropPan}
                    onResizePointerDown={beginImageCropFrameResize}
                    onResizePointerMove={updateImageCropFrameResize}
                    onResizePointerUp={finishImageCropFrameResize}
                    sourceNode={imageCropSourcePreviewNode ?? selected}
                    zoom={zoom}
                  />
                ) : (
                  <CanvasSelectionOverlayV1
                    connectionAnchors={
                      pointerInteractions.linePointGesture
                        ? canvasPageConnectionAnchorsV1(page.nodes)
                        : []
                    }
                    editable={canEdit}
                    nodes={selectedNodes}
                    onHandlePointerDown={beginHandlePointer}
                    onLinePointPointerDown={beginLinePointPointer}
                    zoom={zoom}
                  />
                )}
                {marquee ? (
                  <rect
                    className="canvas-v1-marquee"
                    fill="rgb(48 72 245 / 10%)"
                    height={Math.abs(marquee.current.y - marquee.start.y)}
                    pointerEvents="none"
                    stroke="#3048f5"
                    strokeDasharray={`${String(selectionOutlineDash / zoom)} ${String(selectionOutlineGap / zoom)}`}
                    strokeWidth={selectionOutlineWidth / zoom}
                    width={Math.abs(marquee.current.x - marquee.start.x)}
                    x={Math.min(marquee.current.x, marquee.start.x)}
                    y={Math.min(marquee.current.y, marquee.start.y)}
                  />
                ) : null}
              </svg>
              {selected && stageElement
                ? createPortal(
                    <ConfigProvider
                      componentSize="small"
                      theme={canvasTypeToolbarThemeV1}
                    >
                      <div
                        aria-label={t("canvas.editor.selectionTools")}
                        className="absolute top-3.5 left-1/2 z-[70] flex min-h-[43px] max-w-[calc(100%-48px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-xl border border-[var(--canvas-panel-line)] bg-white px-1.5 py-1.5 shadow-[0_9px_25px_rgb(34_36_60_/_12%)] transition-[box-shadow,opacity] duration-[180ms] [overscroll-behavior-inline:contain] [scrollbar-width:thin]"
                        data-canvas-wheel-owner=""
                        onClickCapture={blockReadonlyToolbarAction}
                        onPointerDown={stopCanvasChromePointerDownV1}
                        onWheel={stopCanvasChromeWheelV1}
                        role="toolbar"
                        ref={typeToolbarRef}
                      >
                        {selectedNodes.length > 1 ||
                        selected.kind !== "image" ? (
                          <>
                            <span className="max-w-[88px] flex-none truncate px-1.5 text-[11px] font-bold text-[#363740]">
                              {selectedNodes.length > 1
                                ? t("canvas.editor.selectedCount", {
                                    count: selectedNodes.length,
                                  })
                                : t(`canvas.editor.nodeTypes.${selected.kind}`)}
                            </span>
                            <Divider orientation="vertical" />
                          </>
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        selectedTextNode ? (
                          <>
                            <CanvasFontSelectV1
                              documentFontIds={documentTextStyles.map(
                                (style) => style.snapshot.font.fontId,
                              )}
                              fonts={canvasFonts}
                              onChange={changeSelectedTextFont}
                              value={
                                selectedTextNode.content.paragraphs[0]?.runs[0]
                                  ?.font.fontId ?? "noto-sans-sc"
                              }
                              workspaceId={workspaceId}
                            />
                            <InputNumber
                              aria-label={t("canvas.editor.fontSize")}
                              max={2_048}
                              min={1}
                              onChange={changeSelectedTextFontSize}
                              size="small"
                              step={1}
                              style={{ width: 84 }}
                              value={Math.round(
                                selectedTextFormatting?.fontSize ??
                                  defaultCanvasFontSize,
                              )}
                              variant="filled"
                            />
                            <CanvasColorPickerV1
                              ariaLabel={t("canvas.editor.textColor")}
                              color={paintColor(
                                selectedTextNode.content.paragraphs[0]?.runs[0]
                                  ?.fill ?? {
                                  kind: "solid",
                                  color: "#151515",
                                },
                              )}
                              documentColors={documentColors}
                              onChange={(color) => {
                                previewNode(
                                  nodeWithTextNodeV1(
                                    selected,
                                    mapTextNodeRuns(
                                      selectedTextNode,
                                      (run) => ({
                                        ...run,
                                        fill: {
                                          kind: "solid",
                                          color,
                                        },
                                      }),
                                    ),
                                  ),
                                );
                              }}
                              onCommit={commitPreview}
                              side="left"
                              workspaceId={workspaceId}
                            />
                            <Tooltip title={t("canvas.editor.bold")}>
                              <Button
                                aria-label={t("canvas.editor.bold")}
                                aria-pressed={
                                  (selectedTextFormatting?.fontWeight ??
                                    regularCanvasFontWeight) >=
                                  boldCanvasFontWeight
                                }
                                onClick={() => {
                                  replaceNode(
                                    nodeWithTextNodeV1(
                                      selected,
                                      updateCanvasTextRunsV1(selectedTextNode, {
                                        fontWeight:
                                          (selectedTextFormatting?.fontWeight ??
                                            regularCanvasFontWeight) >=
                                          boldCanvasFontWeight
                                            ? regularCanvasFontWeight
                                            : boldCanvasFontWeight,
                                      }),
                                    ),
                                  );
                                }}
                                type="text"
                              >
                                <span
                                  aria-hidden="true"
                                  className="inline-grid size-4 place-items-center font-serif text-base leading-none font-extrabold"
                                >
                                  B
                                </span>
                              </Button>
                            </Tooltip>
                            <Tooltip title={t("canvas.editor.italic")}>
                              <Button
                                aria-label={t("canvas.editor.italic")}
                                aria-pressed={
                                  selectedTextFormatting?.fontStyle === "italic"
                                }
                                onClick={() => {
                                  replaceNode(
                                    nodeWithTextNodeV1(
                                      selected,
                                      updateCanvasTextRunsV1(selectedTextNode, {
                                        fontStyle:
                                          selectedTextFormatting?.fontStyle ===
                                          "italic"
                                            ? "normal"
                                            : "italic",
                                      }),
                                    ),
                                  );
                                }}
                                type="text"
                              >
                                <span
                                  aria-hidden="true"
                                  className="inline-grid size-4 place-items-center font-serif text-base leading-none italic"
                                >
                                  I
                                </span>
                              </Button>
                            </Tooltip>
                            <Tooltip title={t("canvas.editor.underline")}>
                              <Button
                                aria-label={t("canvas.editor.underline")}
                                aria-pressed={
                                  selectedTextFormatting?.underline ?? false
                                }
                                onClick={() => {
                                  replaceNode(
                                    nodeWithTextNodeV1(
                                      selected,
                                      updateCanvasTextRunsV1(selectedTextNode, {
                                        underline:
                                          !selectedTextFormatting?.underline,
                                      }),
                                    ),
                                  );
                                }}
                                type="text"
                              >
                                <span
                                  aria-hidden="true"
                                  className="inline-grid size-4 place-items-center font-serif text-base leading-none underline underline-offset-2"
                                >
                                  U
                                </span>
                              </Button>
                            </Tooltip>
                            <Tooltip title={t("canvas.editor.strike")}>
                              <Button
                                aria-label={t("canvas.editor.strike")}
                                aria-pressed={
                                  selectedTextFormatting?.strikeThrough ?? false
                                }
                                onClick={() => {
                                  replaceNode(
                                    nodeWithTextNodeV1(
                                      selected,
                                      updateCanvasTextRunsV1(selectedTextNode, {
                                        strikeThrough:
                                          !selectedTextFormatting?.strikeThrough,
                                      }),
                                    ),
                                  );
                                }}
                                type="text"
                              >
                                <span
                                  aria-hidden="true"
                                  className="inline-grid size-4 place-items-center font-serif text-base leading-none line-through"
                                >
                                  S
                                </span>
                              </Button>
                            </Tooltip>
                            {selected.kind === "text" ? (
                              <>
                                <CanvasTextAlignmentPopoverV1
                                  disabled={!canEdit || selectionHasLocked}
                                  node={selectedTextNode}
                                  onChange={replaceNode}
                                />
                                <Button
                                  aria-expanded={
                                    inspectorMode === "text-spacing"
                                  }
                                  data-canvas-inspector="text-spacing"
                                  className="min-w-[52px] px-2.5"
                                  onClick={(event) => {
                                    openInspector(
                                      "text-spacing",
                                      event.currentTarget,
                                    );
                                  }}
                                  color={
                                    inspectorMode === "text-spacing"
                                      ? "primary"
                                      : "default"
                                  }
                                  variant={
                                    inspectorMode === "text-spacing"
                                      ? "filled"
                                      : "text"
                                  }
                                >
                                  {t("canvas.editor.spacing")}
                                </Button>
                                <Button
                                  aria-expanded={
                                    inspectorMode === "text-effects"
                                  }
                                  data-canvas-inspector="text-effects"
                                  className="min-w-[52px] px-2.5"
                                  onClick={(event) => {
                                    openInspector(
                                      "text-effects",
                                      event.currentTarget,
                                    );
                                  }}
                                  color={
                                    inspectorMode === "text-effects"
                                      ? "primary"
                                      : "default"
                                  }
                                  variant={
                                    inspectorMode === "text-effects"
                                      ? "filled"
                                      : "text"
                                  }
                                >
                                  {t("canvas.editor.effects")}
                                </Button>
                              </>
                            ) : null}
                          </>
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        selected.kind === "shape" ? (
                          <CanvasColorPickerV1
                            ariaLabel={t("canvas.editor.fillColor")}
                            color={paintColor(selected.fill)}
                            documentColors={documentColors}
                            onChange={(color) => {
                              previewNode({
                                ...selected,
                                fill: {
                                  kind: "solid",
                                  color,
                                },
                              });
                            }}
                            onCommit={commitPreview}
                            side="left"
                            workspaceId={workspaceId}
                          />
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        selected.kind === "line" ? (
                          <CanvasColorPickerV1
                            ariaLabel={t("canvas.editor.lineColor")}
                            color={paintColor(selected.stroke.paint)}
                            documentColors={documentColors}
                            onChange={(color) => {
                              previewNode({
                                ...selected,
                                stroke: {
                                  ...selected.stroke,
                                  paint: {
                                    kind: "solid",
                                    color,
                                  },
                                },
                              });
                            }}
                            onCommit={commitPreview}
                            side="left"
                            workspaceId={workspaceId}
                          />
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        selected.kind === "graphic" &&
                        selectedGraphicDefinition
                          ? (["primary", "secondary"] as const)
                              .filter((slot) =>
                                selectedGraphicDefinition.paths.some(
                                  (path) => path.colorSlot === slot,
                                ),
                              )
                              .map((slot) => (
                                <CanvasColorPickerV1
                                  ariaLabel={
                                    slot === "primary"
                                      ? t("canvas.editor.primaryColor")
                                      : t("canvas.editor.secondaryColor")
                                  }
                                  color={
                                    selected.colorSlots[slot] ??
                                    selectedGraphicDefinition.defaultColors[
                                      slot
                                    ]
                                  }
                                  documentColors={documentColors}
                                  key={slot}
                                  onChange={(color) => {
                                    previewNode({
                                      ...selected,
                                      colorSlots: {
                                        ...selected.colorSlots,
                                        [slot]: color,
                                      },
                                    });
                                  }}
                                  onCommit={commitPreview}
                                  side="left"
                                  workspaceId={workspaceId}
                                />
                              ))
                          : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        (selected.kind === "frame" ||
                          selected.kind === "grid") ? (
                          <Button
                            aria-expanded={
                              mediaContentTarget?.nodeId === selected.id
                            }
                            data-canvas-action="edit-container-content"
                            icon={<FolderOpen aria-hidden="true" />}
                            onClick={(event) => {
                              if (selected.kind === "frame") {
                                openMediaContentTarget(
                                  { kind: "frame", nodeId: selected.id },
                                  event.currentTarget,
                                );
                                return;
                              }
                              const slotId = canvasGridDefinitionV1(
                                selected.definition,
                              ).slots[0]?.id;
                              if (slotId) {
                                openMediaContentTarget(
                                  {
                                    kind: "grid",
                                    nodeId: selected.id,
                                    slotId,
                                  },
                                  event.currentTarget,
                                );
                              }
                            }}
                            color={
                              mediaContentTarget?.nodeId === selected.id
                                ? "primary"
                                : "default"
                            }
                            variant={
                              mediaContentTarget?.nodeId === selected.id
                                ? "filled"
                                : "text"
                            }
                          >
                            {t("canvas.mediaContainer.edit")}
                          </Button>
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        (selected.kind === "shape" ||
                          selected.kind === "line" ||
                          selected.kind === "graphic" ||
                          selected.kind === "grid" ||
                          selected.kind === "frame") ? (
                          <Button
                            aria-expanded={inspectorMode === "style"}
                            aria-label={t("canvas.editor.styleOptions")}
                            data-canvas-inspector="style"
                            icon={<SlidersHorizontal aria-hidden="true" />}
                            onClick={(event) => {
                              openInspector("style", event.currentTarget);
                            }}
                            color={
                              inspectorMode === "style" ? "primary" : "default"
                            }
                            variant={
                              inspectorMode === "style" ? "filled" : "text"
                            }
                          >
                            {t(`canvas.editor.styleNames.${selected.kind}`)}
                          </Button>
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        selected.kind === "image" ? (
                          <>
                            <Button
                              aria-label={t("canvas.mediaContainer.replace")}
                              data-canvas-action="replace-image"
                              icon={<PictureOutlined aria-hidden="true" />}
                              onClick={() => {
                                openAssetPickerTask({
                                  intent: "replace",
                                  nodeId: selected.id,
                                });
                              }}
                              type="text"
                            >
                              {t("canvas.mediaContainer.replace")}
                            </Button>
                            <Button
                              aria-expanded={
                                Boolean(imagePanelView) &&
                                imagePanelView !== "crop"
                              }
                              aria-label={t("canvas.editor.editImage")}
                              data-canvas-action="edit-image"
                              data-canvas-inspector="image"
                              icon={<SlidersOutlined aria-hidden="true" />}
                              onClick={(event) => {
                                openImagePanel("home", event.currentTarget);
                              }}
                              color={
                                imagePanelView && imagePanelView !== "crop"
                                  ? "primary"
                                  : "default"
                              }
                              variant={
                                imagePanelView && imagePanelView !== "crop"
                                  ? "filled"
                                  : "text"
                              }
                            >
                              {t("canvas.editor.editImage")}
                            </Button>
                            <Button
                              aria-expanded={imagePanelView === "crop"}
                              aria-label={t("canvas.editor.crop")}
                              data-canvas-action="crop"
                              icon={<ScissorOutlined aria-hidden="true" />}
                              onClick={(event) => {
                                openImagePanel("crop", event.currentTarget);
                              }}
                              color={
                                imagePanelView === "crop"
                                  ? "primary"
                                  : "default"
                              }
                              variant={
                                imagePanelView === "crop" ? "filled" : "text"
                              }
                            >
                              {t("canvas.editor.crop")}
                            </Button>
                          </>
                        ) : null}
                        <Button
                          aria-expanded={
                            inspectorMode === "layers" ||
                            inspectorMode === "position"
                          }
                          aria-label={t("canvas.editor.layers")}
                          data-canvas-inspector="position"
                          icon={<BlockOutlined aria-hidden="true" />}
                          onClick={(event) => {
                            openInspector("position", event.currentTarget);
                          }}
                          color={
                            inspectorMode === "layers" ||
                            inspectorMode === "position"
                              ? "primary"
                              : "default"
                          }
                          variant={
                            inspectorMode === "layers" ||
                            inspectorMode === "position"
                              ? "filled"
                              : "text"
                          }
                        >
                          {t("canvas.editor.position")}
                        </Button>
                        {selectedNodes.length === 1 ? (
                          <Button
                            aria-expanded={inspectorMode === "common"}
                            aria-label={t("canvas.editor.properties")}
                            data-canvas-inspector="common"
                            icon={<SlidersOutlined aria-hidden="true" />}
                            onClick={(event) => {
                              openInspector("common", event.currentTarget);
                            }}
                            color={
                              inspectorMode === "common" ? "primary" : "default"
                            }
                            variant={
                              inspectorMode === "common" ? "filled" : "text"
                            }
                          >
                            {t("canvas.editor.properties")}
                          </Button>
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        selected.kind !== "text" ? (
                          <>
                            <Divider orientation="vertical" />
                            <Tooltip
                              placement="bottom"
                              title={t("canvas.editor.flipHorizontal")}
                            >
                              <Button
                                aria-label={t("canvas.editor.flipHorizontal")}
                                aria-pressed={selected.transform.flipX}
                                color={
                                  selected.transform.flipX
                                    ? "primary"
                                    : "default"
                                }
                                icon={
                                  <ColumnWidthOutlined aria-hidden="true" />
                                }
                                onClick={() => {
                                  replaceNode({
                                    ...selected,
                                    transform: {
                                      ...selected.transform,
                                      flipX: !selected.transform.flipX,
                                    },
                                  });
                                }}
                                variant={
                                  selected.transform.flipX ? "filled" : "text"
                                }
                              />
                            </Tooltip>
                            <Tooltip
                              placement="bottom"
                              title={t("canvas.editor.flipVertical")}
                            >
                              <Button
                                aria-label={t("canvas.editor.flipVertical")}
                                aria-pressed={selected.transform.flipY}
                                color={
                                  selected.transform.flipY
                                    ? "primary"
                                    : "default"
                                }
                                icon={
                                  <ColumnHeightOutlined aria-hidden="true" />
                                }
                                onClick={() => {
                                  replaceNode({
                                    ...selected,
                                    transform: {
                                      ...selected.transform,
                                      flipY: !selected.transform.flipY,
                                    },
                                  });
                                }}
                                variant={
                                  selected.transform.flipY ? "filled" : "text"
                                }
                              />
                            </Tooltip>
                          </>
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length > 1 ? (
                          <>
                            <Tooltip title={t("canvas.editor.alignLeft")}>
                              <Button
                                aria-label={t("canvas.editor.alignLeft")}
                                icon={<AlignStartVertical aria-hidden="true" />}
                                onClick={() => {
                                  mutate({
                                    type: "align_selected",
                                    alignment: "left",
                                  });
                                }}
                                type="text"
                              />
                            </Tooltip>
                            <Tooltip title={t("canvas.editor.alignCenter")}>
                              <Button
                                aria-label={t("canvas.editor.alignCenter")}
                                icon={
                                  <AlignCenterVertical aria-hidden="true" />
                                }
                                onClick={() => {
                                  mutate({
                                    type: "align_selected",
                                    alignment: "center_horizontal",
                                  });
                                }}
                                type="text"
                              />
                            </Tooltip>
                            <Tooltip title={t("canvas.editor.alignTop")}>
                              <Button
                                aria-label={t("canvas.editor.alignTop")}
                                icon={
                                  <AlignStartHorizontal aria-hidden="true" />
                                }
                                onClick={() => {
                                  mutate({
                                    type: "align_selected",
                                    alignment: "top",
                                  });
                                }}
                                type="text"
                              />
                            </Tooltip>
                            <Tooltip title={t("canvas.editor.alignMiddle")}>
                              <Button
                                aria-label={t("canvas.editor.alignMiddle")}
                                icon={
                                  <AlignCenterHorizontal aria-hidden="true" />
                                }
                                onClick={() => {
                                  mutate({
                                    type: "align_selected",
                                    alignment: "center_vertical",
                                  });
                                }}
                                type="text"
                              />
                            </Tooltip>
                            {selectedNodes.length > 2 ? (
                              <>
                                <Tooltip
                                  title={t(
                                    "canvas.editor.distributeHorizontal",
                                  )}
                                >
                                  <Button
                                    aria-label={t(
                                      "canvas.editor.distributeHorizontal",
                                    )}
                                    icon={
                                      <AlignHorizontalSpaceBetween aria-hidden="true" />
                                    }
                                    onClick={() => {
                                      mutate({
                                        type: "distribute_selected",
                                        axis: "horizontal",
                                      });
                                    }}
                                    type="text"
                                  />
                                </Tooltip>
                                <Tooltip
                                  title={t("canvas.editor.distributeVertical")}
                                >
                                  <Button
                                    aria-label={t(
                                      "canvas.editor.distributeVertical",
                                    )}
                                    icon={
                                      <AlignVerticalSpaceBetween aria-hidden="true" />
                                    }
                                    onClick={() => {
                                      mutate({
                                        type: "distribute_selected",
                                        axis: "vertical",
                                      });
                                    }}
                                    type="text"
                                  />
                                </Tooltip>
                              </>
                            ) : null}
                            <Tooltip title={t("canvas.editor.group")}>
                              <Button
                                aria-label={t("canvas.editor.group")}
                                icon={<Group aria-hidden="true" />}
                                onClick={() => {
                                  mutate({
                                    type: "group_selected",
                                    groupId: `group:${crypto.randomUUID()}`,
                                  });
                                }}
                                type="text"
                              />
                            </Tooltip>
                          </>
                        ) : null}
                        {canEdit &&
                        !selectionHasLocked &&
                        selectedNodes.length === 1 &&
                        selected.kind === "group" ? (
                          <>
                            <Button
                              onClick={() => {
                                commitPreview();
                                setActivePanel(undefined);
                                setAssetPickerTask(undefined);
                                setImagePanelView(undefined);
                                setInspectorMode(undefined);
                                setMediaContentTarget(undefined);
                                setGroupIsolation({
                                  groupId: selected.id,
                                  ...(selected.children.at(-1)
                                    ? {
                                        childId: selected.children.at(-1)!.id,
                                      }
                                    : {}),
                                });
                              }}
                              type="text"
                            >
                              {t("canvas.groupIsolation.enter")}
                            </Button>
                            <Tooltip title={t("canvas.editor.ungroup")}>
                              <Button
                                aria-label={t("canvas.editor.ungroup")}
                                icon={<Ungroup aria-hidden="true" />}
                                onClick={() => {
                                  mutate({
                                    type: "ungroup",
                                    groupId: selected.id,
                                  });
                                }}
                                type="text"
                              />
                            </Tooltip>
                          </>
                        ) : null}
                        {canEdit ? (
                          <>
                            <Divider orientation="vertical" />
                            {selectedNodes.length === 1 ? (
                              <Tooltip
                                placement="bottom"
                                title={t(
                                  selected.locked
                                    ? "canvas.layers.unlock"
                                    : "canvas.layers.lock",
                                )}
                              >
                                <Button
                                  aria-label={t(
                                    selected.locked
                                      ? "canvas.layers.unlock"
                                      : "canvas.layers.lock",
                                  )}
                                  icon={
                                    canvasLockControlV1(selected.locked)
                                      .icon === "unlock" ? (
                                      <LockOpen aria-hidden="true" />
                                    ) : (
                                      <Lock aria-hidden="true" />
                                    )
                                  }
                                  onClick={() => {
                                    replaceNode({
                                      ...selected,
                                      locked: !selected.locked,
                                    });
                                  }}
                                  color={
                                    selected.locked ? "primary" : "default"
                                  }
                                  variant={selected.locked ? "filled" : "text"}
                                />
                              </Tooltip>
                            ) : null}
                            {selectionHasLocked ? null : (
                              <>
                                <Tooltip
                                  placement="bottom"
                                  title={t("canvas.editor.copy")}
                                >
                                  <Button
                                    aria-label={t("canvas.editor.copy")}
                                    icon={<CopyOutlined aria-hidden="true" />}
                                    onClick={duplicateSelected}
                                    type="text"
                                  />
                                </Tooltip>
                                <Tooltip
                                  placement="bottom"
                                  title={t("canvas.editor.delete")}
                                >
                                  <Button
                                    aria-label={t("canvas.editor.delete")}
                                    icon={<DeleteOutlined aria-hidden="true" />}
                                    onClick={() => {
                                      mutate({ type: "delete_selected" });
                                    }}
                                    type="text"
                                  />
                                </Tooltip>
                              </>
                            )}
                          </>
                        ) : null}
                      </div>
                    </ConfigProvider>,
                    stageElement,
                  )
                : null}
              {gesture?.kind === "rotate" &&
              selectedNodes.length === 1 &&
              selected &&
              rotationReadoutPoint ? (
                <output
                  className="absolute z-[25] min-w-12 -translate-x-1/2 rounded-lg bg-[#151515] px-2 py-1.5 text-center text-xs font-bold tabular-nums text-white shadow-[0_7px_18px_rgb(0_0_0_/_24%)]"
                  style={{
                    left: rotationReadoutPoint.x * zoom,
                    top: rotationReadoutPoint.y * zoom,
                  }}
                >
                  {Math.round(selected.transform.rotation)}°
                </output>
              ) : null}
              {editingText
                ? (() => {
                    const sourceNode = topLevelNode(
                      renderedPage,
                      editingText.nodeId,
                    );
                    const node = sourceNode
                      ? editableTextNodeV1(sourceNode)
                      : undefined;
                    if (!node) {
                      return null;
                    }
                    const run = node.content.paragraphs[0]?.runs[0];
                    return (
                      <div className="pointer-events-none absolute inset-0 z-[9] overflow-hidden">
                        <textarea
                          aria-label={t("canvas.editor.editText")}
                          className="pointer-events-auto absolute box-border min-h-6 min-w-6 resize-none overflow-x-hidden overflow-y-auto border-0 bg-transparent p-0 outline-0 shadow-none [overflow-wrap:anywhere] [text-shadow:none] [transform-origin:center] [white-space:pre-wrap] selection:bg-[rgb(48_72_245_/_18%)]"
                          onBlur={() => {
                            finishTextEditing(true);
                          }}
                          onChange={changeEditingText}
                          onKeyDown={handleTextEditingKeyDown}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                          ref={connectTextEditor}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                          }}
                          style={{
                            left: node.transform.x * zoom,
                            top: node.transform.y * zoom,
                            width: node.transform.width * zoom,
                            height: node.transform.height * zoom,
                            transform: `rotate(${String(
                              node.transform.rotation,
                            )}deg)`,
                            fontFamily: run?.font.family ?? "sans-serif",
                            fontSize:
                              (run?.fontSize ?? defaultCanvasFontSize) * zoom,
                            fontStyle: run?.fontStyle ?? "normal",
                            fontWeight:
                              run?.fontWeight ?? regularCanvasFontWeight,
                            letterSpacing: (run?.letterSpacing ?? 0) * zoom,
                            lineHeight:
                              node.content.paragraphs[0]?.lineHeight ??
                              defaultCanvasLineHeight,
                            paddingTop:
                              canvasTextEditorVerticalOffsetV1(
                                node,
                                browserCanvasTextMeasureV1,
                              ) * zoom,
                            textAlign:
                              node.content.paragraphs[0]?.align === "justify"
                                ? "justify"
                                : (node.content.paragraphs[0]?.align ?? "left"),
                            caretColor: paintColor(
                              run?.fill ?? {
                                kind: "solid",
                                color: "#151515",
                              },
                            ),
                            color: paintColor(
                              run?.fill ?? {
                                kind: "solid",
                                color: "#151515",
                              },
                            ),
                            direction:
                              node.content.paragraphs[0]?.direction === "auto"
                                ? undefined
                                : node.content.paragraphs[0]?.direction,
                          }}
                          spellCheck={false}
                          placeholder={t("canvas.toolbar.insertText")}
                          value={editingText.value}
                        />
                      </div>
                    );
                  })()
                : null}
            </div>
          </CanvasNodeContextMenuV1>
        </div>

        <div className="canvas-v1-bottom-chrome">
          <CanvasPageStripV1
            activePageId={state.activePageId}
            canEdit={canEdit}
            onActivatePage={activatePage}
            onAddPage={addPage}
            onDeletePage={deleteActivePage}
            onMoveActivePageBackward={moveActivePageBackward}
            onMoveActivePageForward={moveActivePageForward}
            onReorderPage={reorderPage}
            pages={displayState.document.pages}
            resources={resources}
          />

          <CanvasViewControlsV1
            onFit={fitViewport}
            onShortcutsOpenChange={setShortcutsOpen}
            onShortcutsTriggerRef={(node) => {
              shortcutsTriggerRef.current = node;
            }}
            onZoomChange={changeViewportZoom}
            shortcutsOpen={shortcutsOpen}
            zoom={zoom}
          />
        </div>
      </section>

      {dropActive ? (
        <div className="pointer-events-none fixed inset-[72px_18px_18px] z-[200] grid place-items-center content-center gap-3 rounded-[20px] border-[3px] border-dashed border-[#3048f5] bg-[rgb(239_242_255_/_90%)] text-[#2338c2] backdrop-blur-xl">
          <FolderOpen aria-hidden="true" className="size-[42px]" />
          <strong>{t("canvas.editor.drop")}</strong>
        </div>
      ) : null}
      {operationReviewSession ? (
        <CanvasOperationReviewV1
          afterClose={() => {
            window.requestAnimationFrame(() => {
              const imageToolTrigger =
                typeToolbarRef.current?.querySelector<HTMLElement>(
                  '[data-canvas-action="edit-image"]',
                );
              (
                operationReviewTriggerRef.current ??
                imageToolTrigger ??
                stage.current
              )?.focus();
            });
          }}
          applicationAuthorized={canApplyCanvasOperations}
          assetSaved={Boolean(operationReviewSession.savedAssetId)}
          busy={operationBusy}
          onApply={(disposition) => {
            void applyCanvasOperation(disposition);
          }}
          onClose={() => {
            void discardCanvasOperation();
          }}
          onDismiss={() => {
            setReviewDismissal({
              phase: operationReviewSession.phase,
              sessionId: operationReviewSession.id,
              updatedAt: operationReviewSession.updatedAt,
            });
          }}
          onDiscard={() => {
            void discardCanvasOperation();
          }}
          onRefreshStatus={() => {
            void capabilityRunQuery.refetch();
          }}
          onRetry={() => {
            void retryCanvasOperation();
          }}
          onRetryPreview={retryOperationPreview}
          onSaveAsset={() => {
            void saveCanvasOperationAsset();
          }}
          onViewAsset={viewSavedOperationAsset}
          {...(operationMaskUrl ? { maskUrl: operationMaskUrl } : {})}
          {...(operationPreviewUrl ? { previewUrl: operationPreviewUrl } : {})}
          {...(operationPreviewError
            ? { previewError: operationPreviewError }
            : {})}
          open={operationReviewOpen}
          session={operationReviewSession}
          {...(operationSourceUrl ? { sourceUrl: operationSourceUrl } : {})}
          sourceCompatibility={operationSourceCompatibility}
          {...(operationStatusError
            ? { statusError: operationStatusError }
            : {})}
        />
      ) : null}
      {canvasExport.open ? (
        <CanvasExportPanel
          activePageId={state.activePageId}
          {...(brand ? { brandName: brand.name } : {})}
          canDownload={canDownloadExport}
          canExport={canExport}
          canViewAssets={canViewExportAssets}
          {...(canvasExport.error ? { error: canvasExport.error } : {})}
          {...(canvasExport.existingAsset
            ? { existingAsset: canvasExport.existingAsset }
            : {})}
          onCancel={canvasExport.cancelExport}
          onClose={canvasExport.closeExport}
          onDownload={canvasExport.downloadExportResult}
          onExistingAssetChange={canvasExport.changeExistingAsset}
          onRetry={canvasExport.retryExport}
          onRun={canvasExport.runExport}
          onSelectedPageIdsChange={canvasExport.changeSelectedPageIds}
          onSettingsChange={canvasExport.changeSettings}
          onViewAssets={canvasExport.viewAssets}
          pages={state.document.pages.map((page) => ({
            height: page.height,
            id: page.id,
            name: page.name,
            transparentBackground: page.background.kind === "transparent",
            width: page.width,
          }))}
          phase={canvasExport.phase}
          progress={canvasExport.progress}
          results={canvasExport.results}
          retryable={canvasExport.retryable}
          selectedPageIds={canvasExport.selectedPageIds}
          settings={canvasExport.settings}
          workspaceId={workspaceId}
        />
      ) : null}
      <CanvasWorkspaceNoticeV1
        {...(draftSaveError ? { draftSaveError } : {})}
        {...(operationMessage ? { operationMessage } : {})}
        onDismissOperationMessage={() => {
          setOperationMessage(undefined);
        }}
        onDismissSaveError={() => {
          setSaveError(undefined);
        }}
        onResolveSaveConflict={resolveSaveConflict}
        onRetryDraftSave={retryDraftSave}
        saveConflictActive={saveConflictActive}
        {...(saveError && activePanel !== "materials" ? { saveError } : {})}
        sourceDeletionCancellationPending={sourceDeletionCancellationPending}
      />
      {saveConflictOpen ? (
        <CanvasSaveConflictDialog
          {...(saveConflictError ? { error: saveConflictError } : {})}
          {...(saveConflictDraft ? { latestDraft: saveConflictDraft } : {})}
          localSummary={{
            pageCount: state.document.pages.length,
            title,
            ...(draftRuntime.version ? { version: draftRuntime.version } : {}),
          }}
          onKeepLocal={keepLocalAfterSaveConflict}
          onOpenChange={updateSaveConflictDialogVisibility}
          onReadLatest={readLatestSaveConflict}
          onUseLatest={applyLatestAfterSaveConflict}
          open
          {...(saveConflictResolving
            ? { resolving: saveConflictResolving }
            : {})}
        />
      ) : null}
      {historyOpen ? (
        <CanvasHistoryDialog
          canRestore={
            canEdit &&
            effectiveSaveStatus === "saved" &&
            pendingDiagnostics.length === 0 &&
            fingerprint === draftRuntime.lastSavedFingerprint
          }
          {...(draftRuntime.id ? { canvasDraftId: draftRuntime.id } : {})}
          currentVersion={draftRuntime.version ?? 1}
          onOpenChange={handleHistoryOpenChange}
          onRestore={restoreRevision}
          open
          restoring={historyRestoring}
          workspaceId={workspaceId}
        />
      ) : null}
      {state.document.pages.map((page) => (
        <svg
          aria-hidden="true"
          className="invisible fixed top-[-100000px] left-[-100000px]"
          key={`export:${page.id}`}
          ref={(node) => {
            canvasExport.registerExportSource(page.id, node);
          }}
          viewBox={`0 0 ${String(page.width)} ${String(page.height)}`}
        >
          <CanvasPageV1 clipToPage page={page} resources={resources} />
        </svg>
      ))}
    </main>
  );
}
