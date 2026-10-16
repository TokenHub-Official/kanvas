import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function sourceText(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Canvas workspace responsibility boundaries", () => {
  it("keeps image upload transport and recovery inside its lifecycle module", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const uploadSource = sourceText("./use-canvas-image-uploads-v1.ts");

    for (const ownedSymbol of [
      "allocateUserImport",
      "commitUserImport",
      "uploadUserImport",
      "loadCanvasRuntimeRecoveryV1",
      "saveCanvasRuntimeRecoveryV1",
    ]) {
      expect(workspaceSource).not.toContain(ownedSymbol);
      expect(uploadSource).toContain(ownedSymbol);
    }
  });

  it("mounts the board from its Draft before artifact hydration completes", () => {
    const routeSource = sourceText("../../routes/board-desktop-content.tsx");
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");

    expect(routeSource).not.toContain("downloadArtifact");
    expect(routeSource).not.toContain("readAsDataURL");
    expect(routeSource).not.toContain("hydrateEditorRuntimeDocumentV1");
    expect(routeSource).toContain("initialArtifactIds");
    expect(workspaceSource).toContain("loadCanvasArtifactResourcesV1");
    expect(workspaceSource).toContain("editorRuntimePageArtifactIdsV1");
    expect(workspaceSource).toContain("backgroundPreviewIds");
    expect(workspaceSource).toContain("artifactResourcesLoading");
    expect(workspaceSource).toContain("artifactResourcesUnavailable");
  });

  it("keeps global keyboard and clipboard listeners inside their lifecycle module", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const keyboardSource = sourceText("./use-canvas-keyboard-shortcuts-v1.ts");

    for (const eventName of ['"keydown"', '"keyup"', '"paste"']) {
      expect(workspaceSource).not.toContain(`addEventListener(${eventName}`);
      expect(keyboardSource).toContain(`addEventListener(${eventName}`);
    }
  });

  it("keeps export transport and recovery inside the export feature controller", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const exportSource = sourceText("./use-canvas-export-v1.ts");

    for (const ownedSymbol of [
      "allocateCanvasExport",
      "commitCanvasExport",
      "uploadCanvasExport",
      "loadCanvasExportRecovery",
      "saveCanvasExportRecovery",
    ]) {
      expect(workspaceSource).not.toContain(ownedSymbol);
      expect(exportSource).toContain(ownedSymbol);
    }
    expect(exportSource).toContain("suppressRecoveryOnce");
    expect(exportSource).toContain("await removeRecovery().catch");
  });

  it("keeps draft persistence and conflict transport inside its controller", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const persistenceSource = sourceText(
      "./use-canvas-draft-persistence-controller-v1.ts",
    );

    for (const ownedSymbol of [
      "createCanvasDraft",
      "fetchCanvasDraft",
      "promoteCanvasOperationSessionsV1",
      "updateCanvasDraft",
    ]) {
      expect(workspaceSource).not.toContain(ownedSymbol);
      expect(persistenceSource).toContain(ownedSymbol);
    }
  });

  it("keeps viewport persistence and measurement inside the viewport hook", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const viewportSource = sourceText("./use-canvas-viewport-v1.ts");

    expect(workspaceSource).not.toContain("ResizeObserver");
    expect(workspaceSource).not.toContain("localStorage");
    expect(viewportSource).toContain("ResizeObserver");
    expect(viewportSource).toContain("localStorage");
  });

  it("keeps node pointer gestures inside the pointer interaction controller", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const pointerSource = sourceText("./use-canvas-pointer-interactions-v1.ts");

    for (const ownedSymbol of [
      "appendCanvasFreehandPointV1",
      "resizeEditorNodeV1",
      "rotateEditorNodeV1",
      "snapEditorNodeMoveV1",
    ]) {
      expect(workspaceSource).not.toContain(ownedSymbol);
      expect(pointerSource).toContain(ownedSymbol);
    }
  });

  it("keeps extracted inspectors out of the workspace implementation", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");

    for (const componentName of [
      "CommonNodeInspectorV1",
      "LayersInspectorV1",
      "NodeStyleInspectorV1",
      "TextEffectsInspectorV1",
    ]) {
      expect(workspaceSource).not.toContain(`function ${componentName}`);
      expect(workspaceSource).not.toContain(`const ${componentName} =`);
    }
  });

  it("routes every expanded editor task through the single left task lane", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const leftPanelSource = sourceText("./canvas-left-panel-v1.tsx");
    const workspaceStyles = sourceText("./canvas-workspace-v1.css");

    expect(workspaceSource).toContain("taskPanel");
    expect(workspaceSource).not.toContain("CanvasInspectorPanelV1");
    expect(leftPanelSource).toContain("CanvasTaskPanelV1");
    expect(workspaceStyles).not.toContain('"sidebar stage inspector"');
    expect(workspaceStyles).not.toContain(".canvas-v1-inspector");
  });

  it("uses Ant Design Icons for generic left-rail and drawing actions", () => {
    const leftPanelSource = sourceText("./canvas-left-panel-v1.tsx");
    const quickToolsSource = sourceText("./canvas-quick-tools-popover-v1.tsx");

    expect(leftPanelSource).toContain('from "@ant-design/icons"');
    expect(quickToolsSource).toContain('from "@ant-design/icons"');
    expect(leftPanelSource).not.toContain("assets/icons/ant-design");
    expect(quickToolsSource).not.toContain("assets/icons/ant-design");
  });

  it("keeps export, history and save-conflict on the Ant Design control stack", () => {
    for (const source of [
      sourceText("./canvas-export-panel.tsx"),
      sourceText("./canvas-history-dialog.tsx"),
      sourceText("./canvas-save-conflict-dialog.tsx"),
    ]) {
      expect(source).toContain('from "antd"');
      expect(source).not.toContain("components/dialog");
      expect(source).not.toContain("components/alert-dialog");
      expect(source).not.toContain("components/button");
      expect(source).not.toContain("components/icon-button");
      expect(source).not.toContain('.css"');
    }
  });

  it("keeps transient Canvas chrome in component-local Tailwind", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const workspaceStyles = sourceText("./canvas-workspace-v1.css");
    const noticeSource = sourceText("./canvas-workspace-notice-v1.tsx");
    const viewControlsSource = sourceText("./canvas-view-controls-v1.tsx");

    for (const legacySelector of [
      ".canvas-v1-drop-overlay",
      ".canvas-v1-image-processing-mask",
      ".canvas-v1-message",
      ".canvas-v1-shortcuts",
      ".canvas-range-control-v1",
      ".canvas-operation-preview-v1",
    ]) {
      expect(workspaceStyles).not.toContain(legacySelector);
    }
    expect(workspaceSource).not.toContain('className="canvas-v1-drop-overlay"');
    expect(viewControlsSource).not.toContain('className="canvas-v1-shortcuts"');
    expect(noticeSource).toContain('from "antd"');
    expect(noticeSource).toContain('from "@ant-design/icons"');
    expect(noticeSource).not.toContain("canvas-icons-v1");
    expect(sourceText("./canvas-range-control-v1.tsx")).toContain(
      'from "antd"',
    );
    expect(sourceText("./canvas-operation-review-v1.tsx")).not.toContain(
      "canvas-operation-preview-v1",
    );
  });

  it("retains only reachable cross-component geometry in Workspace CSS", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const workspaceStyles = sourceText("./canvas-workspace-v1.css");
    const viewportGateSource = sourceText(
      "../../routes/board-viewport-gate.tsx",
    );

    expect(viewportGateSource).toContain("(min-width: 768px)");
    expect(workspaceStyles).not.toContain("@media (width <= 600px)");
    for (const retainedSelector of [
      ".canvas-v1-workspace",
      ".canvas-v1-stage",
      ".canvas-v1-stage-scroll",
      ".canvas-v1-bottom-chrome",
      "@container canvas-stage",
    ]) {
      expect(workspaceStyles).toContain(retainedSelector);
    }
    expect(workspaceSource).toContain("overflow-x-auto overflow-y-hidden");
    expect(workspaceSource).toContain('data-canvas-wheel-owner=""');
  });

  it("uses one neutral interaction grammar across dense Canvas panels", () => {
    const backgroundSource = sourceText("./canvas-background-panel-v1.tsx");
    const designSource = sourceText("./canvas-design-panel-v1.tsx");
    const exportSource = sourceText("./canvas-export-panel.tsx");
    const layersSource = sourceText("./canvas-layers-inspector-v1.tsx");
    const assetPickerSource = sourceText(
      "../assets/workspace-asset-picker.tsx",
    );
    const themeSource = sourceText("../../theme/kanvas-theme.ts");

    expect(themeSource).toContain('colorPrimaryBg: "#F2F2F2"');
    expect(backgroundSource).toContain("<Tabs");
    expect(backgroundSource).not.toContain("<Segmented");
    expect(exportSource).not.toContain("<Segmented");
    expect(assetPickerSource).not.toContain("<Segmented");
    expect(layersSource).toContain("<Space.Compact");
    expect(designSource).not.toContain("grid-rows-[auto_auto]");
    expect(designSource).toContain("truncate text-xs text-[#858690]");
    expect(sourceText("./canvas-view-controls-v1.tsx")).toContain(
      'document.addEventListener("pointerdown"',
    );
    expect(sourceText("./canvas-workspace-v1.tsx")).toContain(
      "dismissContextPanelFromStage",
    );
  });

  it("lets context-menu items receive their click before the menu closes", () => {
    const shortcutSource = sourceText("./use-canvas-keyboard-shortcuts-v1.ts");
    expect(shortcutSource).not.toContain(
      'window.addEventListener("pointerdown", onCloseContextMenu)',
    );
  });

  it("keeps asset intent in the originating task instead of a global picker mode", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const assetPickerSource = sourceText(
      "../assets/workspace-asset-picker.tsx",
    );

    expect(assetPickerSource).not.toContain("assetIntents");
    expect(assetPickerSource).not.toContain("intentTitle");
    expect(workspaceSource).toContain("type CanvasAssetPickerTaskV1");
    expect(workspaceSource).toContain("pickIntent={currentTask.intent}");
    expect(workspaceSource).toContain("addFiles(files, undefined, target)");
    expect(workspaceSource).toMatch(
      /const openInspector[\s\S]*?setMediaContentTarget\(undefined\)/,
    );
  });

  it("keeps simple text alignment in a toolbar popover instead of an inspector", () => {
    const workspaceSource = sourceText("./canvas-workspace-v1.tsx");
    const inspectorStateSource = sourceText("./canvas-inspector-state-v1.ts");
    const alignmentSource = sourceText(
      "./canvas-text-alignment-popover-v1.tsx",
    );

    expect(workspaceSource).toContain("CanvasTextAlignmentPopoverV1");
    expect(workspaceSource).not.toContain('openInspector("text-alignment"');
    expect(inspectorStateSource).not.toContain('"text-alignment"');
    expect(alignmentSource).toContain("<Popover");
    expect(alignmentSource).toContain("setOpen(false)");
    expect(alignmentSource).toContain('role="radiogroup"');
    expect(alignmentSource).toContain('container: "!p-1"');
    expect(alignmentSource).toContain("!size-8 !min-w-8 !p-0");
    expect(sourceText("../../theme/kanvas-theme-provider.tsx")).toContain(
      "autoInsertSpace: false",
    );
    expect(workspaceSource.match(/min-w-\[52px\] px-2\.5/gu)).toHaveLength(2);
  });
});
