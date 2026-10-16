import type {
  ApplicationRuntime,
  RuntimeStateReader,
  StorageProfileRegistry,
} from "@kanvas/application";
import type {
  ModelResourceImportClaim,
  ModelResourceImportStore,
} from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import type { ServerStreamUploadCoordinator } from "@kanvas/storage";
import { describe, expect, it, vi } from "vitest";

import { ModelResourceImportLoop } from "../src/model-resource/model-resource-import-loop.js";

function byteStream(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      let emitted = false;
      return {
        next() {
          if (emitted) {
            return Promise.resolve({ done: true, value: undefined });
          }
          emitted = true;
          return Promise.resolve({ done: false, value: bytes });
        },
      };
    },
  };
}

describe("ModelResourceImportLoop", () => {
  it("continues a ready Catalog installation before claiming more imports", async () => {
    const continueCatalogInstallations = vi.fn().mockResolvedValue(true);
    const claimNext = vi.fn();
    const loop = new ModelResourceImportLoop({
      runtime: {
        runtimeFence: { assertAllowed: vi.fn().mockResolvedValue({}) },
      } as unknown as ApplicationRuntime,
      runtimeStateReader: {
        read: () =>
          Promise.resolve({
            state: "ACTIVE",
            executionGeneration: 7,
            stateVersion: 1,
          }),
      },
      store: {
        claimNext,
        commitDownloaded: vi.fn(),
        reportDownloadProgress: vi.fn(),
        completeCancellation: vi.fn(),
        completeAnalysis: vi.fn(),
        fail: vi.fn(),
        listPublishedRuntimeAdapters: vi.fn(),
      },
      profiles: { resolve: vi.fn() },
      uploads: {} as ServerStreamUploadCoordinator,
      maximumBytes: 1_048_576,
      pollIntervalMs: 1_000,
      leaseDurationMs: 60_000,
      downloadTimeoutMs: 10_000,
      logger: { error: vi.fn(), info: vi.fn() },
      nextId: () => "01K00000000000000000000001",
      continueCatalogInstallations,
    });

    await expect(loop.runOnce()).resolves.toBe(true);
    expect(continueCatalogInstallations).toHaveBeenCalledOnce();
    expect(claimNext).not.toHaveBeenCalled();
  });

  it("downloads a stable HTTPS import into the governed upload session", async () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const url = "https://models.example/portable-model.onnx";
    const commitDownloaded = vi.fn().mockResolvedValue({});
    const ingest = vi.fn(
      async ({ body }: { readonly body: AsyncIterable<Uint8Array> }) => {
        for await (const _chunk of body) void _chunk;
        return {
          uploadSessionId: "01K00000000000000000000012",
          state: "verified" as const,
          replayed: false,
        };
      },
    );
    const reportDownloadProgress = vi.fn().mockResolvedValue("continue");
    const downloadedBody = byteStream(new Uint8Array([0x08, 0x01, 0x12, 0x00]));
    const claim = {
      record: {
        id: "01K00000000000000000000010",
        workspaceId: "01K00000000000000000000011",
        source: {
          kind: "https" as const,
          url,
        },
        status: "fetching" as const,
      },
      processingLeaseGeneration: 3,
      processingLeaseTokenHash: "a".repeat(64),
      uploadSession: { id: "01K00000000000000000000012" },
    } as unknown as ModelResourceImportClaim;
    const download = vi.fn().mockResolvedValue({
      body: downloadedBody,
      path: "portable-model.onnx",
      sourceMetadata: { etag: '"portable-v1"' },
    });
    const loop = new ModelResourceImportLoop({
      runtime: {
        runtimeFence: { assertAllowed: vi.fn().mockResolvedValue({}) },
      } as unknown as ApplicationRuntime,
      runtimeStateReader: {
        read: () =>
          Promise.resolve({
            state: "ACTIVE",
            executionGeneration: 7,
            stateVersion: 1,
          }),
      },
      store: {
        claimNext: vi.fn().mockResolvedValue(claim),
        commitDownloaded,
        reportDownloadProgress,
        completeCancellation: vi.fn(),
        completeAnalysis: vi.fn(),
        fail: vi.fn(),
        listPublishedRuntimeAdapters: vi.fn(),
      },
      profiles: { resolve: vi.fn() },
      uploads: { ingest },
      maximumBytes: 1_048_576,
      pollIntervalMs: 1_000,
      leaseDurationMs: 60_000,
      downloadTimeoutMs: 10_000,
      logger: { error: vi.fn(), info: vi.fn() },
      nextId: () => "01K00000000000000000000013",
      now: () => now,
      download,
    });

    await expect(loop.runOnce()).resolves.toBe(true);
    expect(download).toHaveBeenCalledWith({
      url,
      maximumBytes: 1_048_576,
      deadlineAt: new Date(now.getTime() + 10_000),
    });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ session: claim.uploadSession }),
    );
    expect(reportDownloadProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ downloadedBytes: "4" }),
    );
    expect(commitDownloaded).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: claim.record.id,
        workspaceId: claim.record.workspaceId,
        storedObjectId: "01K00000000000000000000013",
        path: "portable-model.onnx",
        sourceMetadata: { etag: '"portable-v1"' },
      }),
    );
  });

  it("cooperatively cancels an active download before committing bytes", async () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const chunk = new Uint8Array(1_048_576);
    const claim = {
      record: {
        id: "01K00000000000000000000010",
        workspaceId: "01K00000000000000000000011",
        source: {
          kind: "https" as const,
          url: "https://models.example/portable-model.onnx",
        },
        status: "fetching" as const,
        downloadedBytes: "0",
      },
      processingLeaseGeneration: 3,
      processingLeaseTokenHash: "a".repeat(64),
      uploadSession: { id: "01K00000000000000000000012" },
    } as unknown as ModelResourceImportClaim;
    const reportDownloadProgress = vi
      .fn()
      .mockResolvedValueOnce("continue")
      .mockResolvedValueOnce("cancel_requested");
    const completeCancellation = vi.fn().mockResolvedValue({});
    const commitDownloaded = vi.fn();
    const fail = vi.fn();
    const loop = new ModelResourceImportLoop({
      runtime: {
        runtimeFence: { assertAllowed: vi.fn().mockResolvedValue({}) },
      } as unknown as ApplicationRuntime,
      runtimeStateReader: {
        read: () =>
          Promise.resolve({
            state: "ACTIVE",
            executionGeneration: 7,
            stateVersion: 1,
          }),
      },
      store: {
        claimNext: vi.fn().mockResolvedValue(claim),
        commitDownloaded,
        reportDownloadProgress,
        completeCancellation,
        completeAnalysis: vi.fn(),
        fail,
        listPublishedRuntimeAdapters: vi.fn(),
      },
      profiles: { resolve: vi.fn() },
      uploads: {
        ingest: async ({ body }) => {
          try {
            for await (const _part of body) void _part;
          } catch (error) {
            throw new Error("Storage write stopped before publication.", {
              cause: error,
            });
          }
          return { uploadSessionId: claim.uploadSession.id };
        },
      } as ServerStreamUploadCoordinator,
      maximumBytes: 2_097_152,
      pollIntervalMs: 1_000,
      leaseDurationMs: 60_000,
      downloadTimeoutMs: 10_000,
      logger: { error: vi.fn(), info: vi.fn() },
      nextId: () => "01K00000000000000000000013",
      now: () => now,
      download: vi.fn().mockResolvedValue({
        body: byteStream(chunk),
        path: "portable-model.onnx",
        sourceMetadata: {},
      }),
    });

    await expect(loop.runOnce()).resolves.toBe(true);
    expect(completeCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ importId: claim.record.id }),
    );
    expect(commitDownloaded).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("analyzes a direct upload against data-defined Adapters without a Catalog", async () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const completeAnalysis = vi.fn().mockResolvedValue({});
    const fail = vi.fn().mockResolvedValue({});
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
    const claim: ModelResourceImportClaim = {
      record: {
        id: "01K00000000000000000000001",
        workspaceId: "01K00000000000000000000002",
        createdByPrincipalId: "01K00000000000000000000007",
        sourceKind: "upload",
        source: { kind: "upload", fileName: "portable-model.onnx" },
        uploadSessionId: "01K00000000000000000000008",
        uploadExpiresAt: new Date(now.getTime() + 3_600_000),
        status: "analyzing",
        downloadedBytes: "4",
        compatibleAdapters: [],
        requiredUserInputs: [],
        files: [
          {
            path: "portable-model.onnx",
            storedObjectId: "01K00000000000000000000003",
            storageProfileId: "01K00000000000000000000004",
            container: "objects",
            objectKey: "workspaces/example/model",
            immutableIdentityHash: `sha256:${"a".repeat(64)}`,
            mediaType: "application/octet-stream",
            byteSize: "4",
            sha256: "b".repeat(64),
            sourceMetadata: {},
          },
        ],
        version: 2,
        createdAt: now,
        updatedAt: now,
      },
      processingLeaseGeneration: 1,
      processingLeaseTokenHash: "c".repeat(64),
      processingLeaseExpiresAt: new Date(now.getTime() + 120_000),
      uploadSession: {
        id: "01K00000000000000000000008",
        workspaceId: "01K00000000000000000000002",
        actorId: "01K00000000000000000000007",
        purpose: "model_resource",
        storageProfileId: "01K00000000000000000000004",
        compatibilityProbeId: "01K00000000000000000000009",
        profileConfigurationHash: `sha256:${"f".repeat(64)}`,
        container: "objects",
        objectKey: "workspaces/example/model",
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
        state: "committed",
        version: 2,
        expiresAt: new Date(now.getTime() + 3_600_000),
        cleanupEligibleAt: new Date(now.getTime() + 7_200_000),
        verificationProfileVersion: "model-resource-opaque-v1",
        replayed: false,
      },
    };
    const store = {
      claimNext: vi.fn().mockResolvedValue(claim),
      commitDownloaded: vi.fn(),
      reportDownloadProgress: vi.fn(),
      completeCancellation: vi.fn(),
      completeAnalysis,
      fail,
      listPublishedRuntimeAdapters: vi.fn().mockResolvedValue([
        {
          id: "01K00000000000000000000005",
          adapterKey: "portable.onnx.worker.v1",
          revision: 1,
          canonicalDigest: `sha256:${"d".repeat(64)}`,
          document: {
            schemaVersion: "kanvas.runtime-adapter-definition/v1",
            adapterKey: "portable.onnx.worker.v1",
            revision: 1,
            displayName: {
              defaultLocale: "en-US",
              values: { "en-US": "Portable ONNX Worker" },
            },
            executionTarget: "worker",
            sourceKinds: ["model_resource"],
            supportedModelFormats: ["onnx"],
            modelResourceInterfaceDigest: digestProviderValue(nativeInterface),
            invocationInputSchema: { type: "object" },
            invocationOutputSchema: { type: "object" },
            configurationSchema: { type: "object" },
            artifactInputs: [],
            executable: {
              kind: "built_in",
              packageKey: "kanvas.portable-onnx",
              packageVersion: "1.0.0",
              entrypoint: "portable.onnx.run",
              releaseDigest: `sha256:${"e".repeat(64)}`,
            },
          },
        },
      ]),
    } satisfies Pick<
      ModelResourceImportStore,
      | "claimNext"
      | "commitDownloaded"
      | "reportDownloadProgress"
      | "completeCancellation"
      | "completeAnalysis"
      | "fail"
      | "listPublishedRuntimeAdapters"
    >;
    const profiles = {
      resolve: vi.fn(() => ({
        storageProfileId: claim.record.files[0]!.storageProfileId,
        kind: "local" as const,
        adapter: {
          openRead: vi.fn().mockResolvedValue({
            body: byteStream(new Uint8Array([0x08, 0x01, 0x12, 0x00])),
          }),
        },
      })),
    } as unknown as StorageProfileRegistry;
    const runtimeStateReader: RuntimeStateReader = {
      read: () =>
        Promise.resolve({
          state: "ACTIVE",
          executionGeneration: 7,
          stateVersion: 1,
        }),
    };
    const loop = new ModelResourceImportLoop({
      runtime: {
        runtimeFence: { assertAllowed: vi.fn().mockResolvedValue({}) },
      } as unknown as ApplicationRuntime,
      runtimeStateReader,
      store,
      profiles,
      uploads: {} as ServerStreamUploadCoordinator,
      maximumBytes: 1_048_576,
      pollIntervalMs: 1_000,
      leaseDurationMs: 60_000,
      downloadTimeoutMs: 10_000,
      logger: { error: vi.fn(), info: vi.fn() },
      nextId: () => "01K00000000000000000000006",
      now: () => now,
      inspectOnnx: vi.fn().mockResolvedValue(nativeInterface),
    });

    await expect(loop.runOnce()).resolves.toBe(true);
    expect(completeAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: claim.record.id,
        workspaceId: claim.record.workspaceId,
        source: claim.record.source,
        suggestedKey: "model.portable.model",
        suggestedDisplayName: "portable model",
        format: "onnx",
        requiredUserInputs: [],
        compatibleAdapters: [
          expect.objectContaining({
            adapterKey: "portable.onnx.worker.v1",
            executionTarget: "worker",
            confidence: "exact",
            reasonCode: "model_resource.interface_matched",
          }),
        ],
      }),
    );
    expect(fail).not.toHaveBeenCalled();
  });
});
