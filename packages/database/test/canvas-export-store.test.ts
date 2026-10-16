import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { createCanvasExportStore } from "../src/runtime/canvas-export-store.js";

const ids = Object.freeze({
  artifact: "01K00000000000000000000001",
  asset: "01K00000000000000000000002",
  authority: "01K00000000000000000000003",
  exportSession: "01K00000000000000000000004",
  organization: "01K00000000000000000000005",
  principal: "01K00000000000000000000006",
  storedObject: "01K00000000000000000000007",
  workspace: "01K00000000000000000000008",
});

const scope: TrustedWorkspaceScope = {
  workspaceId: ids.workspace,
  organizationId: ids.organization,
  principalId: ids.principal,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "canvas-export-session",
  authorityType: "human_membership",
  authorityId: ids.authority,
  authorityVersion: 3,
  authorizationModelVersion: 1,
  effectivePermissions: ["asset.write"],
  trusted: true,
};

function poolWithExecute(execute: ReturnType<typeof vi.fn>): Pool {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    execute,
    release: vi.fn(),
    rollback: vi.fn().mockResolvedValue(undefined),
  } as unknown as PoolConnection;
  return {
    getConnection: vi.fn().mockResolvedValue(connection),
  } as unknown as Pool;
}

describe("CanvasExportStore", () => {
  it("recovers the immutable committed result and original Asset version", async () => {
    const committedAt = new Date("2026-07-30T20:00:00.000Z");
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            principalId: ids.principal,
            principalStatus: "active",
            membershipId: ids.authority,
            membershipRole: "owner",
            membershipStatus: "active",
            membershipVersion: 3,
            organizationId: ids.organization,
            workspaceId: ids.workspace,
            workspaceStatus: "active",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: ids.exportSession,
            workspaceId: ids.workspace,
            actorId: ids.principal,
            allocationRequestHash: `sha256:${"1".repeat(64)}`,
            storageProfileId: "01K00000000000000000000009",
            container: "objects",
            objectKey: "workspaces/export",
            storageVersionId: null,
            providerEtag: null,
            sealedIdentityHash: `sha256:${"2".repeat(64)}`,
            state: "committed",
            version: 4,
            expectedSize: "68",
            expiresAt: new Date("2026-07-30T21:00:00.000Z"),
            cleanupState: "none",
            verifiedSize: "68",
            verifiedSha256: "3".repeat(64),
            detectedMediaType: "image/png",
            committedStoredObjectId: ids.storedObject,
            committedAt,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            exportSessionId: ids.exportSession,
            storedObjectId: ids.storedObject,
            artifactId: ids.artifact,
            assetId: ids.asset,
            metadata: {
              canvasExport: {
                assetVersion: 4,
                request: {
                  canvasDraftId: "01K00000000000000000000009",
                  documentVersion: 3,
                  pageId: "page-1",
                  format: "png",
                  displayFilename: "poster.png",
                },
              },
            },
            contentDigest: `sha256:${"3".repeat(64)}`,
            mediaType: "image/png",
            byteSize: "68",
            committedAt,
          },
        ],
        [],
      ]);
    const store = createCanvasExportStore(poolWithExecute(execute), {
      instanceId: "canvas-export-test",
    });

    await expect(
      store.get(scope, ids.exportSession, new Date("2026-07-30T20:01:00.000Z")),
    ).resolves.toMatchObject({
      state: "committed",
      sourceRequest: {
        canvasDraftId: "01K00000000000000000000009",
        documentVersion: 3,
        pageId: "page-1",
        format: "png",
        displayFilename: "poster.png",
      },
      result: {
        status: "replayed",
        artifactId: ids.artifact,
        assetId: ids.asset,
        assetVersion: 4,
        committedAt,
      },
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("rejects a transparent JPEG request before opening a transaction", async () => {
    const getConnection = vi.fn();
    const store = createCanvasExportStore(
      { getConnection } as unknown as Pool,
      { instanceId: "canvas-export-test" },
    );

    await expect(
      store.commit({
        authority: scope,
        exportSessionId: ids.exportSession,
        storedObjectId: ids.storedObject,
        artifactId: ids.artifact,
        outboxEventId: "01K0000000000000000000000A",
        request: {
          canvasDraftId: "01K0000000000000000000000B",
          documentVersion: 1,
          pageId: "page-1",
          format: "jpeg",
          width: 1080,
          height: 1080,
          transparentBackground: true,
          displayFilename: "export.jpg",
          requestHash: `sha256:${"4".repeat(64)}`,
        },
        target: { kind: "artifact_only" },
        audit: {
          auditEventId: "01K0000000000000000000000C",
          authenticationRefHash: `sha256:${"5".repeat(64)}`,
        },
        now: new Date("2026-07-30T20:01:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "canvas_export.invalid_argument",
    });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("derives the exported Artifact classification from trusted source facts", async () => {
    const sourceArtifactId = "01K0000000000000000000000E";
    const requestHash = `sha256:${"4".repeat(64)}`;
    const now = new Date("2026-07-30T20:01:00.000Z");
    const execute = vi.fn(
      async (sqlValue: unknown, params?: readonly unknown[]) => {
        await Promise.resolve(params);
        const sql = String(sqlValue);
        if (sql.includes("FROM instance_runtime_state")) {
          return [
            [
              {
                state: "ACTIVE",
                executionGeneration: 9,
              },
            ],
          ];
        }
        if (sql.includes("FROM workspace_membership AS membership")) {
          return [
            [
              {
                principalId: ids.principal,
                principalStatus: "active",
                membershipId: ids.authority,
                membershipRole: "owner",
                membershipStatus: "active",
                membershipVersion: 3,
                organizationId: ids.organization,
                workspaceId: ids.workspace,
                workspaceStatus: "active",
              },
            ],
          ];
        }
        if (sql.includes("FROM upload_session")) {
          return [
            [
              {
                id: ids.exportSession,
                workspaceId: ids.workspace,
                actorId: ids.principal,
                allocationRequestHash: requestHash,
                storageProfileId: "01K00000000000000000000009",
                container: "objects",
                objectKey: "workspaces/export",
                storageVersionId: "version-1",
                providerEtag: "etag-1",
                sealedIdentityHash: `sha256:${"2".repeat(64)}`,
                state: "verified",
                version: 3,
                expectedSize: "68",
                expiresAt: new Date("2026-07-30T21:00:00.000Z"),
                cleanupState: "none",
                verifiedSize: "68",
                verifiedSha256: "3".repeat(64),
                detectedMediaType: "image/png",
                committedStoredObjectId: null,
                committedAt: null,
              },
            ],
          ];
        }
        if (sql.includes("FROM canvas_draft")) {
          return [
            [
              {
                document: {
                  schemaVersion: "kanvas.editor-document/v1",
                  title: "受控素材画板",
                  pages: [
                    {
                      id: "page-1",
                      name: "页面 1",
                      width: 1080,
                      height: 1080,
                      background: {
                        kind: "transparent",
                      },
                      nodes: [
                        {
                          id: "image-1",
                          name: "受控素材",
                          kind: "image",
                          transform: {
                            x: 0,
                            y: 0,
                            width: 1080,
                            height: 1080,
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
                              artifactId: sourceArtifactId,
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
                          cornerRadius: 0,
                        },
                      ],
                    },
                  ],
                  metadata: {
                    createdWith: "canvas-export-test",
                  },
                },
                contentDigest: `sha256:${"6".repeat(64)}`,
                version: 3,
              },
            ],
          ];
        }
        if (
          sql.includes("FROM artifact") &&
          sql.includes("availability_status")
        ) {
          return [
            [
              {
                id: sourceArtifactId,
                availabilityStatus: "available",
                dataClassification: "restricted",
              },
            ],
          ];
        }
        if (
          sql.includes("INSERT INTO") ||
          sql.includes("UPDATE upload_session")
        ) {
          return [
            {
              affectedRows: 1,
              insertId: 0,
              warningStatus: 0,
            },
          ];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const store = createCanvasExportStore(poolWithExecute(execute), {
      instanceId: "canvas-export-test",
    });

    await expect(
      store.commit({
        authority: scope,
        exportSessionId: ids.exportSession,
        storedObjectId: ids.storedObject,
        artifactId: ids.artifact,
        outboxEventId: "01K0000000000000000000000A",
        request: {
          canvasDraftId: "01K0000000000000000000000B",
          documentVersion: 3,
          pageId: "page-1",
          format: "png",
          width: 1080,
          height: 1080,
          transparentBackground: true,
          displayFilename: "export.png",
          requestHash,
        },
        target: { kind: "artifact_only" },
        audit: {
          auditEventId: "01K0000000000000000000000C",
          authenticationRefHash: `sha256:${"5".repeat(64)}`,
        },
        now,
      }),
    ).resolves.toMatchObject({
      status: "committed",
      artifactId: ids.artifact,
    });

    const artifactInsert = execute.mock.calls.find(([sqlValue]) =>
      String(sqlValue).includes("INSERT INTO artifact ("),
    );
    expect(artifactInsert?.[1]).toEqual(expect.arrayContaining(["restricted"]));
    expect(JSON.parse(String(artifactInsert?.[1]?.[8]))).toMatchObject({
      dataClassification: "restricted",
    });
  });
});
