import { describe, expect, it } from "vitest";

import { createAssetReuseDraftV1 } from "./asset-reuse-draft-v1.js";

describe("asset reuse draft v1", () => {
  it("pins the immutable ArtifactReference in the first saved revision", () => {
    const draft = createAssetReuseDraftV1({
      workspaceId: "01K00000000000000000000001",
      assetId: "01K00000000000000000000002",
      artifactId: "01K00000000000000000000003",
      assetName: "发布主视觉",
      intrinsicSize: {
        width: 1920,
        height: 1080,
      },
      nodeId: "image-reuse-1",
    });

    expect(draft.title).toBe("发布主视觉 · 复用");
    expect(draft.pages[0]?.nodes[0]).toMatchObject({
      id: "image-reuse-1",
      kind: "image",
      name: "发布主视觉",
      image: {
        source: {
          kind: "artifact",
          assetId: "01K00000000000000000000002",
          artifactId: "01K00000000000000000000003",
        },
        intrinsicWidth: 1920,
        intrinsicHeight: 1080,
      },
    });
  });

  it("fits a portrait asset inside the default page", () => {
    const draft = createAssetReuseDraftV1({
      workspaceId: "01K00000000000000000000001",
      assetId: "01K00000000000000000000002",
      artifactId: "01K00000000000000000000003",
      assetName: "竖版海报",
      intrinsicSize: {
        width: 1080,
        height: 1920,
      },
      nodeId: "image-reuse-2",
    });
    const node = draft.pages[0]?.nodes[0];

    expect(node).toMatchObject({
      transform: {
        x: 351.675,
        y: 205.2,
        width: 376.65,
        height: 669.6,
      },
    });
  });
});
