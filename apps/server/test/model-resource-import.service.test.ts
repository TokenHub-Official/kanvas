import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  FinalizePublishedModelResourceImportOptions,
  ModelResourceImportRecord,
  ModelResourceRecord,
  StartModelResourceImportOptions,
} from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { ModelResourceImportService } from "../src/model-resources/model-resource-import.service.js";
import type { ServerStorageRuntime } from "../src/storage/server-storage-runtime.js";

const scope: TrustedWorkspaceScope = Object.freeze({
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "model-resource-import-test",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["capability.configure"] as const,
  trusted: true,
});

describe("ModelResourceImportService", () => {
  it("starts a stable HTTPS import without consulting the Catalog", async () => {
    const source = {
      kind: "https" as const,
      url: "https://models.example/portable-model.onnx",
    };
    const getCatalogEntry = vi.fn();
    const allocateUploadSession = vi.fn(
      (options: {
        readonly expectedSha256?: string;
        readonly expectedSize?: string;
      }) => {
        void options;
        return Promise.resolve({ id: "01K00000000000000000000012" });
      },
    );
    const start = vi.fn((options: StartModelResourceImportOptions) =>
      Promise.resolve({
        value: {
          id: options.importId,
          workspaceId: scope.workspaceId,
          createdByPrincipalId: scope.principalId,
          sourceKind: "url",
          source,
          uploadSessionId: options.uploadSessionId,
          uploadExpiresAt: options.now,
          status: "fetching",
          downloadedBytes: "0",
          compatibleAdapters: [],
          requiredUserInputs: [],
          files: [],
          version: 1,
          createdAt: options.now,
          updatedAt: options.now,
        } satisfies ModelResourceImportRecord,
        replayed: false,
      }),
    );
    const database = {
      modelResources: { getCatalogEntry },
      storageUploads: { allocateUploadSession },
      modelResourceImports: { start },
    } as unknown as ServerDatabaseRuntime;
    const storage = {
      profileId: "01K00000000000000000000013",
      profileConfigurationHash: `sha256:${"f".repeat(64)}`,
      container: "objects",
      cleanupGraceMilliseconds: 3_600_000,
      modelResourceImportSessionTtlMilliseconds: 3_600_000,
      modelResourceMaximumInputBytes: 536_870_912,
      ensureCompatibilityProbe: vi.fn().mockResolvedValue({
        id: "01K00000000000000000000014",
      }),
    } as unknown as ServerStorageRuntime;

    const result = await new ModelResourceImportService(
      database,
      storage,
    ).start(scope, "start-direct-url", {
      source: {
        kind: "url",
        url: source.url,
      },
    });

    expect(getCatalogEntry).not.toHaveBeenCalled();
    const allocation = allocateUploadSession.mock.calls[0]?.[0];
    expect(allocation).toBeDefined();
    expect(allocation).not.toHaveProperty("expectedSha256");
    expect(allocation).not.toHaveProperty("expectedSize");
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: "url",
        source,
      }),
    );
    expect(result).toMatchObject({ status: "fetching", source });
  });

  it("requests cancellation without exposing worker lease details", async () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const importId = "01K00000000000000000000005";
    const requestCancellation = vi.fn().mockResolvedValue({
      id: importId,
      workspaceId: scope.workspaceId,
      createdByPrincipalId: scope.principalId,
      sourceKind: "url",
      source: {
        kind: "https",
        url: "https://models.example/portable-model.onnx",
      },
      expectedByteSize: "10485760",
      downloadedBytes: "1048576",
      cancelRequestedAt: now,
      uploadSessionId: "01K00000000000000000000006",
      uploadExpiresAt: new Date("2026-09-01T01:00:00.000Z"),
      status: "fetching",
      compatibleAdapters: [],
      requiredUserInputs: [],
      files: [],
      version: 2,
      createdAt: now,
      updatedAt: now,
    } satisfies ModelResourceImportRecord);
    const database = {
      modelResourceImports: { requestCancellation },
    } as unknown as ServerDatabaseRuntime;

    const result = await new ModelResourceImportService(database, {
      modelResourceMaximumInputBytes: 536_870_912,
    } as ServerStorageRuntime).cancel(scope, importId, "request-1");

    expect(requestCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ scope, importId }),
    );
    expect(result).toMatchObject({
      status: "fetching",
      downloadedBytes: "1048576",
      cancelRequestedAt: now.toISOString(),
    });
    expect(JSON.stringify(result)).not.toMatch(/lease|token/u);
  });

  it("publishes a directly uploaded model for every compatible current Adapter", async () => {
    const sha256 = "a".repeat(64);
    const primaryFile = {
      path: "portable-model.onnx",
      storedObjectId: "01K00000000000000000000007",
      storageProfileId: "01K00000000000000000000008",
      container: "objects",
      objectKey: "workspaces/example/model",
      immutableIdentityHash: `sha256:${"b".repeat(64)}`,
      mediaType: "application/octet-stream",
      byteSize: "4",
      sha256,
      sourceMetadata: {},
    };
    const nativeInterface = {
      protocol: "tensor" as const,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["input"],
        properties: { input: { type: "array", items: { type: "number" } } },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["output"],
        properties: { output: { type: "array", items: { type: "number" } } },
      },
    };
    const imported = {
      id: "01K00000000000000000000005",
      workspaceId: scope.workspaceId,
      createdByPrincipalId: scope.principalId,
      sourceKind: "upload" as const,
      source: { kind: "upload" as const, fileName: "portable-model.onnx" },
      uploadSessionId: "01K00000000000000000000006",
      uploadExpiresAt: new Date("2026-09-01T02:00:00.000Z"),
      status: "ready" as const,
      format: "onnx" as const,
      nativeInterface,
      compatibleAdapters: [],
      requiredUserInputs: ["license"] as const,
      files: [primaryFile],
      version: 2,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:01:00.000Z"),
    };
    let published: ModelResourceRecord | undefined;
    const finalizePublished = vi.fn(
      (options: FinalizePublishedModelResourceImportOptions) => {
        published = Object.freeze({
          id: options.resourceId,
          workspaceId: scope.workspaceId,
          key: options.target.key,
          displayName: options.displayName,
          status: "active" as const,
          version: 1,
          revisionId: options.revisionId,
          revision: 1,
          revisionDigest: options.revisionDigest,
          manifest: options.manifest,
          implementationCount: 0,
          createdAt: options.now,
          updatedAt: options.now,
        });
        return Promise.resolve({
          resourceId: options.resourceId,
          revisionId: options.revisionId,
          replayed: false,
        });
      },
    );
    const listPublishedRuntimeAdapters = vi.fn().mockResolvedValue([
      {
        id: "01K00000000000000000000009",
        adapterKey: "portable.onnx.browser.v1",
        revision: 1,
        canonicalDigest: `sha256:${"c".repeat(64)}`,
        document: {
          sourceKinds: ["model_resource"],
          supportedModelFormats: ["onnx"],
          modelResourceInterfaceDigest: digestProviderValue(nativeInterface),
          executionTarget: "browser",
        },
      },
      {
        id: "01K00000000000000000000010",
        adapterKey: "portable.onnx.worker.v1",
        revision: 1,
        canonicalDigest: `sha256:${"d".repeat(64)}`,
        document: {
          sourceKinds: ["model_resource"],
          supportedModelFormats: ["onnx"],
          modelResourceInterfaceDigest: digestProviderValue(nativeInterface),
          executionTarget: "worker",
        },
      },
      {
        id: "01K00000000000000000000011",
        adapterKey: "remote.onnx.provider.v1",
        revision: 1,
        canonicalDigest: `sha256:${"e".repeat(64)}`,
        document: {
          sourceKinds: ["model_service"],
          supportedModelFormats: ["onnx"],
          executionTarget: "provider",
        },
      },
    ]);
    const database = {
      capabilityInstallations: {
        resumeForModelResourceImport: vi.fn().mockResolvedValue(false),
      },
      modelResourceImports: {
        read: vi.fn().mockResolvedValue(imported),
        listPublishedRuntimeAdapters,
        finalizePublished,
      },
      modelResources: {
        list: vi.fn(() => Promise.resolve(published ? [published] : [])),
      },
    } as unknown as ServerDatabaseRuntime;
    const storage = {
      profiles: {
        resolve: vi.fn(() => ({
          storageProfileId: primaryFile.storageProfileId,
          kind: "local",
          adapter: {
            inspectObject: vi.fn().mockResolvedValue({
              identity: {
                storageProfileId: primaryFile.storageProfileId,
                container: primaryFile.container,
                objectKey: primaryFile.objectKey,
              },
              byteSize: primaryFile.byteSize,
              sha256: primaryFile.sha256,
              immutableIdentityHash: primaryFile.immutableIdentityHash,
            }),
          },
        })),
      },
    } as unknown as ServerStorageRuntime;

    const result = await new ModelResourceImportService(
      database,
      storage,
    ).publish(scope, imported.id, "publish-direct-upload", {
      expectedVersion: 2,
      target: { kind: "new", key: "portable.model.onnx" },
      displayName: "Portable ONNX model",
      format: "onnx",
      license: { spdxId: "Apache-2.0" },
      nativeInterface,
    });

    expect(listPublishedRuntimeAdapters).toHaveBeenCalledWith(
      scope.workspaceId,
    );
    const finalized = finalizePublished.mock.calls[0]?.[0];
    expect(finalized?.target).toEqual({
      kind: "new",
      key: "portable.model.onnx",
    });
    expect(finalized?.manifest).toMatchObject({
      executionTargets: ["browser", "worker"],
      format: "onnx",
      sha256: `sha256:${sha256}`,
      source: imported.source,
    });
    expect(result.resource.manifest.executionTargets).toEqual([
      "browser",
      "worker",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /storageProfileId|container|objectKey|immutableIdentityHash/u,
    );
  });
});
