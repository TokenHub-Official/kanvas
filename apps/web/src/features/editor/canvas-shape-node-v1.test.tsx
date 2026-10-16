import type { EditorShapeNodeV1 } from "@kanvas/contracts/editor";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanvasShapeNodeV1 } from "./canvas-shape-node-v1.js";

const node: EditorShapeNodeV1 = {
  id: "shape:hero",
  name: "渐变流程判断",
  kind: "shape",
  transform: {
    x: 120,
    y: 240,
    width: 480,
    height: 320,
    rotation: 12,
    flipX: true,
    flipY: false,
  },
  opacity: 0.84,
  blendMode: "multiply",
  visible: true,
  locked: false,
  definition: {
    catalogId: "kanvas.core.shapes",
    definitionId: "flowchart.decision",
    revision: "2026-07-31",
  },
  parameters: {},
  fill: {
    kind: "linear_gradient",
    angle: 45,
    stops: [
      {
        color: "#3048f5",
        offset: 0,
      },
      {
        color: "#ff2f70",
        offset: 1,
      },
    ],
  },
  stroke: {
    paint: {
      kind: "solid",
      color: "#151515",
    },
    width: 6,
    alignment: "center",
    dash: [12, 8],
  },
};

describe("CanvasShapeNodeV1", () => {
  it("renders catalog geometry, transforms, gradients and strokes", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasShapeNodeV1 node={node} />
      </svg>,
    );

    expect(markup).toContain('data-node-id="shape:hero"');
    expect(markup).toContain('data-node-kind="shape"');
    expect(markup).toContain('transform="translate(120 240)"');
    expect(markup).toContain("rotate(12 240 160)");
    expect(markup).toContain("scale(-1 1)");
    expect(markup).toContain("<linearGradient");
    expect(markup).toContain('fill="url(#shape_hero-fill)"');
    expect(markup).toContain('stroke="#151515"');
    expect(markup).toContain('stroke-dasharray="12 8"');
    expect(markup).toContain("mix-blend-mode:multiply");
  });

  it("uses the exact catalog revision and fails instead of drawing a fallback", () => {
    expect(() =>
      renderToStaticMarkup(
        <svg>
          <CanvasShapeNodeV1
            node={{
              ...node,
              definition: {
                ...node.definition,
                revision: "missing",
              },
            }}
          />
        </svg>,
      ),
    ).toThrow("is not loaded");
  });

  it("renders editable shape label content above the geometry", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasShapeNodeV1
          node={{
            ...node,
            label: {
              padding: {
                top: 20,
                right: 20,
                bottom: 20,
                left: 20,
              },
              content: {
                paragraphs: [
                  {
                    align: "center",
                    direction: "auto",
                    lineHeight: 1.2,
                    spaceBefore: 0,
                    spaceAfter: 0,
                    runs: [
                      {
                        text: "是否通过",
                        font: {
                          source: "builtin",
                          fontId: "noto-sans-sc",
                          family: "Noto Sans SC",
                        },
                        fontSize: 36,
                        fontWeight: 700,
                        fontStyle: "normal",
                        letterSpacing: 0,
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
            },
          }}
        />
      </svg>,
    );

    expect(markup).toContain("是否通过");
    expect(markup).toContain('font-family="Noto Sans SC"');
    expect(markup).toContain('clip-path="url(#shape_hero-bounds-clip)"');
  });

  it("renders inside and outside stroke alignment as distinct geometry", () => {
    const inside = renderToStaticMarkup(
      <svg>
        <CanvasShapeNodeV1
          node={{
            ...node,
            stroke: { ...node.stroke, alignment: "inside" },
          }}
        />
      </svg>,
    );
    const outside = renderToStaticMarkup(
      <svg>
        <CanvasShapeNodeV1
          node={{
            ...node,
            stroke: { ...node.stroke, alignment: "outside" },
          }}
        />
      </svg>,
    );

    expect(inside).toContain('data-stroke-alignment="inside"');
    expect(inside).toContain('clip-path="url(#shape_hero-stroke-inside)"');
    expect(inside).toContain('stroke-width="12"');
    expect(outside).toContain('data-stroke-alignment="outside"');
    expect(outside).toContain('mask="url(#shape_hero-stroke-outside)"');
    expect(outside).toContain('stroke-width="12"');
  });

  it("renders the sticky-note fold as part of generic shape geometry", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasShapeNodeV1
          node={{
            ...node,
            name: "便签",
            definition: {
              catalogId: "kanvas.core.shapes",
              definitionId: "basic.sticky-note",
              revision: "2026-07-31",
            },
            fill: {
              kind: "solid",
              color: "#ffd21f",
            },
          }}
        />
      </svg>,
    );

    expect(markup).toContain("M72 98 L98 72");
    expect(markup).toContain('opacity="0.14"');
    expect(markup).toContain('fill="#ffd21f"');
  });
});
