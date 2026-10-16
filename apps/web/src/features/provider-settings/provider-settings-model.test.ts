import type { ProviderSettingSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  providerSettingActions,
  providerSettingStatus,
} from "./provider-settings-model.js";

function provider(
  input: Partial<ProviderSettingSummary> = {},
): ProviderSettingSummary {
  return {
    baseUrl: "https://api.openai.com/v1",
    canRefreshModelCatalog: false,
    createdAt: "2026-08-05T00:00:00.000Z",
    displayName: "OpenAI",
    id: "01K00000000000000000000000",
    lifecycle: "draft",
    modelKeys: ["gpt-image-1"],
    preset: "openai",
    secretConfigured: true,
    updatedAt: "2026-08-05T00:00:00.000Z",
    validation: "pending",
    version: 1,
    ...input,
  };
}

describe("provider settings recovery model", () => {
  it("keeps a failed legacy configuration out of use while allowing another check", () => {
    const failed = provider({
      lifecycle: "disabled",
      validation: "failed",
    });
    expect(providerSettingStatus(failed)).toMatchObject({
      key: "inactive",
      label: "未启用",
    });
    expect(providerSettingActions(failed)).toMatchObject({
      canActivate: false,
      canDisable: false,
      canRotate: false,
      canValidate: true,
    });
  });

  it("shows a newly verified service as ready to enable", () => {
    const ready = provider({
      canRefreshModelCatalog: true,
      lifecycle: "disabled",
      validation: "passed",
      validatedAt: "2026-08-05T00:30:00.000Z",
    });
    expect(providerSettingStatus(ready)).toMatchObject({
      key: "ready",
      label: "待启用",
    });
    expect(providerSettingActions(ready)).toMatchObject({
      activationKey: "activate",
      activationLabel: "启用",
      canActivate: true,
      canDisable: false,
      canRefreshCatalog: true,
      canReviewCatalog: false,
      canRotate: false,
      canValidate: false,
    });
  });

  it("lets a previously active disabled service return", () => {
    const disabled = provider({
      activatedAt: "2026-08-05T01:00:00.000Z",
      lifecycle: "disabled",
      validation: "passed",
    });
    expect(providerSettingStatus(disabled).label).toBe("已停用");
    expect(providerSettingActions(disabled)).toMatchObject({
      activationLabel: "重新启用",
      canActivate: true,
      canRefreshCatalog: false,
    });
  });

  it("keeps revoked services read-only", () => {
    expect(
      providerSettingActions(
        provider({
          lifecycle: "revoked",
          validation: "failed",
        }),
      ),
    ).toMatchObject({
      canActivate: false,
      canDisable: false,
      canRefreshCatalog: false,
      canRotate: false,
      canValidate: false,
    });
  });

  it("gives active services only their safe management actions", () => {
    expect(
      providerSettingActions(
        provider({
          canRefreshModelCatalog: true,
          lifecycle: "active",
          validation: "passed",
        }),
      ),
    ).toMatchObject({
      canActivate: false,
      canDisable: true,
      canRefreshCatalog: true,
      canReviewCatalog: false,
      canRotate: true,
      canValidate: false,
    });
    expect(
      providerSettingActions(
        provider({
          canRefreshModelCatalog: true,
          lifecycle: "active",
          secretConfigured: false,
          validation: "passed",
        }),
      ).canRefreshCatalog,
    ).toBe(false);
    expect(
      providerSettingActions(
        provider({
          canRefreshModelCatalog: false,
          lifecycle: "active",
          validation: "passed",
        }),
      ).canRefreshCatalog,
    ).toBe(false);
  });

  it("exposes catalog review whenever an immutable refresh is pending", () => {
    expect(
      providerSettingActions(
        provider({
          activatedAt: "2026-08-05T01:00:00.000Z",
          lifecycle: "disabled",
          modelCatalog: {
            revision: 3,
            activatedRevision: 2,
            changesPendingReview: true,
            discoveredAt: "2026-08-05T02:00:00.000Z",
            discoveryMethod: "openai.models",
            sourceDigest: `sha256:${"a".repeat(64)}`,
          },
          validation: "passed",
        }),
      ).canReviewCatalog,
    ).toBe(true);
  });

  it("keeps an unchecked legacy draft visibly inactive and checkable", () => {
    const pending = provider();
    expect(providerSettingStatus(pending)).toMatchObject({
      key: "inactive",
      label: "未启用",
    });
    expect(providerSettingActions(pending)).toMatchObject({
      canActivate: false,
      canValidate: true,
    });
  });
});
