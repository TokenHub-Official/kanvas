import type { BrandKitSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceBrandChoiceV1,
  withoutBrandChoiceV1,
  workspaceBrandChoiceValueV1,
  workspaceDefaultBrandChoiceV1,
} from "./use-workspace-brand-choice-v1.js";

function brand(
  id: string,
  revisionId: string,
  isDefault: boolean,
): BrandKitSummary {
  return {
    id,
    workspaceId: "01K00000000000000000000000",
    name: isDefault ? "Kanvas 主品牌" : "Kanvas 活动品牌",
    lifecycleStatus: "active",
    isDefault,
    version: 1,
    draftVersion: 1,
    latestPublishedRevision: {
      id: revisionId,
      revisionNumber: 1,
      publishedAt: "2026-08-23T00:00:00.000Z",
    },
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}

describe("Workspace brand choice", () => {
  const primary = brand(
    "01K00000000000000000000001",
    "01K00000000000000000000002",
    true,
  );
  const campaign = brand(
    "01K00000000000000000000003",
    "01K00000000000000000000004",
    false,
  );

  it("prefills the published Workspace default for new work", () => {
    expect(
      resolveWorkspaceBrandChoiceV1(
        [campaign, primary],
        workspaceDefaultBrandChoiceV1,
      ),
    ).toMatchObject({
      resolvedChoice: workspaceBrandChoiceValueV1(primary.id),
      selection: {
        brandKitRevisionId: primary.latestPublishedRevision?.id,
        withoutBrand: false,
      },
    });
  });

  it("allows one task to choose another published brand", () => {
    expect(
      resolveWorkspaceBrandChoiceV1(
        [primary, campaign],
        workspaceBrandChoiceValueV1(campaign.id),
      ).selection,
    ).toMatchObject({
      brand: { id: campaign.id },
      brandKitRevisionId: campaign.latestPublishedRevision?.id,
      withoutBrand: false,
    });
  });

  it("keeps an explicit no-brand choice distinct from the default", () => {
    expect(
      resolveWorkspaceBrandChoiceV1([primary], withoutBrandChoiceV1).selection,
    ).toEqual({ withoutBrand: true });
  });
});
