import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";
import type {
  BrandKitLogo,
  BrandKitTextStyle,
  CanvasBrandContext,
  WorkspaceAssetSummary,
} from "@kanvas/contracts/api";
import {
  BgColorsOutlined,
  EditOutlined,
  FileImageOutlined,
  FontSizeOutlined,
  PictureOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  WorkspaceAssetPicker,
  type WorkspaceAssetPickIntent,
  type WorkspaceAssetPickResult,
  type WorkspaceAssetUploadItem,
} from "../assets/workspace-asset-picker.js";
import {
  canvasLeftRailDefinitions,
  type CanvasLeftRailId,
} from "./canvas-left-rail-model.js";
import { CanvasQuickToolsV1 } from "./canvas-quick-tools-popover-v1.js";
import type {
  CanvasBrushSettingsV1,
  CanvasQuickToolIdV1,
} from "./canvas-quick-tools-v1.js";
import type { CanvasGraphicDefinitionV1 } from "./graphic-catalog-v1.js";
import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";
import { CanvasMaterialsPanelV1 } from "./canvas-materials-panel-v1.js";
import { CanvasTextPanelV1 } from "./canvas-text-panel-v1.js";
import { CanvasBackgroundPanelV1 } from "./canvas-background-panel-v1.js";
import { CanvasDesignPanelV1 } from "./canvas-design-panel-v1.js";
import { CanvasTaskPanelV1 } from "./canvas-task-panel-v1.js";
import type { CanvasDocumentTextStyleV1 } from "./canvas-text-style-v1.js";
import type { CanvasTextInsertionOptionsV1 } from "./canvas-insertion-commands-v1.js";
import {
  canvasFontCatalogV1,
  type CanvasFontDefinitionV1,
} from "./font-catalog-v1.js";
import type { CanvasWorkspaceArtTextPresetV1 } from "./canvas-art-text-resources.js";
import { CanvasBrandPanelV1 } from "./canvas-brand-panel-v1.js";

export {
  canvasArtTextInsertionOptionsV1,
  canvasShapeCategoriesV1,
  canvasShapeCategoryLabelV1,
  canvasShapesForCategoryV1,
  searchCanvasMaterialsV1,
  searchCanvasTextCatalogV1,
} from "./canvas-left-panel-catalog-v1.js";

const railIcons = {
  design: FileImageOutlined,
  materials: PictureOutlined,
  text: FontSizeOutlined,
  brand: BgColorsOutlined,
  tools: EditOutlined,
} as const;
const noAdoptBrandRevision = (): Promise<void> => Promise.resolve();

export function CanvasLeftPanelV1({
  active,
  activeQuickTool,
  backgroundTransparent,
  backgroundColor,
  brand,
  brandColorTarget = "page",
  brushSettings,
  canEdit,
  canManageBrand = false,
  canReadBrand = true,
  documentColors,
  documentTextStyles,
  externalImageLibrary,
  externalArtTextLibrary,
  externalFontLibrary,
  fontCatalog = canvasFontCatalogV1,
  fontCatalogError = false,
  gradientBackground,
  height,
  imageBackground,
  taskPanel,
  importing,
  onActiveChange,
  onAdoptBrandRevision = noAdoptBrandRevision,
  onApplyBrandColor,
  onBackgroundColor,
  onBackgroundColorPreview,
  onBackgroundGradient,
  onBackgroundGradientPreview,
  onBackgroundImageFocalPointPreview,
  onBackgroundImageFit,
  onBackgroundImageOpacityPreview,
  onBackgroundPreviewCommit,
  onBackgroundTransparent,
  onBrushSettingsChange,
  onBrowseBackgroundImages,
  onConvertBackgroundImage,
  onInsertFrame,
  onInsertGraphic,
  onInsertGrid,
  onInsertLine,
  onInsertBrandLogo,
  onInsertBrandTextStyle,
  onInsertNote,
  onInsertShape,
  onInsertText,
  onCatalogDragEnd,
  onCatalogDragStart,
  onAssetDragEnd,
  onAssetDragStart,
  onPickAssets,
  onCancelUpload,
  onResizePage,
  onRenamePage,
  onRetryUpload,
  onSelectUpload,
  onUploadFiles,
  selectedImageAvailable,
  onUseSelectedImageAsBackground,
  onQuickToolChange,
  uploadError,
  uploadItems,
  pageName,
  width,
  workspaceId,
  workspaceArtTextPresets = [],
}: {
  readonly active?: CanvasLeftRailId;
  readonly activeQuickTool: CanvasQuickToolIdV1;
  readonly backgroundTransparent: boolean;
  readonly backgroundColor?: string;
  readonly brand?: CanvasBrandContext;
  readonly brandColorTarget?: "page" | "shape" | "text";
  readonly brushSettings: CanvasBrushSettingsV1;
  readonly canEdit: boolean;
  readonly canManageBrand?: boolean;
  readonly canReadBrand?: boolean;
  readonly documentColors: readonly string[];
  readonly documentTextStyles: readonly CanvasDocumentTextStyleV1[];
  readonly externalImageLibrary?: ReactNode;
  readonly externalArtTextLibrary?: ReactNode;
  readonly externalFontLibrary?: ReactNode;
  readonly fontCatalog?: readonly CanvasFontDefinitionV1[];
  readonly fontCatalogError?: boolean;
  readonly gradientBackground?: {
    readonly angle: number;
    readonly first: string;
    readonly second: string;
  };
  readonly height: number;
  readonly imageBackground?: {
    readonly fit: "contain" | "cover" | "fill";
    readonly focalPoint: {
      readonly x: number;
      readonly y: number;
    };
    readonly opacity: number;
  };
  readonly taskPanel?: {
    readonly accessibleLabel?: string;
    readonly backLabel?: string;
    readonly content: ReactNode;
    readonly onBack?: () => void;
    readonly onClose: () => void;
    readonly title: string;
  };
  readonly importing: boolean;
  readonly onActiveChange: (active: CanvasLeftRailId | undefined) => void;
  readonly onAdoptBrandRevision?: (brandKitRevisionId: string) => Promise<void>;
  readonly onApplyBrandColor?: (color: string) => void;
  readonly onBackgroundColor: (color: string) => void;
  readonly onBackgroundColorPreview: (color: string) => void;
  readonly onBackgroundGradient: (
    first: string,
    second: string,
    angle: number,
  ) => void;
  readonly onBackgroundGradientPreview: (
    first: string,
    second: string,
    angle: number,
  ) => void;
  readonly onBackgroundImageFocalPointPreview: (x: number, y: number) => void;
  readonly onBackgroundImageFit: (fit: "contain" | "cover" | "fill") => void;
  readonly onBackgroundImageOpacityPreview: (opacity: number) => void;
  readonly onBackgroundPreviewCommit: () => void;
  readonly onBackgroundTransparent: () => void;
  readonly onBrushSettingsChange: (settings: CanvasBrushSettingsV1) => void;
  readonly onBrowseBackgroundImages: () => void;
  readonly onConvertBackgroundImage: () => void;
  readonly onInsertFrame: (definition: EditorCatalogReferenceV1) => void;
  readonly onInsertGraphic: (definition: CanvasGraphicDefinitionV1) => void;
  readonly onInsertGrid: (definition: EditorCatalogReferenceV1) => void;
  readonly onInsertLine: (definition: EditorCatalogReferenceV1) => void;
  readonly onInsertBrandLogo?: (logo: BrandKitLogo) => Promise<void>;
  readonly onInsertBrandTextStyle?: (
    style: BrandKitTextStyle,
    color: string,
  ) => void;
  readonly onInsertNote: (color: string) => void;
  readonly onInsertShape: (definition: EditorCatalogReferenceV1) => void;
  readonly onInsertText: (options?: CanvasTextInsertionOptionsV1) => void;
  readonly onCatalogDragEnd: () => void;
  readonly onCatalogDragStart: (payload: EditorNodeInsertionPayload) => void;
  readonly onAssetDragEnd: () => void;
  readonly onAssetDragStart: (asset: WorkspaceAssetSummary) => void;
  readonly onPickAssets: (
    assets: readonly WorkspaceAssetSummary[],
    intent: WorkspaceAssetPickIntent,
  ) => Promise<WorkspaceAssetPickResult>;
  readonly onCancelUpload: (id: string) => void;
  readonly onResizePage: (
    width: number,
    height: number,
    mode: "keep" | "scale",
  ) => void;
  readonly onRenamePage: (name: string) => void;
  readonly onRetryUpload: (id: string) => void;
  readonly onSelectUpload: (id: string) => void;
  readonly onUploadFiles: (files: readonly File[]) => void;
  readonly onUseSelectedImageAsBackground: () => void;
  readonly onQuickToolChange: (tool: CanvasQuickToolIdV1) => void;
  readonly selectedImageAvailable: boolean;
  readonly uploadError?: string;
  readonly uploadItems: readonly WorkspaceAssetUploadItem[];
  readonly pageName: string;
  readonly width: number;
  readonly workspaceId: string;
  readonly workspaceArtTextPresets?: readonly CanvasWorkspaceArtTextPresetV1[];
}) {
  const { t } = useTranslation();
  const closeQuickTools = () => {
    onQuickToolChange("select");
    onActiveChange(undefined);
  };
  const insertQuickText = () => {
    onInsertText({
      editImmediately: true,
      text: t("canvas.quickTools.insertText"),
    });
  };
  const assetPickerProps = {
    canEdit,
    importing,
    onAssetDragEnd,
    onAssetDragStart,
    onPickAssets,
    onCancelUpload,
    onRetryUpload,
    onSelectUpload,
    onUploadFiles,
    ...(uploadError ? { uploadError } : {}),
    uploadItems,
    workspaceId,
  } as const;
  const backgroundPanel = (
    <CanvasBackgroundPanelV1
      backgroundTransparent={backgroundTransparent}
      {...(backgroundColor ? { backgroundColor } : {})}
      documentColors={documentColors}
      {...(gradientBackground ? { gradientBackground } : {})}
      {...(imageBackground ? { imageBackground } : {})}
      onBrowseImages={onBrowseBackgroundImages}
      onColor={onBackgroundColor}
      onColorPreview={onBackgroundColorPreview}
      onConvertImage={onConvertBackgroundImage}
      onGradient={onBackgroundGradient}
      onGradientPreview={onBackgroundGradientPreview}
      onImageFocalPointPreview={onBackgroundImageFocalPointPreview}
      onImageFit={onBackgroundImageFit}
      onImageOpacityPreview={onBackgroundImageOpacityPreview}
      onPreviewCommit={onBackgroundPreviewCommit}
      onUseSelectedImage={onUseSelectedImageAsBackground}
      onTransparent={onBackgroundTransparent}
      selectedImageAvailable={selectedImageAvailable}
      workspaceId={workspaceId}
    />
  );
  return (
    <aside className="relative z-50 flex min-h-0 [grid-area:sidebar] overflow-visible bg-[var(--canvas-panel-surface)] shadow-[1px_0_0_var(--canvas-panel-line)]">
      <nav
        aria-label={t("canvas.leftRail.label")}
        className="flex w-[72px] shrink-0 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-5"
        data-canvas-wheel-owner=""
      >
        {canvasLeftRailDefinitions
          .filter((item) => item.id !== "brand" || canReadBrand)
          .map((item) => {
            const Icon = railIcons[item.id];
            const selected = active === item.id;
            return (
              <Button
                aria-current={selected ? "page" : undefined}
                block
                className="h-[52px] shrink-0 flex-col gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium leading-none transition-colors"
                color={selected ? "primary" : "default"}
                key={item.id}
                onClick={() => {
                  onActiveChange(active === item.id ? undefined : item.id);
                }}
                type="text"
                variant={selected ? "filled" : "text"}
              >
                <Icon aria-hidden="true" className="text-[18px]" />
                <span>{t(`canvas.leftRail.items.${item.id}`)}</span>
              </Button>
            );
          })}
      </nav>
      {active === "tools" ? (
        <CanvasTaskPanelV1
          onClose={closeQuickTools}
          title={t("canvas.leftRail.items.tools")}
        >
          <CanvasQuickToolsV1
            activeTool={activeQuickTool}
            brushSettings={brushSettings}
            documentColors={documentColors}
            onActiveToolChange={onQuickToolChange}
            onBrushSettingsChange={onBrushSettingsChange}
            onInsertLine={onInsertLine}
            onInsertNote={onInsertNote}
            onInsertShape={onInsertShape}
            onInsertText={insertQuickText}
            workspaceId={workspaceId}
          />
        </CanvasTaskPanelV1>
      ) : null}
      {taskPanel ? (
        <CanvasTaskPanelV1
          {...(taskPanel.accessibleLabel
            ? { accessibleLabel: taskPanel.accessibleLabel }
            : {})}
          {...(taskPanel.backLabel ? { backLabel: taskPanel.backLabel } : {})}
          {...(taskPanel.onBack ? { onBack: taskPanel.onBack } : {})}
          onClose={taskPanel.onClose}
          title={taskPanel.title}
        >
          {taskPanel.content}
        </CanvasTaskPanelV1>
      ) : null}
      {active && active !== "tools" ? (
        <CanvasTaskPanelV1
          onClose={() => {
            onActiveChange(undefined);
          }}
          title={t(`canvas.leftRail.items.${active}`)}
        >
          {active === "design" ? (
            <>
              <CanvasDesignPanelV1
                height={height}
                name={pageName}
                onRenamePage={onRenamePage}
                onResizePage={onResizePage}
                width={width}
              />
              {backgroundPanel}
            </>
          ) : null}
          {active === "materials" ? (
            <CanvasMaterialsPanelV1
              imageLibrary={
                <WorkspaceAssetPicker
                  {...assetPickerProps}
                  compact
                  {...(externalImageLibrary
                    ? { externalLibrary: externalImageLibrary }
                    : {})}
                  initialTab="library"
                  mode="all"
                />
              }
              onInsertFrame={onInsertFrame}
              onInsertGraphic={onInsertGraphic}
              onInsertGrid={onInsertGrid}
              onInsertLine={onInsertLine}
              onInsertShape={onInsertShape}
              onCatalogDragEnd={onCatalogDragEnd}
              onCatalogDragStart={onCatalogDragStart}
            />
          ) : null}
          {active === "text" ? (
            <CanvasTextPanelV1
              documentStyles={documentTextStyles}
              {...(externalArtTextLibrary ? { externalArtTextLibrary } : {})}
              {...(externalFontLibrary ? { externalFontLibrary } : {})}
              fontCatalog={fontCatalog}
              fontCatalogError={fontCatalogError}
              onCatalogDragEnd={onCatalogDragEnd}
              onCatalogDragStart={onCatalogDragStart}
              onInsertText={onInsertText}
              workspaceArtTextPresets={workspaceArtTextPresets}
            />
          ) : null}
          {active === "brand" ? (
            <CanvasBrandPanelV1
              {...(brand ? { brand } : {})}
              canManage={canManageBrand}
              canEdit={canEdit}
              colorTarget={brandColorTarget}
              onAdoptBrandRevision={onAdoptBrandRevision}
              onApplyColor={onApplyBrandColor ?? onBackgroundColor}
              {...(onInsertBrandLogo
                ? { onInsertLogo: onInsertBrandLogo }
                : {})}
              {...(onInsertBrandTextStyle
                ? { onInsertTextStyle: onInsertBrandTextStyle }
                : {})}
              workspaceId={workspaceId}
            />
          ) : null}
        </CanvasTaskPanelV1>
      ) : null}
    </aside>
  );
}
