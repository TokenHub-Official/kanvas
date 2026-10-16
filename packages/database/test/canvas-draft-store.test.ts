import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { EditorDraftContentV1 } from "@kanvas/contracts/editor";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  canvasDraftArtifactReferences,
  createCanvasDraftStore,
  digestCanvasDraftCreateRequest,
  digestCanvasDraftContent,
} from "../src/runtime/canvas-draft-store.js";

const workspaceId = "01K00000000000000000000001";
const principalId = "01K00000000000000000000003";
const canvasDraftId = "01K00000000000000000000005";
const brandKitId = "01K00000000000000000000020";
const brandKitRevisionA = "01K00000000000000000000021";
const brandKitRevisionB = "01K00000000000000000000022";
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000002",
  principalId,
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
const document: EditorDraftContentV1 = {
  schemaVersion: "kanvas.editor-document/v1",
  title: "活动主视觉",
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1080,
      background: { kind: "transparent" },
      nodes: [],
    },
  ],
  metadata: {
    createdWith: "kanvas-web",
  },
};
const now = new Date("2026-07-29T00:00:00.000Z");
const imageDocument: EditorDraftContentV1 = {
  ...document,
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1080,
      background: { kind: "transparent" },
      nodes: [
        {
          id: "image-1",
          name: "商品图",
          kind: "image",
          transform: {
            x: 100,
            y: 100,
            width: 400,
            height: 300,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          opacity: 1,
          blendMode: "normal",
          visible: true,
          locked: false,
          image: {
            source: {
              kind: "artifact",
              artifactId: "01K00000000000000000000007",
            },
            crop: {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
            },
            fit: "contain",
            focalPoint: { x: 0.5, y: 0.5 },
          },
          cornerRadius: 0,
        },
      ],
    },
  ],
};
const backgroundDocument: EditorDraftContentV1 = {
  ...document,
  pages: [
    {
      id: "page-1",
      name: "页面 1",
      width: 1080,
      height: 1080,
      background: {
        kind: "image",
        image: {
          source: {
            kind: "artifact",
            artifactId: "01K00000000000000000000008",
          },
          crop: { x: 0, y: 0, width: 1, height: 1 },
          fit: "cover",
          focalPoint: { x: 0.5, y: 0.5 },
        },
        opacity: 1,
      },
      nodes: [],
    },
  ],
};
const v1Document: EditorDraftContentV1 = {
  schemaVersion: "kanvas.editor-document/v1",
  title: "V1 商品排版",
  pages: [
    {
      id: "page-v1",
      name: "页面 1",
      width: 1080,
      height: 1350,
      background: {
        kind: "image",
        image: {
          source: {
            kind: "artifact",
            artifactId: "01K00000000000000000000011",
          },
          crop: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          fit: "cover",
          focalPoint: {
            x: 0.5,
            y: 0.5,
          },
        },
        opacity: 1,
      },
      nodes: [
        {
          id: "image-v1",
          name: "商品图",
          kind: "image",
          transform: {
            x: 100,
            y: 100,
            width: 400,
            height: 300,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          opacity: 1,
          blendMode: "normal",
          visible: true,
          locked: false,
          image: {
            source: {
              kind: "artifact",
              artifactId: "01K00000000000000000000012",
            },
            crop: {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
            },
            fit: "contain",
            focalPoint: {
              x: 0.5,
              y: 0.5,
            },
          },
          cornerRadius: 0,
        },
        {
          id: "graphic-v1",
          name: "品牌图标",
          kind: "graphic",
          transform: {
            x: 540,
            y: 100,
            width: 200,
            height: 200,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          opacity: 1,
          blendMode: "normal",
          visible: true,
          locked: false,
          source: {
            kind: "artifact",
            artifactId: "01K00000000000000000000013",
          },
          colorSlots: {},
          preserveAspectRatio: true,
        },
        {
          id: "group-v1",
          name: "容器组",
          kind: "group",
          transform: {
            x: 100,
            y: 500,
            width: 800,
            height: 500,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          opacity: 1,
          blendMode: "normal",
          visible: true,
          locked: false,
          children: [
            {
              id: "frame-v1",
              name: "人物画框",
              kind: "frame",
              transform: {
                x: 0,
                y: 0,
                width: 320,
                height: 420,
                rotation: 0,
                flipX: false,
                flipY: false,
              },
              opacity: 1,
              blendMode: "normal",
              visible: true,
              locked: false,
              definition: {
                catalogId: "kanvas.core.frames",
                definitionId: "frame.portrait",
                revision: "1",
              },
              content: {
                image: {
                  source: {
                    kind: "artifact",
                    artifactId: "01K00000000000000000000014",
                  },
                  crop: {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                  },
                  fit: "cover",
                  focalPoint: {
                    x: 0.5,
                    y: 0.5,
                  },
                },
              },
              fill: {
                kind: "none",
              },
              stroke: {
                paint: {
                  kind: "none",
                },
                width: 0,
                alignment: "center",
              },
            },
            {
              id: "grid-v1",
              name: "双图网格",
              kind: "grid",
              transform: {
                x: 360,
                y: 0,
                width: 420,
                height: 420,
                rotation: 0,
                flipX: false,
                flipY: false,
              },
              opacity: 1,
              blendMode: "normal",
              visible: true,
              locked: false,
              definition: {
                catalogId: "kanvas.core.grids",
                definitionId: "grid.two",
                revision: "1",
              },
              gap: 12,
              cornerRadius: 0,
              cells: [
                {
                  slotId: "left",
                  content: {
                    image: {
                      source: {
                        kind: "artifact",
                        artifactId: "01K00000000000000000000015",
                      },
                      crop: {
                        x: 0,
                        y: 0,
                        width: 1,
                        height: 1,
                      },
                      fit: "cover",
                      focalPoint: {
                        x: 0.5,
                        y: 0.5,
                      },
                    },
                  },
                },
                {
                  slotId: "right",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  metadata: {
    createdWith: "kanvas-web",
  },
};

function brandFields(brandKitRevisionId: string, brandRevisionNumber: number) {
  return {
    brandKitRevisionId,
    brandKitId,
    brandName: "Acme 主品牌",
    brandRevisionNumber,
  };
}

function row(
  version: number,
  value = document,
  brand?: ReturnType<typeof brandFields>,
) {
  return {
    id: canvasDraftId,
    workspaceId,
    document: value,
    contentDigest: digestCanvasDraftContent(value),
    createRequestHash: digestCanvasDraftCreateRequest(value, undefined),
    version,
    createdByPrincipalId: principalId,
    updatedByPrincipalId: principalId,
    createdAt: now,
    updatedAt: now,
    ...(brand ?? {}),
  };
}

function summaryRow(
  id: string,
  title: string,
  updatedAt: Date,
  brand?: ReturnType<typeof brandFields>,
) {
  return {
    id,
    workspaceId,
    brandKitRevisionId: null,
    brandKitId: null,
    brandName: null,
    brandRevisionNumber: null,
    title,
    pageCount: 1,
    version: 2,
    createdAt: now,
    updatedAt,
    ...(brand ?? {}),
  };
}

function revisionRow(
  version: number,
  value = document,
  kind: "brand_update" | "restore" | "save" = "save",
  restoredFromVersion: number | null = null,
  brand?: ReturnType<typeof brandFields>,
) {
  return {
    workspaceId,
    canvasDraftId,
    version,
    document: value,
    contentDigest: digestCanvasDraftContent(value),
    revisionKind: kind,
    restoredFromVersion,
    createdByPrincipalId: principalId,
    createdAt: now,
    ...(brand ?? {}),
  };
}

function poolWith(execute: ReturnType<typeof vi.fn>) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute,
  };
  return {
    pool: {
      getConnection: vi.fn().mockResolvedValue(connection),
      execute,
    } as unknown as Pool,
    connection,
  };
}

const audit = {
  auditEventId: "01K00000000000000000000006",
  authenticationRefHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

describe("CanvasDraftStore", () => {
  it("recovers an exact committed mutation from its audit event and revision", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            action: "canvas_draft.update",
            resourceId: canvasDraftId,
            version: 2,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[revisionRow(2)], []]);
    const { pool } = poolWith(execute);

    await expect(
      createCanvasDraftStore(pool).recoverMutation(scope, audit.auditEventId),
    ).resolves.toMatchObject({
      kind: "update",
      beforeVersion: 1,
      afterVersion: 2,
      revision: { canvasDraftId, version: 2 },
    });
  });

  it("lists recent Workspace Draft summaries in update order", async () => {
    const newer = summaryRow(
      "01K00000000000000000000008",
      "新版主视觉",
      new Date("2026-07-29T00:02:00.000Z"),
      brandFields("01K00000000000000000000007", 3),
    );
    const older = summaryRow(
      canvasDraftId,
      "活动主视觉",
      new Date("2026-07-29T00:01:00.000Z"),
    );
    const overflow = summaryRow("01K00000000000000000000009", "更早画板", now);
    const execute = vi.fn().mockResolvedValue([[newer, older, overflow], []]);
    const { pool } = poolWith(execute);
    const store = createCanvasDraftStore(pool);

    await expect(
      store.list({
        authority: scope,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: newer.id,
          title: "新版主视觉",
          brand: { name: "Acme 主品牌", revisionNumber: 3 },
        },
        { id: older.id, title: "活动主视觉" },
      ],
      truncated: true,
    });
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "ORDER BY draft.updated_at DESC, draft.id DESC",
    );
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "LEFT JOIN brand_kit_revision",
    );
    expect(execute.mock.calls[0]?.[1]).toEqual([workspaceId]);
  });

  it("creates one versioned Draft and returns the server-owned identities", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row(1)], []]);
    const { pool, connection } = poolWith(execute);
    const appendAudit = vi.fn().mockResolvedValue(undefined);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit,
    });

    await expect(
      store.create({
        authority: scope,
        canvasDraftId,
        idempotencyKey: "create-1",
        document,
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      draft: {
        id: canvasDraftId,
        workspaceId,
        document: {
          documentId: canvasDraftId,
          workspaceId,
          title: "活动主视觉",
        },
        version: 1,
      },
    });
    expect(appendAudit).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("pins one authorized explicit Brand Revision on the initial Draft and history", async () => {
    const brandedScope: TrustedWorkspaceScope = {
      ...scope,
      effectivePermissions: ["canvas.read", "canvas.write", "brand.read"],
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([
        [
          {
            brandKitRevisionId: brandKitRevisionA,
            brandKitId,
            brandName: "Acme 主品牌",
            brandRevisionNumber: 1,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([
        [row(1, document, brandFields(brandKitRevisionA, 1))],
        [],
      ]);
    const { pool } = poolWith(execute);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit: () => Promise.resolve(),
    });

    await expect(
      store.create({
        authority: brandedScope,
        canvasDraftId,
        idempotencyKey: "brand-create-1",
        document,
        brandKitRevisionId: brandKitRevisionA,
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      draft: {
        brand: {
          brandKitId,
          brandKitRevisionId: brandKitRevisionA,
          name: "Acme 主品牌",
          revisionNumber: 1,
        },
      },
    });
    expect(execute.mock.calls[2]?.[1]).toContain(brandKitRevisionA);
    expect(execute.mock.calls[3]?.[1]).toContain(brandKitRevisionA);
  });

  it("creates an explicitly unbranded Draft without resolving the Workspace default", async () => {
    const brandedScope: TrustedWorkspaceScope = {
      ...scope,
      effectivePermissions: ["canvas.read", "canvas.write", "brand.read"],
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row(1)], []]);
    const { pool } = poolWith(execute);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit: () => Promise.resolve(),
    });

    const result = await store.create({
      authority: brandedScope,
      canvasDraftId,
      idempotencyKey: "without-brand-create-1",
      document,
      brandKitRevisionId: null,
      now,
      audit,
    });
    expect(result).toMatchObject({
      replayed: false,
      draft: { id: canvasDraftId },
    });
    expect(result.draft).not.toHaveProperty("brand");
    expect(String(execute.mock.calls[1]?.[0])).toContain(
      "INSERT INTO canvas_draft",
    );
    expect(digestCanvasDraftCreateRequest(document, null)).not.toBe(
      digestCanvasDraftCreateRequest(document, undefined),
    );
  });

  it("replays a matching create key without appending another audit event", async () => {
    const execute = vi.fn().mockResolvedValue([[row(1)], []]);
    const { pool } = poolWith(execute);
    const appendAudit = vi.fn();
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit,
    });

    await expect(
      store.create({
        authority: scope,
        canvasDraftId,
        idempotencyKey: "create-1",
        document,
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: true,
      draft: {
        version: 1,
      },
    });
    expect(appendAudit).not.toHaveBeenCalled();
  });

  it("retains every image Artifact in the same Draft transaction", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row(1, imageDocument)], []]);
    const { pool } = poolWith(execute);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit: () => Promise.resolve(),
    });

    await store.create({
      authority: scope,
      canvasDraftId,
      idempotencyKey: "create-image-draft",
      document: imageDocument,
      now,
      audit,
    });

    expect(String(execute.mock.calls[2]?.[0])).toContain(
      "canvas_draft_artifact_reference",
    );
    expect(execute.mock.calls[2]?.[1]).toContain("01K00000000000000000000007");
  });

  it("retains a page background Artifact with its own reference role", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row(1, backgroundDocument)], []]);
    const { pool } = poolWith(execute);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit: () => Promise.resolve(),
    });

    await store.create({
      authority: scope,
      canvasDraftId,
      idempotencyKey: "create-background-draft",
      document: backgroundDocument,
      now,
      audit,
    });

    expect(execute.mock.calls[2]?.[1]).toContain("01K00000000000000000000008");
    expect(execute.mock.calls[2]?.[1]).toContain("editor.page.background");
  });

  it("collects every V1 Artifact through backgrounds, nodes and nested containers", () => {
    expect(canvasDraftArtifactReferences(v1Document)).toEqual([
      {
        artifactId: "01K00000000000000000000011",
        role: "editor.page.background",
      },
      {
        artifactId: "01K00000000000000000000012",
        role: "editor.image.source",
      },
      {
        artifactId: "01K00000000000000000000013",
        role: "editor.graphic.source",
      },
      {
        artifactId: "01K00000000000000000000014",
        role: "editor.frame.content",
      },
      {
        artifactId: "01K00000000000000000000015",
        role: "editor.grid.content",
      },
    ]);
  });

  it("rejects a stale update instead of overwriting another editing session", async () => {
    const execute = vi.fn().mockResolvedValue([[row(3)], []]);
    const { pool, connection } = poolWith(execute);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit: () => Promise.resolve(),
    });

    await expect(
      store.update({
        authority: scope,
        canvasDraftId,
        expectedVersion: 1,
        document: {
          ...document,
          title: "过期修改",
        },
        now,
        audit,
      }),
    ).rejects.toMatchObject({
      code: "canvas_draft.concurrent_change",
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("lists bounded immutable revision summaries in descending order", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        revisionRow(3, {
          ...document,
          title: "第三版",
        }),
        revisionRow(2, {
          ...document,
          title: "第二版",
        }),
      ],
      [],
    ]);
    const { pool } = poolWith(execute);
    const store = createCanvasDraftStore(pool);

    await expect(
      store.listRevisions({
        authority: scope,
        canvasDraftId,
        limit: 20,
      }),
    ).resolves.toMatchObject([
      {
        version: 3,
        title: "第三版",
        kind: "save",
      },
      {
        version: 2,
        title: "第二版",
        kind: "save",
      },
    ]);
  });

  it("appends the saved document as the next immutable revision", async () => {
    const nextDocument = {
      ...document,
      title: "第二版",
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[row(1)], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row(2, nextDocument)], []]);
    const { pool } = poolWith(execute);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit: () => Promise.resolve(),
    });

    await expect(
      store.update({
        authority: scope,
        canvasDraftId,
        expectedVersion: 1,
        document: nextDocument,
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      draft: {
        version: 2,
        document: {
          title: "第二版",
        },
      },
    });
    expect(String(execute.mock.calls[2]?.[0])).toContain(
      "INSERT INTO canvas_draft_revision",
    );
    expect(execute.mock.calls[2]?.[1]).toContain(2);
    expect(execute.mock.calls[2]?.[1]).toContain("save");
  });

  it("restores an older revision as a new version without rewriting history", async () => {
    const currentDocument = {
      ...document,
      title: "当前第四稿",
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [row(4, currentDocument, brandFields(brandKitRevisionB, 2))],
        [],
      ])
      .mockResolvedValueOnce([
        [
          revisionRow(
            2,
            document,
            "save",
            null,
            brandFields(brandKitRevisionA, 1),
          ),
        ],
        [],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([
        [row(5, document, brandFields(brandKitRevisionA, 1))],
        [],
      ]);
    const { pool } = poolWith(execute);
    const appendAudit = vi.fn().mockResolvedValue(undefined);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit,
    });

    await expect(
      store.restore({
        authority: scope,
        canvasDraftId,
        expectedVersion: 4,
        sourceVersion: 2,
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      draft: {
        version: 5,
        document: {
          title: "活动主视觉",
        },
        brand: {
          brandKitRevisionId: brandKitRevisionA,
          revisionNumber: 1,
        },
      },
    });
    expect(execute.mock.calls[2]?.[1]).toContain(brandKitRevisionA);
    expect(execute.mock.calls[3]?.[1]).toContain("restore");
    expect(execute.mock.calls[3]?.[1]).toContain(2);
    expect(execute.mock.calls[3]?.[1]).toContain(brandKitRevisionA);
    expect(appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "canvas_draft.restore",
        restoredFromVersion: 2,
        brandKitRevisionId: brandKitRevisionA,
        version: 5,
      }),
    );
  });

  it("adopts a newer Brand Revision as explicit Canvas history without changing document content", async () => {
    const brandedScope: TrustedWorkspaceScope = {
      ...scope,
      effectivePermissions: ["canvas.read", "canvas.write", "brand.read"],
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [row(2, document, brandFields(brandKitRevisionA, 1))],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            brandKitRevisionId: brandKitRevisionB,
            brandKitId,
            brandName: "Acme 主品牌",
            brandRevisionNumber: 2,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([
        [row(3, document, brandFields(brandKitRevisionB, 2))],
        [],
      ]);
    const { pool } = poolWith(execute);
    const appendAudit = vi.fn().mockResolvedValue(undefined);
    const store = createCanvasDraftStore(pool, {
      revalidateAuthority: () => Promise.resolve(),
      appendAudit,
    });

    await expect(
      store.updateBrand({
        authority: brandedScope,
        canvasDraftId,
        expectedVersion: 2,
        brandKitRevisionId: brandKitRevisionB,
        now,
        audit,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      draft: {
        version: 3,
        brand: {
          brandKitRevisionId: brandKitRevisionB,
          revisionNumber: 2,
        },
        document: { title: document.title },
      },
    });
    expect(execute.mock.calls[2]?.[1]).toContain(brandKitRevisionB);
    expect(execute.mock.calls[3]?.[1]).toContain("brand_update");
    expect(appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "canvas_draft.brand_update",
        previousBrandKitRevisionId: brandKitRevisionA,
        brandKitRevisionId: brandKitRevisionB,
      }),
    );
  });
});
