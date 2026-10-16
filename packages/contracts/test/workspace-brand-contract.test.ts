import { Value } from "@sinclair/typebox/value";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  BrandKitColorSchema,
  BrandKitDraftSchema,
  BrandKitRevisionSchema,
  BrandKitRevisionListSchema,
  createBrandKitRoute,
  getBrandKitDraftRoute,
  getBrandKitRevisionRoute,
  getDefaultBrandKitRevisionRoute,
  listBrandKitsRoute,
  listBrandKitRevisionsRoute,
  publishBrandKitRoute,
  routeRegistry,
  setDefaultBrandKitRoute,
  UpdateBrandKitDraftBodySchema,
  updateBrandKitDraftRoute,
} from "../src/api/index.js";

const workspaceId = "01K00000000000000000000001";
const brandKitId = "01K00000000000000000000002";
const brandKitRevisionId = "01K00000000000000000000003";
const principalId = "01K00000000000000000000004";

const primaryColor = {
  key: "color.primary",
  name: "品牌主色",
  role: "primary",
  value: "#2457F5",
  position: 0,
} as const;
const primaryLogo = {
  key: "logo.primary",
  name: "主 Logo",
  role: "primary",
  assetId: "01K00000000000000000000005",
  artifactId: "01K00000000000000000000006",
  position: 0,
} as const;
const titleStyle = {
  key: "text.title",
  name: "品牌标题",
  role: "title",
  fontId: "noto-sans-sc",
  fontRevision: "google-fonts-2026-07-31",
  fontFamily: "Noto Sans SC",
  fontSize: 64,
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: 0,
  colorKey: "color.primary",
  position: 0,
} as const;
const guidelines = {
  voice: "清晰、克制、可信",
  principles: ["作品优先"],
  avoid: ["避免魔法式表达"],
} as const;

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  return ajv;
}

describe("Workspace Brand contracts", () => {
  it("registers the bounded BRAND-00 route surface", () => {
    expect(listBrandKitsRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/brand-kits",
      idempotency: "none",
    });
    expect(createBrandKitRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/brand-kits",
      idempotency: "required",
    });
    expect(updateBrandKitDraftRoute).toMatchObject({
      method: "PATCH",
      path: "/api/v1/brand-kits/{brandKitId}/draft",
    });
    expect(publishBrandKitRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/brand-kits/{brandKitId}/revisions",
      idempotency: "required",
    });
    expect(listBrandKitRevisionsRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/brand-kits/{brandKitId}/revisions",
      idempotency: "none",
    });
    expect(setDefaultBrandKitRoute).toMatchObject({
      method: "PUT",
      path: "/api/v1/brand-kits/{brandKitId}/default",
    });
    expect(getDefaultBrandKitRevisionRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/brand-kits/default/revision",
    });

    for (const route of [
      listBrandKitsRoute,
      createBrandKitRoute,
      getBrandKitDraftRoute,
      updateBrandKitDraftRoute,
      publishBrandKitRoute,
      listBrandKitRevisionsRoute,
      setDefaultBrandKitRoute,
      getDefaultBrandKitRevisionRoute,
      getBrandKitRevisionRoute,
    ]) {
      expect(routeRegistry).toContain(route);
      expect(route.security).toEqual(["sessionOrServiceToken"]);
    }
  });

  it("accepts semantic colors and rejects unbounded color values", () => {
    expect(Value.Check(BrandKitColorSchema, primaryColor)).toBe(true);
    expect(
      Value.Check(BrandKitColorSchema, {
        ...primaryColor,
        role: "marketing_magic",
      }),
    ).toBe(false);
    expect(
      Value.Check(BrandKitColorSchema, {
        ...primaryColor,
        value: "rgb(36 87 245)",
      }),
    ).toBe(false);
    expect(
      Value.Check(BrandKitColorSchema, {
        ...primaryColor,
        providerModel: "internal-detail",
      }),
    ).toBe(false);
  });

  it("models a CAS-protected draft without exposing a dynamic latest reference", () => {
    const draft = {
      brandKitId,
      workspaceId,
      name: "Acme 主品牌",
      description: "面向主要产品线的团队品牌",
      lifecycleStatus: "active",
      isDefault: true,
      brandKitVersion: 3,
      draftVersion: 5,
      colors: [primaryColor],
      logos: [primaryLogo],
      referenceImages: [],
      textStyles: [titleStyle],
      guidelines,
      latestPublishedRevision: {
        id: brandKitRevisionId,
        revisionNumber: 2,
        publishedAt: "2026-08-21T18:00:00.000Z",
      },
      createdAt: "2026-08-20T18:00:00.000Z",
      updatedAt: "2026-08-21T18:30:00.000Z",
    };
    const validateDraft = createAjv().compile(BrandKitDraftSchema);
    expect(validateDraft(draft), JSON.stringify(validateDraft.errors)).toBe(
      true,
    );
    expect(
      Value.Check(UpdateBrandKitDraftBodySchema, {
        expectedDraftVersion: 5,
        name: "Acme 主品牌",
        colors: [primaryColor],
        logos: [primaryLogo],
        referenceImages: [],
        textStyles: [titleStyle],
        guidelines,
      }),
    ).toBe(true);
    expect(
      Value.Check(UpdateBrandKitDraftBodySchema, {
        expectedDraftVersion: 0,
        name: "   ",
        colors: [primaryColor],
        logos: [primaryLogo],
        referenceImages: [],
        textStyles: [titleStyle],
        guidelines,
      }),
    ).toBe(false);
  });

  it("pins one immutable published revision with a content digest", () => {
    const revision = {
      id: brandKitRevisionId,
      brandKitId,
      workspaceId,
      revisionNumber: 2,
      name: "Acme 主品牌",
      colors: [primaryColor],
      logos: [primaryLogo],
      referenceImages: [],
      textStyles: [titleStyle],
      guidelines,
      contentDigest:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      publishedByPrincipalId: principalId,
      publishedAt: "2026-08-21T18:00:00.000Z",
    };
    const validateRevision = createAjv().compile(BrandKitRevisionSchema);
    expect(
      validateRevision(revision),
      JSON.stringify(validateRevision.errors),
    ).toBe(true);
    expect(
      validateRevision({
        id: brandKitRevisionId,
        brandKitId,
        workspaceId,
        revisionNumber: 2,
        name: "Acme 主品牌",
        colors: [primaryColor],
        logos: [primaryLogo],
        textStyles: [titleStyle],
        guidelines,
        contentDigest: "latest",
        publishedByPrincipalId: principalId,
        publishedAt: "2026-08-21T18:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      validateRevision({
        ...revision,
        logos: [],
      }),
    ).toBe(false);
  });

  it("bounds published version history to user-facing summaries", () => {
    const validateVersions = createAjv().compile(BrandKitRevisionListSchema);
    expect(
      validateVersions({
        items: [
          {
            id: brandKitRevisionId,
            revisionNumber: 2,
            publishedAt: "2026-08-21T18:00:00.000Z",
          },
        ],
      }),
    ).toBe(true);
  });
});
