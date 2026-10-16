import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createWorkspaceBrandStore } from "../src/runtime/workspace-brand-store.js";

const workspaceId = "01K00000000000000000000001";
const organizationId = "01K00000000000000000000002";
const principalId = "01K00000000000000000000003";
const authorityId = "01K00000000000000000000004";
const brandKitId = "01K00000000000000000000005";
const brandKitRevisionId = "01K00000000000000000000006";
const auditEventId = "01K00000000000000000000007";
const now = new Date("2026-08-21T21:00:00.000Z");
const digest =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId,
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session-reference",
  authorityType: "human_membership",
  authorityId,
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["brand.read", "brand.manage", "asset.read"],
  trusted: true,
};
const authorizationRow = {
  principalId,
  principalStatus: "active",
  membershipId: authorityId,
  membershipRole: "admin",
  membershipStatus: "active",
  membershipVersion: 1,
  organizationId,
  workspaceId,
  workspaceStatus: "active",
};
const document = {
  schemaVersion: 1,
  name: "Acme 主品牌",
  colors: [
    {
      key: "color.primary",
      name: "主色",
      role: "primary",
      value: "#2457F5",
      position: 0,
    },
  ],
  logos: [
    {
      key: "logo.primary",
      name: "主 Logo",
      role: "primary",
      assetId: "01K00000000000000000000008",
      artifactId: "01K00000000000000000000009",
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
};

function brandRow(latest: boolean) {
  return {
    id: brandKitId,
    workspaceId,
    name: document.name,
    description: null,
    lifecycleStatus: "active",
    isDefault: null,
    latestPublishedRevisionId: latest ? brandKitRevisionId : null,
    creationRequestKey: "create-brand-1",
    creationRequestHash: digest,
    version: 1,
    createdByPrincipalId: principalId,
    updatedByPrincipalId: principalId,
    createdAt: now,
    updatedAt: now,
    draftSchemaVersion: 1,
    draftDocument: document,
    draftContentDigest: digest,
    draftVersion: 2,
    draftCreatedByPrincipalId: principalId,
    draftUpdatedByPrincipalId: principalId,
    draftCreatedAt: now,
    draftUpdatedAt: now,
    latestRevisionNumber: latest ? 1 : null,
    latestRevisionPublishedAt: latest ? now : null,
  };
}

function revisionRow() {
  return {
    id: brandKitRevisionId,
    workspaceId,
    brandKitId,
    revisionNumber: 1,
    schemaVersion: 1,
    contentDocument: document,
    contentDigest: digest,
    publicationRequestKey: "publish-brand-1",
    publicationRequestHash: digest,
    publishedByPrincipalId: principalId,
    publishedAt: now,
  };
}

function result(affectedRows = 1): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

function queuedPool(results: readonly unknown[]) {
  const queue = [...results];
  const beginTransaction = vi.fn(() => Promise.resolve());
  const commit = vi.fn(() => Promise.resolve());
  const rollback = vi.fn(() => Promise.resolve());
  const release = vi.fn();
  const execute = vi.fn(() => {
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("Unexpected SQL execution."));
    }
    return Promise.resolve(next);
  });
  const connection = {
    beginTransaction,
    commit,
    rollback,
    release,
    execute,
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(() => Promise.resolve(connection)),
  } as unknown as Pool;
  return {
    pool,
    beginTransaction,
    commit,
    rollback,
    release,
    remaining: () => queue.length,
  };
}

describe("Workspace Brand Store", () => {
  it("lists bounded immutable versions after revalidating brand read scope", async () => {
    const queued = queuedPool([
      [[authorizationRow], []],
      [[brandRow(true)], []],
      [[revisionRow()], []],
    ]);
    const store = createWorkspaceBrandStore(queued.pool);

    await expect(store.listRevisions(scope, brandKitId, now)).resolves.toEqual([
      {
        id: brandKitRevisionId,
        revisionNumber: 1,
        publishedAt: now,
      },
    ]);
    expect(queued.remaining()).toBe(0);
    expect(queued.commit).toHaveBeenCalledOnce();
  });

  it("publishes one fixed Revision and commits audit in the same transaction", async () => {
    const queued = queuedPool([
      [[authorizationRow], []],
      [[], []],
      [[brandRow(false)], []],
      [[authorizationRow], []],
      [[{ artifactId: document.logos[0]!.artifactId }], []],
      [result(), []],
      [result(), []],
      [result(), []],
      [result(), []],
      [[revisionRow()], []],
    ]);
    const store = createWorkspaceBrandStore(queued.pool);

    await expect(
      store.publish({
        authority: scope,
        brandKitId,
        brandKitRevisionId,
        expectedDraftVersion: 2,
        idempotencyKey: "publish-brand-1",
        actorPrincipalId: principalId,
        now,
        audit: {
          auditEventId,
          authenticationRefHash: digest,
        },
      }),
    ).resolves.toMatchObject({
      replayed: false,
      value: {
        id: brandKitRevisionId,
        brandKitId,
        revisionNumber: 1,
        contentDigest: digest,
      },
    });
    expect(queued.remaining()).toBe(0);
    expect(queued.beginTransaction).toHaveBeenCalledOnce();
    expect(queued.commit).toHaveBeenCalledOnce();
    expect(queued.rollback).not.toHaveBeenCalled();
    expect(queued.release).toHaveBeenCalledOnce();
  });

  it("rolls back when an unpublished Brand Kit is selected as default", async () => {
    const queued = queuedPool([
      [[authorizationRow], []],
      [[{ id: brandKitId }], []],
      [[brandRow(false)], []],
    ]);
    const store = createWorkspaceBrandStore(queued.pool);

    await expect(
      store.setDefault({
        authority: scope,
        brandKitId,
        expectedBrandKitVersion: 1,
        actorPrincipalId: principalId,
        now,
        audit: {
          auditEventId,
          authenticationRefHash: digest,
        },
      }),
    ).rejects.toMatchObject({ code: "brand.publication_required" });
    expect(queued.remaining()).toBe(0);
    expect(queued.commit).not.toHaveBeenCalled();
    expect(queued.rollback).toHaveBeenCalledOnce();
    expect(queued.release).toHaveBeenCalledOnce();
  });
});
