import { describe, expect, it } from "vitest";

import {
  canvasPendingUploadRemovalActionV1,
  canvasUploadFileSignatureV1,
  queueCanvasImportFilesV1,
} from "./use-canvas-image-uploads-v1.js";
import { createEditorRuntimePlacedImageV1 } from "./editor-node-factory-v1.js";
import type {
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
} from "./editor-runtime-v1.js";

function imageFile(name: string, type = "image/png"): File {
  return new File(["image"], name, {
    lastModified: 1_723_456_789,
    type,
  });
}

const commonNode = {
  name: "Upload target",
  opacity: 1,
  blendMode: "normal" as const,
  visible: true,
  locked: false,
  transform: {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
};

function pendingImage(localId: string) {
  return createEditorRuntimePlacedImageV1(
    {
      kind: "local_file",
      localId,
      name: "pending.png",
      mediaType: "image/png",
      size: 1024,
      previewUrl: `blob:https://kanvas.invalid/${localId}`,
    },
    { width: 800, height: 600 },
  );
}

function pageWith(nodes: readonly EditorRuntimeNodeV1[]): EditorRuntimePageV1 {
  return {
    id: "page-1",
    name: "Page 1",
    width: 1080,
    height: 1080,
    background: { kind: "transparent" },
    nodes,
  };
}

describe("Canvas image upload queue", () => {
  it("uses stable file metadata for pending-upload identity", () => {
    expect(canvasUploadFileSignatureV1(imageFile("product.png"))).toBe(
      "product.png:image/png:5:1723456789",
    );
  });

  it("queues supported files once and reports duplicate selections", () => {
    const first = imageFile("product.png");
    const duplicate = imageFile("product.png");
    const unsupported = imageFile("notes.txt", "text/plain");
    const pendingSignatures = new Set<string>();

    const queued = queueCanvasImportFilesV1(
      [first, duplicate, unsupported],
      pendingSignatures,
    );

    expect(queued.accepted).toEqual([first]);
    expect(queued.duplicateCount).toBe(1);
    expect(pendingSignatures).toEqual(
      new Set(["product.png:image/png:5:1723456789"]),
    );
  });

  it("cancels contextual uploads without deleting their frame or grid", () => {
    const frame = {
      ...commonNode,
      id: "frame-1",
      kind: "frame",
      definition: {
        catalogId: "kanvas.core.frames",
        definitionId: "frame.rectangle",
        revision: "2026-07-31",
      },
      content: { image: pendingImage("frame-local") },
      fill: { kind: "none" },
      stroke: { paint: { kind: "none" }, width: 0, alignment: "center" },
    } as const satisfies EditorRuntimeNodeV1;
    const grid = {
      ...commonNode,
      id: "grid-1",
      kind: "grid",
      definition: {
        catalogId: "kanvas.core.grids",
        definitionId: "grid.two.columns",
        revision: "2026-07-31",
      },
      gap: 12,
      cornerRadius: 0,
      cells: [
        { slotId: "left" },
        {
          slotId: "right",
          content: { image: pendingImage("grid-local") },
        },
      ],
    } as const satisfies EditorRuntimeNodeV1;

    expect(
      canvasPendingUploadRemovalActionV1(
        pageWith([frame, grid]),
        "frame-local",
      ),
    ).toEqual({
      type: "remove_frame_content",
      frameId: "frame-1",
      pageId: "page-1",
    });
    expect(
      canvasPendingUploadRemovalActionV1(pageWith([frame, grid]), "grid-local"),
    ).toEqual({
      type: "remove_grid_cell_content",
      gridId: "grid-1",
      pageId: "page-1",
      slotId: "right",
    });
  });
});
