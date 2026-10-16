import { describe, expect, it, vi } from "vitest";

import {
  uploadWorkflowTestFile,
  type WorkflowTestFileUploadDependencies,
} from "./workflow-test-file-control.js";

describe("Workflow test file upload", () => {
  it("allocates, uploads and commits a local image into an Artifact", async () => {
    const allocate = vi.fn().mockResolvedValue({
      uploadSessionId: "01K00000000000000000000001",
      state: "open",
      expiresAt: "2026-08-19T00:00:00.000Z",
      maximumBytes: "1000000",
      replayed: false,
    });
    const upload = vi.fn().mockImplementation(
      async (
        _context: unknown,
        uploadSessionId: string,
        file: File,
        options: {
          readonly onProgress?: (value: {
            loadedBytes: number;
            totalBytes: number;
          }) => void;
        },
      ) => {
        options.onProgress?.({
          loadedBytes: file.size,
          totalBytes: file.size,
        });
        return Promise.resolve({
          uploadSessionId,
          state: "verified",
          replayed: false,
        });
      },
    );
    const commit = vi.fn().mockResolvedValue({
      status: "committed",
      uploadSessionId: "01K00000000000000000000001",
      storedObjectId: "01K00000000000000000000002",
      artifactId: "01K00000000000000000000003",
      contentDigest: `sha256:${"a".repeat(64)}`,
      mediaType: "image/png",
      byteSize: "5",
      committedAt: "2026-08-18T00:00:00.000Z",
    });
    const progress = vi.fn();
    const dependencies = {
      allocate,
      upload,
      commit,
    } as unknown as WorkflowTestFileUploadDependencies;

    await expect(
      uploadWorkflowTestFile({
        csrfToken: "csrf",
        workspaceId: "01K00000000000000000000000",
        file: new File(["image"], "poster.png", { type: "image/png" }),
        dependencies,
        onProgress: progress,
      }),
    ).resolves.toBe("01K00000000000000000000003");

    expect(allocate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "01K00000000000000000000000",
      }),
      { expectedMediaType: "image/png", expectedSize: "5" },
      expect.any(String),
    );
    expect(upload).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(
      expect.any(Object),
      "01K00000000000000000000001",
      expect.objectContaining({
        artifactType: "image.source",
        metadata: { importedFrom: "workflow-candidate-test" },
      }),
    );
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it("rejects file types unsupported by the trusted import endpoint", async () => {
    await expect(
      uploadWorkflowTestFile({
        csrfToken: "csrf",
        workspaceId: "01K00000000000000000000000",
        file: new File(["svg"], "poster.svg", { type: "image/svg+xml" }),
      }),
    ).rejects.toThrow(/PNG, JPEG and WebP/u);
  });
});
