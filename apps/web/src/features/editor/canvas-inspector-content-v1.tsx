import type { ComponentProps } from "react";

import { CommonNodeInspectorV1 } from "./canvas-inspector-controls-v1.js";
import type { CanvasInspectorModeV1 } from "./canvas-inspector-state-v1.js";
import { LayersInspectorV1 } from "./canvas-layers-inspector-v1.js";
import { NodeStyleInspectorV1 } from "./canvas-node-style-inspector-v1.js";
import {
  TextEffectsInspectorV1,
  TextSpacingInspectorV1,
} from "./canvas-text-inspector-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

type LayersInspectorProps = ComponentProps<typeof LayersInspectorV1>;

export function CanvasInspectorContentV1({
  canEdit,
  documentColors,
  mode,
  nodes,
  onAlign,
  onChangeMode,
  onMove,
  onPreview,
  onPreviewCommit,
  onReplace,
  onSelect,
  pageHeight,
  pageWidth,
  selected,
  selectedIds,
  selectedNodes,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly documentColors: readonly string[];
  readonly mode: CanvasInspectorModeV1;
  readonly nodes: readonly EditorRuntimeNodeV1[];
  readonly onAlign: LayersInspectorProps["onAlign"];
  readonly onChangeMode: LayersInspectorProps["onModeChange"];
  readonly onMove: LayersInspectorProps["onMove"];
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly onReplace: (node: EditorRuntimeNodeV1) => void;
  readonly onSelect: LayersInspectorProps["onSelect"];
  readonly pageHeight: number;
  readonly pageWidth: number;
  readonly selected?: EditorRuntimeNodeV1;
  readonly selectedIds: readonly string[];
  readonly selectedNodes: readonly EditorRuntimeNodeV1[];
  readonly workspaceId: string;
}) {
  if (mode === "common" && selectedNodes.length === 1 && selected) {
    return (
      <CommonNodeInspectorV1
        disabled={!canEdit}
        node={selected}
        onChange={onReplace}
        onPreview={onPreview}
        onPreviewCommit={onPreviewCommit}
      />
    );
  }

  if (mode === "position" || mode === "layers") {
    return (
      <LayersInspectorV1
        disabled={!canEdit}
        mode={mode}
        nodes={nodes}
        onAlign={onAlign}
        onModeChange={onChangeMode}
        onMove={onMove}
        onPreview={onPreview}
        onPreviewCommit={onPreviewCommit}
        onReplace={onReplace}
        onSelect={onSelect}
        pageHeight={pageHeight}
        pageWidth={pageWidth}
        selectedIds={selectedIds}
      />
    );
  }

  if (
    mode === "style" &&
    selectedNodes.length === 1 &&
    selected &&
    (selected.kind === "shape" ||
      selected.kind === "line" ||
      selected.kind === "graphic" ||
      selected.kind === "grid" ||
      selected.kind === "frame")
  ) {
    return (
      <NodeStyleInspectorV1
        disabled={!canEdit || selected.locked}
        documentColors={documentColors}
        node={selected}
        onChange={onReplace}
        onPreview={onPreview}
        onPreviewCommit={onPreviewCommit}
        workspaceId={workspaceId}
      />
    );
  }

  if (selectedNodes.length !== 1 || selected?.kind !== "text") {
    return null;
  }

  if (mode === "text-spacing") {
    return (
      <TextSpacingInspectorV1
        disabled={!canEdit || selected.locked}
        node={selected}
        onChange={onReplace}
        onPreview={onPreview}
        onPreviewCommit={onPreviewCommit}
      />
    );
  }

  if (mode === "text-effects") {
    return (
      <TextEffectsInspectorV1
        disabled={!canEdit || selected.locked}
        documentColors={documentColors}
        node={selected}
        onChange={onReplace}
        onPreview={onPreview}
        onPreviewCommit={onPreviewCommit}
        workspaceId={workspaceId}
      />
    );
  }

  return null;
}
