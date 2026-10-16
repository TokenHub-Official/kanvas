import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceContentQueryStore,
  WorkspaceContentQueryStoreError,
} from "../src/runtime/workspace-content-query-store.js";

const workspaceId = "01K00000000000000000000001";
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session-reference",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: [
    "canvas.read",
    "agent.run",
    "asset.read",
    "artifact.download",
    "workflow.read",
    "capability.run",
  ],
  trusted: true,
};

describe("WorkspaceContentQueryStore", () => {
  it("resolves an Agent attachment only for the principal who imported it", async () => {
    const artifactId = "01K00000000000000000000006";
    const query = vi.fn().mockResolvedValue([
      [
        {
          id: artifactId,
          artifactType: "image.source",
          displayFilename: "private-reference.png",
          mediaType: "image/png",
          availabilityStatus: "available",
          createdAt: new Date("2026-08-25T20:00:00.000Z"),
        },
      ],
      [],
    ]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    await expect(
      store.getAgentAttachmentArtifact(scope, artifactId),
    ).resolves.toEqual({
      id: artifactId,
      artifactType: "image.source",
      displayFilename: "private-reference.png",
      mediaType: "image/png",
      availabilityStatus: "available",
      createdAt: new Date("2026-08-25T20:00:00.000Z"),
    });
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "artifact.created_by_principal_id = ?",
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "importedFrom')) = 'agent-composer'",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      workspaceId,
      artifactId,
      scope.principalId,
      null,
      null,
      scope.principalId,
    ]);
  });

  it("limits reuse of an Agent-produced image to its owning Thread", async () => {
    const artifactId = "01K00000000000000000000006";
    const threadId = "01K00000000000000000000007";
    const query = vi.fn().mockResolvedValue([
      [
        {
          id: artifactId,
          artifactType: "image.generated",
          displayFilename: "candidate.png",
          mediaType: "image/png",
          availabilityStatus: "available",
          createdAt: new Date("2026-08-25T20:00:00.000Z"),
        },
      ],
      [],
    ]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    await expect(
      store.getAgentAttachmentArtifact(scope, artifactId, threadId),
    ).resolves.toMatchObject({ id: artifactId });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("FROM agent_action_receipt");
    expect(sql).toContain("agent_run.thread_id = ?");
    expect(sql).toContain("thread.created_by_principal_id = ?");
    expect(sql).toContain("action.capability_run_id = capability.id");
    expect(sql).toContain("action.workflow_run_id = node.workflow_run_id");
    expect(query.mock.calls[0]?.[1]).toContain(threadId);
  });

  it("projects bounded Artifact facts produced by one Workflow Run", async () => {
    const workflowRunId = "01K00000000000000000000005";
    const query = vi.fn().mockResolvedValue([
      [
        {
          id: "01K00000000000000000000006",
          artifactType: "image.generated",
          displayFilename: "result.png",
          mediaType: "image/png",
          availabilityStatus: "available",
          createdAt: new Date("2026-08-25T20:00:00.000Z"),
        },
      ],
      [],
    ]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    await expect(
      store.listWorkflowRunArtifacts(scope, workflowRunId),
    ).resolves.toEqual([
      {
        id: "01K00000000000000000000006",
        artifactType: "image.generated",
        displayFilename: "result.png",
        mediaType: "image/png",
        availabilityStatus: "available",
        createdAt: new Date("2026-08-25T20:00:00.000Z"),
      },
    ]);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "node.workflow_run_id = ?",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      workspaceId,
      workflowRunId,
      scope.principalId,
    ]);
  });

  it("maps only each Asset current Artifact and keeps storage addressing private", async () => {
    const query = vi.fn().mockResolvedValue([
      [
        {
          id: "01K00000000000000000000005",
          assetKey: "asset-1",
          name: "产品原图",
          assetType: "image.source",
          lifecycleStatus: "active",
          currentArtifactId: "01K00000000000000000000006",
          artifactType: "image",
          displayFilename: "product.png",
          mediaType: "image/png",
          byteSize: "2048",
          availabilityStatus: "available",
          dataClassification: "internal",
          artifactCreatedAt: new Date("2026-07-29T00:00:00.000Z"),
          brandKitId: "01K00000000000000000000020",
          brandKitRevisionId: "01K00000000000000000000021",
          brandName: "Kanvas 主品牌",
          brandRevisionNumber: 3,
          version: 1,
          createdAt: new Date("2026-07-28T00:00:00.000Z"),
          updatedAt: new Date("2026-07-29T00:00:00.000Z"),
        },
      ],
      [],
    ]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    const result = await store.listAssets(scope);

    expect(query.mock.calls[0]?.[1]).toEqual([workspaceId, 101]);
    expect(query.mock.calls[1]?.[0]).toContain("SELECT DISTINCT");
    expect(result.items[0]).toMatchObject({
      id: "01K00000000000000000000005",
      currentArtifact: {
        id: "01K00000000000000000000006",
        mediaType: "image/png",
        byteSize: "2048",
        brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
      },
    });
    expect(result.items[0]).not.toHaveProperty("objectKey");
    expect(result.items[0]).not.toHaveProperty("container");
    expect(result.facets).toEqual({
      assetTypes: ["image.source"],
    });
  });

  it("returns one Asset with bounded current history and direct lineage", async () => {
    const assetId = "01K00000000000000000000005";
    const artifactId = "01K00000000000000000000006";
    const sourceArtifactId = "01K00000000000000000000007";
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            id: assetId,
            assetKey: "canvas-export-1",
            name: "首页视觉",
            assetType: "image.canvas_export",
            lifecycleStatus: "active",
            currentArtifactId: artifactId,
            artifactType: "image.canvas_export",
            displayFilename: "homepage.png",
            mediaType: "image/png",
            byteSize: "2048",
            availabilityStatus: "available",
            dataClassification: "internal",
            artifactCreatedAt: new Date("2026-08-05T01:00:00.000Z"),
            version: 2,
            createdAt: new Date("2026-08-04T01:00:00.000Z"),
            updatedAt: new Date("2026-08-05T01:00:00.000Z"),
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: artifactId,
            artifactType: "image.canvas_export",
            displayFilename: "homepage.png",
            mediaType: "image/png",
            byteSize: "2048",
            availabilityStatus: "available",
            dataClassification: "internal",
            createdByCapabilityRunId: null,
            brandKitId: "01K00000000000000000000020",
            brandKitRevisionId: "01K00000000000000000000021",
            brandName: "Kanvas 主品牌",
            brandRevisionNumber: 3,
            metadata: {
              canvasExport: {
                request: {
                  canvasDraftId: "01K00000000000000000000008",
                  documentVersion: 4,
                  pageId: "page-1",
                  format: "png",
                  width: 1080,
                  height: 1080,
                  transparentBackground: true,
                },
                sourceArtifactCount: 1,
              },
            },
            isCurrent: 1,
            createdAt: new Date("2026-08-05T01:00:00.000Z"),
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            brandKitId: "01K00000000000000000000020",
            name: "Kanvas 主品牌",
            isDefault: 1,
            logoRole: "primary",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            edgeId: "01K00000000000000000000012",
            edgeCreatedAt: new Date("2026-08-04T01:30:00.000Z"),
            direction: "input",
            relation: "composed_from",
            artifactId: sourceArtifactId,
            artifactType: "image.source",
            displayFilename: "source.png",
            mediaType: "image/png",
            artifactCreatedAt: new Date("2026-08-04T01:00:00.000Z"),
          },
        ],
        [],
      ]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    await expect(
      store.getAsset(scope, assetId, {
        historyKind: "artifacts",
        cursor: {
          occurredAt: new Date("2026-08-04T02:00:00.000Z"),
          id: "01K00000000000000000000011",
          currentRank: 0,
        },
        limit: 10,
      }),
    ).resolves.toMatchObject({
      id: assetId,
      version: 2,
      currentArtifact: {
        id: artifactId,
        isCurrent: true,
        brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
        origin: {
          kind: "canvas_export",
          canvasDraftId: "01K00000000000000000000008",
          documentVersion: 4,
          width: 1080,
          height: 1080,
          sourceArtifactCount: 1,
        },
      },
      lineage: [
        {
          direction: "input",
          relation: "composed_from",
          artifact: { id: sourceArtifactId },
        },
      ],
      artifactsTruncated: false,
      lineageTruncated: false,
      usedByBrands: [
        {
          name: "Kanvas 主品牌",
          isDefault: true,
          logoRole: "primary",
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1]?.[0]).not.toContain("object_key");
    expect(query.mock.calls[1]?.[0]).toContain(
      "CASE WHEN ar.id = ? THEN 1 ELSE 0 END < ?",
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      artifactId,
      workspaceId,
      assetId,
      artifactId,
      0,
      artifactId,
      0,
      new Date("2026-08-04T02:00:00.000Z"),
      new Date("2026-08-04T02:00:00.000Z"),
      "01K00000000000000000000011",
      11,
    ]);
  });

  it("applies Asset filters and returns an opaque keyset boundary", async () => {
    const cursorDate = new Date("2026-07-29T00:00:00.000Z");
    const first = {
      id: "01K00000000000000000000005",
      assetKey: "asset-1",
      name: "产品原图",
      assetType: "image.source",
      lifecycleStatus: "active" as const,
      currentArtifactId: null,
      artifactType: null,
      displayFilename: null,
      mediaType: null,
      byteSize: null,
      availabilityStatus: null,
      dataClassification: null,
      artifactCreatedAt: null,
      version: 1,
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T23:00:00.000Z"),
    };
    const query = vi.fn().mockResolvedValue([
      [
        first,
        {
          ...first,
          id: "01K00000000000000000000004",
          updatedAt: new Date("2026-07-28T22:00:00.000Z"),
        },
      ],
      [],
    ]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    const result = await store.listAssets(scope, {
      search: "产品",
      mediaKind: "image",
      assetType: "image.source",
      lifecycleStatus: "active",
      cursor: {
        updatedAt: cursorDate,
        id: "01K00000000000000000000008",
      },
      limit: 1,
    });

    expect(query.mock.calls[0]?.[0]).toContain("a.updated_at < ?");
    expect(query.mock.calls[0]?.[1]).toEqual([
      workspaceId,
      "%产品%",
      "%产品%",
      "image/%",
      "active",
      "image.source",
      cursorDate,
      cursorDate,
      "01K00000000000000000000008",
      2,
    ]);
    expect(result).toMatchObject({
      truncated: true,
      items: [{ id: first.id }],
      nextCursor: {
        updatedAt: first.updatedAt,
        id: first.id,
      },
    });
  });

  it("loads recent Assets by bounded IDs without depending on the first page", async () => {
    const query = vi.fn().mockResolvedValue([[], []]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);
    const ids = ["01K00000000000000000000005", "01K00000000000000000000006"];

    await expect(
      store.listAssets(scope, {
        ids,
        mediaKind: "image",
        lifecycleStatus: "active",
        limit: 24,
      }),
    ).resolves.toMatchObject({
      items: [],
      truncated: false,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("a.id IN (?, ?)");
    expect(query.mock.calls[0]?.[1]).toEqual([
      workspaceId,
      "image/%",
      "active",
      ...ids,
      25,
    ]);
  });

  it("projects only the latest published and enabled creation entrypoints", async () => {
    const query = vi.fn().mockResolvedValue([
      [
        {
          skillRevisionId: "01K00000000000000000000005",
          skillKey: "team.product-cutout",
          skillRevision: 3,
          manifestDocument: {
            displayName: "商品透明底图",
            nonProduction: false,
            entrypoints: [
              {
                entrypointKey: "generate",
                displayName: "生成透明底图",
                description: "保留主体并输出透明 PNG。",
                category: "商品图片",
                outputPresentation: "single_review",
                inputUiSchema: {
                  schemaVersion: "kanvas.entrypoint-ui/v0",
                },
              },
            ],
          },
          entrypointKey: "generate",
          workflowRevisionId: "01K00000000000000000000006",
          workflowRevision: 2,
          inputSchema: {
            type: "object",
          },
          outputSchema: {
            type: "object",
          },
          capabilityKey: "image.shared.process",
          capabilityRevision: 2,
          capabilityCanonicalDigest: `sha256:${"a".repeat(64)}`,
          capabilityAuthoring: {
            schemaVersion: "kanvas.capability-declaration/v1",
            origin: "declared",
            catalog: {
              title: { "zh-CN": "共享能力", "en-US": "Shared capability" },
              category: { "zh-CN": "图像处理", "en-US": "Image processing" },
              sourceKind: "plugin",
              tags: ["image"],
              surfaces: ["workflow", "agent", "canvas"],
            },
            parameters: [
              {
                key: "sourceArtifactId",
                label: { "zh-CN": "源图片", "en-US": "Source image" },
                semanticType: "artifact.image",
                required: true,
                exposurePolicy: {
                  allowed: ["workflow_author"],
                  default: "workflow_author",
                },
                sourcePolicy: {
                  allowed: ["workflow_input"],
                  default: "workflow_input",
                },
                editor: "artifact_picker",
              },
            ],
            outputs: [
              {
                key: "imageArtifactId",
                label: { "zh-CN": "结果", "en-US": "Result" },
                semanticType: "artifact.image",
                primary: true,
                visibility: "author",
              },
            ],
          },
        },
      ],
      [],
    ]);
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    await expect(store.listCreationEntrypoints(scope)).resolves.toMatchObject({
      items: [
        {
          skillKey: "team.product-cutout",
          displayName: "共享能力",
          category: "图像处理",
          outputPresentation: "single_review",
          nonProduction: false,
          effectiveInvocationSchema: {
            availability: "unavailable",
            reason: "route_unavailable",
          },
          capability: {
            contractKey: "image.shared.process",
            revision: 2,
            surfaces: ["workflow", "agent", "canvas"],
            parameters: [
              {
                key: "sourceArtifactId",
                semanticType: "artifact.image",
              },
            ],
          },
        },
      ],
      truncated: false,
    });
    expect(query.mock.calls[0]?.[1]).toEqual([workspaceId, 101]);
  });

  it("rejects a forged or underprivileged scope before issuing SQL", async () => {
    const query = vi.fn();
    const store = createWorkspaceContentQueryStore({
      query,
    } as unknown as Pool);

    await expect(
      store.listAssets({
        ...scope,
        effectivePermissions: ["canvas.read"],
      }),
    ).rejects.toBeInstanceOf(WorkspaceContentQueryStoreError);
    expect(query).not.toHaveBeenCalled();
  });
});
