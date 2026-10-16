import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";

import type { StorageObjectIdentity } from "@kanvas/application";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAwsS3CompatibleOperations,
  createS3CompatibleStorageAdapter,
  runStorageCompatibilityProbe,
  S3CompatibleStorageError,
  type S3CompatibleDeleteRequest,
  type S3CompatibleGetRequest,
  type S3CompatibleObjectOperations,
  type S3CompatiblePutRequest,
} from "../src/index.js";
import {
  isExpectedStorageProbeError,
  isRedundantSmithyStreamingWarning,
} from "../src/s3-compatible-adapter.js";

const profileId = "01K00000000000000000000001";
const bucket = "kanvas-test-objects";
const identity: StorageObjectIdentity = Object.freeze({
  storageProfileId: profileId,
  container: bucket,
  objectKey: "workspaces/example/object.bin",
});
const roots: string[] = [];

interface MemoryObject {
  bytes: Buffer;
  etag: string;
  metadata: Readonly<Record<string, string>>;
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createMemoryOperations(): {
  readonly operations: S3CompatibleObjectOperations;
  readonly objects: Map<string, MemoryObject>;
  readonly puts: S3CompatiblePutRequest[];
  readonly close: ReturnType<typeof vi.fn>;
} {
  const objects = new Map<string, MemoryObject>();
  const puts: S3CompatiblePutRequest[] = [];
  const close = vi.fn();
  let etagSequence = 0;
  return {
    objects,
    puts,
    close,
    operations: Object.freeze({
      async putObject(request: S3CompatiblePutRequest) {
        puts.push(request);
        if (objects.has(request.key)) {
          throw new S3CompatibleStorageError(
            "s3_storage.object_exists",
            "conditional create conflict",
          );
        }
        const bytes = await collect(request.body);
        if (bytes.byteLength !== request.contentLength) {
          throw new Error("invalid content length");
        }
        const checksum = createHash("sha256").update(bytes).digest("base64");
        if (checksum !== request.checksumSha256Base64) {
          throw new Error("invalid checksum");
        }
        etagSequence += 1;
        objects.set(request.key, {
          bytes,
          etag: `"etag-${etagSequence}"`,
          metadata: request.metadata,
        });
      },
      headObject(_bucket: string, key: string) {
        const object = objects.get(key);
        return Promise.resolve(
          object
            ? Object.freeze({
                contentLength: String(object.bytes.byteLength),
                etag: object.etag,
                metadata: object.metadata,
              })
            : undefined,
        );
      },
      getObject(request: S3CompatibleGetRequest) {
        const object = objects.get(request.key);
        if (!object) {
          throw new S3CompatibleStorageError(
            "s3_storage.object_missing",
            "missing",
          );
        }
        if (object.etag !== request.ifMatch) {
          throw new S3CompatibleStorageError(
            "s3_storage.object_changed",
            "etag mismatch",
          );
        }
        let bytes = object.bytes;
        if (request.range) {
          const match = /^bytes=([0-9]+)-([0-9]+)$/u.exec(request.range);
          if (!match) {
            throw new Error("invalid test range");
          }
          bytes = bytes.subarray(Number(match[1]), Number(match[2]) + 1);
        }
        return Promise.resolve(
          Object.freeze({
            body: Readable.from([bytes]),
            contentLength: String(bytes.byteLength),
            ...(request.range
              ? {
                  contentRange: `${request.range.replace(
                    "bytes=",
                    "bytes ",
                  )}/${object.bytes.byteLength}`,
                }
              : {}),
          }),
        );
      },
      deleteObject(request: S3CompatibleDeleteRequest) {
        const object = objects.get(request.key);
        if (!object) {
          return Promise.resolve(
            Object.freeze({ disposition: "missing" as const }),
          );
        }
        if (object.etag !== request.ifMatch) {
          throw new S3CompatibleStorageError(
            "s3_storage.object_changed",
            "etag mismatch",
          );
        }
        objects.delete(request.key);
        return Promise.resolve(
          Object.freeze({ disposition: "deleted" as const }),
        );
      },
      close,
    }),
  };
}

function chunks(value: string): AsyncIterable<Uint8Array> {
  return Readable.from([Buffer.from(value)]);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("S3-compatible server-owned storage adapter", () => {
  it("suppresses only Smithy's redundant streaming retry warning", () => {
    expect(
      isRedundantSmithyStreamingWarning([
        "An error was encountered in a non-retryable streaming request.",
      ]),
    ).toBe(true);
    expect(
      isRedundantSmithyStreamingWarning(["A different storage warning."]),
    ).toBe(false);
  });

  it("suppresses only expected compatibility-probe errors", () => {
    expect(
      isExpectedStorageProbeError([
        {
          commandName: "PutObjectCommand",
          input: {
            Key: "compatibility-probes/probe-id",
            IfNoneMatch: "*",
          },
          metadata: { httpStatusCode: 412 },
        },
      ]),
    ).toBe(true);
    expect(
      isExpectedStorageProbeError([
        {
          commandName: "HeadObjectCommand",
          input: { Key: "compatibility-probes/probe-id" },
          metadata: { httpStatusCode: 404 },
        },
      ]),
    ).toBe(true);
    expect(
      isExpectedStorageProbeError([
        {
          commandName: "HeadObjectCommand",
          input: { Key: "workspaces/example/object.bin" },
          metadata: { httpStatusCode: 404 },
        },
      ]),
    ).toBe(false);
  });

  it("creates a bounded SigV4 HTTPS URL for provider egress without exposing credentials", async () => {
    const operations = createAwsS3CompatibleOperations({
      endpoint: "https://s3.us-west-1.amazonaws.com",
      region: "us-west-1",
      forcePathStyle: false,
      keyPrefix: "kanvas-test/",
      credentials: {
        accessKeyId: "AKIATESTONLY",
        secretAccessKey: "test-secret-that-must-not-appear",
      },
    });
    try {
      const signed = await operations.createProviderReadUrl?.({
        bucket: "example-bucket",
        key: "objects/source image.png",
        responseContentType: "image/png",
        expiresInSeconds: 900,
      });
      expect(signed?.url).toMatch(
        /^https:\/\/example-bucket\.s3\.us-west-1\.amazonaws\.com\/kanvas-test\/objects\/source%20image\.png\?/u,
      );
      const url = new URL(signed!.url);
      expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
      expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
      expect(url.searchParams.get("x-amz-content-sha256")).toBe(
        "UNSIGNED-PAYLOAD",
      );
      expect(url.searchParams.get("response-content-type")).toBe("image/png");
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(
        /^[0-9a-f]{64}$/u,
      );
      expect(signed?.url).not.toContain("test-secret-that-must-not-appear");
    } finally {
      operations.close?.();
    }
  });

  it("passes the generic immutable identity compatibility probe", async () => {
    const memory = createMemoryOperations();
    const adapter = createS3CompatibleStorageAdapter({
      storageProfileId: profileId,
      bucket,
      operations: memory.operations,
      encryption: { mode: "AES256" },
    });

    await expect(
      runStorageCompatibilityProbe(adapter, bucket),
    ).resolves.toMatchObject({
      adapterInitialized: true,
      serverOwnedWrite: true,
      sameKeyReplayRejected: true,
      immutableSealRecovery: true,
      fullObjectChecksum: true,
      rangeRead: true,
      idempotentExactDelete: true,
      distributedProfile: true,
      serverSideEncryptionConfigured: true,
    });
    expect(memory.objects.size).toBe(0);
    expect(memory.puts[0]?.ifNoneMatch).toBe("*");
    expect(memory.puts[0]?.encryption).toEqual({
      mode: "AES256",
    });
    await adapter.close?.();
    expect(memory.close).toHaveBeenCalledOnce();
  });

  it("spools bounded bytes, rejects same-key replay, verifies ranges, and deletes exactly", async () => {
    const staging = await mkdtemp(join(tmpdir(), "kanvas-s3-stage-test-"));
    roots.push(staging);
    const memory = createMemoryOperations();
    const adapter = createS3CompatibleStorageAdapter({
      storageProfileId: profileId,
      bucket,
      operations: memory.operations,
      encryption: { mode: "none" },
      stagingDirectory: staging,
    });
    const written = await adapter.writeObject({
      identity,
      maximumBytes: "64",
      body: chunks("hello world"),
    });

    expect(written).toMatchObject({
      byteSize: "11",
      sha256: createHash("sha256").update("hello world").digest("hex"),
      writeProtectionMode: "server_owned",
    });
    expect(await readdir(staging)).toEqual([]);
    await expect(
      adapter.writeObject({
        identity,
        maximumBytes: "64",
        body: chunks("replacement"),
      }),
    ).rejects.toMatchObject({
      code: "s3_storage.object_exists",
    });
    expect(await readdir(staging)).toEqual([]);

    const range = await adapter.openRead({
      identity,
      expectedByteSize: written.byteSize,
      expectedSha256: written.sha256,
      expectedImmutableIdentityHash: written.immutableIdentityHash,
      range: { start: "6", endInclusive: "10" },
    });
    expect((await collect(range.body)).toString()).toBe("world");
    await expect(
      adapter.deleteObject({
        identity,
        expectedByteSize: written.byteSize,
        expectedSha256: written.sha256,
        expectedImmutableIdentityHash: written.immutableIdentityHash,
      }),
    ).resolves.toEqual({ disposition: "deleted" });
    await expect(
      adapter.deleteObject({
        identity,
        expectedByteSize: written.byteSize,
        expectedSha256: written.sha256,
        expectedImmutableIdentityHash: written.immutableIdentityHash,
      }),
    ).resolves.toEqual({ disposition: "missing" });
  });

  it("detects provider-side byte replacement before reads or exact deletion", async () => {
    const memory = createMemoryOperations();
    const adapter = createS3CompatibleStorageAdapter({
      storageProfileId: profileId,
      bucket,
      operations: memory.operations,
      encryption: { mode: "none" },
    });
    const written = await adapter.writeObject({
      identity,
      maximumBytes: "32",
      body: chunks("first"),
    });
    memory.objects.set(identity.objectKey, {
      bytes: Buffer.from("other"),
      etag: '"tampered"',
      metadata: {
        "kanvas-byte-size": written.byteSize,
        "kanvas-sha256": written.sha256,
      },
    });

    const exact = {
      identity,
      expectedByteSize: written.byteSize,
      expectedSha256: written.sha256,
      expectedImmutableIdentityHash: written.immutableIdentityHash,
    };
    await expect(adapter.openRead(exact)).rejects.toMatchObject({
      code: "s3_storage.identity_mismatch",
    });
    await expect(adapter.deleteObject(exact)).rejects.toMatchObject({
      code: "s3_storage.identity_mismatch",
    });
    expect(memory.objects.has(identity.objectKey)).toBe(true);
  });

  it("fails closed on unsafe identities and allocated size overflow", async () => {
    const memory = createMemoryOperations();
    const adapter = createS3CompatibleStorageAdapter({
      storageProfileId: profileId,
      bucket,
      operations: memory.operations,
      encryption: { mode: "none" },
    });

    await expect(
      adapter.inspectObject({
        ...identity,
        objectKey: "../escape",
      }),
    ).rejects.toMatchObject({
      code: "s3_storage.invalid_identity",
    });
    await expect(
      adapter.writeObject({
        identity,
        maximumBytes: "9007199254740992",
        body: chunks(""),
      }),
    ).rejects.toMatchObject({
      code: "s3_storage.size_limit_exceeded",
    });
  });
});

it("prefixes every S3 transport operation", async () => {
  const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
    ETag: '"tag"',
    ContentLength: 1,
    Metadata: {},
    Body: Readable.from([Buffer.from("x")]),
  } as never);
  const ops = createAwsS3CompatibleOperations({
    endpoint: "https://s3.example",
    region: "test",
    forcePathStyle: true,
    keyPrefix: "kanvas-test/",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  try {
    await ops.putObject({
      bucket,
      key: "probe",
      body: Readable.from([Buffer.from("x")]),
      contentLength: 1,
      checksumSha256Base64: "",
      metadata: {},
      ifNoneMatch: "*",
      encryption: { mode: "none" },
    });
    await ops.headObject(bucket, "probe");
    await ops.getObject({ bucket, key: "probe", ifMatch: '"tag"' });
    await ops.deleteObject({ bucket, key: "probe", ifMatch: '"tag"' });
    expect(send).toHaveBeenCalledTimes(4);
    for (const [command] of send.mock.calls)
      expect((command as { input: { Key: string } }).input.Key).toBe(
        "kanvas-test/probe",
      );
  } finally {
    send.mockRestore();
    ops.close?.();
  }
});
