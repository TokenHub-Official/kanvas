import type { TrustedWorkspaceScope } from "@kanvas/application";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { CapabilityInstallationService } from "../src/capabilities/capability-installation.service.js";
import type { ModelResourceImportService } from "../src/model-resources/model-resource-import.service.js";

const scope: TrustedWorkspaceScope = Object.freeze({
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "capability-installation-service",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["capability.configure"] as const,
  trusted: true,
});

const digest = `sha256:${"a".repeat(64)}`;
const recommendation = {
  id: "01K00000000000000000000010",
  recommendationKey: "recommendation.image.example",
  capabilityKey: "image.example.process",
  packageVersion: "1.0.0",
  canonicalDigest: digest,
  document: {} as never,
  title: {
    defaultLocale: "en-US",
    values: { "en-US": "Example" },
  },
  category: {
    defaultLocale: "en-US",
    values: { "en-US": "Image" },
  },
  sourceKind: "model_resource" as const,
};

describe("CapabilityInstallationService", () => {
  it("starts and attaches the recommended model import without installing early", async () => {
    const install = vi.fn().mockResolvedValue({
      id: "01K00000000000000000000011",
      catalogEntryId: recommendation.id,
      status: "waiting_dependency",
      requiredModelResourceAssetKey: "model.example.release",
      version: 1,
      replayed: false,
    });
    const attachModelResourceImport = vi.fn().mockResolvedValue({
      id: "01K00000000000000000000011",
      catalogEntryId: recommendation.id,
      status: "waiting_dependency",
      modelResourceImportId: "01K00000000000000000000012",
      version: 2,
      replayed: false,
    });
    const start = vi.fn().mockResolvedValue({
      id: "01K00000000000000000000012",
    });
    const service = new CapabilityInstallationService(
      {
        capabilityInstallations: {
          listCatalogEntries: vi.fn().mockResolvedValue([recommendation]),
          install,
          attachModelResourceImport,
        },
        modelResources: {
          listCatalogEntries: vi.fn().mockResolvedValue([
            {
              id: "01K00000000000000000000013",
              assetKey: "model.example.release",
            },
          ]),
        },
      } as unknown as ServerDatabaseRuntime,
      { start } as unknown as ModelResourceImportService,
    );

    await expect(
      service.install(
        scope,
        recommendation.id,
        "install-example",
        { expectedCatalogDigest: digest, confirmDependencies: true },
        "request-1",
      ),
    ).resolves.toMatchObject({
      status: "waiting_dependency",
      requiredAction: "importing_model_resource",
      modelResourceImportId: "01K00000000000000000000012",
    });
    expect(start).toHaveBeenCalledWith(
      scope,
      expect.stringMatching(/^capability-dependency:/u),
      {
        source: {
          kind: "catalog",
          catalogEntryId: "01K00000000000000000000013",
        },
      },
      "request-1",
    );
    expect(attachModelResourceImport).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "01K00000000000000000000011",
        expectedVersion: 1,
        modelResourceImportId: "01K00000000000000000000012",
      }),
    );
  });

  it("guides model-service configuration when no compatible route is selected", async () => {
    const service = new CapabilityInstallationService(
      {
        capabilityInstallations: {
          listCatalogEntries: vi
            .fn()
            .mockResolvedValue([
              { ...recommendation, sourceKind: "model_service" },
            ]),
          install: vi.fn().mockResolvedValue({
            id: "01K00000000000000000000014",
            catalogEntryId: recommendation.id,
            status: "waiting_dependency",
            version: 1,
            replayed: false,
          }),
        },
      } as unknown as ServerDatabaseRuntime,
      {} as ModelResourceImportService,
    );

    await expect(
      service.install(
        scope,
        recommendation.id,
        "install-model-service-example",
        { expectedCatalogDigest: digest, confirmDependencies: true },
      ),
    ).resolves.toMatchObject({
      status: "waiting_dependency",
      requiredAction: "configure_model_service",
    });
  });
});
