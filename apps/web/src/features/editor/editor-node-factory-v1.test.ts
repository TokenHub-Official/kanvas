import { describe, expect, it } from "vitest";

import {
  createEditorRuntimeNodeV1,
  defaultEditorNodeSizeV1,
} from "./editor-node-factory-v1.js";
import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";
import { canvasTextPresetReferenceV1 } from "./text-preset-catalog-v1.js";

const rect = {
  x: 120,
  y: 180,
  width: 480,
  height: 320,
};

const references = {
  shape: {
    catalogId: "kanvas.core.shapes",
    definitionId: "flowchart.decision",
    revision: "2026-07-31",
  },
  line: {
    catalogId: "kanvas.core.lines",
    definitionId: "line.straight",
    revision: "2026-07-31",
  },
  frame: {
    catalogId: "kanvas.core.frames",
    definitionId: "frame.circle",
    revision: "2026-07-31",
  },
  grid: {
    catalogId: "kanvas.core.grids",
    definitionId: "grid.three.columns",
    revision: "2026-07-31",
  },
} as const;

describe("Canvas Core V1 node factory", () => {
  it("creates a local image that is visible before upload", () => {
    const node = createEditorRuntimeNodeV1(
      {
        kind: "image",
        source: {
          kind: "local_file",
          localId: "local-1",
          name: "商品图.png",
          mediaType: "image/png",
          size: 2_048,
          previewUrl: "blob:https://kanvas.invalid/local-1",
        },
        intrinsicSize: {
          width: 1_200,
          height: 900,
        },
      },
      "image-1",
      rect,
    );

    expect(node).toMatchObject({
      id: "image-1",
      kind: "image",
      transform: rect,
      image: {
        source: {
          kind: "local",
          localId: "local-1",
          uploadState: "uploading",
        },
        intrinsicWidth: 1_200,
        intrinsicHeight: 900,
      },
    });
  });

  it("materializes editable artistic text presets", () => {
    const preset = canvasTextPresetReferenceV1("text.glitch");
    const node = createEditorRuntimeNodeV1(
      {
        kind: "text",
        text: "新品上市",
        preset,
      },
      "text-1",
      rect,
    );

    expect(node).toMatchObject({
      kind: "text",
      content: {
        paragraphs: [
          {
            runs: [
              {
                text: "新品上市",
                font: {
                  fontId: "oswald",
                },
              },
            ],
          },
        ],
      },
      effects: [
        {
          kind: "offset_layers",
        },
      ],
      preset,
    });
  });

  it("pins an adopted workspace font without retaining its external URL", () => {
    const fontRevisionId = "01K00000000000000000000001";
    const node = createEditorRuntimeNodeV1(
      {
        kind: "text",
        text: "Team headline",
        font: {
          family: "Team Sans",
          fontId: fontRevisionId,
          revision: fontRevisionId,
          source: "workspace",
        },
      },
      "text-workspace-font",
      rect,
    );

    expect(node).toMatchObject({
      kind: "text",
      content: {
        paragraphs: [
          {
            runs: [
              {
                font: {
                  family: "Team Sans",
                  fontId: fontRevisionId,
                  revision: fontRevisionId,
                  source: "workspace",
                },
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(node)).not.toContain("https://");
  });

  it("uses catalog defaults for parametric shapes", () => {
    const node = createEditorRuntimeNodeV1(
      {
        kind: "shape",
        definition: references.shape,
      },
      "shape-1",
      rect,
    );

    expect(node).toMatchObject({
      kind: "shape",
      definition: references.shape,
      parameters: {},
    });
    expect(
      defaultEditorNodeSizeV1({
        kind: "shape",
        definition: references.shape,
      }),
    ).toEqual({
      width: 360,
      height: 240,
    });
  });

  it("creates a sticky note as a reusable labeled shape node", () => {
    const node = createEditorRuntimeNodeV1(
      {
        kind: "note",
        color: "#ffd21f",
        text: "记录灵感",
      },
      "note-1",
      rect,
    );

    expect(node).toMatchObject({
      id: "note-1",
      kind: "shape",
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
      label: {
        content: {
          paragraphs: [
            {
              align: "left",
              runs: [
                {
                  text: "记录灵感",
                  fontSize: 28,
                },
              ],
            },
          ],
          verticalAlign: "top",
        },
      },
    });
    expect(
      defaultEditorNodeSizeV1({
        kind: "note",
        color: "#ffd21f",
      }),
    ).toEqual({
      width: 280,
      height: 260,
    });
  });

  it("creates frame and grid structures from their definitions", () => {
    const frame = createEditorRuntimeNodeV1(
      {
        kind: "frame",
        definition: references.frame,
      },
      "frame-1",
      rect,
    );
    const grid = createEditorRuntimeNodeV1(
      {
        kind: "grid",
        definition: references.grid,
      },
      "grid-1",
      rect,
    );

    expect(frame).toMatchObject({
      kind: "frame",
      definition: references.frame,
      fill: { kind: "none" },
      stroke: {
        paint: { kind: "solid", color: "#b8bac4" },
        width: 2,
        alignment: "inside",
      },
    });
    expect(grid).toMatchObject({
      kind: "grid",
      cells: [{ slotId: "left" }, { slotId: "center" }, { slotId: "right" }],
    });
  });

  it("creates every directly insertable capability", () => {
    const payloads: readonly EditorNodeInsertionPayload[] = [
      {
        kind: "image",
        source: {
          kind: "artifact",
          reference: {
            kind: "artifact",
            artifactId: "01K00000000000000000000031",
          },
        },
        intrinsicSize: {
          width: 1_200,
          height: 900,
        },
      },
      {
        kind: "text",
      },
      {
        kind: "shape",
        definition: references.shape,
      },
      {
        kind: "line",
        definition: references.line,
      },
      {
        kind: "note",
        color: "#ffd21f",
      },
      {
        kind: "graphic",
        source: {
          kind: "catalog",
          catalogId: "kanvas.core.graphics",
          resourceId: "graphic.spark",
          revision: "1",
        },
        intrinsicSize: {
          width: 400,
          height: 400,
        },
      },
      {
        kind: "frame",
        definition: references.frame,
      },
      {
        kind: "grid",
        definition: references.grid,
      },
    ];

    expect(
      payloads
        .map((payload, index) =>
          createEditorRuntimeNodeV1(payload, `node-${String(index)}`, rect),
        )
        .map((node) => node.kind),
    ).toEqual([
      "image",
      "text",
      "shape",
      "line",
      "shape",
      "graphic",
      "frame",
      "grid",
    ]);
  });
});
