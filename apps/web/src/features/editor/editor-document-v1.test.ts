import type { EditorDocumentV1 } from "@kanvas/contracts/editor";
import { describe, expect, it, vi } from "vitest";

import {
  createEditorDraftContentV1,
  hydrateEditorRuntimeDocumentV1,
  editorArtifactSourceUrlV1,
  editorDocumentV1ArtifactIds,
  hydrateEditorDocumentV1,
  normalizeEditorDocumentV1,
} from "./editor-document-v1.js";

const common = {
  transform: {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  opacity: 1,
  blendMode: "normal" as const,
  visible: true,
  locked: false,
};

const placedImage = (artifactId: string) =>
  ({
    source: {
      kind: "artifact" as const,
      artifactId,
    },
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
  }) as const;

const repeatedArtifact = "01K00000000000000000000031";
const unavailableArtifact = "01K00000000000000000000032";

const document: EditorDocumentV1 = {
  schemaVersion: "kanvas.editor-document/v1",
  documentId: "01K00000000000000000000020",
  workspaceId: "01K00000000000000000000000",
  title: "V1 资源解析",
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1080,
      background: {
        kind: "image",
        image: placedImage(repeatedArtifact),
        opacity: 1,
      },
      nodes: [
        {
          ...common,
          id: "image-1",
          name: "商品图",
          kind: "image",
          image: placedImage(repeatedArtifact),
          cornerRadius: 0,
        },
        {
          ...common,
          id: "group-1",
          name: "容器组",
          kind: "group",
          children: [
            {
              ...common,
              id: "frame-1",
              name: "画框",
              kind: "frame",
              definition: {
                catalogId: "kanvas.core.frames",
                definitionId: "frame.circle",
                revision: "1",
              },
              content: {
                image: placedImage(repeatedArtifact),
              },
              fill: {
                kind: "none",
              },
              stroke: {
                paint: {
                  kind: "none",
                },
                width: 0,
                alignment: "center",
              },
            },
            {
              ...common,
              id: "grid-1",
              name: "网格",
              kind: "grid",
              definition: {
                catalogId: "kanvas.core.grids",
                definitionId: "grid.two",
                revision: "1",
              },
              gap: 8,
              cornerRadius: 0,
              cells: [
                {
                  slotId: "left",
                  content: {
                    image: placedImage(unavailableArtifact),
                  },
                },
                {
                  slotId: "right",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  metadata: {
    createdWith: "kanvas-web",
  },
};

describe("Editor Document V1 runtime resources", () => {
  it("collects every nested Artifact exactly once", () => {
    expect(editorDocumentV1ArtifactIds(document)).toEqual([
      repeatedArtifact,
      unavailableArtifact,
    ]);
  });

  it("deduplicates resolution and degrades one unavailable Artifact", async () => {
    const resolveArtifact = vi.fn((artifactId: string) =>
      artifactId === unavailableArtifact
        ? Promise.reject(new Error("unavailable"))
        : Promise.resolve(`blob:https://kanvas.invalid/${artifactId}`),
    );

    const hydrated = await hydrateEditorDocumentV1(document, resolveArtifact);

    expect(resolveArtifact).toHaveBeenCalledTimes(2);
    expect(
      editorArtifactSourceUrlV1(hydrated.resources, repeatedArtifact),
    ).toBe(`blob:https://kanvas.invalid/${repeatedArtifact}`);
    expect(hydrated.resources.get(unavailableArtifact)).toEqual({
      artifactId: unavailableArtifact,
      sourceUnavailable: true,
    });
    expect(hydrated.document).toBe(document);
  });

  it("keeps the current document identity when creating the runtime", async () => {
    expect(normalizeEditorDocumentV1(document)).toBe(document);
    const hydrated = await hydrateEditorRuntimeDocumentV1(document, vi.fn());
    expect(hydrated.document.schemaVersion).toBe("kanvas.editor-document/v1");
  });

  it("serializes the runtime through the durable V1 boundary", () => {
    const draft = createEditorDraftContentV1(
      {
        ...document,
        title: "旧标题",
      },
      "  新标题  ",
    );

    expect(draft).toMatchObject({
      schemaVersion: "kanvas.editor-document/v1",
      title: "新标题",
      pages: document.pages,
    });
    expect(draft).not.toHaveProperty("documentId");
    expect(draft).not.toHaveProperty("workspaceId");
  });
});
