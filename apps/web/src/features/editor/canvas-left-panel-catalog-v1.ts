import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";

import { canvasFontCatalogV1 } from "./font-catalog-v1.js";
import {
  canvasFrameCatalogV1,
  canvasGridCatalogV1,
} from "./frame-grid-catalog-v1.js";
import { canvasGraphicCatalogV1 } from "./graphic-catalog-v1.js";
import { canvasLineCatalogV1 } from "./line-catalog-v1.js";
import {
  canvasShapeCatalogV1,
  type CanvasShapeCategoryV1,
} from "./shape-catalog-v1.js";
import {
  canvasTextPresetCatalogV1,
  canvasTextPresetReferenceV1,
} from "./text-preset-catalog-v1.js";

export const canvasShapeCategoriesV1 = [
  ["basic", "基础"],
  ["arrows", "箭头"],
  ["decorative", "装饰"],
  ["callouts", "标注"],
  ["flowchart", "流程图"],
] as const satisfies readonly [CanvasShapeCategoryV1, string][];

export function canvasShapeCategoryLabelV1(
  category: CanvasShapeCategoryV1,
): string {
  return (
    canvasShapeCategoriesV1.find(([id]) => id === category)?.[1] ?? category
  );
}

export function canvasShapesForCategoryV1(
  category: CanvasShapeCategoryV1,
  query: string,
) {
  const results = searchCanvasMaterialsV1(query).shapes;
  return query.trim()
    ? results
    : results.filter((shape) => shape.category === category);
}

export function canvasArtTextInsertionOptionsV1(presetId: string): {
  readonly editImmediately: true;
  readonly preset: EditorCatalogReferenceV1;
  readonly text: "设计标题";
} {
  return {
    editImmediately: true,
    text: "设计标题",
    preset: canvasTextPresetReferenceV1(presetId),
  };
}

export function searchCanvasMaterialsV1(query: string) {
  const normalized = query.trim().toLowerCase();
  const includes = (...terms: readonly string[]) =>
    terms.join(" ").toLowerCase().includes(normalized);
  return {
    shapes: canvasShapeCatalogV1.filter((shape) =>
      includes(shape.label, shape.definitionId, ...shape.keywords),
    ),
    graphics: canvasGraphicCatalogV1.filter((graphic) =>
      includes(graphic.label, graphic.resourceId, ...graphic.keywords),
    ),
    lines: canvasLineCatalogV1.filter((line) =>
      includes(line.label, line.definitionId),
    ),
    frames: canvasFrameCatalogV1.filter((frame) =>
      includes(frame.label, frame.definitionId),
    ),
    grids: canvasGridCatalogV1.filter((grid) =>
      includes(grid.label, grid.definitionId),
    ),
  };
}

export function searchCanvasTextCatalogV1(query: string) {
  const normalized = query.trim().toLowerCase();
  return {
    presets: canvasTextPresetCatalogV1.filter((preset) =>
      `${preset.label} ${preset.id}`.toLowerCase().includes(normalized),
    ),
    fonts: canvasFontCatalogV1.filter((font) =>
      `${font.label} ${font.family} ${font.id}`
        .toLowerCase()
        .includes(normalized),
    ),
  };
}
