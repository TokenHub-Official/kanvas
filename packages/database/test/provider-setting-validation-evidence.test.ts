import { describe, expect, it } from "vitest";

import { providerSettingValidationDigest } from "../src/runtime/provider-settings-store.js";

const input = Object.freeze({
  providerSettingId: "01K00000000000000000000001",
  providerEndpointId: "01K00000000000000000000002",
  preset: "openai" as const,
  baseUrlDigest:
    "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  modelCatalogDigest:
    "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  modelCatalogSourceDigest:
    "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  selectedModelKeys: Object.freeze(["gpt-image-1"]),
  secretMaterialFingerprint:
    "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  validatedAt: new Date("2026-08-12T10:00:00.000Z"),
});

describe("Provider setting validation evidence", () => {
  it("is deterministic and binds every probed create fact", () => {
    const digest = providerSettingValidationDigest(input);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(providerSettingValidationDigest(input)).toBe(digest);

    for (const changed of [
      { preset: "openrouter" as const },
      {
        selectedModelKeys: Object.freeze(["gpt-image-1", "gpt-image-1-mini"]),
      },
      {
        secretMaterialFingerprint:
          "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      },
      {
        validatedAt: new Date("2026-08-12T10:00:00.001Z"),
      },
    ]) {
      expect(
        providerSettingValidationDigest({
          ...input,
          ...changed,
        }),
      ).not.toBe(digest);
    }
  });
});
