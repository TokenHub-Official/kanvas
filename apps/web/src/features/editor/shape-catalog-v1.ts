import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";

export interface CanvasShapePointV1 {
  readonly x: number;
  readonly y: number;
}

export type CanvasShapeGeometryV1 =
  | {
      readonly defaultArmWidth: number;
      readonly kind: "cross";
    }
  | {
      readonly kind: "ellipse";
    }
  | {
      readonly kind: "path";
      readonly path: string;
    }
  | {
      readonly kind: "polygon";
      readonly points: readonly CanvasShapePointV1[];
    }
  | {
      readonly kind: "rectangle";
    }
  | {
      readonly innerRadius: number;
      readonly kind: "ring";
    }
  | {
      readonly defaultTailPosition: number;
      readonly kind: "speech_rounded";
    }
  | {
      readonly kind: "sticky_note";
    };

export type CanvasShapeCategoryV1 =
  "arrows" | "basic" | "callouts" | "decorative" | "flowchart";

export interface CanvasShapeNumberParameterV1 {
  readonly defaultValue: number;
  readonly id: string;
  readonly kind: "number";
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
}

export interface CanvasShapeTextAreaV1 {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export interface CanvasShapeDefinitionV1 {
  readonly category: CanvasShapeCategoryV1;
  readonly defaultAspectRatio: number;
  readonly definitionId: string;
  readonly geometry: CanvasShapeGeometryV1;
  readonly keywords: readonly string[];
  readonly label: string;
  readonly parameters: readonly CanvasShapeNumberParameterV1[];
  readonly revision: string;
  readonly supportsText: boolean;
  readonly textArea: CanvasShapeTextAreaV1;
}

const revision = "2026-07-31";

const fullTextArea = {
  top: 0.08,
  right: 0.08,
  bottom: 0.08,
  left: 0.08,
} as const;

const insetTextArea = {
  top: 0.16,
  right: 0.16,
  bottom: 0.16,
  left: 0.16,
} as const;

const noParameters = [] as const;

function regularPolygon(
  sides: number,
  rotation = -Math.PI / 2,
): readonly CanvasShapePointV1[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / sides;
    return {
      x: 0.5 + Math.cos(angle) * 0.48,
      y: 0.5 + Math.sin(angle) * 0.48,
    };
  });
}

function starPolygon(
  points: number,
  innerRadius = 0.44,
): readonly CanvasShapePointV1[] {
  return Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 0.48 : 0.48 * innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    return {
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius,
    };
  });
}

function definition(
  value: Omit<CanvasShapeDefinitionV1, "revision">,
): CanvasShapeDefinitionV1 {
  return {
    ...value,
    revision,
  };
}

function polygonDefinition(
  definitionId: string,
  label: string,
  category: CanvasShapeCategoryV1,
  points: readonly CanvasShapePointV1[],
  options: {
    readonly aspectRatio?: number;
    readonly keywords?: readonly string[];
    readonly supportsText?: boolean;
    readonly textArea?: CanvasShapeTextAreaV1;
  } = {},
): CanvasShapeDefinitionV1 {
  return definition({
    definitionId,
    label,
    category,
    defaultAspectRatio: options.aspectRatio ?? 1,
    supportsText: options.supportsText ?? true,
    textArea: options.textArea ?? insetTextArea,
    keywords: options.keywords ?? [],
    parameters: noParameters,
    geometry: {
      kind: "polygon",
      points,
    },
  });
}

const basicShapes = [
  definition({
    definitionId: "basic.rectangle",
    label: "矩形",
    category: "basic",
    defaultAspectRatio: 1.2,
    supportsText: true,
    textArea: fullTextArea,
    keywords: ["方形", "正方形", "rectangle", "square"],
    parameters: [
      {
        id: "cornerRadius",
        label: "圆角",
        kind: "number",
        minimum: 0,
        maximum: 0.5,
        defaultValue: 0,
      },
    ],
    geometry: {
      kind: "rectangle",
    },
  }),
  definition({
    definitionId: "basic.rounded-rectangle",
    label: "圆角矩形",
    category: "basic",
    defaultAspectRatio: 1.4,
    supportsText: true,
    textArea: fullTextArea,
    keywords: ["卡片", "按钮", "rounded rectangle"],
    parameters: [
      {
        id: "cornerRadius",
        label: "圆角",
        kind: "number",
        minimum: 0,
        maximum: 0.5,
        defaultValue: 0.18,
      },
    ],
    geometry: {
      kind: "rectangle",
    },
  }),
  definition({
    definitionId: "basic.sticky-note",
    label: "便签",
    category: "basic",
    defaultAspectRatio: 1.08,
    supportsText: true,
    textArea: {
      top: 0.12,
      right: 0.14,
      bottom: 0.2,
      left: 0.12,
    },
    keywords: ["便利贴", "sticky note", "memo"],
    parameters: noParameters,
    geometry: {
      kind: "sticky_note",
    },
  }),
  definition({
    definitionId: "basic.ellipse",
    label: "圆形",
    category: "basic",
    defaultAspectRatio: 1,
    supportsText: true,
    textArea: insetTextArea,
    keywords: ["椭圆", "circle", "ellipse"],
    parameters: noParameters,
    geometry: {
      kind: "ellipse",
    },
  }),
  polygonDefinition("basic.triangle", "三角形", "basic", regularPolygon(3), {
    keywords: ["triangle"],
  }),
  polygonDefinition(
    "basic.right-triangle",
    "直角三角形",
    "basic",
    [
      { x: 0.02, y: 0.02 },
      { x: 0.98, y: 0.98 },
      { x: 0.02, y: 0.98 },
    ],
    { keywords: ["right triangle"] },
  ),
  polygonDefinition("basic.diamond", "菱形", "basic", regularPolygon(4), {
    keywords: ["diamond", "rhombus"],
  }),
  polygonDefinition(
    "basic.parallelogram",
    "平行四边形",
    "basic",
    [
      { x: 0.2, y: 0.02 },
      { x: 0.98, y: 0.02 },
      { x: 0.8, y: 0.98 },
      { x: 0.02, y: 0.98 },
    ],
    { aspectRatio: 1.3, keywords: ["parallelogram"] },
  ),
  polygonDefinition(
    "basic.trapezoid",
    "梯形",
    "basic",
    [
      { x: 0.2, y: 0.02 },
      { x: 0.8, y: 0.02 },
      { x: 0.98, y: 0.98 },
      { x: 0.02, y: 0.98 },
    ],
    { aspectRatio: 1.2, keywords: ["trapezoid"] },
  ),
  ...[
    [5, "五边形", "pentagon"],
    [6, "六边形", "hexagon"],
    [7, "七边形", "heptagon"],
    [8, "八边形", "octagon"],
    [10, "十边形", "decagon"],
    [12, "十二边形", "dodecagon"],
  ].map(([sides, label, keyword]) =>
    polygonDefinition(
      `basic.polygon-${String(sides)}`,
      String(label),
      "basic",
      regularPolygon(Number(sides)),
      { keywords: [String(keyword)] },
    ),
  ),
  definition({
    definitionId: "basic.cross",
    label: "十字形",
    category: "basic",
    defaultAspectRatio: 1,
    supportsText: false,
    textArea: insetTextArea,
    keywords: ["加号", "cross", "plus"],
    parameters: [
      {
        id: "armWidth",
        label: "臂宽",
        kind: "number",
        minimum: 0.08,
        maximum: 0.48,
        defaultValue: 0.28,
      },
    ],
    geometry: {
      kind: "cross",
      defaultArmWidth: 0.28,
    },
  }),
  definition({
    definitionId: "basic.ring",
    label: "圆环",
    category: "basic",
    defaultAspectRatio: 1,
    supportsText: false,
    textArea: insetTextArea,
    keywords: ["环形", "donut", "ring"],
    parameters: [
      {
        id: "innerRadius",
        label: "内径",
        kind: "number",
        minimum: 0.05,
        maximum: 0.92,
        defaultValue: 0.62,
      },
    ],
    geometry: {
      kind: "ring",
      innerRadius: 0.62,
    },
  }),
  definition({
    definitionId: "basic.semicircle",
    label: "半圆",
    category: "basic",
    defaultAspectRatio: 2,
    supportsText: true,
    textArea: {
      top: 0.3,
      right: 0.12,
      bottom: 0.08,
      left: 0.12,
    },
    keywords: ["半圆形", "semicircle"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M2 98 A48 48 0 0 1 98 98 Z",
    },
  }),
  definition({
    definitionId: "basic.heart",
    label: "心形",
    category: "basic",
    defaultAspectRatio: 1.05,
    supportsText: false,
    textArea: insetTextArea,
    keywords: ["爱心", "heart", "love"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M50 92 C42 82 8 59 8 31 C8 13 30 5 43 20 L50 28 L57 20 C70 5 92 13 92 31 C92 59 58 82 50 92 Z",
    },
  }),
  definition({
    definitionId: "basic.cloud",
    label: "云形",
    category: "basic",
    defaultAspectRatio: 1.4,
    supportsText: true,
    textArea: insetTextArea,
    keywords: ["云朵", "cloud"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M22 82 C8 82 4 68 12 58 C7 43 20 30 34 35 C41 17 66 15 76 33 C94 32 103 54 91 67 C92 76 85 82 74 82 Z",
    },
  }),
] as const satisfies readonly CanvasShapeDefinitionV1[];

const arrowShapes = [
  polygonDefinition(
    "arrow.right",
    "右箭头",
    "arrows",
    [
      { x: 0.02, y: 0.3 },
      { x: 0.62, y: 0.3 },
      { x: 0.62, y: 0.08 },
      { x: 0.98, y: 0.5 },
      { x: 0.62, y: 0.92 },
      { x: 0.62, y: 0.7 },
      { x: 0.02, y: 0.7 },
    ],
    { aspectRatio: 1.5, keywords: ["right arrow"] },
  ),
  polygonDefinition(
    "arrow.left",
    "左箭头",
    "arrows",
    [
      { x: 0.98, y: 0.3 },
      { x: 0.38, y: 0.3 },
      { x: 0.38, y: 0.08 },
      { x: 0.02, y: 0.5 },
      { x: 0.38, y: 0.92 },
      { x: 0.38, y: 0.7 },
      { x: 0.98, y: 0.7 },
    ],
    { aspectRatio: 1.5, keywords: ["left arrow"] },
  ),
  polygonDefinition(
    "arrow.up",
    "上箭头",
    "arrows",
    [
      { x: 0.3, y: 0.98 },
      { x: 0.3, y: 0.38 },
      { x: 0.08, y: 0.38 },
      { x: 0.5, y: 0.02 },
      { x: 0.92, y: 0.38 },
      { x: 0.7, y: 0.38 },
      { x: 0.7, y: 0.98 },
    ],
    { aspectRatio: 0.68, keywords: ["up arrow"] },
  ),
  polygonDefinition(
    "arrow.down",
    "下箭头",
    "arrows",
    [
      { x: 0.3, y: 0.02 },
      { x: 0.3, y: 0.62 },
      { x: 0.08, y: 0.62 },
      { x: 0.5, y: 0.98 },
      { x: 0.92, y: 0.62 },
      { x: 0.7, y: 0.62 },
      { x: 0.7, y: 0.02 },
    ],
    { aspectRatio: 0.68, keywords: ["down arrow"] },
  ),
  polygonDefinition(
    "arrow.double-horizontal",
    "左右箭头",
    "arrows",
    [
      { x: 0.02, y: 0.5 },
      { x: 0.26, y: 0.12 },
      { x: 0.26, y: 0.32 },
      { x: 0.74, y: 0.32 },
      { x: 0.74, y: 0.12 },
      { x: 0.98, y: 0.5 },
      { x: 0.74, y: 0.88 },
      { x: 0.74, y: 0.68 },
      { x: 0.26, y: 0.68 },
      { x: 0.26, y: 0.88 },
    ],
    { aspectRatio: 1.6, keywords: ["double arrow"] },
  ),
  polygonDefinition(
    "arrow.double-vertical",
    "上下箭头",
    "arrows",
    [
      { x: 0.5, y: 0.02 },
      { x: 0.88, y: 0.26 },
      { x: 0.68, y: 0.26 },
      { x: 0.68, y: 0.74 },
      { x: 0.88, y: 0.74 },
      { x: 0.5, y: 0.98 },
      { x: 0.12, y: 0.74 },
      { x: 0.32, y: 0.74 },
      { x: 0.32, y: 0.26 },
      { x: 0.12, y: 0.26 },
    ],
    { aspectRatio: 0.62, keywords: ["vertical double arrow"] },
  ),
  ...[
    ["right", "右折角", false],
    ["left", "左折角", true],
  ].map(([direction, label, mirrored]) =>
    polygonDefinition(
      `arrow.chevron-${String(direction)}`,
      String(label),
      "arrows",
      (
        [
          { x: 0.14, y: 0.02 },
          { x: 0.5, y: 0.5 },
          { x: 0.14, y: 0.98 },
          { x: 0.5, y: 0.98 },
          { x: 0.86, y: 0.5 },
          { x: 0.5, y: 0.02 },
        ] as const
      ).map((point) => ({
        x: mirrored ? 1 - point.x : point.x,
        y: point.y,
      })),
      {
        aspectRatio: 0.7,
        supportsText: false,
        keywords: ["chevron", String(direction)],
      },
    ),
  ),
  definition({
    definitionId: "arrow.bent-right",
    label: "转弯箭头",
    category: "arrows",
    defaultAspectRatio: 1,
    supportsText: false,
    textArea: insetTextArea,
    keywords: ["转向", "bent arrow", "turn"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M12 88 V48 C12 30 26 16 44 16 H68 V4 L96 26 L68 48 V36 H44 C37 36 32 41 32 48 V88 Z",
    },
  }),
  definition({
    definitionId: "arrow.u-turn",
    label: "回转箭头",
    category: "arrows",
    defaultAspectRatio: 0.9,
    supportsText: false,
    textArea: insetTextArea,
    keywords: ["掉头", "u turn", "return"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M78 96 V44 C78 30 68 20 54 20 C40 20 30 30 30 44 V56 H44 L22 84 L0 56 H12 V44 C12 20 30 2 54 2 C78 2 96 20 96 44 V96 Z",
    },
  }),
] as const satisfies readonly CanvasShapeDefinitionV1[];

const decorativeShapes = [
  ...[
    [4, "四角星"],
    [5, "五角星"],
    [6, "六角星"],
    [8, "八角星"],
    [12, "十二角星"],
  ].map(([points, label]) =>
    polygonDefinition(
      `decorative.star-${String(points)}`,
      String(label),
      "decorative",
      starPolygon(Number(points)),
      {
        supportsText: Number(points) >= 8,
        keywords: ["星形", "star", String(points)],
      },
    ),
  ),
  polygonDefinition(
    "decorative.burst-8",
    "八角爆炸形",
    "decorative",
    starPolygon(8, 0.72),
    { keywords: ["爆炸贴", "burst", "sale"] },
  ),
  polygonDefinition(
    "decorative.burst-16",
    "十六角爆炸形",
    "decorative",
    starPolygon(16, 0.74),
    { keywords: ["促销贴", "burst", "promotion"] },
  ),
  definition({
    definitionId: "decorative.ribbon",
    label: "丝带",
    category: "decorative",
    defaultAspectRatio: 2.2,
    supportsText: true,
    textArea: {
      top: 0.18,
      right: 0.24,
      bottom: 0.18,
      left: 0.24,
    },
    keywords: ["横幅", "ribbon", "banner"],
    parameters: noParameters,
    geometry: {
      kind: "polygon",
      points: [
        { x: 0.02, y: 0.14 },
        { x: 0.22, y: 0.14 },
        { x: 0.22, y: 0.02 },
        { x: 0.78, y: 0.02 },
        { x: 0.78, y: 0.14 },
        { x: 0.98, y: 0.14 },
        { x: 0.86, y: 0.5 },
        { x: 0.98, y: 0.86 },
        { x: 0.78, y: 0.86 },
        { x: 0.78, y: 0.98 },
        { x: 0.22, y: 0.98 },
        { x: 0.22, y: 0.86 },
        { x: 0.02, y: 0.86 },
        { x: 0.14, y: 0.5 },
      ],
    },
  }),
] as const satisfies readonly CanvasShapeDefinitionV1[];

const calloutShapes = [
  definition({
    definitionId: "callout.speech-rounded",
    label: "圆角对话框",
    category: "callouts",
    defaultAspectRatio: 1.35,
    supportsText: true,
    textArea: {
      top: 0.1,
      right: 0.1,
      bottom: 0.28,
      left: 0.1,
    },
    keywords: ["对话", "气泡", "speech bubble"],
    parameters: [
      {
        id: "tailPosition",
        label: "尾巴位置",
        kind: "number",
        minimum: 0.1,
        maximum: 0.9,
        defaultValue: 0.3,
      },
    ],
    geometry: {
      kind: "speech_rounded",
      defaultTailPosition: 0.3,
    },
  }),
  definition({
    definitionId: "callout.speech-ellipse",
    label: "椭圆对话框",
    category: "callouts",
    defaultAspectRatio: 1.35,
    supportsText: true,
    textArea: {
      top: 0.16,
      right: 0.14,
      bottom: 0.28,
      left: 0.14,
    },
    keywords: ["椭圆气泡", "speech oval"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M50 4 C76 4 96 19 96 40 C96 61 76 76 50 76 H38 L20 96 L24 72 C11 65 4 53 4 40 C4 19 24 4 50 4 Z",
    },
  }),
  definition({
    definitionId: "callout.thought",
    label: "思考气泡",
    category: "callouts",
    defaultAspectRatio: 1.3,
    supportsText: true,
    textArea: insetTextArea,
    keywords: ["思考", "thought bubble"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M20 70 C6 64 4 48 14 38 C8 22 24 10 40 16 C50 2 72 6 76 22 C94 22 102 40 92 54 C96 68 82 78 68 74 C56 86 36 82 30 72 Z M20 82 A7 7 0 1 0 20 96 A7 7 0 1 0 20 82 Z",
    },
  }),
  definition({
    definitionId: "callout.bracket",
    label: "括号标注",
    category: "callouts",
    defaultAspectRatio: 1.7,
    supportsText: true,
    textArea: fullTextArea,
    keywords: ["标注", "bracket", "annotation"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M18 4 H4 V96 H18 V86 H14 V14 H18 Z M82 4 H96 V96 H82 V86 H86 V14 H82 Z",
    },
  }),
] as const satisfies readonly CanvasShapeDefinitionV1[];

const flowchartShapes = [
  ["process", "流程", "rectangle"],
  ["terminator", "开始/结束", "ellipse"],
].map(([id, label, geometryKind]) =>
  definition({
    definitionId: `flowchart.${String(id)}`,
    label: String(label),
    category: "flowchart",
    defaultAspectRatio: 1.7,
    supportsText: true,
    textArea: fullTextArea,
    keywords: ["流程图", "flowchart", String(id)],
    parameters: noParameters,
    geometry:
      geometryKind === "ellipse"
        ? { kind: "ellipse" as const }
        : { kind: "rectangle" as const },
  }),
);

flowchartShapes.push(
  polygonDefinition(
    "flowchart.decision",
    "判断",
    "flowchart",
    regularPolygon(4),
    { aspectRatio: 1.5, keywords: ["决策", "decision"] },
  ),
  polygonDefinition(
    "flowchart.data",
    "数据",
    "flowchart",
    [
      { x: 0.14, y: 0.02 },
      { x: 0.98, y: 0.02 },
      { x: 0.86, y: 0.98 },
      { x: 0.02, y: 0.98 },
    ],
    { aspectRatio: 1.6, keywords: ["输入输出", "data"] },
  ),
  definition({
    definitionId: "flowchart.document",
    label: "文档",
    category: "flowchart",
    defaultAspectRatio: 1.45,
    supportsText: true,
    textArea: {
      top: 0.08,
      right: 0.08,
      bottom: 0.2,
      left: 0.08,
    },
    keywords: ["文件", "document"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M2 2 H98 V82 C78 68 62 96 42 82 C24 70 14 86 2 78 Z",
    },
  }),
  definition({
    definitionId: "flowchart.predefined-process",
    label: "预定义流程",
    category: "flowchart",
    defaultAspectRatio: 1.7,
    supportsText: true,
    textArea: {
      top: 0.08,
      right: 0.18,
      bottom: 0.08,
      left: 0.18,
    },
    keywords: ["子流程", "predefined process"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M2 2 H98 V98 H2 Z M16 2 V98 M84 2 V98",
    },
  }),
  definition({
    definitionId: "flowchart.database",
    label: "数据库",
    category: "flowchart",
    defaultAspectRatio: 1.2,
    supportsText: true,
    textArea: insetTextArea,
    keywords: ["存储", "database", "storage"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M4 18 C4 8 24 2 50 2 C76 2 96 8 96 18 V82 C96 92 76 98 50 98 C24 98 4 92 4 82 Z M4 18 C4 28 24 34 50 34 C76 34 96 28 96 18 M4 50 C4 60 24 66 50 66 C76 66 96 60 96 50",
    },
  }),
  polygonDefinition(
    "flowchart.manual-input",
    "手动输入",
    "flowchart",
    [
      { x: 0.12, y: 0.02 },
      { x: 0.98, y: 0.02 },
      { x: 0.98, y: 0.98 },
      { x: 0.02, y: 0.98 },
    ],
    { aspectRatio: 1.6, keywords: ["manual input"] },
  ),
  polygonDefinition(
    "flowchart.preparation",
    "准备",
    "flowchart",
    [
      { x: 0.18, y: 0.02 },
      { x: 0.82, y: 0.02 },
      { x: 0.98, y: 0.5 },
      { x: 0.82, y: 0.98 },
      { x: 0.18, y: 0.98 },
      { x: 0.02, y: 0.5 },
    ],
    { aspectRatio: 1.5, keywords: ["preparation"] },
  ),
  definition({
    definitionId: "flowchart.delay",
    label: "延迟",
    category: "flowchart",
    defaultAspectRatio: 1.45,
    supportsText: true,
    textArea: {
      top: 0.08,
      right: 0.24,
      bottom: 0.08,
      left: 0.08,
    },
    keywords: ["等待", "delay"],
    parameters: noParameters,
    geometry: {
      kind: "path",
      path: "M2 2 H54 C80 2 98 22 98 50 C98 78 80 98 54 98 H2 Z",
    },
  }),
);

export const canvasShapeCatalogV1 = [
  ...basicShapes,
  ...arrowShapes,
  ...decorativeShapes,
  ...calloutShapes,
  ...flowchartShapes,
] as const satisfies readonly CanvasShapeDefinitionV1[];

const definitions = new Map(
  canvasShapeCatalogV1.map((shape) => [shape.definitionId, shape]),
);

export function findCanvasShapeDefinitionV1(
  definitionId: string,
  definitionRevision = revision,
): CanvasShapeDefinitionV1 | undefined {
  const shape = definitions.get(definitionId);
  return shape?.revision === definitionRevision ? shape : undefined;
}

export function canvasShapeDefinitionV1(
  reference: EditorCatalogReferenceV1,
): CanvasShapeDefinitionV1 {
  if (reference.catalogId !== "kanvas.core.shapes") {
    throw new Error(`Shape catalog ${reference.catalogId} is not loaded.`);
  }
  const shape = findCanvasShapeDefinitionV1(
    reference.definitionId,
    reference.revision,
  );
  if (!shape) {
    throw new Error(
      `Shape ${reference.definitionId}@${reference.revision} is not loaded.`,
    );
  }
  return shape;
}
