import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ResourceAdoptionRequest } from "@kanvas/contracts/api";
import type { FastifyRequest } from "fastify";
import { decodeTime } from "ulid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ProviderProbeModule from "../src/provider/provider-setting-probe.js";

const requestProviderBinary = vi.hoisted(() => vi.fn());
const resolveResourceSourceCandidate = vi.hoisted(() => vi.fn());

vi.mock("../src/provider/provider-setting-probe.js", async () => {
  const actual = await vi.importActual<typeof ProviderProbeModule>(
    "../src/provider/provider-setting-probe.js",
  );
  return { ...actual, requestProviderBinary };
});

vi.mock("../src/resource-sources/resource-source-adapters.js", () => {
  class ResourceSourceAdapterError extends Error {
    public constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ResourceSourceAdapterError,
    resolveResourceSourceCandidate,
    listResourceSourceAdapterTypes: () => [],
    resourceSourceAdapterCapabilities: () => [],
    resourceSourceAdapterType: () => ({
      adapterKind: "openverse.v1",
      adapterVersion: "1.0.0",
      authModes: ["none"],
    }),
    searchResourceSourceAdapter: vi.fn(),
    validateResourceSourceAdapter: vi.fn(),
  };
});

import { WorkspaceResourceSourcesController } from "../src/http/workspace-resource-sources.controller.js";

const workspaceId = "01K00000000000000000000001";
const sourceId = "01K00000000000000000000002";
const revisionId = "01K00000000000000000000003";
const termsDigest = `sha256:${"a".repeat(64)}`;
const scope = {
  workspaceId,
  organizationId: "01K00000000000000000000004",
  principalId: "01K00000000000000000000005",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000006",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["asset.read", "asset.write"],
  trusted: true,
} as TrustedWorkspaceScope;

describe("Workspace resource source adoption", () => {
  beforeEach(() => {
    requestProviderBinary.mockReset();
    resolveResourceSourceCandidate.mockReset();
  });

  it("re-resolves the pinned candidate and commits it through trusted User Import", async () => {
    const image = Buffer.from("verified-image-bytes");
    requestProviderBinary.mockResolvedValue({
      statusCode: 200,
      contentType: "image/jpeg",
      body: image,
    });
    resolveResourceSourceCandidate.mockResolvedValue({
      sourceInstanceId: sourceId,
      sourceRevisionId: revisionId,
      externalId: "image-1",
      kind: "image",
      title: "Mountain",
      sourcePageUrl: "https://example.com/mountain",
      license: {
        licenseId: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        commercialUseAllowed: true,
        modificationAllowed: true,
        attributionRequired: false,
        shareAlikeRequired: false,
        standaloneRedistributionAllowed: true,
        modelReleaseStatus: "unknown",
        propertyReleaseStatus: "unknown",
        trademarkRisk: "unknown",
        capturedAt: "2026-08-27T06:00:00.000Z",
        termsDigest,
      },
      providerObligations: {
        displayCreditRequired: false,
        hotlinkRequired: false,
        downloadEventRequired: false,
        brandingRequired: false,
        coreReplicationRestricted: false,
      },
      preview: {
        url: "https://images.example/preview.jpg",
        mediaType: "image/jpeg",
      },
      original: {
        url: "https://images.example/original.jpg",
        mediaType: "image/jpeg",
      },
      tags: [],
    });
    const allocateUserImport = vi.fn().mockResolvedValue({
      uploadSessionId: "01K00000000000000000000007",
    });
    const uploadUserImport = vi.fn().mockResolvedValue({ state: "verified" });
    const commitUserImport = vi.fn().mockResolvedValue({
      artifactId: "01K00000000000000000000008",
    });
    const controller = new WorkspaceResourceSourcesController(
      { instanceId: "instance-1" } as never,
      {
        resourceSources: {
          resolveCatalogIdentity: vi.fn().mockResolvedValue({
            id: sourceId,
            displayName: "Open images",
            adapterKind: "openverse.v1",
            adapterVersion: "1.0.0",
            revisionId,
            endpointOrigin: "https://api.openverse.org",
            configuration: {},
            licensePolicy: {
              requireCommercialUse: true,
              allowAttribution: true,
              allowShareAlike: false,
              allowStandaloneRedistributionRestriction: true,
              allowUnknownModelRelease: true,
              allowUnknownPropertyRelease: true,
              allowedLicenseIds: [],
            },
            capabilities: ["image.search", "image.import"],
          }),
        },
      } as never,
      {} as never,
      {} as never,
      { require: () => ({ scope }) } as never,
      {
        allocateUserImport,
        uploadUserImport,
        commitUserImport,
      } as never,
    );
    const body: ResourceAdoptionRequest = {
      schemaVersion: 1,
      sourceInstanceId: sourceId,
      sourceRevisionId: revisionId,
      candidateKind: "image",
      externalId: "image-1",
      expectedTermsDigest: termsDigest,
      displayName: "Mountain",
    };

    await expect(
      controller.adoptCatalogCandidate(
        { id: "request-1" } as FastifyRequest,
        "adopt-1",
        body,
      ),
    ).resolves.toEqual({
      kind: "artifact",
      artifactId: "01K00000000000000000000008",
    });
    expect(allocateUserImport).toHaveBeenCalledWith(
      scope,
      "external-resource:pinned:adopt-1",
      expect.objectContaining({ expectedMediaType: "image/jpeg" }),
    );
    expect(commitUserImport).toHaveBeenCalled();
    const commitCall = commitUserImport.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { readonly metadata: Readonly<Record<string, unknown>> },
      unknown,
    ];
    expect(commitCall[0]).toBe(scope);
    expect(commitCall[1]).toBe("01K00000000000000000000007");
    expect(commitCall[2].metadata).toMatchObject({
      sourceInstanceId: sourceId,
      sourceRevisionId: revisionId,
      externalId: "image-1",
      license: {
        capturedAt: new Date(decodeTime(revisionId)).toISOString(),
      },
    });
    expect(commitCall[2]).not.toHaveProperty("asset");
    expect(commitCall[3]).toBe("request-1");
  });
});
