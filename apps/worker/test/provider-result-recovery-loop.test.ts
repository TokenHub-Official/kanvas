import { describe, expect, it, vi } from "vitest";
import {
  createStorageUploadStore,
  StorageUploadStoreError,
} from "@kanvas/database/runtime";
import type { Pool } from "mysql2/promise";
import type {
  ClaimedProviderResultRecovery,
  ProviderResultRecoveryStore,
  StorageUploadStore,
  ContentTransferStore,
} from "@kanvas/database/runtime";
import type { TrustedImageStorageRuntime } from "@kanvas/storage";
import { ProviderResultRecoveryLoop } from "../src/provider/provider-result-recovery-loop.js";
import { ProviderAdapterCallError } from "../src/provider/provider-adapter.js";
import type { ProviderHttpRequest } from "../src/provider/provider-http-transport.js";

const id = (value: number) => `01K${String(value).padStart(23, "0")}`;

function fixture(statusCode = 200) {
  const claim = {
    id: id(1),
    workspaceId: id(2),
    capabilityRunId: id(3),
    attemptId: id(4),
    providerEndpointId: id(5),
    invocationId: id(6),
    url: "https://results.example/file.png?signature=secret",
    uploadSessionId: id(7),
    storedObjectId: id(8),
    artifactId: id(9),
    leaseToken: "a".repeat(64),
    authority: {
      principalId: id(10),
      authenticationRefId: id(11),
      workspaceId: id(2),
      trusted: true,
    },
  } as ClaimedProviderResultRecovery;
  const store = {
    claim: vi.fn().mockResolvedValue(claim),
    renew: vi.fn().mockResolvedValue(true),
    fail: vi.fn(),
    recordPolicy: vi.fn(),
  };
  const request = vi.fn(async (input: ProviderHttpRequest) => {
    await input.onResultPolicyResolved?.({
      version: 7,
      enabled: true,
      allowedOrigins: ["https://results.example"],
    });
    return {
      statusCode,
      headers: { "content-type": "image/png" },
      body: Buffer.from("fixture"),
    };
  });
  const allocate = vi.fn().mockResolvedValue({ id: id(7), state: "open" });
  const ingest = vi.fn();
  const commit = vi.fn();
  const loop = new ProviderResultRecoveryLoop({
    store: store as unknown as ProviderResultRecoveryStore,
    uploads: {
      allocateUploadSession: allocate,
    } as unknown as StorageUploadStore,
    content: {
      commitRecoveredProviderResult: commit,
    } as unknown as ContentTransferStore,
    storage: {
      ensureCompatibilityProbe: vi.fn().mockResolvedValue({ id: id(13) }),
      profileId: id(12),
      container: "container",
      profileConfigurationHash: `sha256:${"a".repeat(64)}`,
      verificationProfileVersion: "v1",
      cleanupGraceMilliseconds: 1000,
      uploads: { ingest },
    } as unknown as TrustedImageStorageRuntime,
    transport: { request },
    onError: vi.fn(),
  });
  return { loop, store, request, allocate, ingest, commit, claim };
}
describe("Stored Provider result recovery", () => {
  it("preserves storage failure codes instead of hiding them behind a generic recovery error", async () => {
    const f = fixture();
    f.allocate.mockRejectedValue(
      new StorageUploadStoreError(
        "storage_upload.access_denied",
        "private diagnostic message",
      ),
    );
    await f.loop.tick();
    expect(f.store.fail).toHaveBeenCalledWith(
      f.claim.id,
      f.claim.leaseToken,
      "storage_upload.access_denied",
      expect.any(Date),
    );
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("passes real upload-allocation validation before entering the database transaction", async () => {
    const f = fixture();
    const reachedDatabase = new Error(
      "validation passed; no database writes in this test",
    );
    const getConnection = vi.fn().mockRejectedValue(reachedDatabase);
    const uploads = createStorageUploadStore({
      getConnection,
    } as unknown as Pool);
    f.allocate.mockImplementation(uploads.allocateUploadSession.bind(uploads));
    await f.loop.tick();
    expect(getConnection).toHaveBeenCalledOnce();
    expect(f.allocate).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: f.claim.authority,
        actorId: f.claim.authority.principalId,
      }),
    );
    expect(f.ingest).not.toHaveBeenCalled();
  });
  it("only fetches retained bytes and binds storage commit to the original task owner", async () => {
    const f = fixture();
    await f.loop.tick();
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.request.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      targetKind: "provider_result",
      headers: {},
      baseUrl: "https://results.example",
      path: "/file.png?signature=secret",
      resultPolicyContext: {
        workspaceId: id(2),
        providerEndpointId: id(5),
        invocationId: id(6),
      },
    });
    expect(f.store.recordPolicy).toHaveBeenCalledWith(id(1), "a".repeat(64), 7);
    expect(f.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryId: id(1),
        artifactId: id(9),
        authority: f.claim.authority,
        metadata: {
          recoveredFromCapabilityRunId: id(3),
          recoveryId: id(1),
        },
      }),
    );
    expect(f.commit.mock.calls[0]?.[0]).not.toHaveProperty("asset");
    expect(f.store.fail).not.toHaveBeenCalled();
  });
  it("reports an expired file without uploading, committing or generating", async () => {
    const f = fixture(410);
    await f.loop.tick();
    expect(f.store.fail).toHaveBeenCalledWith(
      id(1),
      "a".repeat(64),
      "result_recovery.expired",
      expect.any(Date),
    );
    expect(f.allocate).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("retains the download policy failure and never starts storage", async () => {
    const f = fixture();
    f.request.mockRejectedValue(
      new ProviderAdapterCallError(
        "provider.output_origin_not_allowed",
        "not_started",
      ),
    );
    await f.loop.tick();
    expect(f.store.fail).toHaveBeenCalledWith(
      id(1),
      "a".repeat(64),
      "provider.output_origin_not_allowed",
      expect.any(Date),
    );
    expect(f.ingest).not.toHaveBeenCalled();
  });
});
