import type { EditorDocumentV1, EditorNodeV1 } from "@kanvas/contracts/editor";
import { describe, expect, it } from "vitest";

import { applyEditorNodeInsertionV1 } from "./editor-insertion-transaction-v1.js";
import { createEditorStateV1, editorReducerV1 } from "./editor-state-v1.js";

const imageSource = {
  kind: "local_file",
  localId: "local-product",
  name: "商品.png",
  mediaType: "image/png",
  size: 2_048,
  previewUrl: "blob:https://kanvas.invalid/product",
} as const;

const imagePayload = {
  kind: "image",
  source: imageSource,
  intrinsicSize: {
    width: 1_600,
    height: 1_200,
  },
} as const;

function common(id: string) {
  return {
    id,
    name: id,
    transform: {
      x: 100,
      y: 100,
      width: 300,
      height: 240,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal" as const,
    visible: true,
    locked: false,
  };
}

function documentWith(nodes: readonly EditorNodeV1[]): EditorDocumentV1 {
  return {
    schemaVersion: "kanvas.editor-document/v1",
    documentId: "01K00000000000000000000020",
    workspaceId: "01K00000000000000000000000",
    title: "插入事务",
    pages: [
      {
        id: "page-1",
        name: "页面 1",
        width: 1_080,
        height: 1_080,
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

function frame(): EditorNodeV1 {
  return {
    ...common("frame-1"),
    kind: "frame",
    definition: {
      catalogId: "kanvas.core.frames",
      definitionId: "frame.circle",
      revision: "2026-07-31",
    },
    fill: {
      kind: "solid",
      color: "#f5f5f5",
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

function grid(): EditorNodeV1 {
  return {
    ...common("grid-1"),
    kind: "grid",
    definition: {
      catalogId: "kanvas.core.grids",
      definitionId: "grid.two.columns",
      revision: "2026-07-31",
    },
    gap: 12,
    cornerRadius: 0,
    cells: [{ slotId: "left" }, { slotId: "right" }],
  };
}

function image(): EditorNodeV1 {
  return {
    ...common("image-1"),
    kind: "image",
    image: {
      source: {
        kind: "artifact",
        artifactId: "01K00000000000000000000031",
      },
      crop: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      fit: "contain",
      focalPoint: {
        x: 0.5,
        y: 0.5,
      },
    },
    cornerRadius: 0,
  };
}

describe("Canvas Core V1 insertion transaction", () => {
  it("places a new node at the visible center and is idempotent by request identity", () => {
    const initial = createEditorStateV1(documentWith([]));
    const intent = {
      requestId: "upload-1",
      payload: imagePayload,
      target: {
        kind: "canvas_center",
        pageId: "page-1",
        visiblePageRect: {
          x: 100,
          y: 200,
          width: 800,
          height: 600,
        },
      },
    } as const;
    const added = applyEditorNodeInsertionV1(initial, intent);

    expect(added.document.pages[0]!.nodes).toMatchObject([
      {
        id: "insert:upload-1",
        kind: "image",
        transform: {
          x: 252,
          y: 314,
          width: 496,
          height: 372,
        },
        image: {
          source: {
            kind: "local",
            uploadState: "uploading",
          },
        },
      },
    ]);
    expect(() => applyEditorNodeInsertionV1(added, intent)).toThrow(
      "used more than once",
    );
  });

  it("adds a result beside its source in one undoable transaction", () => {
    const initial = createEditorStateV1(documentWith([image()]));
    const added = applyEditorNodeInsertionV1(initial, {
      requestId: "generated-result-1",
      payload: imagePayload,
      target: {
        kind: "canvas_adjacent",
        pageId: "page-1",
        sourceRect: image().transform,
        visiblePageRect: {
          x: 0,
          y: 0,
          width: 1_080,
          height: 1_080,
        },
      },
    });
    const nodes = added.document.pages[0]!.nodes;

    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toMatchObject({
      id: "insert:generated-result-1",
      kind: "image",
    });
    expect(nodes[1]!.transform).not.toMatchObject(image().transform);
    expect(added.past).toHaveLength(1);

    const undone = editorReducerV1(added, {
      type: "undo",
    });
    expect(undone.document.pages[0]!.nodes).toHaveLength(1);
    expect(undone.document.pages[0]!.nodes[0]!.id).toBe("image-1");
  });

  it("fills frames, grid cells and backgrounds without creating nodes", () => {
    let state = createEditorStateV1(documentWith([frame(), grid()]));
    state = applyEditorNodeInsertionV1(state, {
      requestId: "fill-frame",
      payload: imagePayload,
      target: {
        kind: "frame_content",
        pageId: "page-1",
        frameId: "frame-1",
      },
    });
    state = applyEditorNodeInsertionV1(state, {
      requestId: "fill-grid",
      payload: imagePayload,
      target: {
        kind: "grid_cell",
        pageId: "page-1",
        gridId: "grid-1",
        slotId: "right",
      },
    });
    state = applyEditorNodeInsertionV1(state, {
      requestId: "fill-background",
      payload: imagePayload,
      target: {
        kind: "page_background",
        pageId: "page-1",
      },
    });

    expect(state.document.pages[0]).toMatchObject({
      background: {
        kind: "image",
        image: {
          fit: "cover",
        },
      },
      nodes: [
        {
          id: "frame-1",
          content: {
            image: {
              fit: "cover",
            },
          },
        },
        {
          id: "grid-1",
          cells: [
            { slotId: "left" },
            {
              slotId: "right",
              content: {
                image: {
                  fit: "cover",
                },
              },
            },
          ],
        },
      ],
    });
    expect(state.past).toHaveLength(3);
  });

  it("replaces image content without changing node geometry and supports undo", () => {
    const initial = createEditorStateV1(documentWith([image()]));
    const replaced = applyEditorNodeInsertionV1(initial, {
      requestId: "replace-image",
      payload: imagePayload,
      target: {
        kind: "replace_node_content",
        pageId: "page-1",
        nodeId: "image-1",
      },
    });

    expect(replaced.document.pages[0]!.nodes[0]).toMatchObject({
      id: "image-1",
      transform: common("unused").transform,
      image: {
        source: {
          kind: "local",
          localId: "local-product",
        },
      },
    });
    const undone = editorReducerV1(replaced, {
      type: "undo",
    });
    expect(undone.document.pages[0]!.nodes[0]).toMatchObject({
      image: {
        source: {
          kind: "artifact",
          artifactId: "01K00000000000000000000031",
        },
      },
    });
  });

  it("rejects incompatible content targets explicitly", () => {
    const state = createEditorStateV1(documentWith([frame()]));

    expect(() =>
      applyEditorNodeInsertionV1(state, {
        requestId: "bad-fill",
        payload: {
          kind: "text",
          text: "错误",
        },
        target: {
          kind: "frame_content",
          pageId: "page-1",
          frameId: "frame-1",
        },
      }),
    ).toThrow("accepts image content only");
  });
});
