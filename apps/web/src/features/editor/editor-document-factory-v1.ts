import type { EditorDocumentV1, EditorPageV1 } from "@kanvas/contracts/editor";

const transientDocumentId = "00000000000000000000000000";

export interface EditorPagePresetV1 {
  readonly height: number;
  readonly id: string;
  readonly label: string;
  readonly width: number;
}

export const editorPagePresetsV1 = [
  {
    id: "square",
    label: "正方形",
    width: 1080,
    height: 1080,
  },
  {
    id: "portrait",
    label: "竖版 3:4",
    width: 1080,
    height: 1440,
  },
  {
    id: "story",
    label: "竖屏内容",
    width: 1080,
    height: 1920,
  },
  {
    id: "landscape",
    label: "横版内容",
    width: 1920,
    height: 1080,
  },
  {
    id: "document",
    label: "文档",
    width: 1240,
    height: 1754,
  },
] as const satisfies readonly EditorPagePresetV1[];

export function createEditorPageV1(
  id: string,
  name: string,
  size: {
    readonly height: number;
    readonly width: number;
  } = editorPagePresetsV1[0],
): EditorPageV1 {
  return {
    id,
    name,
    width: Math.round(size.width),
    height: Math.round(size.height),
    background: {
      kind: "paint",
      paint: {
        kind: "solid",
        color: "#ffffff",
      },
    },
    nodes: [],
  };
}

export function createEditorDocumentV1(
  workspaceId: string,
  options: {
    readonly documentId?: string;
    readonly pageId?: string;
    readonly title?: string;
  } = {},
): EditorDocumentV1 {
  return {
    schemaVersion: "kanvas.editor-document/v1",
    documentId: options.documentId ?? transientDocumentId,
    workspaceId,
    title: options.title ?? "未命名画板",
    pages: [createEditorPageV1(options.pageId ?? "page-1", "页面 1")],
    metadata: {
      createdWith: "kanvas-web",
    },
  };
}
