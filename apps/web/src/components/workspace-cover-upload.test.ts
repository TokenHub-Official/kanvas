import { describe, expect, it, vi } from "vitest";
import {
  allocateUserImport,
  commitUserImport,
  uploadUserImport,
} from "../api/transport.js";
import { createWorkspaceCoverUploader } from "./workspace-cover-upload.js";
vi.mock("../api/transport.js", () => ({
  allocateUserImport: vi.fn(),
  commitUserImport: vi.fn(),
  uploadUserImport: vi.fn(),
}));
describe("workspace cover upload", () => {
  it("retries an uncertain commit without allocating or transferring the file again", async () => {
    vi.mocked(allocateUserImport).mockResolvedValue({
      uploadSessionId: "upload-1",
    } as Awaited<ReturnType<typeof allocateUserImport>>);
    vi.mocked(uploadUserImport).mockResolvedValue(
      {} as Awaited<ReturnType<typeof uploadUserImport>>,
    );
    vi.mocked(commitUserImport)
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ assetId: "asset-1" } as Awaited<
        ReturnType<typeof commitUserImport>
      >);
    const upload = createWorkspaceCoverUploader({
      csrfToken: "csrf",
      workspaceId: "workspace",
    });
    const file = new File(["image"], "cover.webp", { type: "image/webp" });
    await expect(upload(file, new AbortController().signal)).rejects.toThrow(
      "connection lost",
    );
    await expect(upload(file, new AbortController().signal)).resolves.toBe(
      "asset-1",
    );
    expect(allocateUserImport).toHaveBeenCalledTimes(1);
    expect(uploadUserImport).toHaveBeenCalledTimes(1);
    expect(commitUserImport).toHaveBeenCalledTimes(2);
    expect(vi.mocked(commitUserImport).mock.calls[0]?.slice(0, 3)).toEqual(
      vi.mocked(commitUserImport).mock.calls[1]?.slice(0, 3),
    );
  });
});
