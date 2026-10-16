import type {
  EditorGroupNodeV1,
  EditorShapeNodeV1,
  EditorTextNodeV1,
} from "@kanvas/contracts/editor";
import { describe, expect, it } from "vitest";

import {
  cloneNodeV1,
  findCanvasNodeV1,
  nodeWithEditedTextV1,
  nodeWithTextNodeV1,
  paintColor,
  shapeTextNodeForEditingV1,
  shapeWithoutLabelV1,
  textNodeValue,
  textNodeWithValue,
} from "./canvas-workspace-model-v1.js";

const commonNode = {
  opacity: 1,
  blendMode: "normal" as const,
  visible: true,
  locked: false,
};

function textNode(): EditorTextNodeV1 {
  return {
    ...commonNode,
    id: "text-1",
    kind: "text",
    name: "Text",
    transform: {
      x: 10,
      y: 20,
      width: 300,
      height: 120,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    content: {
      paragraphs: [
        {
          align: "left",
          direction: "auto",
          lineHeight: 1.2,
          spaceBefore: 0,
          spaceAfter: 8,
          runs: [
            {
              text: "First",
              font: {
                source: "builtin",
                fontId: "inter",
                family: "Inter",
              },
              fontSize: 32,
              fontWeight: 700,
              fontStyle: "normal",
              letterSpacing: 0,
              fill: {
                kind: "solid",
                color: "#151515",
              },
              decoration: {
                underline: false,
                strikeThrough: false,
              },
            },
          ],
        },
        {
          align: "right",
          direction: "auto",
          lineHeight: 1.5,
          spaceBefore: 4,
          spaceAfter: 0,
          runs: [
            {
              text: "Second",
              font: {
                source: "builtin",
                fontId: "inter",
                family: "Inter",
              },
              fontSize: 20,
              fontWeight: 400,
              fontStyle: "italic",
              letterSpacing: 1,
              fill: {
                kind: "solid",
                color: "#3048f5",
              },
              decoration: {
                underline: false,
                strikeThrough: false,
              },
            },
          ],
        },
      ],
      verticalAlign: "top",
      resizeMode: "auto_height",
    },
    effects: [],
  };
}

function shapeNode(): EditorShapeNodeV1 {
  return {
    ...commonNode,
    id: "shape-1",
    kind: "shape",
    name: "Shape",
    transform: {
      x: 5,
      y: 7,
      width: 100,
      height: 80,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    definition: {
      catalogId: "kanvas.core.shapes",
      definitionId: "basic.rectangle",
      revision: "2026-07-31",
    },
    parameters: {},
    fill: {
      kind: "solid",
      color: "#ffffff",
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

describe("Canvas workspace model", () => {
  it("creates and commits a centered label for an unlabeled closed shape", () => {
    const shape = shapeNode();

    expect(shapeTextNodeForEditingV1(shape)).toMatchObject({
      kind: "text",
      content: { paragraphs: [{ runs: [{ text: "" }] }] },
    });
    expect(nodeWithEditedTextV1(shape, "流程入口")).toMatchObject({
      kind: "shape",
      label: {
        content: {
          verticalAlign: "middle",
          paragraphs: [{ align: "center", runs: [{ text: "流程入口" }] }],
        },
      },
    });
    expect(shape).not.toHaveProperty("label");
  });

  it("projects text formatting back into an existing shape label", () => {
    const labeled = nodeWithEditedTextV1(shapeNode(), "流程入口");
    const text = shapeTextNodeForEditingV1(labeled)!;
    const updatedText = {
      ...text,
      content: {
        ...text.content,
        paragraphs: text.content.paragraphs.map((paragraph) => ({
          ...paragraph,
          runs: paragraph.runs.map((run) => ({
            ...run,
            fontWeight: 700,
          })),
        })),
      },
    };

    expect(nodeWithTextNodeV1(labeled, updatedText)).toMatchObject({
      kind: "shape",
      label: {
        content: {
          paragraphs: [{ runs: [{ text: "流程入口", fontWeight: 700 }] }],
        },
      },
    });
  });

  it("keeps a duplicated node inside the page near an edge", () => {
    const source = {
      ...shapeNode(),
      transform: {
        ...shapeNode().transform,
        x: 880,
        y: 900,
        width: 120,
        height: 100,
      },
    };

    expect(
      cloneNodeV1(source, "edge", true, " 副本", {
        width: 1_000,
        height: 1_000,
      }).transform,
    ).toMatchObject({
      x: 848,
      y: 868,
      width: 120,
      height: 100,
    });
    expect(
      cloneNodeV1(
        {
          ...source,
          transform: { ...source.transform, x: 940, width: 120 },
        },
        "outside-edge",
        true,
        " 副本",
        { width: 1_000, height: 1_000 },
      ).transform.x,
    ).toBe(880);
  });

  it("removes internal text without changing the shape geometry", () => {
    const labeled = nodeWithEditedTextV1(shapeNode(), "流程入口");

    expect(
      shapeWithoutLabelV1(labeled as ReturnType<typeof shapeNode>),
    ).toEqual(shapeNode());
  });

  it("replaces text while preserving matching paragraph and run styles", () => {
    const original = textNode();
    const updated = textNodeWithValue(
      original,
      "Updated first\nUpdated second",
    );

    expect(textNodeValue(updated)).toBe("Updated first\nUpdated second");
    expect(updated.content.paragraphs[0]).toMatchObject({
      align: "left",
      spaceAfter: 8,
      runs: [
        {
          fontSize: 32,
          fontWeight: 700,
          text: "Updated first",
        },
      ],
    });
    expect(updated.content.paragraphs[1]).toMatchObject({
      align: "right",
      lineHeight: 1.5,
      runs: [
        {
          fontSize: 20,
          fontStyle: "italic",
          text: "Updated second",
        },
      ],
    });
  });

  it("offsets only the copied top-level node and regenerates nested ids", () => {
    const group: EditorGroupNodeV1 = {
      ...commonNode,
      id: "group-1",
      kind: "group",
      name: "Group",
      transform: {
        x: 100,
        y: 200,
        width: 320,
        height: 240,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      children: [shapeNode()],
    };

    expect(cloneNodeV1(group, "01COPY", true, " copy")).toMatchObject({
      id: "group-1:copy:01COPY",
      name: "Group copy",
      transform: {
        x: 132,
        y: 232,
      },
      children: [
        {
          id: "shape-1:copy:01COPY",
          name: "Shape copy",
          transform: {
            x: 5,
            y: 7,
          },
        },
      ],
    });
    expect(findCanvasNodeV1([group], "shape-1")?.kind).toBe("shape");
  });

  it("uses solid paint colors and a stable fallback for other paints", () => {
    expect(
      paintColor({
        kind: "solid",
        color: "#abcdef",
      }),
    ).toBe("#abcdef");
    expect(paintColor({ kind: "none" })).toBe("#3048f5");
  });
});
