import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  ContentDomainStore,
  WorkspaceContentQueryStore,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { WorkspaceContentController } from "../src/http/workspace-content.controller.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";

const workspaceId = "01K00000000000000000000001";
const request = {} as FastifyRequest;
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
    "canvas.write",
    "asset.read",
    "asset.write",
    "artifact.download",
    "workflow.read",
  ],
  trusted: true,
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

describe("WorkspaceContentController", () => {
  it("adopts an immutable result Artifact into an idempotent Workspace Asset", async () => {
    const createAsset = vi
      .fn<ContentDomainStore["createAsset"]>()
      .mockResolvedValue({
        status: "created",
        assetId: "01K00000000000000000000005",
        artifactId: "01K00000000000000000000006",
        version: 1,
      });
    const controller = new WorkspaceContentController(
      {
        content: {
          createAsset,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await expect(
      controller.createAssetFromArtifact(
        request,
        "01K00000000000000000000005",
        {
          assetId: "01K00000000000000000000005",
          artifactId: "01K00000000000000000000006",
          name: "去背景结果",
        },
      ),
    ).resolves.toEqual({
      status: "created",
      assetId: "01K00000000000000000000005",
      artifactId: "01K00000000000000000000006",
      version: 1,
    });
    const command = createAsset.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      authority: scope,
      assetId: "01K00000000000000000000005",
      assetKey: "canvas-result-01k00000000000000000000005",
      name: "去背景结果",
      assetType: "image",
      initialArtifact: {
        kind: "adopt",
        artifactId: "01K00000000000000000000006",
      },
    });
    expect(command?.now).toBeInstanceOf(Date);
  });

  it("does not expose storage addressing in the Asset response", async () => {
    const listAssets = vi
      .fn<WorkspaceContentQueryStore["listAssets"]>()
      .mockResolvedValue({
        items: [
          {
            id: "01K00000000000000000000005",
            assetKey: "asset-1",
            name: "产品图",
            assetType: "image.source",
            lifecycleStatus: "active",
            currentArtifact: {
              id: "01K00000000000000000000006",
              artifactType: "image",
              displayFilename: "product.png",
              mediaType: "image/png",
              byteSize: "2048",
              availabilityStatus: "available",
              dataClassification: "internal",
              brand: {
                brandKitId: "01K00000000000000000000020",
                brandKitRevisionId: "01K00000000000000000000021",
                name: "Kanvas 主品牌",
                revisionNumber: 3,
              },
              createdAt: new Date("2026-07-29T01:00:00.000Z"),
            },
            version: 1,
            createdAt: new Date("2026-07-29T00:00:00.000Z"),
            updatedAt: new Date("2026-07-29T01:00:00.000Z"),
          },
        ],
        truncated: false,
        facets: {
          assetTypes: ["image.source"],
        },
      });
    const controller = new WorkspaceContentController(
      {
        workspaceContentQueries: {
          listAssets,
          listCreationEntrypoints: () =>
            Promise.resolve({
              items: [],
              truncated: false,
            }),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    const result = await controller.listAssets(request, {});

    expect(listAssets).toHaveBeenCalledWith(scope, {
      limit: 100,
    });
    expect(result.items[0]).not.toHaveProperty("objectKey");
    expect(result.items[0]?.currentArtifact).toMatchObject({
      id: "01K00000000000000000000006",
      brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
      createdAt: "2026-07-29T01:00:00.000Z",
    });
    expect(result.facets).toEqual({
      assetTypes: ["image.source"],
    });
  });

  it("serializes Asset detail history, lineage, and authorized actions", async () => {
    const getAsset = vi
      .fn<WorkspaceContentQueryStore["getAsset"]>()
      .mockResolvedValue({
        id: "01K00000000000000000000005",
        name: "首页视觉",
        assetType: "image.canvas_export",
        lifecycleStatus: "active",
        version: 2,
        currentArtifact: {
          id: "01K00000000000000000000006",
          artifactType: "image.canvas_export",
          displayFilename: "homepage.png",
          mediaType: "image/png",
          byteSize: "2048",
          availabilityStatus: "available",
          dataClassification: "internal",
          isCurrent: true,
          brand: {
            brandKitId: "01K00000000000000000000020",
            brandKitRevisionId: "01K00000000000000000000021",
            name: "Kanvas 主品牌",
            revisionNumber: 3,
          },
          origin: {
            kind: "canvas_export",
            canvasDraftId: "01K00000000000000000000007",
            documentVersion: 3,
            pageId: "page-1",
            format: "png",
            width: 1080,
            height: 1080,
            transparentBackground: true,
            sourceArtifactCount: 1,
          },
          createdAt: new Date("2026-08-05T01:00:00.000Z"),
        },
        artifacts: [],
        artifactsTruncated: false,
        artifactsNextCursor: {
          occurredAt: new Date("2026-08-03T01:00:00.000Z"),
          id: "01K00000000000000000000009",
          currentRank: 0,
        },
        lineage: [
          {
            direction: "input",
            relation: "composed_from",
            artifact: {
              id: "01K00000000000000000000008",
              artifactType: "image.source",
              displayFilename: "source.png",
              mediaType: "image/png",
              createdAt: new Date("2026-08-04T01:00:00.000Z"),
            },
          },
        ],
        lineageTruncated: false,
        usedByBrands: [
          {
            brandKitId: "01K00000000000000000000020",
            name: "Kanvas 主品牌",
            isDefault: true,
            logoRole: "primary",
          },
        ],
        createdAt: new Date("2026-08-04T00:00:00.000Z"),
        updatedAt: new Date("2026-08-05T01:00:00.000Z"),
      });
    const controller = new WorkspaceContentController(
      {
        workspaceContentQueries: {
          getAsset,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await expect(
      controller.getAsset(
        request,
        {
          assetId: "01K00000000000000000000005",
        },
        {
          historyKind: "artifacts",
          cursor: Buffer.from(
            JSON.stringify({
              occurredAt: "2026-08-04T01:00:00.000Z",
              id: "01K00000000000000000000010",
              currentRank: 0,
            }),
            "utf8",
          ).toString("base64url"),
          limit: "20",
        },
      ),
    ).resolves.toMatchObject({
      id: "01K00000000000000000000005",
      currentArtifact: {
        brand: { name: "Kanvas 主品牌", revisionNumber: 3 },
        createdAt: "2026-08-05T01:00:00.000Z",
      },
      artifactsNextCursor: Buffer.from(
        JSON.stringify({
          occurredAt: "2026-08-03T01:00:00.000Z",
          id: "01K00000000000000000000009",
          currentRank: 0,
        }),
        "utf8",
      ).toString("base64url"),
      lineage: [
        {
          artifact: {
            createdAt: "2026-08-04T01:00:00.000Z",
          },
        },
      ],
      usedByBrands: [
        {
          name: "Kanvas 主品牌",
          isDefault: true,
          logoRole: "primary",
        },
      ],
      availableActions: [
        "download_artifacts",
        "reuse_on_canvas",
        "download_current",
      ],
      updatedAt: "2026-08-05T01:00:00.000Z",
    });
    expect(getAsset).toHaveBeenCalledWith(scope, "01K00000000000000000000005", {
      historyKind: "artifacts",
      cursor: {
        occurredAt: new Date("2026-08-04T01:00:00.000Z"),
        id: "01K00000000000000000000010",
        currentRank: 0,
      },
      limit: 20,
    });
  });

  it("decodes Asset filters and returns the next keyset cursor", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        updatedAt: "2026-07-29T01:00:00.000Z",
        id: "01K00000000000000000000008",
      }),
      "utf8",
    ).toString("base64url");
    const listAssets = vi
      .fn<WorkspaceContentQueryStore["listAssets"]>()
      .mockResolvedValue({
        items: [],
        truncated: true,
        nextCursor: {
          updatedAt: new Date("2026-07-28T01:00:00.000Z"),
          id: "01K00000000000000000000007",
        },
      });
    const controller = new WorkspaceContentController(
      {
        workspaceContentQueries: {
          listAssets,
          listCreationEntrypoints: () =>
            Promise.resolve({ items: [], truncated: false }),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    const result = await controller.listAssets(request, {
      q: "产品",
      mediaKind: "image",
      assetType: "image.source",
      lifecycleStatus: "active",
      cursor,
      limit: "48",
    });

    expect(listAssets).toHaveBeenCalledWith(scope, {
      search: "产品",
      mediaKind: "image",
      assetType: "image.source",
      lifecycleStatus: "active",
      cursor: {
        updatedAt: new Date("2026-07-29T01:00:00.000Z"),
        id: "01K00000000000000000000008",
      },
      limit: 48,
    });
    expect(result.nextCursor).toBe(
      Buffer.from(
        JSON.stringify({
          updatedAt: "2026-07-28T01:00:00.000Z",
          id: "01K00000000000000000000007",
        }),
        "utf8",
      ).toString("base64url"),
    );
  });

  it("decodes a bounded recent Asset ID projection", async () => {
    const listAssets = vi
      .fn<WorkspaceContentQueryStore["listAssets"]>()
      .mockResolvedValue({
        items: [],
        truncated: false,
      });
    const controller = new WorkspaceContentController(
      {
        workspaceContentQueries: {
          listAssets,
          listCreationEntrypoints: () =>
            Promise.resolve({ items: [], truncated: false }),
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await controller.listAssets(request, {
      ids: ["01K00000000000000000000005", "01K00000000000000000000006"].join(
        ",",
      ),
      mediaKind: "image",
      lifecycleStatus: "active",
      limit: "24",
    });

    expect(listAssets).toHaveBeenCalledWith(scope, {
      ids: ["01K00000000000000000000005", "01K00000000000000000000006"],
      mediaKind: "image",
      lifecycleStatus: "active",
      limit: 24,
    });
  });

  it("returns creation entrypoints without exposing Workflow internals", async () => {
    const listCreationEntrypoints = vi
      .fn<WorkspaceContentQueryStore["listCreationEntrypoints"]>()
      .mockResolvedValue({
        items: [
          {
            skillRevisionId: "01K00000000000000000000005",
            skillKey: "team.social-cover",
            skillRevision: 1,
            entrypointKey: "create",
            workflowRevisionId: "01K00000000000000000000006",
            workflowRevision: 2,
            displayName: "社媒封面",
            description: "根据素材生成多个封面方向。",
            category: "社媒",
            nonProduction: false,
            outputPresentation: "board",
            inputSchema: {
              type: "object",
            },
            outputSchema: {
              type: "object",
            },
            capability: {
              contractKey: "image.shared.process",
              revision: 1,
              canonicalDigest: `sha256:${"a".repeat(64)}`,
              surfaces: ["workflow", "agent", "canvas"],
              parameters: [
                {
                  key: "sourceArtifactId",
                  semanticType: "artifact.image",
                },
              ],
              outputs: [
                {
                  key: "imageArtifactId",
                  semanticType: "artifact.image",
                  primary: true,
                },
              ],
            },
            effectiveInvocationSchema: {
              schemaVersion: "kanvas.effective-invocation-schema/v1",
              availability: "available",
              controlledParameterKeys: [],
              validationSchema: {
                schemaVersion:
                  "kanvas.effective-invocation-validation-schema/v1",
                document: '{"type":"object"}',
              },
              fields: [],
            },
          },
        ],
        truncated: false,
      });
    const controller = new WorkspaceContentController(
      {
        workspaceContentQueries: {
          listAssets: () =>
            Promise.resolve({
              items: [],
              truncated: false,
            }),
          listCreationEntrypoints,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts(),
    );

    await expect(
      controller.listCreationEntrypoints(request),
    ).resolves.toMatchObject({
      items: [
        {
          displayName: "社媒封面",
          outputPresentation: "board",
          effectiveInvocationSchema: {
            availability: "available",
            fields: [],
          },
          capability: {
            contractKey: "image.shared.process",
            surfaces: ["workflow", "agent", "canvas"],
            outputs: [
              {
                key: "imageArtifactId",
                semanticType: "artifact.image",
                primary: true,
              },
            ],
          },
        },
      ],
    });
    expect(listCreationEntrypoints).toHaveBeenCalledWith(scope, "zh-CN");
  });
});
