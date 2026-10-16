import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createAliyunOssStorageAdapter } from "../src/aliyun-oss-adapter.js";
import { runStorageCompatibilityProbe } from "../src/storage-compatibility-probe.js";
import type { AliyunOssNativeClient } from "../src/aliyun-oss-transport.js";

function fixture() {
  const objects = new Map<
    string,
    { body: Buffer; headers: Record<string, string> }
  >();
  let beforeWrite: (() => Promise<void>) | undefined;
  let failDelete = false;
  const client: AliyunOssNativeClient = {
    getBucketVersioning() {
      return Promise.resolve({});
    },
    async putStream(key, stream, options) {
      const chunks: Buffer[] = [];
      for await (const c of stream as AsyncIterable<Uint8Array>)
        chunks.push(Buffer.from(c));
      const body = Buffer.concat(chunks);
      if (key.includes("/objects/") && beforeWrite) await beforeWrite();
      if (
        objects.has(key) &&
        options.headers["x-oss-forbid-overwrite"] === "true"
      )
        throw Object.assign(new Error("conflict"), {
          code: "FileAlreadyExists",
        });
      objects.set(key, {
        body,
        headers: {
          etag: '"' + createHash("md5").update(body).digest("hex") + '"',
          "content-length": String(body.length),
          "content-type": options.mime,
          ...Object.fromEntries(
            Object.entries(options.meta).map(([k, v]) => [
              "x-oss-meta-" + k,
              v,
            ]),
          ),
        },
      });
    },
    head(key) {
      const value = objects.get(key);
      if (!value)
        throw Object.assign(new Error("missing"), { code: "NoSuchKey" });
      return Promise.resolve({ res: { status: 200, headers: value.headers } });
    },
    getStream(key, { headers }) {
      const value = objects.get(key);
      if (!value)
        throw Object.assign(new Error("missing"), { code: "NoSuchKey" });
      if (headers["If-Match"] !== value.headers.etag)
        throw Object.assign(new Error("changed"), {
          code: "PreconditionFailed",
        });
      let body = value.body;
      let responseHeaders = { ...value.headers };
      if (headers.Range) {
        const [start, end] = headers.Range.slice(6).split("-").map(Number);
        body = body.subarray(start, (end ?? 0) + 1);
        responseHeaders = {
          ...responseHeaders,
          "content-length": String(body.length),
          "content-range": `bytes ${start}-${end}/${value.body.length}`,
        };
      }
      return Promise.resolve({
        stream: Readable.from([body]),
        res: { status: headers.Range ? 206 : 200, headers: responseHeaders },
      });
    },
    delete(key) {
      if (failDelete)
        throw Object.assign(new Error("unavailable"), {
          code: "ServiceUnavailable",
        });
      objects.delete(key);
      return Promise.resolve();
    },
    list({ prefix }) {
      return Promise.resolve({
        objects: [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name })),
        isTruncated: false,
      });
    },
    signatureUrl(key) {
      return "https://objects.example/" + key + "?signature=test";
    },
  };
  const options = {
    storageProfileId: "01K00000000000000000000001",
    bucket: "test-bucket",
    endpoint: "https://objects.example",
    region: "oss-cn-test",
    keyPrefix: "kanvas-test/",
    accessKeyId: "test",
    accessKeySecret: "test",
  };
  return {
    client,
    objects,
    options,
    setBeforeWrite: (f: () => Promise<void>) => {
      beforeWrite = f;
    },
    setFailDelete: (v: boolean) => {
      failDelete = v;
    },
  };
}

describe("native OSS provider lifecycle", () => {
  it("reconciles a late upload left behind after the uploader loses its process", async () => {
    const f = fixture();
    const a = await createAliyunOssStorageAdapter(f.options, f.client);
    const identity = {
      storageProfileId: f.options.storageProfileId,
      container: f.options.bucket,
      objectKey: "lost-process",
    };
    await a.cleanupUnpublishedObject(identity);
    // Model a server-side completion whose client process no longer exists to
    // perform the post-PUT fence check. No API read may expose these bytes.
    f.objects.set("kanvas-test/objects/lost-process", {
      body: Buffer.from("late"),
      headers: { etag: '"late"', "content-length": "4" },
    });
    const restarted = await createAliyunOssStorageAdapter(f.options, f.client);
    await restarted.reconcileCleanup?.();
    expect(f.objects.has("kanvas-test/objects/lost-process")).toBe(false);
    await expect(
      restarted.writeObject({
        identity,
        body: Readable.from([Buffer.from("new")]),
        maximumBytes: "3",
      }),
    ).rejects.toMatchObject({ code: "oss_storage.object_exists" });
  });
  it("allows only one of two competing creates to publish the same key", async () => {
    const f = fixture();
    const a = await createAliyunOssStorageAdapter(f.options, f.client);
    const identity = {
      storageProfileId: f.options.storageProfileId,
      container: f.options.bucket,
      objectKey: "concurrent",
    };
    const results = await Promise.allSettled(
      ["one", "two"].map((text) =>
        a.writeObject({
          identity,
          body: Readable.from([Buffer.from(text)]),
          maximumBytes: "3",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await a.inspectObject(identity)).toBeDefined();
  });
  it("passes the complete storage probe and preserves deletion fences", async () => {
    const f = fixture();
    const adapter = await createAliyunOssStorageAdapter(f.options, f.client);
    expect(adapter.kind).toBe("oss");
    await expect(
      runStorageCompatibilityProbe(adapter, f.options.bucket),
    ).resolves.toMatchObject({
      sameKeyReplayRejected: true,
      rangeRead: true,
      idempotentExactDelete: true,
    });
    expect(
      [...f.objects.keys()].every((k) =>
        k.startsWith("kanvas-test/deletions/"),
      ),
    ).toBe(true);
  });
  it("keeps a failed physical deletion recoverable after provider restart", async () => {
    const f = fixture();
    const a = await createAliyunOssStorageAdapter(f.options, f.client);
    const identity = {
      storageProfileId: f.options.storageProfileId,
      container: f.options.bucket,
      objectKey: "file",
    };
    const written = await a.writeObject({
      identity,
      body: Readable.from([Buffer.from("abc")]),
      maximumBytes: "3",
    });
    f.setFailDelete(true);
    await expect(
      a.deleteObject({
        identity,
        expectedByteSize: written.byteSize,
        expectedSha256: written.sha256,
        expectedImmutableIdentityHash: written.immutableIdentityHash,
      }),
    ).rejects.toThrow();
    f.setFailDelete(false);
    const restarted = await createAliyunOssStorageAdapter(f.options, f.client);
    await restarted.reconcileCleanup?.();
    expect(await restarted.inspectObject(identity)).toBeUndefined();
    await expect(
      restarted.writeObject({
        identity,
        body: Readable.from([Buffer.from("xyz")]),
        maximumBytes: "3",
      }),
    ).rejects.toMatchObject({ code: "oss_storage.object_exists" });
  });
  it("rejects a delayed write when cleanup fences the absent object", async () => {
    const f = fixture();
    const a = await createAliyunOssStorageAdapter(f.options, f.client);
    const identity = {
      storageProfileId: f.options.storageProfileId,
      container: f.options.bucket,
      objectKey: "late",
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.setBeforeWrite(async () => {
      entered();
      await gate;
    });
    const write = a.writeObject({
      identity,
      body: Readable.from([Buffer.from("abc")]),
      maximumBytes: "3",
    });
    const rejected = expect(write).rejects.toMatchObject({
      code: "oss_storage.object_exists",
    });
    await started;
    await a.cleanupUnpublishedObject(identity);
    release();
    await rejected;
    expect(await a.inspectObject(identity)).toBeUndefined();
    expect(f.objects.has("kanvas-test/objects/late")).toBe(false);
  });
  it("never deletes an object when the expected content facts differ", async () => {
    const f = fixture();
    const a = await createAliyunOssStorageAdapter(f.options, f.client);
    const identity = {
      storageProfileId: f.options.storageProfileId,
      container: f.options.bucket,
      objectKey: "protected",
    };
    const written = await a.writeObject({
      identity,
      body: Readable.from([Buffer.from("abc")]),
      maximumBytes: "3",
    });
    await expect(
      a.deleteObject({
        identity,
        expectedByteSize: "3",
        expectedSha256: "sha256:" + "0".repeat(64),
        expectedImmutableIdentityHash: written.immutableIdentityHash,
      }),
    ).rejects.toThrow();
    expect(f.objects.has("kanvas-test/objects/protected")).toBe(true);
    expect([...f.objects.keys()].some((k) => k.includes("/deletions/"))).toBe(
      false,
    );
  });
});
