import { FormatRegistry } from "@sinclair/typebox/type";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  adoptResourceCatalogCandidateRoute,
  createWorkspaceResourceSourceRoute,
  disableWorkspaceResourceSourceRoute,
  listResourceCatalogSourcesRoute,
  listWorkspaceResourceSourcesRoute,
  listWorkspaceArtTextCatalogRoute,
  listWorkspaceFontCatalogRoute,
  publishWorkspaceResourceSourceRoute,
  rotateWorkspaceResourceSourceCredentialRoute,
  routeRegistry,
  searchResourceCatalogRoute,
  validateWorkspaceResourceSourceRoute,
} from "../src/api/index.js";

import {
  ArtTextPresetManifestSchema,
  ResourceAdoptionRequestSchema,
  ResourceFontCandidateSchema,
  ResourceImageCandidateSchema,
  ResourceCatalogSearchQuerySchema,
  ResourceSourceInstanceSchema,
  resourceLicensePolicyReason,
} from "../src/resource-source/index.js";

const sourceId = "01K00000000000000000000001";
const revisionId = "01K00000000000000000000002";
const workspaceId = "01K00000000000000000000000";
const digest = `sha256:${"a".repeat(64)}`;
const timestamp = "2026-08-27T03:00:00.000Z";

FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));

const license = {
  licenseId: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  commercialUseAllowed: true,
  modificationAllowed: true,
  attributionRequired: false,
  shareAlikeRequired: false,
  standaloneRedistributionAllowed: true,
  modelReleaseStatus: "unknown" as const,
  propertyReleaseStatus: "unknown" as const,
  trademarkRisk: "unknown" as const,
  capturedAt: timestamp,
  termsDigest: digest,
};

const obligations = {
  displayCreditRequired: false,
  hotlinkRequired: false,
  downloadEventRequired: false,
  brandingRequired: false,
  coreReplicationRestricted: false,
};

describe("resource source contracts", () => {
  it("registers the governed settings lifecycle routes", () => {
    for (const route of [
      listWorkspaceResourceSourcesRoute,
      createWorkspaceResourceSourceRoute,
      validateWorkspaceResourceSourceRoute,
      publishWorkspaceResourceSourceRoute,
      disableWorkspaceResourceSourceRoute,
      rotateWorkspaceResourceSourceCredentialRoute,
      listResourceCatalogSourcesRoute,
      searchResourceCatalogRoute,
      adoptResourceCatalogCandidateRoute,
      listWorkspaceArtTextCatalogRoute,
      listWorkspaceFontCatalogRoute,
    ]) {
      expect(routeRegistry).toContain(route);
    }
    expect(createWorkspaceResourceSourceRoute.idempotency).toBe("required");
    expect(publishWorkspaceResourceSourceRoute.idempotency).toBe("required");
  });

  it("allows an empty query to browse a published catalog", () => {
    expect(
      Value.Check(ResourceCatalogSearchQuerySchema, {
        sourceId,
        q: "",
        limit: "24",
      }),
    ).toBe(true);
  });

  it("exposes only non-secret source state", () => {
    const source = {
      schemaVersion: 1,
      id: sourceId,
      workspaceId,
      displayName: "Workspace image library",
      adapterKind: "openverse.v1",
      endpointOrigin: "https://api.openverse.org",
      status: "published",
      validationStatus: "passed",
      secretConfigured: true,
      currentRevisionId: revisionId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(Value.Check(ResourceSourceInstanceSchema, source)).toBe(true);
    expect(
      Value.Check(ResourceSourceInstanceSchema, {
        ...source,
        apiKey: "must-not-cross-the-contract",
      }),
    ).toBe(false);
  });

  it("requires HTTPS media and keeps provider obligations separate", () => {
    const candidate = {
      sourceInstanceId: sourceId,
      sourceRevisionId: revisionId,
      externalId: "image-1",
      kind: "image",
      title: "Public domain mountain",
      sourcePageUrl: "https://example.com/image-1",
      license,
      providerObligations: obligations,
      preview: {
        url: "https://cdn.example.com/image-1-preview.jpg",
        mediaType: "image/jpeg",
      },
      original: {
        url: "https://cdn.example.com/image-1.jpg",
        mediaType: "image/jpeg",
      },
      tags: ["mountain"],
    };

    expect(Value.Check(ResourceImageCandidateSchema, candidate)).toBe(true);
    expect(
      Value.Check(ResourceImageCandidateSchema, {
        ...candidate,
        original: { ...candidate.original, url: "http://unsafe.test/a.jpg" },
      }),
    ).toBe(false);
  });

  it("rejects floating font versions and unpinned files", () => {
    const candidate = {
      sourceInstanceId: sourceId,
      sourceRevisionId: revisionId,
      externalId: "font-1",
      kind: "font",
      title: "Example Sans",
      family: "Example Sans",
      sourcePageUrl: "https://example.com/fonts/example-sans",
      license: { ...license, embeddingAllowed: true },
      providerObligations: obligations,
      upstreamVersion: "5.3.0",
      category: "sans",
      scripts: ["latin"],
      languages: ["en"],
      weights: [400],
      styles: ["normal"],
      fileVariants: [
        {
          url: "https://cdn.example.com/example-sans-400.woff2",
          format: "woff2",
          weight: 400,
          style: "normal",
          subset: "latin",
          pinned: true,
        },
      ],
    };

    expect(Value.Check(ResourceFontCandidateSchema, candidate)).toBe(true);
    expect(
      Value.Check(ResourceFontCandidateSchema, {
        ...candidate,
        upstreamVersion: "latest",
      }),
    ).toBe(false);
    expect(
      Value.Check(ResourceFontCandidateSchema, {
        ...candidate,
        fileVariants: [{ ...candidate.fileVariants[0], pinned: false }],
      }),
    ).toBe(false);
  });

  it("accepts editable art text but rejects arbitrary CSS", () => {
    const manifest = {
      schemaVersion: 1,
      id: "comic-pop",
      revision: digest,
      labels: { "en-US": "Comic Pop", "zh-CN": "漫画爆炸" },
      fontRequirements: {
        requiredScripts: ["latin", "han"],
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
      license,
    };

    expect(Value.Check(ArtTextPresetManifestSchema, manifest)).toBe(true);
    expect(
      Value.Check(ArtTextPresetManifestSchema, {
        ...manifest,
        css: "filter: url(https://untrusted.test/filter.svg)",
      }),
    ).toBe(false);
  });

  it("enforces workspace license policy independently of provider duties", () => {
    const policy = {
      requireCommercialUse: true,
      allowAttribution: false,
      allowShareAlike: false,
      allowStandaloneRedistributionRestriction: false,
      allowUnknownModelRelease: true,
      allowUnknownPropertyRelease: true,
      allowedLicenseIds: ["CC0-1.0"],
    };

    expect(resourceLicensePolicyReason(policy, license)).toBe("allowed");
    expect(
      resourceLicensePolicyReason(policy, {
        ...license,
        licenseId: "CC-BY-4.0",
        attributionRequired: true,
      }),
    ).toBe("license_not_allowed");
    expect(
      resourceLicensePolicyReason(
        { ...policy, allowedLicenseIds: ["CC-BY-4.0"] },
        {
          ...license,
          licenseId: "CC-BY-4.0",
          attributionRequired: true,
        },
      ),
    ).toBe("attribution_not_allowed");
  });

  it("adopts by candidate identity without accepting external bytes or Canvas state", () => {
    const request = {
      schemaVersion: 1,
      sourceInstanceId: sourceId,
      sourceRevisionId: revisionId,
      candidateKind: "image",
      externalId: "image-1",
      expectedTermsDigest: digest,
      displayName: "Public domain mountain",
    };

    expect(Value.Check(ResourceAdoptionRequestSchema, request)).toBe(true);
    expect(
      Value.Check(ResourceAdoptionRequestSchema, {
        ...request,
        originalUrl: "https://untrusted.test/image.jpg",
        canvasDocument: {},
      }),
    ).toBe(false);
  });
});
