import type { EditorDraftContentV1 } from "@kanvas/contracts/editor";

import { createEditorDocumentV1 } from "./editor-document-factory-v1.js";
import { centeredInsertionRect } from "./editor-node-insertion.js";
import { createEditorRuntimeNodeV1 } from "./editor-node-factory-v1.js";

const REUSED_ASSET_NAME_MAX_LENGTH = 240;

export interface AssetReuseDraftInputV1 {
  readonly artifactId: string;
  readonly assetId: string;
  readonly assetName: string;
  readonly intrinsicSize: {
    readonly height: number;
    readonly width: number;
  };
  readonly nodeId: string;
  readonly workspaceId: string;
}

function reuseTitle(assetName: string): string {
  const suffix = " · 复用";
  const name = assetName.trim() || "未命名资产";
  return `${name.slice(
    0,
    REUSED_ASSET_NAME_MAX_LENGTH - suffix.length,
  )}${suffix}`;
}

export function createAssetReuseDraftV1(
  input: AssetReuseDraftInputV1,
): EditorDraftContentV1 {
  const title = reuseTitle(input.assetName);
  const document = createEditorDocumentV1(input.workspaceId, {
    title,
  });
  const page = document.pages[0];
  if (!page) {
    throw new Error("新画板没有可用页面。");
  }
  const source = {
    kind: "artifact" as const,
    artifactId: input.artifactId,
    assetId: input.assetId,
  };
  const node = createEditorRuntimeNodeV1(
    {
      kind: "image",
      source: {
        kind: "artifact",
        reference: source,
      },
      intrinsicSize: input.intrinsicSize,
    },
    input.nodeId,
    centeredInsertionRect(input.intrinsicSize, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    }),
  );
  if (node.kind !== "image") {
    throw new Error("资产没有形成图片节点。");
  }

  return {
    schemaVersion: document.schemaVersion,
    title,
    pages: [
      {
        ...page,
        nodes: [
          {
            ...node,
            name: input.assetName.trim() || "未命名资产",
            image: {
              ...node.image,
              source,
            },
          },
        ],
      },
    ],
    metadata: document.metadata,
  };
}
