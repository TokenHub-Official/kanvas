import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  createAliyunOssTransport,
  type AliyunOssNativeClient,
} from "../src/aliyun-oss-transport.js";

function fixture() {
  const client = {
    delete: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue({ objects: [] }),
    getBucketVersioning: vi.fn().mockResolvedValue({}),
    putStream: vi.fn().mockResolvedValue({}),
    head: vi
      .fn()
      .mockResolvedValue({ res: { status: 200, headers: { etag: '"v1"' } } }),
    getStream: vi.fn().mockResolvedValue({
      stream: Readable.from([Buffer.from("abc")]),
      res: { status: 206, headers: {} },
    }),
    signatureUrl: vi.fn().mockReturnValue("https://objects.example/signed"),
  } satisfies AliyunOssNativeClient;
  const options = {
    endpoint: "https://objects.example",
    region: "oss-cn-test",
    bucket: "test-bucket",
    keyPrefix: "kanvas-test/",
    accessKeyId: "test",
    accessKeySecret: "secret-not-for-output",
  };
  return {
    client,
    options,
    transport: createAliyunOssTransport(options, client),
  };
}

describe("Aliyun OSS native transport", () => {
  it("uses native overwrite protection and the deployment prefix", async () => {
    const { client, transport } = fixture();
    await transport.putNew(
      "objects/a",
      Readable.from([Buffer.from("abc")]),
      3,
      {
        "kanvas-sha256": "test",
      },
    );
    expect(client.putStream).toHaveBeenCalledWith(
      "kanvas-test/objects/a",
      expect.anything(),
      {
        contentLength: 3,
        mime: "application/octet-stream",
        headers: { "x-oss-forbid-overwrite": "true" },
        meta: { "kanvas-sha256": "test" },
      },
    );
  });
  it.each(["Enabled", "Suspended"])(
    "rejects %s versioning because native forbid-overwrite is ineffective",
    async (state) => {
      const { client, transport } = fixture();
      client.getBucketVersioning.mockResolvedValueOnce({
        versionStatus: state,
      });
      await expect(transport.assertUnversionedBucket()).rejects.toThrow(
        "oss_storage.versioning_incompatible",
      );
    },
  );
  it("keeps ETag and Range conditions on reads", async () => {
    const { client, transport } = fixture();
    await transport.read("objects/a", '"v1"', "bytes=0-2");
    expect(client.getStream).toHaveBeenCalledWith("kanvas-test/objects/a", {
      headers: { "If-Match": '"v1"', Range: "bytes=0-2" },
    });
    await transport.head("objects/a");
    expect(client.head).toHaveBeenCalledWith("kanvas-test/objects/a");
  });
  it("maps missing/conflicting objects without retaining credential-bearing SDK errors", async () => {
    const { client, transport } = fixture();
    client.head.mockRejectedValueOnce({
      code: "NoSuchKey",
      message: "signed-secret",
    });
    expect(await transport.head("objects/a")).toBeUndefined();
    client.putStream.mockRejectedValueOnce({
      code: "FileAlreadyExists",
      message: "signed-secret",
    });
    await expect(
      transport.putNew("objects/a", Readable.from([Buffer.from("x")]), 1, {}),
    ).rejects.toMatchObject({ code: "oss_storage.object_exists" });
    client.head.mockRejectedValueOnce({
      code: "AccessDenied",
      message: "signed-secret",
    });
    try {
      await transport.head("objects/a");
      throw new Error("Expected failure");
    } catch (error) {
      expect(String(error)).not.toContain("signed-secret");
      expect(error).not.toHaveProperty("cause");
    }
  });
  it("signs only prefixed objects with a bounded expiry", () => {
    const { client, transport } = fixture();
    transport.signRead("objects/a", 300, "image/png");
    expect(client.signatureUrl).toHaveBeenCalledWith("kanvas-test/objects/a", {
      expires: 300,
    });
    expect(() => transport.signRead("objects/a", 901, "image/png")).toThrow(
      "oss_storage.invalid_expiry",
    );
  });
  it.each(["../a", "a/../b", "/a", "a//b", "a\\b"])(
    "rejects key escape %s",
    async (key) => {
      const { client, transport } = fixture();
      await expect(transport.head(key)).rejects.toThrow(
        "oss_storage.invalid_key",
      );
      expect(client.head).not.toHaveBeenCalled();
    },
  );
});
