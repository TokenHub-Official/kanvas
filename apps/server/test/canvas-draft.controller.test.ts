import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { CanvasDraftStore } from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { CanvasDraftController } from "../src/http/canvas-draft.controller.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";

const request = {
  id: "request-1",
} as FastifyRequest;
const scope: TrustedWorkspaceScope = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session-reference",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["canvas.read", "canvas.write"],
  trusted: true,
};
const document = {
  schemaVersion: "kanvas.editor-document/v1" as const,
  title: "活动主视觉",
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1080,
      background: { kind: "transparent" as const },
      nodes: [],
    },
  ],
  metadata: {
    createdWith: "kanvas-web",
  },
};

function contexts(): RequestAuthorizationContextStore {
  const result = new RequestAuthorizationContextStore();
  result.set(request, {
    authentication: {
      authSubjectId: "auth-subject",
      sessionId: "session-reference",
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return result;
}

function draft(version: number) {
  return {
    id: "01K00000000000000000000005",
    workspaceId: scope.workspaceId,
    document: {
      documentId: "01K00000000000000000000005",
      workspaceId: scope.workspaceId,
      ...document,
    },
    version,
    createdByPrincipalId: scope.principalId,
    updatedByPrincipalId: scope.principalId,
    createdAt: new Date("2026-07-29T00:00:00.000Z"),
    updatedAt: new Date("2026-07-29T00:01:00.000Z"),
  };
}

function revision(version: number) {
  return {
    canvasDraftId: "01K00000000000000000000005",
    workspaceId: scope.workspaceId,
    document: {
      documentId: "01K00000000000000000000005",
      workspaceId: scope.workspaceId,
      ...document,
    },
    version,
    title: document.title,
    contentDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "save" as const,
    createdByPrincipalId: scope.principalId,
    createdAt: new Date("2026-07-29T00:01:00.000Z"),
  };
}

describe("CanvasDraftController", () => {
  it("lists recent Draft summaries for the trusted Workspace", async () => {
    const list = vi.fn<CanvasDraftStore["list"]>().mockResolvedValue({
      items: [
        {
          id: "01K00000000000000000000005",
          workspaceId: scope.workspaceId,
          brand: {
            brandKitId: "01K00000000000000000000008",
            brandKitRevisionId: "01K00000000000000000000009",
            name: "Acme 主品牌",
            revisionNumber: 2,
          },
          title: "活动主视觉",
          pageCount: 2,
          version: 3,
          createdAt: new Date("2026-07-29T00:00:00.000Z"),
          updatedAt: new Date("2026-07-29T00:01:00.000Z"),
        },
      ],
      truncated: false,
    });
    const controller = new CanvasDraftController(
      {
        canvasDrafts: {
          list,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await expect(controller.list(request, { limit: "4" })).resolves.toEqual({
      items: [
        {
          id: "01K00000000000000000000005",
          workspaceId: scope.workspaceId,
          brand: {
            brandKitId: "01K00000000000000000000008",
            brandKitRevisionId: "01K00000000000000000000009",
            name: "Acme 主品牌",
            revisionNumber: 2,
          },
          title: "活动主视觉",
          pageCount: 2,
          version: 3,
          createdAt: "2026-07-29T00:00:00.000Z",
          updatedAt: "2026-07-29T00:01:00.000Z",
        },
      ],
      truncated: false,
    });
    expect(list).toHaveBeenCalledWith({
      authority: scope,
      limit: 4,
    });
  });

  it("creates a Draft from the trusted Workspace scope", async () => {
    const brandKitRevisionId = "01K00000000000000000000009";
    const create = vi.fn<CanvasDraftStore["create"]>().mockResolvedValue({
      draft: {
        ...draft(1),
        brand: {
          brandKitId: "01K00000000000000000000008",
          brandKitRevisionId,
          name: "Acme 主品牌",
          revisionNumber: 2,
        },
      },
      replayed: false,
    });
    const controller = new CanvasDraftController(
      {
        canvasDrafts: {
          create,
          get: () => Promise.resolve(undefined),
          update: () => Promise.reject(new Error("not expected")),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await expect(
      controller.create(request, "create-1", { document, brandKitRevisionId }),
    ).resolves.toMatchObject({
      draft: {
        version: 1,
        brand: { brandKitRevisionId, revisionNumber: 2 },
        createdAt: "2026-07-29T00:00:00.000Z",
      },
      replayed: false,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        idempotencyKey: "create-1",
        document,
        brandKitRevisionId,
      }),
    );
  });

  it("passes an explicit no-brand choice through to persistence", async () => {
    const create = vi.fn<CanvasDraftStore["create"]>().mockResolvedValue({
      draft: draft(1),
      replayed: false,
    });
    const controller = new CanvasDraftController(
      {
        canvasDrafts: {
          create,
          get: () => Promise.resolve(undefined),
          update: () => Promise.reject(new Error("not expected")),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await controller.create(request, "create-without-brand", {
      document,
      brandKitRevisionId: null,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitRevisionId: null }),
    );
  });

  it("reads and updates only the requested Draft", async () => {
    const get = vi.fn<CanvasDraftStore["get"]>().mockResolvedValue(draft(2));
    const update = vi.fn<CanvasDraftStore["update"]>().mockResolvedValue({
      draft: draft(3),
      replayed: false,
    });
    const updateBrand = vi
      .fn<CanvasDraftStore["updateBrand"]>()
      .mockResolvedValue({
        draft: {
          ...draft(4),
          brand: {
            brandKitId: "01K00000000000000000000008",
            brandKitRevisionId: "01K00000000000000000000009",
            name: "Acme 主品牌",
            revisionNumber: 2,
          },
        },
        replayed: false,
      });
    const controller = new CanvasDraftController(
      {
        canvasDrafts: {
          create: () => Promise.reject(new Error("not expected")),
          get,
          update,
          updateBrand,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await expect(
      controller.get(request, {
        canvasDraftId: "01K00000000000000000000005",
      }),
    ).resolves.toMatchObject({
      id: "01K00000000000000000000005",
      version: 2,
    });
    await expect(
      controller.update(
        request,
        {
          canvasDraftId: "01K00000000000000000000005",
        },
        {
          expectedVersion: 2,
          document: {
            ...document,
            title: "更新后的主视觉",
          },
        },
      ),
    ).resolves.toMatchObject({
      draft: {
        version: 3,
      },
    });
    expect(get).toHaveBeenCalledWith(scope, "01K00000000000000000000005");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        canvasDraftId: "01K00000000000000000000005",
      }),
    );
    await expect(
      controller.updateBrand(
        request,
        { canvasDraftId: "01K00000000000000000000005" },
        {
          expectedVersion: 3,
          brandKitRevisionId: "01K00000000000000000000009",
        },
      ),
    ).resolves.toMatchObject({
      draft: {
        version: 4,
        brand: { revisionNumber: 2 },
      },
    });
    expect(updateBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 3,
        brandKitRevisionId: "01K00000000000000000000009",
      }),
    );
  });

  it("lists, reads, and restores retained Draft revisions", async () => {
    const listRevisions = vi
      .fn<CanvasDraftStore["listRevisions"]>()
      .mockResolvedValue([revision(2), revision(1)]);
    const getRevision = vi
      .fn<CanvasDraftStore["getRevision"]>()
      .mockResolvedValue(revision(1));
    const restore = vi.fn<CanvasDraftStore["restore"]>().mockResolvedValue({
      draft: draft(3),
      replayed: false,
    });
    const controller = new CanvasDraftController(
      {
        canvasDrafts: {
          create: () => Promise.reject(new Error("not expected")),
          get: () => Promise.resolve(draft(2)),
          getRevision,
          listRevisions,
          restore,
          update: () => Promise.reject(new Error("not expected")),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );
    const params = {
      canvasDraftId: "01K00000000000000000000005",
    };

    await expect(
      controller.listRevisions(request, params, {
        limit: "20",
      }),
    ).resolves.toMatchObject({
      items: [
        { version: 2, kind: "save" },
        { version: 1, kind: "save" },
      ],
    });
    await expect(
      controller.getRevision(request, {
        ...params,
        version: "1",
      }),
    ).resolves.toMatchObject({
      version: 1,
      document: {
        title: "活动主视觉",
      },
    });
    await expect(
      controller.restore(request, params, {
        expectedVersion: 2,
        sourceVersion: 1,
      }),
    ).resolves.toMatchObject({
      draft: {
        version: 3,
      },
    });
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        sourceVersion: 1,
      }),
    );
  });
});
