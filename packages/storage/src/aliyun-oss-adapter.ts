import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { StoragePort } from "@kanvas/application";
import {
  createAliyunOssTransport,
  AliyunOssTransportError,
  type AliyunOssTransportOptions,
  type AliyunOssNativeClient,
} from "./aliyun-oss-transport.js";
import {
  createServerOwnedObjectStorageAdapter,
  S3CompatibleStorageError,
  type S3CompatibleObjectOperations,
} from "./s3-compatible-adapter.js";

/**
 * OSS has no atomic ETag-conditional delete. Permanent deletion fences prohibit
 * reusing a logical key. Every writer checks the fence before and after PUT;
 * readers never expose fenced data. The maintenance pass removes late writes
 * after ambiguous requests or process loss. Fence objects must never expire.
 * The deployment prefix must have no writers outside this protocol.
 */
export async function createAliyunOssStorageAdapter(
  options: AliyunOssTransportOptions & {
    storageProfileId: string;
    stagingDirectory?: string;
  },
  client?: AliyunOssNativeClient,
): Promise<StoragePort> {
  const transport = createAliyunOssTransport(options, client);
  await transport.assertUnversionedBucket();
  const fenceKey = (key: string) =>
    `deletions/${createHash("sha256").update(key).digest("hex")}`;
  const dataKey = (key: string) => `objects/${key}`;
  const exists = (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    error.code === "oss_storage.object_exists";
  const fail = (
    code:
      | "object_exists"
      | "object_changed"
      | "provider_failure"
      | "invalid_identity",
  ) =>
    new S3CompatibleStorageError(`s3_storage.${code}`, `OSS storage ${code}.`);
  async function fenced(key: string): Promise<boolean> {
    return Boolean(await transport.head(fenceKey(key)));
  }
  async function removeFenced(key: string): Promise<void> {
    // Only called after a durable fence is observed/created. A key can never be
    // published again after this point, including a delayed upload from old Pods.
    await transport.remove(dataKey(key));
  }
  async function createFence(key: string): Promise<void> {
    const bytes = Buffer.from(JSON.stringify({ key }));
    try {
      await transport.putNew(
        fenceKey(key),
        Readable.from([bytes]),
        bytes.length,
        {},
      );
    } catch (error) {
      if (!exists(error)) throw error;
    }
  }
  let cursor: string | undefined;
  async function reconcileCleanup(): Promise<void> {
    const page = await transport.list("deletions", cursor);
    for (const marker of page.keys) {
      if (!/^deletions\/[a-f0-9]{64}$/u.test(marker))
        throw fail("invalid_identity");
      const head = await transport.head(marker);
      if (!head) throw fail("provider_failure");
      const read = await transport.read(marker, head.headers.etag ?? "");
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of read.stream) {
        length += chunk.byteLength;
        if (length > 4096) throw fail("invalid_identity");
        chunks.push(chunk);
      }
      let key: unknown;
      try {
        const parsed: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        key =
          parsed && typeof parsed === "object" && "key" in parsed
            ? parsed.key
            : undefined;
      } catch {
        throw fail("invalid_identity");
      }
      if (typeof key !== "string" || fenceKey(key) !== marker)
        throw fail("invalid_identity");
      await removeFenced(key);
    }
    cursor = page.nextMarker;
  }
  const operations: S3CompatibleObjectOperations = {
    async putObject(request) {
      if (await fenced(request.key)) throw fail("object_exists");
      try {
        await transport.putNew(
          dataKey(request.key),
          request.body,
          request.contentLength,
          request.metadata,
        );
      } catch (error) {
        if (exists(error)) throw fail("object_exists");
        throw error;
      }
      if (await fenced(request.key)) {
        await removeFenced(request.key);
        throw fail("object_exists");
      }
    },
    async headObject(_bucket, key) {
      if (await fenced(key)) {
        await removeFenced(key);
        return undefined;
      }
      const head = await transport.head(dataKey(key));
      if (!head) return undefined;
      const metadata = Object.fromEntries(
        Object.entries(head.headers)
          .filter(([name]) => name.startsWith("x-oss-meta-"))
          .map(([name, value]) => [name.slice(11), value]),
      );
      return {
        contentLength: head.headers["content-length"] ?? "",
        etag: head.headers.etag ?? "",
        metadata,
      };
    },
    async getObject(request) {
      if (await fenced(request.key)) throw fail("object_changed");
      const read = await transport.read(
        dataKey(request.key),
        request.ifMatch,
        request.range,
      );
      return {
        body: read.stream,
        ...(read.res.headers["content-length"]
          ? { contentLength: read.res.headers["content-length"] }
          : {}),
        ...(read.res.headers["content-range"]
          ? { contentRange: read.res.headers["content-range"] }
          : {}),
      };
    },
    async deleteObject(request) {
      const wasFenced = await fenced(request.key);
      if (!wasFenced) {
        const head = await transport.head(dataKey(request.key));
        if (head && head.headers.etag !== request.ifMatch)
          throw fail("object_changed");
        const bytes = Buffer.from(JSON.stringify({ key: request.key }));
        try {
          await transport.putNew(
            fenceKey(request.key),
            Readable.from([bytes]),
            bytes.length,
            {},
          );
        } catch (error) {
          if (!exists(error)) throw error;
        }
      }
      await removeFenced(request.key);
      return { disposition: wasFenced ? "missing" : "deleted" };
    },
    async createProviderReadUrl(request) {
      if (await fenced(request.key)) throw fail("object_changed");
      const head = await transport.head(dataKey(request.key));
      if (
        head?.headers["content-type"]?.split(";")[0] !==
        request.responseContentType
      )
        throw fail("invalid_identity");
      return {
        url: transport.signRead(
          dataKey(request.key),
          request.expiresInSeconds,
          request.responseContentType,
        ),
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      };
    },
  };
  const base = createServerOwnedObjectStorageAdapter({
    kind: "oss",
    storageProfileId: options.storageProfileId,
    bucket: options.bucket,
    encryption: { mode: "none" },
    operations,
    ...(options.stagingDirectory
      ? { stagingDirectory: options.stagingDirectory }
      : {}),
  });
  async function invoke<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof S3CompatibleStorageError)
        throw new AliyunOssTransportError(
          error.code.replace("s3_storage.", "oss_storage."),
        );
      throw error;
    }
  }
  return Object.freeze({
    ...base,
    writeObject: (request) => invoke(() => base.writeObject(request)),
    sealObject: (request) => invoke(() => base.sealObject(request)),
    inspectObject: (identity) => invoke(() => base.inspectObject(identity)),
    openRead: (request) => invoke(() => base.openRead(request)),
    ...(base.createProviderReadUrl
      ? {
          createProviderReadUrl: (
            request: Parameters<
              NonNullable<StoragePort["createProviderReadUrl"]>
            >[0],
          ) => invoke(() => base.createProviderReadUrl!(request)),
        }
      : {}),
    reconcileCleanup: () => invoke(reconcileCleanup),
    async cleanupUnpublishedObject(identity) {
      // Validate profile/key through the verification core before adding a fence.
      const result = await invoke(() =>
        base.cleanupUnpublishedObject(identity),
      );
      await createFence(identity.objectKey);
      await removeFenced(identity.objectKey);
      return result;
    },
    async deleteObject(request) {
      const result = await invoke(() => base.deleteObject(request));
      await createFence(request.identity.objectKey);
      await removeFenced(request.identity.objectKey);
      return result;
    },
  } satisfies StoragePort);
}
