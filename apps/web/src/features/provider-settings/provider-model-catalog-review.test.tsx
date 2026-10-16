import type { ProviderModelCatalogReview } from "@kanvas/contracts/api";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { ProviderModelCatalogReviewDetails } from "./provider-model-catalog-review.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function review(
  input: Partial<ProviderModelCatalogReview> = {},
): ProviderModelCatalogReview {
  return {
    providerSettingId: "01K00000000000000000000001",
    version: 4,
    current: {
      snapshotId: "01K00000000000000000000002",
      revision: 2,
      canonicalDigest: digest("a"),
      sourceDigest: digest("b"),
    },
    activated: {
      snapshotId: "01K00000000000000000000003",
      revision: 1,
      canonicalDigest: digest("c"),
      sourceDigest: digest("d"),
    },
    selectedModels: [
      {
        providerModelId: "gpt-image-1",
        change: "changed",
        displayName: {
          before: "GPT Image 1",
          after: "GPT Image 1",
        },
        completeness: {
          before: "partial",
          after: "partial",
        },
        inputModalities: { added: [], removed: [] },
        outputModalities: { added: [], removed: [] },
        operations: [
          {
            capabilityKey: "image.generate",
            change: "changed",
            apiSurfaces: {
              added: [],
              removed: [],
            },
            parameters: [
              {
                key: "quality",
                change: "changed",
                changedFields: ["values"],
                before: {
                  key: "quality",
                  label: "Quality",
                  valueType: "enum",
                  values: ["low"],
                  required: false,
                  evidence: [],
                },
                after: {
                  key: "quality",
                  label: "Quality",
                  valueType: "enum",
                  values: ["low", "high"],
                  required: false,
                  evidence: [],
                },
              },
            ],
          },
        ],
        blockers: [],
      },
    ],
    blockers: [],
    canAdopt: true,
    ...input,
  };
}

describe("Provider model catalog review", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("shows immutable revisions and typed parameter changes", () => {
    const markup = renderToStaticMarkup(
      <ProviderModelCatalogReviewDetails review={review()} />,
    );

    expect(markup).toContain("已采用 r1");
    expect(markup).toContain("待采用 r2");
    expect(markup).toContain("gpt-image-1");
    expect(markup).toContain("quality");
    expect(markup).toContain("values");
    expect(markup).toContain("可以采用");
  });

  it("shows a removed selected model as an adoption blocker", () => {
    const blocked = review({
      blockers: [
        {
          code: "selected_model_removed",
          providerModelId: "gpt-image-1",
        },
      ],
      canAdopt: false,
    });
    const markup = renderToStaticMarkup(
      <ProviderModelCatalogReviewDetails review={blocked} />,
    );

    expect(markup).toContain("无法采用");
    expect(markup).toContain("gpt-image-1");
    expect(markup).toContain("已从最新目录中消失");
  });
});
