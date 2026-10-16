import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  ProviderModelCatalogRefreshResultSchema,
  RefreshProviderModelCatalogBodySchema,
  refreshWorkspaceProviderModelCatalogRoute,
  routeRegistry,
} from "../src/api/index.js";

const provider = {
  id: "01K00000000000000000000001",
  displayName: "Studio images",
  preset: "openai" as const,
  baseUrl: "https://api.openai.com/v1",
  modelKeys: ["gpt-image-1"],
  modelCatalog: {
    revision: 2,
    activatedRevision: 1,
    discoveredAt: "2026-08-12T08:00:00.000Z",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    discoveryMethod: "openai.models+adapter-manifest",
    changesPendingReview: true,
  },
  lifecycle: "active" as const,
  validation: "passed" as const,
  secretConfigured: true,
  canRefreshModelCatalog: true,
  version: 4,
  createdAt: "2026-08-12T07:00:00.000Z",
  updatedAt: "2026-08-12T08:00:00.000Z",
};

describe("Provider model catalog refresh contract", () => {
  it("registers an idempotent credential-managed refresh command", () => {
    expect(refreshWorkspaceProviderModelCatalogRoute).toMatchObject({
      operationId: "workspaceProviderSettings.refreshModelCatalog",
      method: "POST",
      path: "/api/v1/provider-settings/{providerSettingId}/model-catalog-refreshes",
      security: ["sessionOrServiceToken"],
      idempotency: "required",
    });
    expect(routeRegistry).toContain(refreshWorkspaceProviderModelCatalogRoute);
    expect(
      Value.Check(RefreshProviderModelCatalogBodySchema, {
        expectedVersion: 3,
      }),
    ).toBe(true);
    expect(
      Value.Check(RefreshProviderModelCatalogBodySchema, {
        expectedVersion: 0,
      }),
    ).toBe(false);
  });

  it("returns catalog review state without credential material", () => {
    const response = {
      provider,
      result: "refreshed" as const,
      changesPendingReview: true,
    };
    const ajv = new Ajv2020({ strict: true });
    (addFormats as unknown as (value: Ajv2020) => unknown)(ajv);
    expect(ajv.compile(ProviderModelCatalogRefreshResultSchema)(response)).toBe(
      true,
    );
    expect(JSON.stringify(response)).not.toContain("apiKey");
  });
});
