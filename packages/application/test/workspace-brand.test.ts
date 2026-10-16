import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceBrand,
  normalizeBrandKitDocument,
  type BrandKitDraftRecord,
  type BrandKitRevisionRecord,
  type TrustedWorkspaceScope,
  type WorkspaceBrandRepository,
} from "../src/index.js";

const workspaceId = "01K00000000000000000000001";
const principalId = "01K00000000000000000000002";
const brandKitId = "01K00000000000000000000003";
const brandKitRevisionId = "01K00000000000000000000004";
const assetId = "01K00000000000000000000008";
const artifactId = "01K00000000000000000000009";
const now = new Date("2026-08-21T20:00:00.000Z");
const authority: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000005",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session-ref",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000006",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["brand.read", "brand.manage"],
  trusted: true,
};
const audit = {
  auditEventId: "01K00000000000000000000007",
  authenticationRefHash:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};
const document = normalizeBrandKitDocument({
  name: "Acme 主品牌",
  colors: [
    {
      key: "color.primary",
      name: "主色",
      role: "primary",
      value: "#2457f5",
      position: 0,
    },
  ],
  logos: [
    {
      key: "logo.primary",
      name: "主 Logo",
      role: "primary",
      assetId,
      artifactId,
      position: 0,
    },
  ],
  referenceImages: [
    {
      key: "reference.photography",
      name: "产品摄影参考",
      description: "自然光与克制构图",
      assetId,
      artifactId,
      position: 0,
    },
  ],
  textStyles: [
    {
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
    },
  ],
  guidelines: {
    voice: "清晰、克制、可信",
    principles: ["作品优先"],
    avoid: ["避免魔法式表达"],
  },
});
const draft: BrandKitDraftRecord = {
  brandKitId,
  workspaceId,
  lifecycleStatus: "active",
  isDefault: false,
  brandKitVersion: 1,
  draftVersion: 1,
  document,
  contentDigest:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  createdByPrincipalId: principalId,
  updatedByPrincipalId: principalId,
  createdAt: now,
  updatedAt: now,
};
const revision: BrandKitRevisionRecord = {
  id: brandKitRevisionId,
  brandKitId,
  workspaceId,
  revisionNumber: 1,
  document,
  contentDigest: draft.contentDigest,
  publishedByPrincipalId: principalId,
  publishedAt: now,
};

function repository(
  overrides: Partial<WorkspaceBrandRepository> = {},
): WorkspaceBrandRepository {
  return {
    list: vi.fn(() => Promise.resolve([])),
    getDraft: vi.fn(() => Promise.resolve(undefined)),
    getRevision: vi.fn(() => Promise.resolve(undefined)),
    listRevisions: vi.fn(() => Promise.resolve([])),
    getDefaultRevision: vi.fn(() => Promise.resolve(undefined)),
    create: vi.fn(() => Promise.resolve({ value: draft, replayed: false })),
    updateDraft: vi.fn(() => Promise.resolve(draft)),
    publish: vi.fn(() => Promise.resolve({ value: revision, replayed: false })),
    setDefault: vi.fn(() =>
      Promise.resolve({
        id: brandKitId,
        workspaceId,
        name: document.name,
        lifecycleStatus: "active" as const,
        isDefault: true,
        version: 2,
        draftVersion: 1,
        latestPublishedRevision: {
          id: brandKitRevisionId,
          revisionNumber: 1,
          publishedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      }),
    ),
    ...overrides,
  };
}

describe("Workspace Brand application", () => {
  it("normalizes colors deterministically and rejects duplicate stable keys", () => {
    expect(document.colors[0]).toMatchObject({
      key: "color.primary",
      value: "#2457F5",
    });
    expect(document.referenceImages[0]).toMatchObject({
      key: "reference.photography",
      description: "自然光与克制构图",
    });
    expect(() =>
      normalizeBrandKitDocument({
        name: "Acme",
        colors: [document.colors[0]!, document.colors[0]!],
        logos: document.logos,
        referenceImages: document.referenceImages,
        textStyles: document.textStyles,
        guidelines: document.guidelines,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "brand.invalid_argument",
      }),
    );
  });

  it("creates an empty draft with one generated stable BrandKit identity", async () => {
    const create = vi.fn(() =>
      Promise.resolve({ value: draft, replayed: false }),
    );
    const store = repository({ create });
    const service = createWorkspaceBrand({
      repository: store,
      now: () => now,
      nextId: () => brandKitId,
    });

    await expect(
      service.create({
        authority,
        name: "  Acme 主品牌  ",
        idempotencyKey: "brand-create-1",
        audit,
      }),
    ).resolves.toEqual({ value: draft, replayed: false });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId,
        actorPrincipalId: principalId,
        document: {
          schemaVersion: 1,
          name: "Acme 主品牌",
          colors: [],
          logos: [],
          referenceImages: [],
          textStyles: [],
          guidelines: { principles: [], avoid: [] },
        },
      }),
    );
  });

  it("generates a fixed Revision identity before publishing", async () => {
    const publish = vi.fn(() =>
      Promise.resolve({ value: revision, replayed: false }),
    );
    const store = repository({ publish });
    const service = createWorkspaceBrand({
      repository: store,
      now: () => now,
      nextId: () => brandKitRevisionId,
    });

    await service.publish({
      authority,
      brandKitId,
      expectedDraftVersion: 1,
      idempotencyKey: "brand-publish-1",
      audit,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId,
        brandKitRevisionId,
        expectedDraftVersion: 1,
        actorPrincipalId: principalId,
      }),
    );
  });

  it("lists immutable version summaries using the current authorization time", async () => {
    const listRevisions = vi.fn(() =>
      Promise.resolve([
        { id: brandKitRevisionId, revisionNumber: 1, publishedAt: now },
      ]),
    );
    const service = createWorkspaceBrand({
      repository: repository({ listRevisions }),
      now: () => now,
      nextId: () => brandKitId,
    });

    await expect(
      service.listRevisions(authority, brandKitId),
    ).resolves.toHaveLength(1);
    expect(listRevisions).toHaveBeenCalledWith(authority, brandKitId, now);
  });

  it("turns missing default and explicit Revisions into stable domain errors", async () => {
    const service = createWorkspaceBrand({
      repository: repository(),
      now: () => now,
      nextId: () => brandKitId,
    });

    await expect(service.getDefaultRevision(authority)).rejects.toMatchObject({
      code: "brand.default_not_found",
    });
    await expect(
      service.getRevision(authority, brandKitId, brandKitRevisionId),
    ).rejects.toMatchObject({ code: "brand.revision_not_found" });
  });
});
