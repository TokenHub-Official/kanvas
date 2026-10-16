import { describe, expect, it } from "vitest";

import {
  normalizeProviderSettingBaseUrl,
  WorkspaceProviderSettingsController,
} from "../src/http/workspace-provider-settings.controller.js";

describe("Workspace Provider Settings endpoint admission", () => {
  it("normalizes the supported Provider presets", () => {
    expect(normalizeProviderSettingBaseUrl("openai", undefined)).toEqual({
      baseUrl: "https://api.openai.com/v1",
      canonicalOrigin: "https://api.openai.com",
    });
    expect(normalizeProviderSettingBaseUrl("openrouter", undefined)).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      canonicalOrigin: "https://openrouter.ai",
    });
    expect(normalizeProviderSettingBaseUrl("xai", undefined)).toEqual({
      baseUrl: "https://api.x.ai/v1",
      canonicalOrigin: "https://api.x.ai",
    });
    expect(normalizeProviderSettingBaseUrl("gemini", undefined)).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      canonicalOrigin: "https://generativelanguage.googleapis.com",
    });
    expect(normalizeProviderSettingBaseUrl("tokenhub", undefined)).toEqual({
      baseUrl: "https://us-api.tokenhub.com",
      canonicalOrigin: "https://us-api.tokenhub.com",
    });
    expect(
      normalizeProviderSettingBaseUrl(
        "newapi",
        "https://newapi.example.com/api/generation/tasks/",
      ),
    ).toEqual({
      baseUrl: "https://newapi.example.com/api",
      canonicalOrigin: "https://newapi.example.com",
    });
  });

  it.each([
    "http://newapi.example.com",
    "https://user:pass@newapi.example.com",
    "https://newapi.example.com?token=secret",
    "https://newapi.example.com/#fragment",
  ])("rejects unsafe Provider Base URL %s", (baseUrl) => {
    expect(() => normalizeProviderSettingBaseUrl("newapi", baseUrl)).toThrow();
  });

  it("allows a regional endpoint for every built-in Provider", () => {
    expect(
      normalizeProviderSettingBaseUrl(
        "openai",
        "https://eu-api.example.com/v1",
      ),
    ).toEqual({
      baseUrl: "https://eu-api.example.com/v1",
      canonicalOrigin: "https://eu-api.example.com",
    });
    expect(
      normalizeProviderSettingBaseUrl(
        "gemini",
        "https://asia-api.example.com/v1beta",
      ),
    ).toEqual({
      baseUrl: "https://asia-api.example.com/v1beta",
      canonicalOrigin: "https://asia-api.example.com",
    });
  });
});

describe("Provider initialization error response", () => {
  it.each(["Instance", "Workspace"])(
    "returns an actionable code for missing %s policy",
    async (level) => {
      type Dependencies = ConstructorParameters<
        typeof WorkspaceProviderSettingsController
      >;
      const controller = new WorkspaceProviderSettingsController(
        {} as Dependencies[0],
        {
          providerSettings: {
            activate: () =>
              Promise.reject(
                new Error(`${level} Provider policy is not configured.`),
              ),
          },
        } as unknown as Dependencies[1],
        {} as Dependencies[2],
        {} as Dependencies[3],
        {
          require: () => ({ scope: { authenticationRefId: "test-session" } }),
        } as unknown as Dependencies[4],
      );
      await expect(
        controller.activate(
          { id: "request-policy-test" } as Parameters<
            typeof controller.activate
          >[0],
          "01K00000000000000000000001",
          "policy-test-operation",
          {
            expectedVersion: 1,
            hardLimitAmount: "20",
            modelPricingConfigurations: [],
          },
        ),
      ).rejects.toMatchObject({
        response: { code: "provider_settings.policy_not_initialized" },
        status: 503,
      });
    },
  );
});
