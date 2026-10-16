import { afterEach, expect, it, vi } from "vitest";
import { toolRequest } from "./library-api.js";
import { createSiteCoverUploader } from "./site-cover-upload.js";
vi.mock("./library-api.js", () => ({ toolRequest: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it("retries commit with the same session without repeating binary upload", async () => {
  const put = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", put);
  vi.mocked(toolRequest)
    .mockResolvedValueOnce({ uploadSessionId: "session" })
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValueOnce({ imageId: "image" });
  const uploader = createSiteCoverUploader("csrf");
  const file = new File(["image"], "cover.png", { type: "image/png" });
  await expect(uploader(file, new AbortController().signal)).rejects.toThrow(
    "connection lost",
  );
  await expect(uploader(file, new AbortController().signal)).resolves.toBe(
    "image",
  );
  expect(put).toHaveBeenCalledOnce();
  expect(vi.mocked(toolRequest).mock.calls[1]?.[0]).toBe(
    vi.mocked(toolRequest).mock.calls[2]?.[0],
  );
});
