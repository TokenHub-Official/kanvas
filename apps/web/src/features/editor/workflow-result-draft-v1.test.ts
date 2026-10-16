import type { BrandKitRevision } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  createWorkflowResultDraftV1,
  readableWorkflowHeadlineColorV1,
} from "./workflow-result-draft-v1.js";

describe("workflow result draft v1", () => {
  it("keeps the headline readable when a Brand text color matches the background", () => {
    expect(readableWorkflowHeadlineColorV1(["#15A67B"], "#15A67BFF")).toBe(
      "#151515",
    );
  });

  it("keeps the result Artifact and turns the pinned Brand text style into editable copy", () => {
    const draft = createWorkflowResultDraftV1({
      workspaceId: "01K00000000000000000000001",
      runId: "01K00000000000000000000002",
      artifactId: "01K00000000000000000000003",
      sourceTitle: "品牌社媒起稿",
      headline: "夏日上新",
      intrinsicSize: { width: 1080, height: 1080 },
      nodeIds: { image: "result-image", text: "brand-headline" },
      brandRevision: {
        id: "01K00000000000000000000004",
        brandKitId: "01K00000000000000000000005",
        workspaceId: "01K00000000000000000000001",
        revisionNumber: 1,
        name: "Kanvas 主品牌",
        colors: [
          {
            key: "text",
            name: "品牌文字",
            role: "text_primary",
            value: "#FDFDFD",
            position: 0,
          },
        ],
        logos: [],
        referenceImages: [],
        textStyles: [
          {
            key: "title",
            name: "品牌标题",
            role: "title",
            fontId: "brand-title",
            fontRevision: "2026-08",
            fontFamily: "Kanvas Sans",
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1,
            colorKey: "text",
            position: 0,
          },
        ],
        guidelines: { principles: [], avoid: [] },
        contentDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        publishedByPrincipalId: "01K00000000000000000000006",
        publishedAt: "2026-08-24T00:00:00.000Z",
      } satisfies BrandKitRevision,
    });

    expect(draft.pages[0]?.nodes[0]).toMatchObject({
      kind: "image",
      image: {
        source: {
          kind: "artifact",
          artifactId: "01K00000000000000000000003",
        },
      },
    });
    expect(draft.pages[0]?.nodes[1]).toMatchObject({
      kind: "text",
      content: {
        paragraphs: [
          {
            runs: [
              {
                text: "夏日上新",
                font: { family: "Kanvas Sans" },
                fill: { kind: "solid", color: "#FDFDFD" },
              },
            ],
          },
        ],
      },
    });
  });
});
