import { Readable } from "node:stream";

import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  ArtifactRepresentationStore,
  CanvasExportStore,
  ContentTransferStore,
  StorageUploadStore,
} from "@kanvas/database/runtime";
import {
  loadArtifactPreviewConfig,
  type ServerStreamUploadCoordinator,
} from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { ServerConfig } from "../src/config.js";
import type { ServerStorageRuntime } from "../src/storage/server-storage-runtime.js";
import { ContentTransferService } from "../src/storage/content-transfer.service.js";

const ids = Object.freeze({
  workspace: "01K00000000000000000000001",
  organization: "01K00000000000000000000002",
  principal: "01K00000000000000000000003",
  session: "01K00000000000000000000004",
  membership: "01K00000000000000000000005",
  profile: "01K00000000000000000000006",
  probe: "01K00000000000000000000007",
  upload: "01K00000000000000000000008",
  storedObject: "01K00000000000000000000009",
  artifact: "01K0000000000000000000000A",
  draft: "01K0000000000000000000000B",
  asset: "01K0000000000000000000000C",
});

const scope: TrustedWorkspaceScope = {
  workspaceId: ids.workspace,
  organizationId: ids.organization,
  principalId: ids.principal,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: ids.session,
  authorityType: "human_membership",
  authorityId: ids.membership,
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["asset.write", "artifact.download"],
  trusted: true,
};

function createFixture() {
  const allocateUploadSession = vi.fn<
    StorageUploadStore["allocateUploadSession"]
  >((options) =>
    Promise.resolve({
      id: options.id,
      workspaceId: options.workspaceId,
      actorId: options.actorId,
      purpose: options.purpose,
      ...(options.expectedSize ? { expectedSize: options.expectedSize } : {}),
      ...(options.expectedMediaType
        ? {
            expectedMediaType: options.expectedMediaType,
          }
        : {}),
      ...(options.expectedSha256
        ? { expectedSha256: options.expectedSha256 }
        : {}),
      storageProfileId: options.storageProfileId,
      compatibilityProbeId: options.compatibilityProbeId,
      profileConfigurationHash: options.profileConfigurationHash,
      container: options.container,
      objectKey: options.objectKey,
      uploadMode: options.uploadMode,
      writeProtectionMode: options.writeProtectionMode,
      state: "open",
      version: 1,
      expiresAt: options.expiresAt,
      cleanupEligibleAt: options.cleanupEligibleAt,
      verificationProfileVersion: options.verificationProfileVersion,
      replayed: false,
    }),
  );
  const readUserImportUploadSession = vi
    .fn<StorageUploadStore["readUserImportUploadSession"]>()
    .mockResolvedValue({
      id: ids.upload,
      workspaceId: ids.workspace,
      actorId: ids.principal,
      purpose: "user_import",
      expectedSize: "4",
      expectedMediaType: "image/png",
      storageProfileId: ids.profile,
      compatibilityProbeId: ids.probe,
      profileConfigurationHash: `sha256:${"a".repeat(64)}`,
      container: "objects",
      objectKey: `workspaces/${ids.workspace}/user-imports/${ids.upload}.png`,
      uploadMode: "server_stream",
      writeProtectionMode: "server_owned",
      state: "open",
      version: 1,
      expiresAt: new Date("2026-07-28T17:00:00.000Z"),
      cleanupEligibleAt: new Date("2026-07-28T18:00:00.000Z"),
      verificationProfileVersion: "trusted-image-structural-v1",
      replayed: false,
    });
  const readCanvasExportUploadSession = vi
    .fn<StorageUploadStore["readCanvasExportUploadSession"]>()
    .mockResolvedValue({
      id: ids.upload,
      workspaceId: ids.workspace,
      actorId: ids.principal,
      purpose: "canvas_export",
      expectedSize: "4",
      expectedMediaType: "image/png",
      storageProfileId: ids.profile,
      compatibilityProbeId: ids.probe,
      profileConfigurationHash: `sha256:${"a".repeat(64)}`,
      container: "objects",
      objectKey: `workspaces/${ids.workspace}/canvas-exports/${ids.upload}`,
      uploadMode: "server_stream",
      writeProtectionMode: "server_owned",
      state: "open",
      version: 1,
      expiresAt: new Date("2026-07-28T17:00:00.000Z"),
      cleanupEligibleAt: new Date("2026-07-28T18:00:00.000Z"),
      verificationProfileVersion: "trusted-image-structural-v1",
      replayed: false,
    });
  const commitUserImport = vi.fn<ContentTransferStore["commitUserImport"]>(
    (options) =>
      Promise.resolve({
        status: "committed",
        uploadSessionId: ids.upload,
        storedObjectId: ids.storedObject,
        artifactId: ids.artifact,
        ...(options.asset ? { assetId: options.asset.assetId } : {}),
        contentDigest: `sha256:${"b".repeat(64)}`,
        mediaType: "image/png",
        byteSize: "4",
        committedAt: new Date("2026-07-28T16:00:00.000Z"),
      }),
  );
  const ingest = vi
    .fn<ServerStreamUploadCoordinator["ingest"]>()
    .mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "verified",
      replayed: false,
    });
  const fontIngest = vi
    .fn<ServerStorageRuntime["fontUploads"]["ingest"]>()
    .mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "verified",
      replayed: false,
    });
  const vectorIngest = vi
    .fn<ServerStorageRuntime["vectorUploads"]["ingest"]>()
    .mockResolvedValue({
      uploadSessionId: ids.upload,
      state: "verified",
      replayed: false,
    });
  const commitCanvasExport = vi.fn<CanvasExportStore["commit"]>((options) =>
    Promise.resolve({
      status: "committed",
      exportSessionId: ids.upload,
      storedObjectId: ids.storedObject,
      artifactId: ids.artifact,
      ...(options.target.kind === "artifact_only"
        ? {}
        : {
            assetId: options.target.assetId,
            assetVersion:
              options.target.kind === "new_asset"
                ? 1
                : options.target.expectedVersion + 1,
          }),
      contentDigest: `sha256:${"b".repeat(64)}`,
      mediaType: "image/png",
      byteSize: "4",
      committedAt: new Date("2026-07-28T16:00:00.000Z"),
    }),
  );
  const getCanvasExport = vi.fn<CanvasExportStore["get"]>().mockResolvedValue({
    exportSessionId: ids.upload,
    state: "verified",
    expiresAt: new Date("2026-07-28T17:00:00.000Z"),
    expectedSize: "4",
    replayed: false,
  });
  const ensureCompatibilityProbe = vi.fn<
    ServerStorageRuntime["ensureCompatibilityProbe"]
  >((workspaceId, probeId) =>
    Promise.resolve({
      id: probeId,
      workspaceId,
      probeKey: "local-filesystem.v1:test",
      storageProfileId: ids.profile,
      profileConfigurationHash: `sha256:${"a".repeat(64)}`,
      status: "passed",
      capabilities: {
        supportsConditionalCreate: false,
        supportsServerOwnedWrite: true,
        supportsMultipart: false,
        supportsRangeRead: true,
        supportsVersionBoundIdentity: false,
        supportsFullObjectChecksum: true,
        sealedIdentityImmutable: true,
      },
      validUntil: new Date("2026-08-01T00:00:00.000Z"),
      replayed: false,
    }),
  );
  const authorizeArtifactDownload = vi
    .fn<ContentTransferStore["authorizeArtifactDownload"]>()
    .mockImplementation((options) =>
      Promise.resolve({
        decision: "allow",
        decisionId: options.decisionId,
        principalId: options.authority.principalId,
        workspaceId: options.authority.workspaceId,
        artifactId: options.artifactId,
        purpose: options.purpose,
        dataClassification: "internal",
        authorizationVersion: 1,
        proxyRequired: true,
        validUntil: options.validUntil,
      }),
    );
  const revalidateArtifactDownload = vi
    .fn<ContentTransferStore["revalidateArtifactDownload"]>()
    .mockImplementation((options) => Promise.resolve(options.decision));
  const findAvailable = vi
    .fn<ArtifactRepresentationStore["findAvailable"]>()
    .mockResolvedValue(undefined);
  const database = {
    storageUploads: {
      allocateUploadSession,
      readCanvasExportUploadSession,
      readUserImportUploadSession,
    },
    contentTransfers: {
      commitUserImport,
      authorizeArtifactDownload,
      revalidateArtifactDownload,
    },
    artifactRepresentations: { findAvailable },
    canvasExports: {
      commit: commitCanvasExport,
      get: getCanvasExport,
    },
  } as unknown as ServerDatabaseRuntime;
  const storage = {
    profileId: ids.profile,
    profileConfigurationHash: `sha256:${"a".repeat(64)}`,
    container: "objects",
    maximumInputBytes: 8,
    cleanupGraceMilliseconds: 3_600_000,
    userImportSessionTtlMilliseconds: 3_600_000,
    verificationProfileVersion: "trusted-image-structural-v1",
    profiles: {
      resolve: () => ({
        storageProfileId: ids.profile,
        kind: "local" as const,
        adapter: {
          openRead: () =>
            Promise.resolve({
              identity: {
                storageProfileId: ids.profile,
                container: "objects",
                objectKey: "preview.webp",
              },
              totalByteSize: "4",
              contentByteSize: "4",
              body: Readable.from([Buffer.from("webp")]),
            }),
        },
      }),
    },
    uploads: {
      ingest,
    },
    fontUploads: {
      ingest: fontIngest,
    },
    vectorUploads: {
      ingest: vectorIngest,
    },
    ensureCompatibilityProbe,
    close: () => Promise.resolve(),
  } as unknown as ServerStorageRuntime;
  return {
    allocateUploadSession,
    commitCanvasExport,
    commitUserImport,
    ensureCompatibilityProbe,
    ingest,
    fontIngest,
    vectorIngest,
    readCanvasExportUploadSession,
    readUserImportUploadSession,
    database,
    storage,
    findAvailable,
    service: new ContentTransferService(database, storage),
  };
}

describe("ContentTransferService", () => {
  it("authorizes and streams the configured persisted representation", async () => {
    const fixture = createFixture();
    fixture.findAvailable.mockResolvedValueOnce({
      id: "01K0000000000000000000000D",
      workspaceId: ids.workspace,
      sourceArtifactId: ids.artifact,
      variantKey: "interactive-preview",
      profileVersion: loadArtifactPreviewConfig({
        KANVAS_ARTIFACT_PREVIEW_MODE: "async_persisted",
      }).profileVersion,
      storageProfileId: ids.profile,
      container: "objects",
      objectKey: "preview.webp",
      immutableIdentityHash: `sha256:${"c".repeat(64)}`,
      byteSize: "4",
      sha256: "c".repeat(64),
      mediaType: "image/webp",
      width: 4,
      height: 4,
      state: "available",
      createdAt: new Date("2026-07-28T16:00:00.000Z"),
    });
    const config = {
      artifactPreview: loadArtifactPreviewConfig({
        KANVAS_ARTIFACT_PREVIEW_MODE: "async_persisted",
      }),
    } as ServerConfig;
    const service = new ContentTransferService(
      fixture.database,
      fixture.storage,
      config,
    );

    const prepared = await service.preparePersistedArtifactPreview(
      scope,
      ids.artifact,
      "preview-request",
    );

    expect(prepared?.headers["content-type"]).toBe("image/webp");
    expect(prepared?.body).toBeDefined();
  });

  it("allocates and commits a dedicated Canvas Export session", async () => {
    const fixture = createFixture();
    const request = {
      canvasDraftId: ids.draft,
      documentVersion: 3,
      pageId: "page-1",
      format: "png" as const,
      width: 1080,
      height: 1080,
      transparentBackground: true,
      displayFilename: "方图.png",
      expectedSize: "4",
    };

    await expect(
      fixture.service.allocateCanvasExport(
        scope,
        "canvas-export-request",
        request,
      ),
    ).resolves.toMatchObject({
      state: "open",
      maximumBytes: "4",
      replayed: false,
    });
    const allocation = fixture.allocateUploadSession.mock.calls[0]?.[0];
    expect(allocation).toMatchObject({
      authority: scope,
      purpose: "canvas_export",
      expectedMediaType: "image/png",
    });
    expect(allocation?.allocationRequestKey).toMatch(
      /^canvas-export:v1:[0-9a-f]{64}$/u,
    );
    if (!allocation) {
      throw new Error("Canvas Export allocation was not captured.");
    }
    expect(allocation.objectKey).toBe(
      `workspaces/${ids.workspace}/canvas-exports/${allocation.id}`,
    );

    const body = Readable.from([Uint8Array.of(1, 2, 3, 4)]);
    await fixture.service.uploadCanvasExport(scope, ids.upload, body);
    const committed = await fixture.service.commitCanvasExport(
      scope,
      ids.upload,
      {
        request,
        target: {
          kind: "new_asset",
          name: "方图",
          assetType: "image.canvas_export",
        },
      },
      "request-export-commit",
    );
    expect(committed).toMatchObject({
      artifactId: ids.artifact,
      assetVersion: 1,
      committedAt: "2026-07-28T16:00:00.000Z",
    });
    expect(fixture.readCanvasExportUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        uploadSessionId: ids.upload,
      }),
    );
    const commit = fixture.commitCanvasExport.mock.calls[0]?.[0];
    expect(commit?.request).toMatchObject(request);
    expect(commit?.request.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(commit?.target).toMatchObject({
      kind: "new_asset",
      name: "方图",
      assetType: "image.canvas_export",
    });
    if (commit?.target.kind !== "new_asset") {
      throw new Error("Expected a new Asset target.");
    }
    expect(commit.target.assetId).toBe(ids.upload);
    expect(commit.audit.requestId).toBe("request-export-commit");
  });

  it("rejects transparent JPEG Canvas Exports before allocation", async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.allocateCanvasExport(scope, "invalid-jpeg", {
        canvasDraftId: ids.draft,
        documentVersion: 1,
        pageId: "page-1",
        format: "jpeg",
        width: 1080,
        height: 1080,
        transparentBackground: true,
        displayFilename: "方图.jpg",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fixture.ensureCompatibilityProbe).not.toHaveBeenCalled();
  });

  it("allocates a scope-bound immutable User Import session", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.allocateUserImport(scope, "import-request", {
        expectedMediaType: "image/png",
        expectedSize: "4",
      }),
    ).resolves.toMatchObject({
      state: "open",
      maximumBytes: "4",
      replayed: false,
    });

    expect(fixture.ensureCompatibilityProbe).toHaveBeenCalledOnce();
    expect(fixture.allocateUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ids.principal,
        authority: scope,
        workspaceId: ids.workspace,
        purpose: "user_import",
        expectedMediaType: "image/png",
        expectedSize: "4",
        storageProfileId: ids.profile,
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
      }),
    );
    const allocation = fixture.allocateUploadSession.mock.calls[0]?.[0];
    expect(allocation?.objectKey).toBe(
      `workspaces/${ids.workspace}/user-imports/${allocation?.id}.png`,
    );
    expect(allocation?.allocationRequestKey).toMatch(
      /^user-import:v1:[0-9a-f]{64}$/u,
    );
  });

  it("adopts a verified font through a dedicated trusted font session", async () => {
    const fixture = createFixture();
    const result = await fixture.service.adoptExternalFont({
      scope,
      idempotencyKey: "font-adoption-1",
      body: Readable.from([Uint8Array.of(0, 1, 2, 3)]),
      byteSize: 4,
      sha256: "a".repeat(64),
      mediaType: "font/ttf",
      displayName: "Inter-400-normal.ttf",
      metadata: { family: "Inter" },
      createAsset: false,
      requestId: "font-request",
    });

    expect(result.artifactId).toBe(ids.artifact);
    const allocation = fixture.allocateUploadSession.mock.calls[0]?.[0];
    expect(allocation).toMatchObject({
      purpose: "user_import",
      expectedMediaType: "font/ttf",
      verificationProfileVersion: "trusted-font-sfnt-v1",
    });
    expect(allocation?.objectKey).toMatch(/\/fonts\/.*\.ttf$/u);
    expect(fixture.fontIngest).toHaveBeenCalledOnce();
    const commit = fixture.commitUserImport.mock.calls[0]?.[0];
    expect(commit?.artifactType).toBe("font.source");
    expect(commit).not.toHaveProperty("asset");
  });

  it("reuses a committed trusted font session after downstream adoption fails", async () => {
    const fixture = createFixture();
    fixture.allocateUploadSession.mockImplementationOnce((options) =>
      Promise.resolve({
        id: options.id,
        workspaceId: options.workspaceId,
        actorId: options.actorId,
        purpose: options.purpose,
        ...(options.expectedSize ? { expectedSize: options.expectedSize } : {}),
        ...(options.expectedMediaType
          ? { expectedMediaType: options.expectedMediaType }
          : {}),
        ...(options.expectedSha256
          ? { expectedSha256: options.expectedSha256 }
          : {}),
        storageProfileId: options.storageProfileId,
        compatibilityProbeId: options.compatibilityProbeId,
        profileConfigurationHash: options.profileConfigurationHash,
        container: options.container,
        objectKey: options.objectKey,
        uploadMode: options.uploadMode,
        writeProtectionMode: options.writeProtectionMode,
        state: "committed",
        version: 5,
        expiresAt: options.expiresAt,
        cleanupEligibleAt: options.cleanupEligibleAt,
        verificationProfileVersion: options.verificationProfileVersion,
        replayed: true,
      }),
    );

    await fixture.service.adoptExternalFont({
      scope,
      idempotencyKey: "font-adoption-retry",
      body: Readable.from([Uint8Array.of(0, 1, 2, 3)]),
      byteSize: 4,
      sha256: "a".repeat(64),
      mediaType: "font/ttf",
      displayName: "Inter-400-normal.ttf",
      metadata: { family: "Inter" },
      createAsset: false,
    });

    expect(fixture.fontIngest).not.toHaveBeenCalled();
    expect(fixture.commitUserImport).toHaveBeenCalledOnce();
  });

  it("adopts a verified SVG through a dedicated trusted vector session", async () => {
    const fixture = createFixture();
    const result = await fixture.service.adoptExternalVector({
      scope,
      idempotencyKey: "vector-adoption-1",
      body: Readable.from([Buffer.from("<svg/>")]),
      byteSize: 6,
      sha256: "b".repeat(64),
      mediaType: "image/svg+xml",
      displayName: "icon.svg",
      metadata: { source: "Iconify" },
      createAsset: false,
      requestId: "vector-request",
    });

    expect(result.artifactId).toBe(ids.artifact);
    const allocation = fixture.allocateUploadSession.mock.calls[0]?.[0];
    expect(allocation).toMatchObject({
      expectedMediaType: "image/svg+xml",
      verificationProfileVersion: "trusted-svg-v1",
    });
    expect(allocation?.objectKey).toMatch(/\/vectors\/.*\.svg$/u);
    expect(fixture.vectorIngest).toHaveBeenCalledOnce();
    expect(fixture.commitUserImport.mock.calls[0]?.[0]).toMatchObject({
      artifactType: "vector.source",
    });
    expect(fixture.commitUserImport.mock.calls[0]?.[0]).not.toHaveProperty(
      "asset",
    );
  });

  it("rejects declared content larger than the configured boundary before allocation", async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.allocateUserImport(scope, "too-large", {
        expectedMediaType: "image/png",
        expectedSize: "9",
      }),
    ).rejects.toMatchObject({
      status: 413,
    });
    expect(fixture.ensureCompatibilityProbe).not.toHaveBeenCalled();
    expect(fixture.allocateUploadSession).not.toHaveBeenCalled();
  });

  it("reads the exact authorized session for upload and atomically commits its Artifact", async () => {
    const fixture = createFixture();
    const body = Readable.from([Uint8Array.of(1, 2, 3, 4)]);
    await fixture.service.uploadUserImport(scope, ids.upload, body);
    const committed = await fixture.service.commitUserImport(
      scope,
      ids.upload,
      {
        artifactType: "source-image",
        dataClassification: "restricted",
        asset: {
          name: "产品原图",
          assetType: "image.source",
        },
      },
      "request-import-commit",
    );
    expect(committed).toMatchObject({
      artifactId: ids.artifact,
      committedAt: "2026-07-28T16:00:00.000Z",
    });
    expect(committed.assetId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);

    expect(fixture.readUserImportUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: scope,
        uploadSessionId: ids.upload,
      }),
    );
    expect(fixture.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        body,
      }),
    );
    expect(fixture.commitUserImport).toHaveBeenCalledOnce();
    const commit = fixture.commitUserImport.mock.calls[0]?.[0];
    expect(commit).toMatchObject({
      authority: scope,
      uploadSessionId: ids.upload,
      artifactType: "source-image",
      dataClassification: "restricted",
      asset: {
        name: "产品原图",
        assetType: "image.source",
      },
    });
    expect(commit?.asset?.assetId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);
    expect(commit?.audit.requestId).toBe("request-import-commit");
  });
});
