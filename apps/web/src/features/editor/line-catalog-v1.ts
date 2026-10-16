import type {
  EditorCatalogReferenceV1,
  EditorLineNodeV1,
} from "@kanvas/contracts/editor";

export interface CanvasLineDefinitionV1 {
  readonly dash?: readonly number[];
  readonly definitionId: string;
  readonly endCap: EditorLineNodeV1["endCap"];
  readonly label: string;
  readonly pathKind: EditorLineNodeV1["pathKind"];
  readonly points: readonly EditorLineNodeV1["points"][number][];
  readonly revision: string;
  readonly startCap: EditorLineNodeV1["startCap"];
  readonly strokeWidth: number;
}

const revision = "2026-07-31";

function line(
  value: Omit<CanvasLineDefinitionV1, "revision">,
): CanvasLineDefinitionV1 {
  return {
    ...value,
    revision,
  };
}

const straightPoints = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
] as const;

export const canvasLineCatalogV1 = [
  line({
    definitionId: "line.straight",
    label: "直线",
    pathKind: "straight",
    points: straightPoints,
    startCap: "none",
    endCap: "none",
    strokeWidth: 4,
  }),
  line({
    definitionId: "line.arrow",
    label: "箭头",
    pathKind: "straight",
    points: straightPoints,
    startCap: "none",
    endCap: "arrow",
    strokeWidth: 4,
  }),
  line({
    definitionId: "line.double-arrow",
    label: "双向箭头",
    pathKind: "straight",
    points: straightPoints,
    startCap: "arrow",
    endCap: "arrow",
    strokeWidth: 4,
  }),
  line({
    definitionId: "line.dashed",
    label: "虚线",
    pathKind: "straight",
    points: straightPoints,
    startCap: "none",
    endCap: "none",
    strokeWidth: 4,
    dash: [12, 10],
  }),
  line({
    definitionId: "line.dotted",
    label: "点线",
    pathKind: "straight",
    points: straightPoints,
    startCap: "circle",
    endCap: "circle",
    strokeWidth: 4,
    dash: [1, 10],
  }),
  line({
    definitionId: "line.curve",
    label: "曲线",
    pathKind: "curve",
    points: [
      { x: 0, y: 0.8 },
      { x: 0.5, y: 0.05 },
      { x: 1, y: 0.8 },
    ],
    startCap: "none",
    endCap: "none",
    strokeWidth: 4,
  }),
  line({
    definitionId: "line.curve-arrow",
    label: "曲线箭头",
    pathKind: "curve",
    points: [
      { x: 0, y: 0.8 },
      { x: 0.5, y: 0.05 },
      { x: 1, y: 0.8 },
    ],
    startCap: "none",
    endCap: "arrow",
    strokeWidth: 4,
  }),
  line({
    definitionId: "line.elbow",
    label: "折线",
    pathKind: "polyline",
    points: [
      { x: 0, y: 0.15 },
      { x: 0.55, y: 0.15 },
      { x: 0.55, y: 0.85 },
      { x: 1, y: 0.85 },
    ],
    startCap: "none",
    endCap: "none",
    strokeWidth: 4,
  }),
  line({
    definitionId: "line.elbow-arrow",
    label: "折线箭头",
    pathKind: "polyline",
    points: [
      { x: 0, y: 0.15 },
      { x: 0.55, y: 0.15 },
      { x: 0.55, y: 0.85 },
      { x: 1, y: 0.85 },
    ],
    startCap: "none",
    endCap: "arrow",
    strokeWidth: 4,
  }),
  line({
    definitionId: "line.measure",
    label: "尺寸线",
    pathKind: "straight",
    points: straightPoints,
    startCap: "square",
    endCap: "square",
    strokeWidth: 3,
  }),
] as const satisfies readonly CanvasLineDefinitionV1[];

const definitions = new Map(
  canvasLineCatalogV1.map((definition) => [
    definition.definitionId,
    definition,
  ]),
);

export function canvasLineDefinitionV1(
  reference: EditorCatalogReferenceV1,
): CanvasLineDefinitionV1 {
  if (reference.catalogId !== "kanvas.core.lines") {
    throw new Error(`Line catalog ${reference.catalogId} is not loaded.`);
  }
  const definition = definitions.get(reference.definitionId);
  if (!definition || definition.revision !== reference.revision) {
    throw new Error(
      `Line ${reference.definitionId}@${reference.revision} is not loaded.`,
    );
  }
  return definition;
}
