import { createHash } from "node:crypto";
import type {
  StorageUploadStore,
  ContentTransferStore,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { ServerStorageRuntime } from "../src/storage/server-storage-runtime.js";
import { ResourceLibraryService } from "../src/resource-libraries/resource-library.service.js";
const id = (value: number) => `01K${String(value).padStart(23, "0")}`;
const scope = {
  workspaceId: id(1),
  principalId: id(2),
  authenticationRefId: "test",
  trusted: true,
} as TrustedWorkspaceScope;
const query = {
  filename: "facts.txt",
  mediaType: "text/plain" as const,
  byteSize: "5",
  sha256: createHash("sha256").update("facts").digest("hex"),
};
function harness(state = "allocated") {
  const authorizeUpload = vi.fn().mockResolvedValue(undefined);
  const allocateUploadSession = vi
    .fn<
      (
        input: Parameters<StorageUploadStore["allocateUploadSession"]>[0],
      ) => Promise<unknown>
    >()
    .mockResolvedValue({ id: id(3), state });
  const commitUserImport = vi
    .fn<
      (
        input: Parameters<ContentTransferStore["commitUserImport"]>[0],
      ) => Promise<unknown>
    >()
    .mockResolvedValue({
      status: "committed",
      artifactId: id(4),
      mediaType: "text/plain",
      byteSize: "5",
    });
  const textIngest = vi.fn().mockResolvedValue({ state: "verified" });
  const imageIngest = vi.fn().mockResolvedValue({ state: "verified" });
  const database = {
    resourceLibraries: {
      authorizeUpload,
      indexText: vi.fn().mockResolvedValue(undefined),
    },
    storageUploads: { allocateUploadSession },
    contentTransfers: { commitUserImport },
  } as unknown as ServerDatabaseRuntime;
  const storage = {
    maximumInputBytes: 1024 * 1024,
    userImportSessionTtlMilliseconds: 60000,
    cleanupGraceMilliseconds: 60000,
    profileId: id(5),
    profileConfigurationHash: "sha256:" + "b".repeat(64),
    container: "objects",
    verificationProfileVersion: "test-v1",
    ensureCompatibilityProbe: vi.fn().mockResolvedValue({ id: id(6) }),
    libraryTextUploads: { ingest: textIngest },
    uploads: { ingest: imageIngest },
  } as unknown as ServerStorageRuntime;
  const service = new ResourceLibraryService(database, storage);
  const body = {
    async *[Symbol.asyncIterator]() {
      yield await Promise.resolve(Buffer.from("facts"));
    },
  };
  return {
    service,
    body,
    authorizeUpload,
    allocateUploadSession,
    commitUserImport,
    textIngest,
    imageIngest,
  };
}
describe("ResourceLibraryService file intake", () => {
  it("verifies text before committing library ownership without implicit Asset adoption", async () => {
    const h = harness();
    await h.service.upload(scope, id(7), "upload-1", query, h.body);
    expect(h.authorizeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ authority: scope, libraryId: id(7) }),
    );
    expect(h.textIngest).toHaveBeenCalledOnce();
    expect(h.imageIngest).not.toHaveBeenCalled();
    const commit = h.commitUserImport.mock.calls[0]?.[0];
    expect(commit).toMatchObject({
      libraryId: id(7),
      artifactType: "document.text",
      displayFilename: "facts.txt",
    });
    expect(commit).not.toHaveProperty("asset");
    expect(h.allocateUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSize: "5",
        expectedSha256: query.sha256,
      }),
    );
  });
  it("uses the existing image verifier and isolates request keys by library", async () => {
    const h = harness();
    await h.service.upload(
      scope,
      id(7),
      "same",
      { ...query, mediaType: "image/png" },
      h.body,
    );
    await h.service.upload(
      scope,
      id(8),
      "same",
      { ...query, mediaType: "image/png" },
      h.body,
    );
    expect(h.imageIngest).toHaveBeenCalledTimes(2);
    expect(
      h.allocateUploadSession.mock.calls[0]?.[0].allocationRequestKey,
    ).not.toBe(h.allocateUploadSession.mock.calls[1]?.[0].allocationRequestKey);
  });
  it("does not replay a body for an already committed upload", async () => {
    const h = harness("committed");
    await h.service.upload(scope, id(7), "retry", query, h.body);
    expect(h.textIngest).not.toHaveBeenCalled();
    expect(h.commitUserImport).toHaveBeenCalledOnce();
  });
  it("rejects oversized text and stops before allocation when management is denied", async () => {
    const h = harness();
    await expect(
      h.service.upload(
        scope,
        id(7),
        "large",
        { ...query, byteSize: "131073" },
        h.body,
      ),
    ).rejects.toThrow();
    expect(h.allocateUploadSession).not.toHaveBeenCalled();
    h.authorizeUpload.mockRejectedValueOnce(new Error("denied"));
    await expect(
      h.service.upload(scope, id(7), "denied", query, h.body),
    ).rejects.toThrow("denied");
    expect(h.allocateUploadSession).not.toHaveBeenCalled();
  });
});
