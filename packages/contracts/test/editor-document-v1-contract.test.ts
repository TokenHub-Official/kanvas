import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  EditorDocumentV1Schema,
  type EditorDocumentV1,
  type EditorNodeKindV1,
  type EditorNodeV1,
} from "../src/editor/index.js";

const transform = {
  x: 120,
  y: 160,
  width: 640,
  height: 480,
  rotation: 0,
  flipX: false,
  flipY: false,
};

const common = {
  transform,
  opacity: 1,
  blendMode: "normal" as const,
  visible: true,
  locked: false,
};

const nonePaint = {
  kind: "none" as const,
};

const solidPaint = {
  kind: "solid" as const,
  color: "#3048f5",
};

const stroke = {
  paint: nonePaint,
  width: 0,
  alignment: "center" as const,
};

const catalogReference = {
  catalogId: "kanvas.core",
  definitionId: "basic.rectangle",
  revision: "2026-07-31",
};

const image = {
  source: {
    kind: "artifact" as const,
    artifactId: "01K00000000000000000000031",
  },
  intrinsicWidth: 2_400,
  intrinsicHeight: 1_800,
  mediaType: "image/png" as const,
  crop: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  },
  fit: "cover" as const,
  focalPoint: {
    x: 0.5,
    y: 0.5,
  },
};

const textContent = {
  paragraphs: [
    {
      align: "center" as const,
      direction: "auto" as const,
      lineHeight: 1.1,
      spaceBefore: 0,
      spaceAfter: 0,
      runs: [
        {
          text: "Kanvas",
          font: {
            source: "builtin" as const,
            fontId: "noto-sans-sc",
            family: "Noto Sans SC",
            revision: "2.004",
          },
          fontSize: 96,
          fontWeight: 700,
          fontStyle: "normal" as const,
          letterSpacing: -2,
          fill: solidPaint,
          decoration: {
            underline: false,
            strikeThrough: false,
          },
        },
      ],
    },
  ],
  verticalAlign: "middle" as const,
  resizeMode: "auto_height" as const,
};

const leafNodes: readonly EditorNodeV1[] = [
  {
    ...common,
    id: "image-1",
    name: "商品图",
    kind: "image",
    image,
    cornerRadius: 24,
    altText: "商品正面图",
  },
  {
    ...common,
    id: "text-1",
    name: "艺术标题",
    kind: "text",
    content: textContent,
    effects: [
      {
        kind: "outline",
        color: "#ffffff",
        width: 8,
      },
      {
        kind: "curve",
        amount: 0.34,
      },
      {
        kind: "offset_layers",
        layers: [
          {
            color: "#ff2f70",
            offsetX: -8,
            offsetY: 0,
            opacity: 0.9,
          },
          {
            color: "#25d9ff",
            offsetX: 8,
            offsetY: 0,
            opacity: 0.9,
          },
        ],
      },
    ],
    preset: {
      ...catalogReference,
      definitionId: "text.glitch",
    },
  },
  {
    ...common,
    id: "shape-1",
    name: "流程图决策",
    kind: "shape",
    definition: {
      ...catalogReference,
      definitionId: "flowchart.decision",
    },
    parameters: {
      cornerBias: 0.2,
      mirror: false,
      semanticRole: "decision",
    },
    fill: solidPaint,
    stroke,
    label: {
      content: textContent,
      padding: {
        top: 24,
        right: 24,
        bottom: 24,
        left: 24,
      },
    },
  },
  {
    ...common,
    id: "line-1",
    name: "连接箭头",
    kind: "line",
    pathKind: "elbow",
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1 },
    ],
    stroke: {
      paint: solidPaint,
      width: 8,
      alignment: "center",
      dash: [16, 8],
    },
    startCap: "none",
    endCap: "hollow_circle",
    startBinding: {
      nodeId: "shape-1",
      anchor: "right",
    },
    endBinding: {
      nodeId: "shape-1",
      anchor: "bottom",
    },
    role: "design",
    capStyle: "square",
    joinStyle: "bevel",
  },
  {
    ...common,
    id: "graphic-1",
    name: "品牌插画",
    kind: "graphic",
    source: {
      kind: "catalog",
      catalogId: "workspace.brand",
      resourceId: "illustration.launch",
      revision: "8",
    },
    colorSlots: {
      primary: "#3048f5",
      accent: "#ff2f70",
    },
    preserveAspectRatio: true,
  },
  {
    ...common,
    id: "frame-1",
    name: "圆形画框",
    kind: "frame",
    definition: {
      ...catalogReference,
      definitionId: "frame.circle",
    },
    content: {
      image,
    },
    fill: nonePaint,
    stroke,
  },
  {
    ...common,
    id: "grid-1",
    name: "三图拼接",
    kind: "grid",
    definition: {
      ...catalogReference,
      definitionId: "grid.three.columns",
    },
    gap: 16,
    cornerRadius: 20,
    cells: [
      {
        slotId: "left",
        content: { image },
      },
      {
        slotId: "center",
      },
      {
        slotId: "right",
      },
    ],
  },
];

const group: EditorNodeV1 = {
  ...common,
  id: "group-1",
  name: "商品信息组",
  kind: "group",
  children: [leafNodes[0]!, leafNodes[1]!],
};

const document: EditorDocumentV1 = {
  schemaVersion: "kanvas.editor-document/v1",
  documentId: "01K00000000000000000000020",
  workspaceId: "01K00000000000000000000000",
  title: "商品活动页",
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1350,
      background: {
        kind: "paint",
        paint: {
          kind: "linear_gradient",
          angle: 135,
          stops: [
            {
              color: "#ffffff",
              offset: 0,
            },
            {
              color: "#f0f3ff",
              offset: 1,
            },
          ],
        },
      },
      overlays: {
        safeArea: {
          top: 48,
          right: 48,
          bottom: 48,
          left: 48,
        },
        guides: [
          {
            id: "guide-center",
            axis: "vertical",
            position: 540,
            locked: true,
          },
        ],
      },
      nodes: [...leafNodes, group],
    },
  ],
  metadata: {
    createdWith: "kanvas-web",
  },
};

describe("EditorDocumentV1Schema", () => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  const validate = ajv.compile(EditorDocumentV1Schema);

  it("accepts the complete Canvas Core V1 node vocabulary", () => {
    expect(validate(document), JSON.stringify(validate.errors, null, 2)).toBe(
      true,
    );

    const kinds = new Set(document.pages[0]?.nodes.map((node) => node.kind));
    const expectedKinds: readonly EditorNodeKindV1[] = [
      "image",
      "text",
      "shape",
      "line",
      "graphic",
      "frame",
      "grid",
      "group",
    ];
    expect(kinds).toEqual(new Set(expectedKinds));
  });

  it("keeps shape definitions catalog-driven instead of enum-bound", () => {
    const shape = document.pages[0]?.nodes.find(
      (node) => node.kind === "shape",
    );

    expect(shape).toMatchObject({
      definition: {
        catalogId: "kanvas.core",
        definitionId: "flowchart.decision",
        revision: "2026-07-31",
      },
    });
    expect(validate(document)).toBe(true);
  });

  it("persists editable artistic text as content plus effects", () => {
    const text = document.pages[0]?.nodes.find((node) => node.kind === "text");

    expect(text).toMatchObject({
      content: {
        paragraphs: [
          {
            runs: [
              {
                text: "Kanvas",
                font: {
                  fontId: "noto-sans-sc",
                },
              },
            ],
          },
        ],
      },
      effects: [
        { kind: "outline" },
        { kind: "curve" },
        { kind: "offset_layers" },
      ],
    });
  });

  it("supports nested group nodes without a parallel group table", () => {
    expect(group).toMatchObject({
      kind: "group",
      children: [{ kind: "image" }, { kind: "text" }],
    });
    expect(validate(document)).toBe(true);
  });

  it("rejects transient local URLs as durable image sources", () => {
    const invalid = structuredClone(document) as unknown as {
      pages: {
        nodes: {
          image?: {
            source: unknown;
          };
        }[];
      }[];
    };
    invalid.pages[0]!.nodes[0]!.image!.source = {
      kind: "data_url",
      value: "data:image/png;base64,AAAA",
    };

    expect(validate(invalid)).toBe(false);
  });

  it("does not allow a page background to masquerade as a node", () => {
    const invalid = structuredClone(document) as unknown as {
      pages: {
        nodes: unknown[];
      }[];
    };
    invalid.pages[0]!.nodes.push({
      ...common,
      id: "background-1",
      name: "背景",
      kind: "background",
      paint: solidPaint,
    });

    expect(validate(invalid)).toBe(false);
  });
});
