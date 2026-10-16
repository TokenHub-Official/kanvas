import type { EditorDocumentV1, EditorNodeV1 } from "@kanvas/contracts/editor";
import { describe, expect, it } from "vitest";

import { createEditorRuntimeNodeV1 } from "./editor-node-factory-v1.js";
import { canvasLineWorldPointsV1 } from "./canvas-line-editing-v1.js";
import { createEditorStateV1, editorReducerV1 } from "./editor-state-v1.js";

function shape(id: string, x: number, y: number): EditorNodeV1 {
  return {
    id,
    name: id,
    kind: "shape",
    transform: {
      x,
      y,
      width: 100,
      height: 80,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal",
    visible: true,
    locked: false,
    definition: {
      catalogId: "kanvas.core.shapes",
      definitionId: "basic.rectangle",
      revision: "2026-07-31",
    },
    parameters: {
      cornerRadius: 0,
    },
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

const containerImage = {
  source: {
    kind: "artifact" as const,
    artifactId: "01K00000000000000000000031",
    assetId: "01K00000000000000000000041",
  },
  crop: { x: 0, y: 0, width: 1, height: 1 },
  fit: "cover" as const,
  focalPoint: { x: 0.5, y: 0.5 },
};

function frame(id: string): EditorNodeV1 {
  return {
    ...shape(id, 100, 100),
    kind: "frame",
    definition: {
      catalogId: "kanvas.core.frames",
      definitionId: "frame.rectangle",
      revision: "2026-07-31",
    },
    content: { image: containerImage },
    fill: { kind: "none" },
    stroke: { paint: { kind: "none" }, width: 0, alignment: "center" },
  };
}

function grid(id: string): EditorNodeV1 {
  return {
    ...shape(id, 100, 100),
    kind: "grid",
    definition: {
      catalogId: "kanvas.core.grids",
      definitionId: "grid.two.columns",
      revision: "2026-07-31",
    },
    gap: 8,
    cornerRadius: 0,
    cells: [
      { slotId: "left", content: { image: containerImage } },
      { slotId: "right" },
    ],
  };
}

function connectedLine(id: string, shapeId: string): EditorNodeV1 {
  return {
    id,
    name: id,
    kind: "line",
    transform: {
      x: 0,
      y: 0,
      width: 200,
      height: 140,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal",
    visible: true,
    locked: false,
    pathKind: "straight",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    stroke: {
      paint: { kind: "solid", color: "#151515" },
      width: 4,
      alignment: "center",
    },
    startCap: "none",
    endCap: "arrow",
    endBinding: { nodeId: shapeId, anchor: "right" },
    role: "design",
  };
}

function documentWith(nodes: readonly EditorNodeV1[]): EditorDocumentV1 {
  return {
    schemaVersion: "kanvas.editor-document/v1",
    documentId: "01K00000000000000000000020",
    workspaceId: "01K00000000000000000000000",
    title: "状态测试",
    pages: [
      {
        id: "page-1",
        name: "页面 1",
        width: 1080,
        height: 1080,
        background: {
          kind: "transparent",
        },
        nodes: [...nodes],
      },
    ],
    metadata: {
      createdWith: "kanvas-web",
    },
  };
}

function activeNodes(state: ReturnType<typeof createEditorStateV1>) {
  return state.document.pages[0]!.nodes;
}

describe("Canvas Core V1 editor state", () => {
  it("adds one node, selects it and records one undoable mutation", () => {
    const initial = createEditorStateV1(documentWith([]));
    const added = editorReducerV1(initial, {
      type: "add_node",
      node: shape("shape-a", 100, 120),
    });

    expect(activeNodes(added)).toHaveLength(1);
    expect(added.selectedIds).toEqual(["shape-a"]);
    expect(added.past).toHaveLength(1);

    const undone = editorReducerV1(added, {
      type: "undo",
    });
    expect(activeNodes(undone)).toHaveLength(0);
    expect(undone.future).toHaveLength(1);

    const redone = editorReducerV1(undone, {
      type: "redo",
    });
    expect(activeNodes(redone)).toHaveLength(1);
    expect(redone.selectedIds).toEqual(["shape-a"]);
  });

  it("cancels a preview without consuming undo history", () => {
    let state = createEditorStateV1(documentWith([shape("shape-a", 100, 100)]));
    state = editorReducerV1(state, {
      type: "preview_replace_node",
      node: { ...activeNodes(state)[0]!, opacity: 0.4 },
    });
    expect(state.preview).toBeDefined();

    state = editorReducerV1(state, { type: "cancel_preview" });

    expect(activeNodes(state)[0]?.opacity).toBe(1);
    expect(state.preview).toBeUndefined();
    expect(state.past).toHaveLength(0);
  });

  it("adds a pasted batch as one undoable mutation", () => {
    const initial = createEditorStateV1(documentWith([]));
    const added = editorReducerV1(initial, {
      type: "add_nodes",
      nodes: [shape("shape-a", 100, 120), shape("shape-b", 240, 120)],
    });

    expect(activeNodes(added)).toHaveLength(2);
    expect(added.selectedIds).toEqual(["shape-a", "shape-b"]);
    expect(added.past).toHaveLength(1);
    expect(
      activeNodes(
        editorReducerV1(added, {
          type: "undo",
        }),
      ),
    ).toHaveLength(0);
  });

  it("moves an image node into the page background as one undoable mutation", () => {
    let state = createEditorStateV1(documentWith([]));
    state = editorReducerV1(state, {
      type: "add_node",
      node: createEditorRuntimeNodeV1(
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
            width: 800,
            height: 600,
          },
        },
        "image-1",
        {
          x: 100,
          y: 120,
          width: 400,
          height: 300,
        },
      ),
    });

    state = editorReducerV1(state, {
      type: "set_image_node_as_background",
      pageId: "page-1",
      nodeId: "image-1",
    });

    expect(activeNodes(state)).toHaveLength(0);
    expect(state.selectedIds).toEqual([]);
    expect(state.document.pages[0]?.background).toMatchObject({
      kind: "image",
      image: {
        fit: "cover",
        source: {
          kind: "artifact",
          artifactId: "01K00000000000000000000031",
        },
      },
      opacity: 1,
    });

    const undone = editorReducerV1(state, {
      type: "undo",
    });
    expect(activeNodes(undone)).toHaveLength(1);
    expect(undone.document.pages[0]?.background).toEqual({
      kind: "transparent",
    });
    expect(undone.selectedIds).toEqual(["image-1"]);
  });

  it("coalesces continuous color previews into one history entry", () => {
    let state = createEditorStateV1(documentWith([shape("shape-a", 100, 120)]));
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-a",
    });
    for (const color of ["#ff0000", "#00ff00", "#0000ff"]) {
      state = editorReducerV1(state, {
        type: "preview_replace_node",
        node: {
          ...activeNodes(state)[0]!,
          fill: {
            kind: "solid",
            color,
          },
        } as EditorNodeV1,
      });
    }
    expect(state.past).toHaveLength(0);
    expect(state.preview).toBeDefined();

    state = editorReducerV1(state, {
      type: "commit_preview",
    });
    expect(state.past).toHaveLength(1);
    expect(state.preview).toBeUndefined();
    expect(activeNodes(state)).toMatchObject([
      {
        fill: {
          kind: "solid",
          color: "#0000ff",
        },
      },
    ]);

    state = editorReducerV1(state, {
      type: "undo",
    });
    expect(activeNodes(state)).toMatchObject([
      {
        fill: {
          kind: "solid",
          color: "#3048f5",
        },
      },
    ]);
  });

  it("keeps committed previews on different selections as separate undo steps", () => {
    let state = createEditorStateV1(
      documentWith([shape("shape-a", 100, 120), shape("shape-b", 260, 120)]),
    );
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-a",
    });
    state = editorReducerV1(state, {
      type: "preview_replace_node",
      node: {
        ...activeNodes(state)[0]!,
        opacity: 0.5,
      } as EditorNodeV1,
    });
    state = editorReducerV1(state, {
      type: "commit_preview",
    });
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-b",
    });
    state = editorReducerV1(state, {
      type: "preview_replace_node",
      node: {
        ...activeNodes(state)[1]!,
        opacity: 0.25,
      } as EditorNodeV1,
    });
    state = editorReducerV1(state, {
      type: "commit_preview",
    });

    expect(state.past).toHaveLength(2);
    state = editorReducerV1(state, { type: "undo" });
    expect(activeNodes(state).map((node) => node.opacity)).toEqual([0.5, 1]);
    state = editorReducerV1(state, { type: "undo" });
    expect(activeNodes(state).map((node) => node.opacity)).toEqual([1, 1]);
  });

  it("groups sibling nodes into local coordinates and ungroups without moving them", () => {
    let state = createEditorStateV1(
      documentWith([shape("shape-a", 100, 140), shape("shape-b", 340, 280)]),
    );
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-a",
    });
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-b",
      mode: "add",
    });
    state = editorReducerV1(state, {
      type: "group_selected",
      groupId: "group-1",
      name: "商品信息",
    });

    expect(activeNodes(state)).toMatchObject([
      {
        id: "group-1",
        kind: "group",
        transform: {
          x: 100,
          y: 140,
          width: 340,
          height: 220,
        },
        children: [
          {
            id: "shape-a",
            transform: {
              x: 0,
              y: 0,
            },
          },
          {
            id: "shape-b",
            transform: {
              x: 240,
              y: 140,
            },
          },
        ],
      },
    ]);
    expect(state.selectedIds).toEqual(["group-1"]);

    state = editorReducerV1(state, {
      type: "ungroup",
      groupId: "group-1",
    });
    expect(activeNodes(state)).toMatchObject([
      {
        id: "shape-a",
        transform: {
          x: 100,
          y: 140,
        },
      },
      {
        id: "shape-b",
        transform: {
          x: 340,
          y: 280,
        },
      },
    ]);
    expect(state.selectedIds).toEqual(["shape-a", "shape-b"]);
  });

  it("scales group children when the group is resized", () => {
    let state = createEditorStateV1(
      documentWith([shape("shape-a", 100, 100), shape("shape-b", 300, 100)]),
    );
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-a",
    });
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-b",
      mode: "add",
    });
    state = editorReducerV1(state, {
      type: "group_selected",
      groupId: "group-1",
    });
    const group = activeNodes(state)[0]!;
    state = editorReducerV1(state, {
      type: "transform_node",
      id: "group-1",
      transform: {
        ...group.transform,
        width: group.transform.width * 2,
        height: group.transform.height * 2,
      },
    });

    expect(activeNodes(state)).toMatchObject([
      {
        kind: "group",
        children: [
          {
            transform: {
              width: 200,
              height: 160,
            },
          },
          {
            transform: {
              x: 400,
              width: 200,
              height: 160,
            },
          },
        ],
      },
    ]);
  });

  it("keeps a bound line endpoint attached when its Shape moves", () => {
    let state = createEditorStateV1(
      documentWith([
        shape("shape-a", 100, 100),
        connectedLine("line-a", "shape-a"),
      ]),
    );
    const target = activeNodes(state)[0]!;
    state = editorReducerV1(state, {
      type: "transform_node",
      id: target.id,
      transform: { ...target.transform, x: 300 },
    });
    const resolvedLine = activeNodes(state)[1];

    expect(resolvedLine?.kind).toBe("line");
    if (resolvedLine?.kind === "line") {
      expect(canvasLineWorldPointsV1(resolvedLine).at(-1)).toEqual({
        x: 400,
        y: 140,
      });
      expect(resolvedLine.endBinding).toEqual({
        nodeId: "shape-a",
        anchor: "right",
      });
    }
  });

  it("dissolves a group when deleting leaves only one child", () => {
    let state = createEditorStateV1(
      documentWith([shape("shape-a", 100, 100), shape("shape-b", 300, 100)]),
    );
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-a",
    });
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-b",
      mode: "add",
    });
    state = editorReducerV1(state, {
      type: "group_selected",
      groupId: "group-1",
    });
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-a",
    });
    state = editorReducerV1(state, {
      type: "delete_selected",
    });

    expect(activeNodes(state)).toMatchObject([
      {
        id: "shape-b",
        kind: "shape",
        transform: {
          x: 300,
          y: 100,
        },
      },
    ]);
  });

  it("deletes an explicit context-menu target without relying on selection", () => {
    let state = createEditorStateV1(
      documentWith([shape("shape-a", 100, 100), shape("shape-b", 300, 100)]),
    );
    state = editorReducerV1(state, {
      type: "select",
      id: "shape-a",
    });

    state = editorReducerV1(state, {
      type: "delete_nodes",
      ids: ["shape-b"],
    });

    expect(activeNodes(state).map((node) => node.id)).toEqual(["shape-a"]);
    expect(state.selectedIds).toEqual(["shape-a"]);
    expect(
      editorReducerV1(state, {
        type: "undo",
      }).document.pages[0]?.nodes.map((node) => node.id),
    ).toEqual(["shape-a", "shape-b"]);
  });

  it("deletes every eraser target in one undoable command", () => {
    const initial = createEditorStateV1(
      documentWith([
        shape("stroke-a", 100, 100),
        shape("stroke-b", 300, 100),
        shape("keep", 500, 100),
      ]),
    );
    const erased = editorReducerV1(initial, {
      type: "delete_nodes",
      ids: ["stroke-a", "stroke-b"],
    });

    expect(activeNodes(erased).map((node) => node.id)).toEqual(["keep"]);
    expect(erased.past).toHaveLength(1);
    expect(
      activeNodes(editorReducerV1(erased, { type: "undo" })).map(
        (node) => node.id,
      ),
    ).toEqual(["stroke-a", "stroke-b", "keep"]);
  });

  it("removes frame and grid-cell content with undoable container identity", () => {
    const initial = createEditorStateV1(
      documentWith([frame("frame-1"), grid("grid-1")]),
    );
    const frameRemoved = editorReducerV1(initial, {
      type: "remove_frame_content",
      pageId: "page-1",
      frameId: "frame-1",
    });
    expect(activeNodes(frameRemoved)[0]).not.toHaveProperty("content");

    const cellRemoved = editorReducerV1(frameRemoved, {
      type: "remove_grid_cell_content",
      pageId: "page-1",
      gridId: "grid-1",
      slotId: "left",
    });
    expect(activeNodes(cellRemoved)[1]).toMatchObject({
      id: "grid-1",
      cells: [{ slotId: "left" }, { slotId: "right" }],
    });
    expect(
      activeNodes(editorReducerV1(cellRemoved, { type: "undo" }))[1],
    ).toMatchObject({
      cells: [
        { slotId: "left", content: { image: containerImage } },
        { slotId: "right" },
      ],
    });
  });

  it("moves layers only within their current sibling list", () => {
    let state = createEditorStateV1(
      documentWith([
        shape("back", 0, 0),
        shape("middle", 0, 0),
        shape("front", 0, 0),
      ]),
    );
    state = editorReducerV1(state, {
      type: "move_layer",
      id: "back",
      move: "to_front",
    });

    expect(activeNodes(state).map((node) => node.id)).toEqual([
      "middle",
      "front",
      "back",
    ]);
  });

  it("does not create history for a layer boundary no-op", () => {
    const state = createEditorStateV1(
      documentWith([shape("back", 0, 0), shape("front", 0, 0)]),
    );

    expect(
      editorReducerV1(state, {
        type: "move_layer",
        id: "front",
        move: "forward",
      }),
    ).toBe(state);
  });

  it("aligns and distributes selected top-level nodes as single mutations", () => {
    let state = createEditorStateV1(
      documentWith([
        shape("left", 100, 80),
        shape("middle", 360, 220),
        shape("right", 700, 360),
      ]),
    );
    for (const [index, id] of ["left", "middle", "right"].entries()) {
      state = editorReducerV1(state, {
        type: "select",
        id,
        mode: index === 0 ? "replace" : "add",
      });
    }
    state = editorReducerV1(state, {
      type: "align_selected",
      alignment: "top",
    });
    expect(activeNodes(state).map((node) => node.transform.y)).toEqual([
      80, 80, 80,
    ]);

    state = editorReducerV1(state, {
      type: "distribute_selected",
      axis: "horizontal",
    });
    expect(activeNodes(state).map((node) => node.transform.x)).toEqual([
      100, 400, 700,
    ]);
  });

  it("rejects duplicate identities and semantic replacement", () => {
    const initial = createEditorStateV1(documentWith([shape("shape-a", 0, 0)]));

    expect(() =>
      editorReducerV1(initial, {
        type: "add_node",
        node: shape("shape-a", 200, 200),
      }),
    ).toThrow("used more than once");

    expect(() =>
      editorReducerV1(initial, {
        type: "replace_node",
        node: {
          id: "shape-a",
          name: "非法文字替换",
          kind: "text",
          transform: shape("unused", 0, 0).transform,
          opacity: 1,
          blendMode: "normal",
          visible: true,
          locked: false,
          content: {
            paragraphs: [
              {
                align: "left",
                direction: "auto",
                lineHeight: 1.2,
                spaceBefore: 0,
                spaceAfter: 0,
                runs: [
                  {
                    text: "错误",
                    font: {
                      source: "system",
                      fontId: "system-ui",
                      family: "system-ui",
                    },
                    fontSize: 32,
                    fontWeight: 400,
                    fontStyle: "normal",
                    letterSpacing: 0,
                    fill: {
                      kind: "solid",
                      color: "#000000",
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
        },
      }),
    ).toThrow("cannot change its semantic kind");
  });

  it("commits a local image across undo and redo snapshots without adding history", () => {
    let state = createEditorStateV1(documentWith([]));
    state = editorReducerV1(state, {
      type: "add_node",
      node: createEditorRuntimeNodeV1(
        {
          kind: "image",
          source: {
            kind: "local_file",
            localId: "local-1",
            name: "商品.png",
            mediaType: "image/png",
            size: 1024,
            previewUrl: "blob:https://kanvas.invalid/local-1",
          },
          intrinsicSize: {
            width: 800,
            height: 600,
          },
        },
        "image-1",
        {
          x: 100,
          y: 100,
          width: 400,
          height: 300,
        },
      ),
    });
    state = editorReducerV1(state, {
      type: "undo",
    });
    expect(state.future).toHaveLength(1);

    state = editorReducerV1(state, {
      type: "commit_local_image",
      localId: "local-1",
      reference: {
        kind: "artifact",
        artifactId: "01K00000000000000000000031",
      },
    });
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(1);

    state = editorReducerV1(state, {
      type: "redo",
    });
    expect(activeNodes(state)).toMatchObject([
      {
        kind: "image",
        image: {
          source: {
            kind: "artifact",
            artifactId: "01K00000000000000000000031",
          },
        },
      },
    ]);
  });

  it("persists page guides as one undoable page mutation", () => {
    const initial = createEditorStateV1(documentWith([]));
    const guided = editorReducerV1(initial, {
      type: "set_page_guides",
      pageId: "page-1",
      guides: [
        {
          id: "guide-center",
          axis: "vertical",
          position: 540,
          locked: false,
        },
      ],
    });

    expect(guided.document.pages[0]!.overlays?.guides).toEqual([
      {
        id: "guide-center",
        axis: "vertical",
        position: 540,
        locked: false,
      },
    ]);
    expect(guided.past).toHaveLength(1);
    expect(() =>
      editorReducerV1(initial, {
        type: "set_page_guides",
        pageId: "page-1",
        guides: [
          {
            id: "same",
            axis: "vertical",
            position: 100,
            locked: false,
          },
          {
            id: "same",
            axis: "horizontal",
            position: 100,
            locked: false,
          },
        ],
      }),
    ).toThrow("must be unique");
  });

  it("adds, reorders and deletes pages while keeping an active page", () => {
    let state = createEditorStateV1(documentWith([]));
    state = editorReducerV1(state, {
      type: "add_page",
      page: {
        id: "page-2",
        name: "页面 2",
        width: 1080,
        height: 1080,
        background: {
          kind: "transparent",
        },
        nodes: [],
      },
    });
    expect(state.activePageId).toBe("page-2");
    state = editorReducerV1(state, {
      type: "rename_page",
      pageId: "page-2",
      name: "封面",
    });
    expect(state.document.pages[1]?.name).toBe("封面");
    state = editorReducerV1(state, {
      type: "reorder_page",
      pageId: "page-2",
      targetIndex: 0,
    });
    expect(state.document.pages.map((page) => page.id)).toEqual([
      "page-2",
      "page-1",
    ]);
    state = editorReducerV1(state, {
      type: "move_page",
      pageId: "page-2",
      direction: "forward",
    });
    expect(state.document.pages.map((page) => page.id)).toEqual([
      "page-1",
      "page-2",
    ]);
    state = editorReducerV1(state, {
      type: "delete_page",
      pageId: "page-2",
    });
    expect(state.activePageId).toBe("page-1");
    expect(state.document.pages).toHaveLength(1);
    expect(() =>
      editorReducerV1(state, {
        type: "delete_page",
        pageId: "page-1",
      }),
    ).toThrow("retain at least one page");
  });

  it("makes page resize consequences explicit and undoable", () => {
    const initial = createEditorStateV1(
      documentWith([shape("shape-a", 100, 200)]),
    );
    const kept = editorReducerV1(initial, {
      type: "resize_page",
      pageId: "page-1",
      width: 540,
      height: 540,
      mode: "keep",
    });
    expect(activeNodes(kept)[0]?.transform).toMatchObject({
      x: 100,
      y: 200,
      width: 100,
      height: 80,
    });

    const scaled = editorReducerV1(initial, {
      type: "resize_page",
      pageId: "page-1",
      width: 540,
      height: 540,
      mode: "scale",
    });
    expect(activeNodes(scaled)[0]?.transform).toMatchObject({
      x: 50,
      y: 100,
      width: 50,
      height: 40,
    });
    expect(
      activeNodes(editorReducerV1(scaled, { type: "undo" }))[0],
    ).toMatchObject({ transform: { x: 100, y: 200, width: 100, height: 80 } });
  });
});
