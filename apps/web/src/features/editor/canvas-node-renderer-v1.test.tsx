import type { EditorNodeV1, EditorPageV1 } from "@kanvas/contracts/editor";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanvasPageV1 } from "./canvas-node-renderer-v1.js";
import type { EditorArtifactRuntimeResourceV1 } from "./editor-document-v1.js";
import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";

const common = {
  transform: {
    x: 40,
    y: 40,
    width: 240,
    height: 180,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  opacity: 1,
  blendMode: "normal" as const,
  visible: true,
  locked: false,
};

function placedImage(artifactId: string) {
  return {
    source: {
      kind: "artifact" as const,
      artifactId,
    },
    intrinsicWidth: 1_200,
    intrinsicHeight: 800,
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
}

function textNode(id: string): EditorNodeV1 {
  return {
    ...common,
    id,
    name: "标题",
    kind: "text",
    content: {
      paragraphs: [
        {
          align: "center",
          direction: "auto",
          lineHeight: 1.1,
          spaceBefore: 0,
          spaceAfter: 0,
          runs: [
            {
              text: "Kanvas",
              font: {
                source: "builtin",
                fontId: "noto-sans-sc",
                family: "Noto Sans SC",
                revision: "google-fonts-2026-07-31",
              },
              fontSize: 56,
              fontWeight: 800,
              fontStyle: "normal",
              letterSpacing: 1,
              fill: {
                kind: "solid",
                color: "#ffffff",
              },
              decoration: {
                underline: false,
                strikeThrough: false,
              },
            },
          ],
        },
      ],
      verticalAlign: "middle",
      resizeMode: "auto_height",
    },
    effects: [
      {
        kind: "outline",
        color: "#151515",
        width: 4,
      },
    ],
  };
}

function shapeNode(id: string): EditorNodeV1 {
  return {
    ...common,
    id,
    name: "判断",
    kind: "shape",
    definition: {
      catalogId: "kanvas.core.shapes",
      definitionId: "flowchart.decision",
      revision: "2026-07-31",
    },
    parameters: {},
    fill: {
      kind: "solid",
      color: "#3048f5",
    },
    stroke: {
      paint: {
        kind: "none",
      },
      width: 0,
      alignment: "center",
    },
  };
}

const nodes: readonly EditorNodeV1[] = [
  {
    ...common,
    id: "image-1",
    name: "图片",
    kind: "image",
    image: placedImage("01K00000000000000000000031"),
    cornerRadius: 20,
  },
  {
    ...common,
    id: "line-1",
    name: "箭头",
    kind: "line",
    pathKind: "curve",
    points: [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
    ],
    stroke: {
      paint: {
        kind: "solid",
        color: "#151515",
      },
      width: 6,
      alignment: "center",
    },
    startCap: "circle",
    endCap: "hollow_diamond",
    role: "design",
    capStyle: "square",
    joinStyle: "bevel",
  },
  {
    ...common,
    id: "graphic-1",
    name: "插画",
    kind: "graphic",
    source: {
      kind: "artifact",
      artifactId: "01K00000000000000000000032",
    },
    colorSlots: {},
    preserveAspectRatio: true,
  },
  {
    ...common,
    id: "frame-1",
    name: "圆形画框",
    kind: "frame",
    definition: {
      catalogId: "kanvas.core.frames",
      definitionId: "frame.circle",
      revision: "2026-07-31",
    },
    content: {
      image: placedImage("01K00000000000000000000033"),
    },
    fill: {
      kind: "none",
    },
    stroke: {
      paint: {
        kind: "solid",
        color: "#ffffff",
      },
      width: 4,
      alignment: "center",
    },
  },
  {
    ...common,
    id: "grid-1",
    name: "双列网格",
    kind: "grid",
    definition: {
      catalogId: "kanvas.core.grids",
      definitionId: "grid.two.columns",
      revision: "2026-07-31",
    },
    gap: 8,
    cornerRadius: 12,
    cells: [
      {
        slotId: "left",
        content: {
          image: placedImage("01K00000000000000000000031"),
        },
      },
      {
        slotId: "right",
      },
    ],
  },
  {
    ...common,
    id: "group-1",
    name: "组合",
    kind: "group",
    children: [shapeNode("shape-1"), textNode("text-1")],
  },
];

const page: EditorPageV1 = {
  id: "page-1",
  name: "页面 1",
  width: 1080,
  height: 1350,
  background: {
    kind: "paint",
    paint: {
      kind: "solid",
      color: "#f6f7fb",
    },
  },
  nodes: [...nodes],
};

const resources = new Map([
  [
    "01K00000000000000000000031",
    {
      artifactId: "01K00000000000000000000031",
      sourceUrl: "blob:https://kanvas.invalid/product",
      sourceUnavailable: false,
    },
  ],
  [
    "01K00000000000000000000032",
    {
      artifactId: "01K00000000000000000000032",
      sourceUrl: "blob:https://kanvas.invalid/graphic",
      sourceUnavailable: false,
    },
  ],
  [
    "01K00000000000000000000033",
    {
      artifactId: "01K00000000000000000000033",
      sourceUrl: "blob:https://kanvas.invalid/frame",
      sourceUnavailable: false,
    },
  ],
]);

describe("CanvasPageV1", () => {
  it("renders every Canvas Core V1 node kind in one tree", () => {
    const markup = renderToStaticMarkup(
      <CanvasPageV1 page={page} resources={resources} />,
    );

    for (const kind of [
      "image",
      "line",
      "graphic",
      "frame",
      "grid",
      "group",
      "shape",
      "text",
    ]) {
      expect(markup).toContain(`data-node-kind="${kind}"`);
    }
    expect(markup).toContain("blob:https://kanvas.invalid/product");
    expect(markup).toContain('data-grid-slot="left"');
    expect(markup).toContain("<marker");
    expect(markup).toContain('stroke-linecap="square"');
    expect(markup).toContain('stroke-linejoin="bevel"');
    expect(markup).toContain("<text");
  });

  it("renders image fit, flip, corner radius and tonal adjustments together", () => {
    const imageNode = nodes[0] as Extract<EditorNodeV1, { kind: "image" }>;
    const imagePage: EditorRuntimePageV1 = {
      ...page,
      nodes: [
        {
          ...imageNode,
          transform: {
            ...imageNode.transform,
            flipX: true,
          },
          cornerRadius: 24,
          image: {
            ...imageNode.image,
            fit: "fill",
            adjustments: {
              brightness: 0,
              contrast: 0,
              saturation: 0,
              temperature: 0,
              tint: 0,
              highlights: 0,
              shadows: 0,
              blur: 0,
              vignette: 0,
              grayscale: 1,
              sepia: 0,
            },
          },
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <CanvasPageV1 page={imagePage} resources={resources} />,
    );

    expect(markup).toContain("scale(-1 1)");
    expect(markup).toContain('rx="24"');
    expect(markup).toContain('preserveAspectRatio="none"');
    expect(markup).toContain('style="filter:grayscale(1)"');
  });

  it("clips a bounded page presentation without removing its nodes", () => {
    const unconstrainedMarkup = renderToStaticMarkup(
      <CanvasPageV1 page={page} resources={resources} />,
    );
    const boundedMarkup = renderToStaticMarkup(
      <CanvasPageV1 clipToPage page={page} resources={resources} />,
    );

    expect(unconstrainedMarkup).toContain('overflow="visible"');
    expect(unconstrainedMarkup).not.toContain("page-clip)");
    expect(boundedMarkup).toContain('overflow="hidden"');
    expect(boundedMarkup).toContain("page-clip)");
    expect(boundedMarkup).toContain('data-node-id="image-1"');
  });

  it("keeps an unavailable image visible as a recoverable node state", () => {
    const unavailable = new Map<string, EditorArtifactRuntimeResourceV1>(
      resources,
    );
    unavailable.set("01K00000000000000000000031", {
      artifactId: "01K00000000000000000000031",
      sourceUnavailable: true,
    });
    const markup = renderToStaticMarkup(
      <CanvasPageV1 page={page} resources={unavailable} />,
    );

    expect(markup).toContain('data-source-unavailable="true"');
    expect(markup).toContain('data-node-id="image-1"');
  });

  it("distinguishes progressive loading from a failed artifact", () => {
    const loading = new Map(resources);
    loading.delete("01K00000000000000000000031");
    const markup = renderToStaticMarkup(
      <CanvasPageV1 page={page} resources={loading} />,
    );

    expect(markup).toContain('data-source-loading="true"');
    expect(markup).not.toContain('data-source-unavailable="true"');
  });

  it("renders a local image immediately without a durable Artifact", () => {
    const runtimePage: EditorRuntimePageV1 = {
      ...page,
      nodes: [
        {
          ...nodes[0]!,
          kind: "image",
          image: {
            ...placedImage("01K00000000000000000000031"),
            source: {
              kind: "local",
              localId: "local-1",
              name: "商品图.png",
              mediaType: "image/png",
              size: 1_024,
              previewUrl: "blob:https://kanvas.invalid/local-1",
              uploadState: "uploading",
            },
          },
          cornerRadius: 20,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <CanvasPageV1 page={runtimePage} resources={new Map()} />,
    );

    expect(markup).toContain("blob:https://kanvas.invalid/local-1");
    expect(markup).not.toContain('data-source-unavailable="true"');
  });

  it("renders a built-in catalog graphic as recolorable vector paths", () => {
    const runtimePage: EditorRuntimePageV1 = {
      ...page,
      nodes: [
        {
          ...nodes[2]!,
          kind: "graphic",
          source: {
            kind: "catalog",
            catalogId: "kanvas.core.graphics",
            resourceId: "graphic.badge-check",
            revision: "2026-07-31",
          },
          colorSlots: {
            primary: "#123456",
            secondary: "#abcdef",
          },
          preserveAspectRatio: true,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <CanvasPageV1 page={runtimePage} resources={new Map()} />,
    );

    expect(markup).toContain('fill="#123456"');
    expect(markup).toContain('fill="#abcdef"');
    expect(markup).not.toContain('data-source-unavailable="true"');
  });
});
