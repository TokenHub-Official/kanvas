import type {
  ApplicationRuntime,
  BrandKitDraftRecord,
  BrandKitRevisionRecord,
  BrandKitSummaryRecord,
  TrustedWorkspaceScope,
  WorkspaceBrand,
} from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceBrandController } from "../src/http/workspace-brand.controller.js";

const workspaceId = "01K00000000000000000000001";
const brandKitId = "01K00000000000000000000002";
const brandKitRevisionId = "01K00000000000000000000003";
const principalId = "01K00000000000000000000004";
const now = new Date("2026-08-21T23:00:00.000Z");
const digest =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000005",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000006",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000007",
  authorityVersion: 3,
  authorizationModelVersion: 1,
  effectivePermissions: ["brand.read", "brand.manage"],
  trusted: true,
};
const color = {
  key: "color.primary",
  name: "主色",
  role: "primary" as const,
  value: "#2457F5",
  position: 0,
};
const logo = {
  key: "logo.primary",
  name: "主 Logo",
  role: "primary" as const,
  assetId: "01K00000000000000000000008",
  artifactId: "01K00000000000000000000009",
  position: 0,
};
const textStyle = {
  key: "text.title",
  name: "品牌标题",
  role: "title" as const,
  fontId: "noto-sans-sc",
  fontRevision: "google-fonts-2026-07-31",
  fontFamily: "Noto Sans SC",
  fontSize: 64,
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: 0,
  colorKey: "color.primary",
  position: 0,
};
const guidelines = {
  voice: "清晰、克制、可信",
  principles: ["作品优先"],
  avoid: ["避免魔法式表达"],
};
const document = {
  schemaVersion: 1 as const,
  name: "Acme 主品牌",
  colors: [color],
  logos: [logo],
  referenceImages: [],
  textStyles: [textStyle],
  guidelines,
};
const draft: BrandKitDraftRecord = {
  brandKitId,
  workspaceId,
  lifecycleStatus: "active",
  isDefault: false,
  brandKitVersion: 2,
  draftVersion: 2,
  document,
  contentDigest: digest,
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
  contentDigest: digest,
  publishedByPrincipalId: principalId,
  publishedAt: now,
};
const summary: BrandKitSummaryRecord = {
  id: brandKitId,
  workspaceId,
  name: document.name,
  lifecycleStatus: "active",
  isDefault: true,
  version: 4,
  draftVersion: 2,
  latestPublishedRevision: {
    id: brandKitRevisionId,
    revisionNumber: 1,
    publishedAt: now,
  },
  createdAt: now,
  updatedAt: now,
};

function request(): FastifyRequest {
  return { id: "request-workspace-brand" } as FastifyRequest;
}

function contexts(
  currentRequest: FastifyRequest,
): RequestAuthorizationContextStore {
  const value = new RequestAuthorizationContextStore();
  value.set(currentRequest, {
    authentication: {
      authSubjectId: "brand-manager",
      sessionId: scope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return value;
}

function controller(
  currentRequest: FastifyRequest,
  workspaceBrand: Partial<WorkspaceBrand>,
): WorkspaceBrandController {
  return new WorkspaceBrandController(
    {
      workspaceBrand,
    } as unknown as ApplicationRuntime,
    contexts(currentRequest),
  );
}

describe("WorkspaceBrandController", () => {
  it("lists only the bounded user-facing Brand projection", async () => {
    const currentRequest = request();
    const list = vi.fn<WorkspaceBrand["list"]>(() =>
      Promise.resolve([summary]),
    );
    const result = await controller(currentRequest, { list }).list(
      currentRequest,
      { lifecycleStatus: "active" },
    );

    expect(list).toHaveBeenCalledWith(scope, { lifecycleStatus: "active" });
    expect(result).toEqual({
      items: [
        {
          id: brandKitId,
          workspaceId,
          name: "Acme 主品牌",
          lifecycleStatus: "active",
          isDefault: true,
          version: 4,
          draftVersion: 2,
          latestPublishedRevision: {
            id: brandKitRevisionId,
            revisionNumber: 1,
            publishedAt: now.toISOString(),
          },
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    });
  });

  it("forwards create and update without exposing internal execution details", async () => {
    const currentRequest = request();
    const create = vi.fn<WorkspaceBrand["create"]>(() =>
      Promise.resolve({ value: draft, replayed: false }),
    );
    const updateDraft = vi.fn<WorkspaceBrand["updateDraft"]>(() =>
      Promise.resolve(draft),
    );
    const target = controller(currentRequest, { create, updateDraft });

    await expect(
      target.create(currentRequest, "brand-create-1", {
        name: "Acme 主品牌",
      }),
    ).resolves.toMatchObject({
      brandKitId,
      name: "Acme 主品牌",
      colors: [color],
      logos: [logo],
      referenceImages: [],
      textStyles: [textStyle],
      guidelines,
      createdAt: now.toISOString(),
    });
    await target.updateDraft(
      currentRequest,
      { brandKitId },
      {
        expectedDraftVersion: 1,
        name: "Acme 主品牌",
        colors: [color],
        logos: [logo],
        referenceImages: [],
        textStyles: [textStyle],
        guidelines,
      },
    );

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      authority: scope,
      idempotencyKey: "brand-create-1",
      audit: { requestId: "request-workspace-brand" },
    });
    expect(create.mock.calls[0]?.[0].audit.authenticationRefHash).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(updateDraft.mock.calls[0]?.[0]).toMatchObject({
      authority: scope,
      brandKitId,
      expectedDraftVersion: 1,
      colors: [color],
      logos: [logo],
      textStyles: [textStyle],
      guidelines,
    });
  });

  it("publishes, sets default, and reads the fixed Revision", async () => {
    const currentRequest = request();
    const publish = vi.fn<WorkspaceBrand["publish"]>(() =>
      Promise.resolve({ value: revision, replayed: false }),
    );
    const setDefault = vi.fn<WorkspaceBrand["setDefault"]>(() =>
      Promise.resolve(summary),
    );
    const getDefaultRevision = vi.fn<WorkspaceBrand["getDefaultRevision"]>(() =>
      Promise.resolve(revision),
    );
    const listRevisions = vi.fn<WorkspaceBrand["listRevisions"]>(() =>
      Promise.resolve([summary.latestPublishedRevision!]),
    );
    const target = controller(currentRequest, {
      publish,
      setDefault,
      getDefaultRevision,
      listRevisions,
    });

    await expect(
      target.publish(
        currentRequest,
        "brand-publish-1",
        { brandKitId },
        { expectedDraftVersion: 2 },
      ),
    ).resolves.toMatchObject({
      id: brandKitRevisionId,
      contentDigest: digest,
      publishedAt: now.toISOString(),
    });
    await expect(
      target.setDefault(
        currentRequest,
        { brandKitId },
        { expectedBrandKitVersion: 3 },
      ),
    ).resolves.toMatchObject({ isDefault: true, version: 4 });
    await expect(
      target.getDefaultRevision(currentRequest),
    ).resolves.toMatchObject({ id: brandKitRevisionId });
    await expect(
      target.listRevisions(currentRequest, { brandKitId }),
    ).resolves.toEqual({
      items: [
        {
          id: brandKitRevisionId,
          revisionNumber: 1,
          publishedAt: now.toISOString(),
        },
      ],
    });

    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      authority: scope,
      brandKitId,
      expectedDraftVersion: 2,
      idempotencyKey: "brand-publish-1",
    });
    expect(setDefault.mock.calls[0]?.[0]).toMatchObject({
      authority: scope,
      brandKitId,
      expectedBrandKitVersion: 3,
    });
    expect(listRevisions).toHaveBeenCalledWith(scope, brandKitId);
  });
});
