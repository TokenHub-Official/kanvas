import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";

import type { CanvasShapePathV1 } from "./shape-geometry-v1.js";

export interface CanvasFrameDefinitionV1 {
  readonly defaultAspectRatio: number;
  readonly definitionId: string;
  readonly label: string;
  readonly path: CanvasShapePathV1;
  readonly revision: string;
}

export interface CanvasGridSlotV1 {
  readonly height: number;
  readonly id: string;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface CanvasGridDefinitionV1 {
  readonly defaultAspectRatio: number;
  readonly definitionId: string;
  readonly label: string;
  readonly revision: string;
  readonly slots: readonly CanvasGridSlotV1[];
}

const revision = "2026-07-31";
const viewBox = "0 0 100 100" as const;

function frame(
  value: Omit<CanvasFrameDefinitionV1, "revision">,
): CanvasFrameDefinitionV1 {
  return {
    ...value,
    revision,
  };
}

function grid(
  value: Omit<CanvasGridDefinitionV1, "revision">,
): CanvasGridDefinitionV1 {
  return {
    ...value,
    revision,
  };
}

export const canvasFrameCatalogV1 = [
  frame({
    definitionId: "frame.rectangle",
    label: "矩形画框",
    defaultAspectRatio: 1.2,
    path: {
      d: "M0 0 H100 V100 H0 Z",
      fillRule: "nonzero",
      viewBox,
    },
  }),
  frame({
    definitionId: "frame.rounded",
    label: "圆角画框",
    defaultAspectRatio: 1.2,
    path: {
      d: "M16 0 H84 Q100 0 100 16 V84 Q100 100 84 100 H16 Q0 100 0 84 V16 Q0 0 16 0 Z",
      fillRule: "nonzero",
      viewBox,
    },
  }),
  frame({
    definitionId: "frame.circle",
    label: "圆形画框",
    defaultAspectRatio: 1,
    path: {
      d: "M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0 Z",
      fillRule: "nonzero",
      viewBox,
    },
  }),
  frame({
    definitionId: "frame.arch",
    label: "拱门画框",
    defaultAspectRatio: 0.76,
    path: {
      d: "M0 100 V46 C0 20 22 0 50 0 C78 0 100 20 100 46 V100 Z",
      fillRule: "nonzero",
      viewBox,
    },
  }),
  frame({
    definitionId: "frame.diamond",
    label: "菱形画框",
    defaultAspectRatio: 1,
    path: {
      d: "M50 0 L100 50 L50 100 L0 50 Z",
      fillRule: "nonzero",
      viewBox,
    },
  }),
  frame({
    definitionId: "frame.heart",
    label: "心形画框",
    defaultAspectRatio: 1.05,
    path: {
      d: "M50 92 C42 82 8 59 8 31 C8 13 30 5 43 20 L50 28 L57 20 C70 5 92 13 92 31 C92 59 58 82 50 92 Z",
      fillRule: "nonzero",
      viewBox,
    },
  }),
  frame({
    definitionId: "frame.blob",
    label: "不规则画框",
    defaultAspectRatio: 1.05,
    path: {
      d: "M15 18 C29 2 55 4 67 12 C86 9 99 29 92 46 C103 65 86 91 65 88 C49 102 22 94 18 75 C0 64 1 35 15 18 Z",
      fillRule: "nonzero",
      viewBox,
    },
  }),
] as const satisfies readonly CanvasFrameDefinitionV1[];

export const canvasGridCatalogV1 = [
  grid({
    definitionId: "grid.two.columns",
    label: "双列",
    defaultAspectRatio: 1.5,
    slots: [
      { id: "left", x: 0, y: 0, width: 0.5, height: 1 },
      { id: "right", x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  }),
  grid({
    definitionId: "grid.two.rows",
    label: "双行",
    defaultAspectRatio: 0.8,
    slots: [
      { id: "top", x: 0, y: 0, width: 1, height: 0.5 },
      { id: "bottom", x: 0, y: 0.5, width: 1, height: 0.5 },
    ],
  }),
  grid({
    definitionId: "grid.three.columns",
    label: "三列",
    defaultAspectRatio: 1.8,
    slots: [
      { id: "left", x: 0, y: 0, width: 1 / 3, height: 1 },
      {
        id: "center",
        x: 1 / 3,
        y: 0,
        width: 1 / 3,
        height: 1,
      },
      {
        id: "right",
        x: 2 / 3,
        y: 0,
        width: 1 / 3,
        height: 1,
      },
    ],
  }),
  grid({
    definitionId: "grid.hero-left",
    label: "左主图",
    defaultAspectRatio: 1.4,
    slots: [
      { id: "hero", x: 0, y: 0, width: 2 / 3, height: 1 },
      {
        id: "top-right",
        x: 2 / 3,
        y: 0,
        width: 1 / 3,
        height: 0.5,
      },
      {
        id: "bottom-right",
        x: 2 / 3,
        y: 0.5,
        width: 1 / 3,
        height: 0.5,
      },
    ],
  }),
  grid({
    definitionId: "grid.hero-top",
    label: "顶部主图",
    defaultAspectRatio: 1,
    slots: [
      { id: "hero", x: 0, y: 0, width: 1, height: 2 / 3 },
      {
        id: "bottom-left",
        x: 0,
        y: 2 / 3,
        width: 0.5,
        height: 1 / 3,
      },
      {
        id: "bottom-right",
        x: 0.5,
        y: 2 / 3,
        width: 0.5,
        height: 1 / 3,
      },
    ],
  }),
  grid({
    definitionId: "grid.four",
    label: "四宫格",
    defaultAspectRatio: 1,
    slots: [
      { id: "top-left", x: 0, y: 0, width: 0.5, height: 0.5 },
      {
        id: "top-right",
        x: 0.5,
        y: 0,
        width: 0.5,
        height: 0.5,
      },
      {
        id: "bottom-left",
        x: 0,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      },
      {
        id: "bottom-right",
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      },
    ],
  }),
  grid({
    definitionId: "grid.nine",
    label: "九宫格",
    defaultAspectRatio: 1,
    slots: Array.from({ length: 9 }, (_, index) => ({
      id: `cell-${String(index + 1)}`,
      x: (index % 3) / 3,
      y: Math.floor(index / 3) / 3,
      width: 1 / 3,
      height: 1 / 3,
    })),
  }),
] as const satisfies readonly CanvasGridDefinitionV1[];

const frames = new Map(
  canvasFrameCatalogV1.map((definition) => [
    definition.definitionId,
    definition,
  ]),
);
const grids = new Map(
  canvasGridCatalogV1.map((definition) => [
    definition.definitionId,
    definition,
  ]),
);

export function canvasFrameDefinitionV1(
  reference: EditorCatalogReferenceV1,
): CanvasFrameDefinitionV1 {
  if (reference.catalogId !== "kanvas.core.frames") {
    throw new Error(`Frame catalog ${reference.catalogId} is not loaded.`);
  }
  const definition = frames.get(reference.definitionId);
  if (!definition || definition.revision !== reference.revision) {
    throw new Error(
      `Frame ${reference.definitionId}@${reference.revision} is not loaded.`,
    );
  }
  return definition;
}

export function canvasGridDefinitionV1(
  reference: EditorCatalogReferenceV1,
): CanvasGridDefinitionV1 {
  if (reference.catalogId !== "kanvas.core.grids") {
    throw new Error(`Grid catalog ${reference.catalogId} is not loaded.`);
  }
  const definition = grids.get(reference.definitionId);
  if (!definition || definition.revision !== reference.revision) {
    throw new Error(
      `Grid ${reference.definitionId}@${reference.revision} is not loaded.`,
    );
  }
  return definition;
}
