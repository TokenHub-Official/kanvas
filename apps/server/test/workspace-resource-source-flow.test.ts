import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ResourceAdoptionRequest } from "@kanvas/contracts/api";
import type { ArtTextPresetManifest } from "@kanvas/contracts/resource-source";
import type { AdoptArtTextPresetOptions } from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ProviderProbeModule from "../src/provider/provider-setting-probe.js";
import type { ProviderProbeRequester } from "../src/provider/provider-setting-probe.js";

const requestProviderProbeJson = vi.hoisted(() =>
  vi.fn<ProviderProbeRequester>(),
);

vi.mock("../src/provider/provider-setting-probe.js", async () => {
  const actual = await vi.importActual<typeof ProviderProbeModule>(
    "../src/provider/provider-setting-probe.js",
  );
  return { ...actual, requestProviderProbeJson };
});

import { WorkspaceResourceSourcesController } from "../src/http/workspace-resource-sources.controller.js";

const workspaceId = "01K00000000000000000000001";
const sourceId = "01K00000000000000000000002";
const sourceRevisionId = "01K00000000000000000000003";
const presetRevisionId = "01K00000000000000000000004";
const manifestRevision = `sha256:${"c".repeat(64)}`;
const termsDigest = `sha256:${"d".repeat(64)}`;
const now = "2026-08-27T06:00:00.000Z";
const scope = {
  workspaceId,
  organizationId: "01K00000000000000000000005",
  principalId: "01K00000000000000000000006",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000007",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["asset.read", "asset.write"],
  trusted: true,
} as TrustedWorkspaceScope;

const manifest: ArtTextPresetManifest = {
  schemaVersion: 1,
  id: "comic-pop",
  revision: manifestRevision,
  labels: { en: "Comic Pop", "zh-Hans": "漫画标题" },
  fontRequirements: {
    requiredScripts: ["Hans"],
    fallbackCategory: "display",
  },
  fill: { kind: "solid", color: "#ff4f9a" },
  effects: [{ kind: "outline", color: "#151515", width: 7 }],
  letterSpacing: 2,
  lineHeight: 1.1,
  alignment: "center",
  editable: {
    text: true,
    font: true,
    colorSlots: ["primary", "outline"],
  },
  license: {
    licenseId: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUseAllowed: true,
    modificationAllowed: true,
    attributionRequired: false,
    shareAlikeRequired: false,
    standaloneRedistributionAllowed: true,
    modelReleaseStatus: "not_applicable",
    propertyReleaseStatus: "not_applicable",
    trademarkRisk: "none_declared",
    capturedAt: now,
    termsDigest,
  },
};

describe("Workspace Resource Source flow", () => {
  beforeEach(() => {
    requestProviderProbeJson.mockReset();
    requestProviderProbeJson.mockImplementation((request) => {
      if (request.path === "/presets/comic-pop.json") {
        return Promise.resolve({ statusCode: 200, body: manifest });
      }
      return Promise.resolve({
        statusCode: 200,
        body: {
          schemaVersion: 1,
          presets: [
            {
              id: manifest.id,
              revision: manifest.revision,
              manifestUrl: "https://styles.example.com/presets/comic-pop.json",
              labels: manifest.labels,
            },
          ],
        },
      });
    });
  });

  it("normalizes a configured registry, adopts it, and projects the internal revision", async () => {
    let adoptedManifest: ArtTextPresetManifest | undefined;
    const adoptArtTextPreset = vi.fn((options: AdoptArtTextPresetOptions) => {
      adoptedManifest = options.manifest;
      return Promise.resolve({
        replayed: false,
        value: {
          id: presetRevisionId,
          sourceId,
          sourceRevisionId,
          externalId: manifest.id,
          manifestDigest: manifest.revision,
          createdAt: new Date(now),
        },
      });
    });
    const database = {
      resourceSources: {
        resolveCatalogIdentity: vi.fn().mockResolvedValue({
          id: sourceId,
          displayName: "Team Art Text",
          adapterKind: "art-text-registry.v1",
          adapterVersion: "1.0.0",
          revisionId: sourceRevisionId,
          endpointOrigin: "https://styles.example.com",
          configuration: { catalogPath: "/catalog.json" },
          licensePolicy: {
            requireCommercialUse: true,
            allowAttribution: true,
            allowShareAlike: false,
            allowStandaloneRedistributionRestriction: true,
            allowUnknownModelRelease: false,
            allowUnknownPropertyRelease: false,
            allowedLicenseIds: ["CC0-1.0"],
          },
          capabilities: ["art_text.list", "art_text.import"],
        }),
        adoptArtTextPreset,
        listArtTextPresets: vi.fn(() =>
          Promise.resolve(
            adoptedManifest
              ? [
                  {
                    id: presetRevisionId,
                    manifest: adoptedManifest,
                    createdAt: new Date(now),
                  },
                ]
              : [],
          ),
        ),
      },
    };
    const controller = new WorkspaceResourceSourcesController(
      { instanceId: "instance-1" } as never,
      database as never,
      {} as never,
      {} as never,
      { require: () => ({ scope }) } as never,
      {} as never,
    );
    const request = { id: "request-1" } as FastifyRequest;
    const search = await controller.searchCatalog(request, {
      sourceId,
      q: "comic",
      limit: "24",
    });
    const candidate = search.candidates[0];
    expect(candidate).toMatchObject({
      kind: "art_text",
      sourceRevisionId,
      externalId: manifest.id,
      manifest: { editable: { text: true } },
    });
    if (!candidate) throw new Error("Expected an Art Text candidate.");
    const body: ResourceAdoptionRequest = {
      schemaVersion: 1,
      sourceInstanceId: sourceId,
      sourceRevisionId,
      candidateKind: "art_text",
      externalId: candidate.externalId,
      expectedTermsDigest: candidate.license.termsDigest,
      displayName: candidate.title,
    };
    await expect(
      controller.adoptCatalogCandidate(request, "adopt-comic-pop", body),
    ).resolves.toEqual({
      kind: "art_text_preset_revision",
      artTextPresetRevisionId: presetRevisionId,
    });
    expect(adoptArtTextPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRevisionId,
        externalId: manifest.id,
        manifest,
      }),
    );
    await expect(controller.listArtTextCatalog(request)).resolves.toEqual({
      presets: [
        {
          id: presetRevisionId,
          manifest,
          createdAt: now,
        },
      ],
    });
  });
});
