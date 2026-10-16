import type { EditorDocumentV1 } from "@kanvas/contracts/editor";
import { describe, expect, it } from "vitest";

import {
  commitEditorLocalImageV1,
  createEditorRuntimeDocumentV1,
  editorRuntimePageArtifactIdsV1,
  editorRuntimeSerializationDiagnosticsV1,
  serializeEditorRuntimeDocumentV1,
  type EditorRuntimeImageNodeV1,
} from "./editor-runtime-v1.js";

const document: EditorDocumentV1 = {
  schemaVersion: "kanvas.editor-document/v1",
  documentId: "01K00000000000000000000020",
  workspaceId: "01K00000000000000000000000",
  title: "Runtime",
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1080,
      background: {
        kind: "transparent",
      },
      nodes: [],
    },
  ],
  metadata: {
    createdWith: "kanvas-web",
  },
};

const localNode: EditorRuntimeImageNodeV1 = {
  id: "image-local",
  name: "刚刚拖入的图片",
  kind: "image",
  transform: {
    x: 120,
    y: 180,
    width: 640,
    height: 480,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  image: {
    source: {
      kind: "local",
      localId: "local-1",
      name: "商品图.png",
      mediaType: "image/png",
      size: 1_024,
      previewUrl: "blob:https://kanvas.invalid/local-1",
      uploadState: "uploading",
    },
    intrinsicWidth: 1_200,
    intrinsicHeight: 900,
    mediaType: "image/png",
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

describe("Canvas Core V1 runtime document", () => {
  it("keeps durable documents structurally stable", () => {
    const runtime = createEditorRuntimeDocumentV1(document);

    expect(serializeEditorRuntimeDocumentV1(runtime)).toEqual(document);
  });

  it("migrates legacy drawing polylines into one freehand object", () => {
    const legacyDrawing: EditorDocumentV1 = {
      ...document,
      pages: [
        {
          ...document.pages[0]!,
          nodes: [
            {
              id: "drawing:legacy-stroke",
              name: "Freehand stroke",
              kind: "line",
              transform: {
                x: 10,
                y: 20,
                width: 200,
                height: 80,
                rotation: 0,
                flipX: false,
                flipY: false,
              },
              opacity: 1,
              blendMode: "normal",
              visible: true,
              locked: false,
              pathKind: "polyline",
              points: [
                { x: 0, y: 0.5 },
                { x: 0.5, y: 0 },
                { x: 1, y: 0.5 },
              ],
              stroke: {
                paint: { kind: "solid", color: "#3048f5" },
                width: 8,
                alignment: "center",
              },
              startCap: "none",
              endCap: "none",
            },
          ],
        },
      ],
    };

    const runtime = createEditorRuntimeDocumentV1(legacyDrawing);

    expect(runtime.pages[0]?.nodes[0]).toMatchObject({
      id: "drawing:legacy-stroke",
      kind: "line",
      role: "freehand",
      capStyle: "round",
      joinStyle: "round",
    });
    expect(
      serializeEditorRuntimeDocumentV1(runtime).pages[0]?.nodes[0],
    ).toMatchObject({ role: "freehand" });
  });

  it("allows a local image in Runtime but blocks durable serialization", () => {
    const runtime = {
      ...createEditorRuntimeDocumentV1(document),
      pages: [
        {
          ...createEditorRuntimeDocumentV1(document).pages[0]!,
          nodes: [localNode],
        },
      ],
    };

    expect(editorRuntimeSerializationDiagnosticsV1(runtime)).toEqual([
      {
        code: "pending_local_source",
        localId: "local-1",
        pageId: "page-1",
        nodeId: "image-local",
      },
    ]);
    expect(() => serializeEditorRuntimeDocumentV1(runtime)).toThrow(
      "pending local image",
    );
  });

  it("commits upload results without changing node identity or geometry", () => {
    const base = createEditorRuntimeDocumentV1(document);
    const runtime = {
      ...base,
      pages: [
        {
          ...base.pages[0]!,
          nodes: [localNode],
        },
      ],
    };
    const committed = commitEditorLocalImageV1(runtime, "local-1", {
      kind: "artifact",
      artifactId: "01K00000000000000000000031",
      assetId: "01K00000000000000000000032",
    });
    const durable = serializeEditorRuntimeDocumentV1(committed);

    expect(durable.pages[0]?.nodes[0]).toMatchObject({
      id: "image-local",
      transform: localNode.transform,
      image: {
        source: {
          kind: "artifact",
          artifactId: "01K00000000000000000000031",
          assetId: "01K00000000000000000000032",
        },
      },
    });
  });

  it("collects durable artifacts by page while ignoring pending local images", () => {
    const durableRuntime = createEditorRuntimeDocumentV1({
      ...document,
      pages: [
        {
          ...document.pages[0]!,
          background: {
            kind: "image",
            image: {
              source: {
                kind: "artifact",
                artifactId: "artifact-background",
              },
              intrinsicWidth: 100,
              intrinsicHeight: 100,
              mediaType: "image/png",
              crop: { x: 0, y: 0, width: 1, height: 1 },
              fit: "cover",
              focalPoint: { x: 0.5, y: 0.5 },
            },
            opacity: 1,
          },
          nodes: [
            {
              ...localNode,
              id: "image-artifact",
              image: {
                ...localNode.image,
                source: {
                  kind: "artifact",
                  artifactId: "artifact-page-1",
                },
              },
            },
          ],
        },
        {
          ...document.pages[0]!,
          id: "page-2",
          nodes: [],
        },
      ],
    });
    const runtime = {
      ...durableRuntime,
      pages: [
        durableRuntime.pages[0]!,
        { ...durableRuntime.pages[1]!, nodes: [localNode] },
      ],
    };

    expect(editorRuntimePageArtifactIdsV1(runtime.pages[0]!)).toEqual([
      "artifact-background",
      "artifact-page-1",
    ]);
    expect(editorRuntimePageArtifactIdsV1(runtime.pages[1]!)).toEqual([]);
  });
});
