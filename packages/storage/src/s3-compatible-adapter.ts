import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, mkdtemp, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { SignatureV4 } from "@smithy/signature-v4";
import type {
  StorageByteRange,
  StorageCapabilities,
  StorageDeleteRequest,
  StorageDeleteResult,
  StorageObjectIdentity,
  StorageObjectInspection,
  StoragePort,
  StorageProviderReadUrl,
  StorageProviderReadUrlRequest,
  StorageReadHandle,
  StorageReadRequest,
  StorageSealRequest,
  StorageWriteRequest,
  StorageWriteResult,
} from "@kanvas/application";

export interface S3CompatibleStaticCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

const smithyStreamingRetryWarning =
  "An error was encountered in a non-retryable streaming request.";

export function isRedundantSmithyStreamingWarning(
  content: readonly unknown[],
): boolean {
  return content.length === 1 && content[0] === smithyStreamingRetryWarning;
}

export function isExpectedStorageProbeError(
  content: readonly unknown[],
): boolean {
  if (
    content.length !== 1 ||
    !content[0] ||
    typeof content[0] !== "object" ||
    Array.isArray(content[0])
  ) {
    return false;
  }
  const event = content[0] as Readonly<Record<string, unknown>>;
  const input =
    event.input &&
    typeof event.input === "object" &&
    !Array.isArray(event.input)
      ? (event.input as Readonly<Record<string, unknown>>)
      : undefined;
  const metadata =
    event.metadata &&
    typeof event.metadata === "object" &&
    !Array.isArray(event.metadata)
      ? (event.metadata as Readonly<Record<string, unknown>>)
      : undefined;
  if (
    typeof input?.Key !== "string" ||
    !input.Key.startsWith("compatibility-probes/")
  ) {
    return false;
  }
  return (
    (event.commandName === "PutObjectCommand" &&
      input.IfNoneMatch === "*" &&
      metadata?.httpStatusCode === 412) ||
    (event.commandName === "HeadObjectCommand" &&
      metadata?.httpStatusCode === 404)
  );
}

const s3ClientLogger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: (...content: unknown[]) => {
    if (!isRedundantSmithyStreamingWarning(content)) {
      console.warn(...content);
    }
  },
  error: (...content: unknown[]) => {
    if (!isExpectedStorageProbeError(content)) {
      console.error(...content);
    }
  },
});

export type S3CompatibleEncryption =
  | Readonly<{ readonly mode: "none" }>
  | Readonly<{ readonly mode: "AES256" }>
  | Readonly<{
      readonly mode: "aws:kms";
      readonly kmsKeyId: string;
    }>;

export interface CreateAwsS3CompatibleOperationsOptions {
  readonly keyPrefix?: string;
  readonly endpoint: string;
  readonly region: string;
  readonly forcePathStyle: boolean;
  readonly credentials?: S3CompatibleStaticCredentials;
}

export interface S3CompatiblePutRequest {
  readonly bucket: string;
  readonly key: string;
  readonly body: Readable;
  readonly contentLength: number;
  readonly checksumSha256Base64: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly ifNoneMatch: "*";
  readonly encryption: S3CompatibleEncryption;
}

export interface S3CompatibleHeadResult {
  readonly contentLength: string;
  readonly etag: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface S3CompatibleGetRequest {
  readonly bucket: string;
  readonly key: string;
  readonly ifMatch: string;
  readonly range?: string;
}

export interface S3CompatibleGetResult {
  readonly body: AsyncIterable<Uint8Array>;
  readonly contentLength?: string;
  readonly contentRange?: string;
}

export interface S3CompatibleDeleteRequest {
  readonly bucket: string;
  readonly key: string;
  readonly ifMatch: string;
}

/**
 * Provider SDK objects stay behind this infrastructure-only seam. Tests and
 * alternative S3-compatible transports can implement the same bounded
 * operations without leaking AWS types into the Application storage port.
 */
export interface S3CompatibleObjectOperations {
  readonly putObject: (request: S3CompatiblePutRequest) => Promise<void>;
  readonly headObject: (
    bucket: string,
    key: string,
  ) => Promise<S3CompatibleHeadResult | undefined>;
  readonly getObject: (
    request: S3CompatibleGetRequest,
  ) => Promise<S3CompatibleGetResult>;
  readonly deleteObject: (
    request: S3CompatibleDeleteRequest,
  ) => Promise<StorageDeleteResult>;
  readonly createProviderReadUrl?: (
    request: Readonly<{
      bucket: string;
      key: string;
      responseContentType: "image/jpeg" | "image/png" | "image/webp";
      expiresInSeconds: number;
    }>,
  ) => Promise<StorageProviderReadUrl>;
  readonly close?: () => void;
}

export interface CreateS3CompatibleStorageOptions {
  readonly kind?: "s3" | "oss";
  readonly storageProfileId: string;
  readonly bucket: string;
  readonly operations: S3CompatibleObjectOperations;
  readonly encryption: S3CompatibleEncryption;
  readonly stagingDirectory?: string;
}

export interface CreateAwsS3CompatibleStorageOptions extends CreateAwsS3CompatibleOperationsOptions {
  readonly storageProfileId: string;
  readonly bucket: string;
  readonly encryption: S3CompatibleEncryption;
  readonly stagingDirectory?: string;
}

export type S3CompatibleStorageErrorCode =
  | "s3_storage.invalid_configuration"
  | "s3_storage.invalid_identity"
  | "s3_storage.object_exists"
  | "s3_storage.object_missing"
  | "s3_storage.size_limit_exceeded"
  | "s3_storage.identity_mismatch"
  | "s3_storage.object_changed"
  | "s3_storage.provider_failure";

export class S3CompatibleStorageError extends Error {
  constructor(
    readonly code: S3CompatibleStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "S3CompatibleStorageError";
  }
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const bucketPattern = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const immutableIdentityHashPattern = /^sha256:[0-9a-f]{64}$/u;
const maximumUint64 = 18_446_744_073_709_551_615n;
const maximumS3ObjectBytes = BigInt(Number.MAX_SAFE_INTEGER);
const minimumProviderReadUrlSeconds = 60;
const maximumProviderReadUrlSeconds = 900;

type SmithySourceData = string | ArrayBuffer | ArrayBufferView;

function smithySourceData(value: SmithySourceData): string | Uint8Array {
  if (typeof value === "string") {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

class NodeSha256 {
  readonly #digest;

  public constructor(secret?: SmithySourceData) {
    this.#digest = secret
      ? createHmac("sha256", smithySourceData(secret))
      : createHash("sha256");
  }

  public update(data: SmithySourceData): void {
    this.#digest.update(smithySourceData(data));
  }

  public digest(): Promise<Uint8Array> {
    return Promise.resolve(this.#digest.digest());
  }
}

function encodedObjectPath(value: string): string {
  return value.split("/").map(awsPercentEncode).join("/");
}

function awsPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function queryString(
  query: Readonly<Record<string, string | readonly string[] | null>>,
): string {
  const entries: Array<readonly [string, string]> = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === null) {
      entries.push([key, ""]);
    } else if (typeof value !== "string") {
      for (const item of value) {
        entries.push([key, item]);
      }
    } else {
      entries.push([key, value]);
    }
  }
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey === rightKey
      ? leftValue.localeCompare(rightValue)
      : leftKey.localeCompare(rightKey),
  );
  return entries
    .map(
      ([key, value]) => `${awsPercentEncode(key)}=${awsPercentEncode(value)}`,
    )
    .join("&");
}

function fail(
  code: S3CompatibleStorageErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new S3CompatibleStorageError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function parseUint64(value: string, label: string): bigint {
  if (!uint64Pattern.test(value)) {
    return fail(
      "s3_storage.invalid_identity",
      `${label} must be an unsigned decimal integer.`,
    );
  }
  const parsed = BigInt(value);
  if (parsed > maximumUint64) {
    return fail(
      "s3_storage.invalid_identity",
      `${label} exceeds the uint64 boundary.`,
    );
  }
  return parsed;
}

function parseS3ByteCount(value: string, label: string): bigint {
  const parsed = parseUint64(value, label);
  if (parsed > maximumS3ObjectBytes) {
    return fail(
      "s3_storage.size_limit_exceeded",
      `${label} exceeds the safe S3 adapter boundary.`,
    );
  }
  return parsed;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function assertIdentity(
  profileId: string,
  bucket: string,
  identity: StorageObjectIdentity,
): void {
  if (
    identity.storageProfileId !== profileId ||
    identity.container !== bucket ||
    identity.storageVersionId !== undefined ||
    identity.objectKey.length < 1 ||
    identity.objectKey.length > 800 ||
    identity.objectKey.startsWith("/") ||
    identity.objectKey.includes("\\") ||
    hasControlCharacter(identity.objectKey)
  ) {
    fail(
      "s3_storage.invalid_identity",
      "S3 object identity is invalid for this storage profile.",
    );
  }
  const segments = identity.objectKey.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.length > 255,
    )
  ) {
    fail(
      "s3_storage.invalid_identity",
      "S3 object key contains an unsafe path segment.",
    );
  }
}

function immutableIdentityHash(identity: StorageObjectIdentity): string {
  const hash = createHash("sha256")
    .update("kanvas:s3-object-identity:v1\0")
    .update(identity.storageProfileId)
    .update("\0")
    .update(identity.container)
    .update("\0")
    .update(identity.objectKey)
    .update("\0")
    .digest("hex");
  return `sha256:${hash}`;
}

function inspection(
  identity: StorageObjectIdentity,
  byteSize: string,
  sha256: string,
): StorageObjectInspection {
  return Object.freeze({
    identity: Object.freeze({ ...identity }),
    byteSize,
    sha256,
    immutableIdentityHash: immutableIdentityHash(identity),
  });
}

function assertExpectedObjectFacts(
  identity: StorageObjectIdentity,
  expectedByteSize: string,
  expectedSha256: string,
  expectedImmutableIdentityHash: string,
): bigint {
  const parsedSize = parseS3ByteCount(expectedByteSize, "Expected byte size");
  if (
    !sha256Pattern.test(expectedSha256) ||
    !immutableIdentityHashPattern.test(expectedImmutableIdentityHash) ||
    expectedImmutableIdentityHash !== immutableIdentityHash(identity)
  ) {
    return fail(
      "s3_storage.invalid_identity",
      "Committed S3 object facts are invalid for this identity.",
    );
  }
  return parsedSize;
}

function isAsyncByteBody(value: unknown): value is AsyncIterable<Uint8Array> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const iterator = (value as { readonly [Symbol.asyncIterator]?: unknown })[
    Symbol.asyncIterator
  ];
  return typeof iterator === "function";
}

function httpStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  const metadata = (error as { readonly $metadata?: unknown }).$metadata;
  if (metadata === null || typeof metadata !== "object") {
    return undefined;
  }
  const status = (metadata as { readonly httpStatusCode?: unknown })
    .httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

function normalizeEtag(value: string | undefined): string {
  const etag = value?.trim();
  if (!etag || etag.length > 512 || hasControlCharacter(etag)) {
    return fail(
      "s3_storage.identity_mismatch",
      "S3-compatible storage did not return a usable object ETag.",
    );
  }
  return etag;
}

function normalizedMetadata(
  value: Record<string, string> | undefined,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    result[key.toLowerCase()] = item;
  }
  return Object.freeze(result);
}

export function createAwsS3CompatibleOperations(
  options: CreateAwsS3CompatibleOperationsOptions,
): S3CompatibleObjectOperations {
  const prefix = options.keyPrefix ?? "";
  if (
    prefix &&
    (!/^(?:[A-Za-z0-9_-]+\/)+$/u.test(prefix) || prefix.length > 200)
  )
    throw new Error("Invalid S3 key prefix.");
  const physicalKey = (key: string): string => prefix + key;
  const staticCredentials = options.credentials;
  const client = new S3Client({
    logger: s3ClientLogger,
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    ...(staticCredentials
      ? {
          credentials: {
            accessKeyId: staticCredentials.accessKeyId,
            secretAccessKey: staticCredentials.secretAccessKey,
            ...(staticCredentials.sessionToken
              ? {
                  sessionToken: staticCredentials.sessionToken,
                }
              : {}),
          },
        }
      : {}),
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return Object.freeze({
    async putObject(request: S3CompatiblePutRequest) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: request.bucket,
            Key: physicalKey(request.key),
            Body: request.body,
            ContentLength: request.contentLength,
            ChecksumSHA256: request.checksumSha256Base64,
            Metadata: request.metadata,
            IfNoneMatch: request.ifNoneMatch,
            ...(request.encryption.mode === "AES256"
              ? { ServerSideEncryption: "AES256" }
              : {}),
            ...(request.encryption.mode === "aws:kms"
              ? {
                  ServerSideEncryption: "aws:kms",
                  SSEKMSKeyId: request.encryption.kmsKeyId,
                }
              : {}),
          }),
        );
      } catch (error) {
        const status = httpStatus(error);
        if (status === 409 || status === 412) {
          return fail(
            "s3_storage.object_exists",
            "S3 conditional create rejected an existing object identity.",
            error,
          );
        }
        return fail(
          "s3_storage.provider_failure",
          "S3-compatible object write failed.",
          error,
        );
      }
    },

    async headObject(bucket: string, key: string) {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: physicalKey(key),
          }),
        );
        if (
          result.ContentLength === undefined ||
          !Number.isSafeInteger(result.ContentLength) ||
          result.ContentLength < 0
        ) {
          return fail(
            "s3_storage.identity_mismatch",
            "S3-compatible storage returned an invalid object size.",
          );
        }
        return Object.freeze({
          contentLength: String(result.ContentLength),
          etag: normalizeEtag(result.ETag),
          metadata: normalizedMetadata(result.Metadata),
        });
      } catch (error) {
        if (error instanceof S3CompatibleStorageError) {
          throw error;
        }
        if (httpStatus(error) === 404) {
          return undefined;
        }
        return fail(
          "s3_storage.provider_failure",
          "S3-compatible object inspection failed.",
          error,
        );
      }
    },

    async getObject(request: S3CompatibleGetRequest) {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: request.bucket,
            Key: physicalKey(request.key),
            IfMatch: request.ifMatch,
            ...(request.range ? { Range: request.range } : {}),
          }),
        );
        if (!isAsyncByteBody(result.Body)) {
          return fail(
            "s3_storage.provider_failure",
            "S3-compatible object read returned no byte stream.",
          );
        }
        return Object.freeze({
          body: result.Body,
          ...(result.ContentLength === undefined
            ? {}
            : { contentLength: String(result.ContentLength) }),
          ...(result.ContentRange ? { contentRange: result.ContentRange } : {}),
        });
      } catch (error) {
        if (error instanceof S3CompatibleStorageError) {
          throw error;
        }
        const status = httpStatus(error);
        if (status === 404) {
          return fail(
            "s3_storage.object_missing",
            "S3 object is missing.",
            error,
          );
        }
        if (status === 412) {
          return fail(
            "s3_storage.object_changed",
            "S3 object changed before the conditional read.",
            error,
          );
        }
        return fail(
          "s3_storage.provider_failure",
          "S3-compatible object read failed.",
          error,
        );
      }
    },

    async deleteObject(request: S3CompatibleDeleteRequest) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: request.bucket,
            Key: physicalKey(request.key),
            IfMatch: request.ifMatch,
          }),
        );
        return Object.freeze({ disposition: "deleted" });
      } catch (error) {
        const status = httpStatus(error);
        if (status === 404) {
          return Object.freeze({ disposition: "missing" });
        }
        if (status === 412) {
          return fail(
            "s3_storage.object_changed",
            "S3 object changed before conditional deletion.",
            error,
          );
        }
        return fail(
          "s3_storage.provider_failure",
          "S3-compatible object deletion failed.",
          error,
        );
      }
    },

    ...(staticCredentials
      ? {
          async createProviderReadUrl(request: {
            readonly bucket: string;
            readonly key: string;
            readonly responseContentType:
              "image/jpeg" | "image/png" | "image/webp";
            readonly expiresInSeconds: number;
          }): Promise<StorageProviderReadUrl> {
            if (
              !Number.isSafeInteger(request.expiresInSeconds) ||
              request.expiresInSeconds < minimumProviderReadUrlSeconds ||
              request.expiresInSeconds > maximumProviderReadUrlSeconds
            ) {
              return fail(
                "s3_storage.invalid_identity",
                "Provider read URL lifetime is outside its safety boundary.",
              );
            }
            const endpoint = new URL(options.endpoint);
            const hostname = options.forcePathStyle
              ? endpoint.hostname
              : `${request.bucket}.${endpoint.hostname}`;
            const path = options.forcePathStyle
              ? `/${awsPercentEncode(
                  request.bucket,
                )}/${encodedObjectPath(physicalKey(request.key))}`
              : `/${encodedObjectPath(physicalKey(request.key))}`;
            const port = endpoint.port ? Number(endpoint.port) : undefined;
            const hostHeader = endpoint.port
              ? `${hostname}:${endpoint.port}`
              : hostname;
            const signer = new SignatureV4({
              credentials: staticCredentials,
              region: options.region,
              service: "s3",
              sha256: NodeSha256,
              uriEscapePath: false,
              applyChecksum: false,
            });
            const signingDate = new Date();
            const signed = await signer.presign(
              {
                method: "GET",
                protocol: endpoint.protocol,
                hostname,
                ...(port === undefined ? {} : { port }),
                path,
                query: {
                  "response-content-type": request.responseContentType,
                },
                headers: {
                  host: hostHeader,
                  "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
                },
              },
              {
                expiresIn: request.expiresInSeconds,
                signingDate,
                hoistableHeaders: new Set(["x-amz-content-sha256"]),
              },
            );
            const query = queryString(
              signed.query as Readonly<
                Record<string, string | readonly string[] | null>
              >,
            );
            return Object.freeze({
              url: `${signed.protocol}//${hostHeader}${signed.path}${
                query ? `?${query}` : ""
              }`,
              expiresAt: new Date(
                signingDate.getTime() + request.expiresInSeconds * 1000,
              ),
            });
          },
        }
      : {}),

    close() {
      client.destroy();
    },
  });
}

interface SpooledObject {
  readonly directory: string;
  readonly path: string;
  readonly byteSize: string;
  readonly sha256: string;
  readonly sha256Base64: string;
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten < 1) {
      return fail(
        "s3_storage.provider_failure",
        "S3 staging write made no progress.",
      );
    }
    offset += result.bytesWritten;
  }
}

async function spoolObject(
  body: AsyncIterable<Uint8Array>,
  maximum: bigint,
  stagingDirectory: string,
): Promise<SpooledObject> {
  let directory: string | undefined;
  let handle: FileHandle | undefined;
  try {
    directory = await mkdtemp(join(stagingDirectory, "kanvas-s3-write-"));
    const path = join(directory, "payload");
    handle = await open(path, "wx", 0o600);
    const digest = createHash("sha256");
    let size = 0n;
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) {
        return fail(
          "s3_storage.provider_failure",
          "S3 storage body yielded a non-byte chunk.",
        );
      }
      size += BigInt(chunk.byteLength);
      if (size > maximum) {
        return fail(
          "s3_storage.size_limit_exceeded",
          "S3 object exceeds its allocated byte limit.",
        );
      }
      digest.update(chunk);
      await writeAll(handle, chunk);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    const binaryDigest = digest.digest();
    return Object.freeze({
      directory,
      path,
      byteSize: size.toString(),
      sha256: binaryDigest.toString("hex"),
      sha256Base64: binaryDigest.toString("base64"),
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    if (error instanceof S3CompatibleStorageError) {
      throw error;
    }
    return fail(
      "s3_storage.provider_failure",
      "Could not stage a bounded S3 object upload.",
      error,
    );
  }
}

async function hashBody(
  body: AsyncIterable<Uint8Array>,
  maximum: bigint,
): Promise<Readonly<{ byteSize: string; sha256: string }>> {
  const digest = createHash("sha256");
  let size = 0n;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      return fail(
        "s3_storage.provider_failure",
        "S3-compatible read yielded a non-byte chunk.",
      );
    }
    size += BigInt(chunk.byteLength);
    if (size > maximum) {
      return fail(
        "s3_storage.size_limit_exceeded",
        "S3-compatible object exceeds its bounded identity.",
      );
    }
    digest.update(chunk);
  }
  return Object.freeze({
    byteSize: size.toString(),
    sha256: digest.digest("hex"),
  });
}

function normalizedRange(
  range: StorageByteRange | undefined,
  size: bigint,
): Readonly<{ start: bigint; end: bigint }> {
  if (!range) {
    return Object.freeze({
      start: 0n,
      end: size === 0n ? -1n : size - 1n,
    });
  }
  const start = parseS3ByteCount(range.start, "Range start");
  const end = parseS3ByteCount(range.endInclusive, "Range end");
  if (start > end || end >= size) {
    return fail(
      "s3_storage.invalid_identity",
      "Requested byte range is outside the S3 object.",
    );
  }
  return Object.freeze({ start, end });
}

function capabilitiesFor(
  encryption: S3CompatibleEncryption,
): StorageCapabilities {
  let serverSideEncryption: StorageCapabilities["serverSideEncryption"] =
    "customer_managed";
  if (encryption.mode === "none") {
    serverSideEncryption = "not_provided";
  } else if (encryption.mode === "AES256") {
    serverSideEncryption = "provider_managed";
  }
  return Object.freeze({
    uploadModes: Object.freeze(["server_stream"] as const),
    writeProtectionModes: Object.freeze(["server_owned"] as const),
    multipart: false,
    fullObjectChecksum: true,
    rangeRead: true,
    versionBoundIdentity: false,
    sealedIdentityImmutable: true,
    deploymentScope: "distributed",
    maximumObjectBytes: maximumS3ObjectBytes.toString(),
    serverSideEncryption,
  });
}

export function createServerOwnedObjectStorageAdapter(
  options: CreateS3CompatibleStorageOptions,
): StoragePort {
  const stagingDirectory = options.stagingDirectory ?? tmpdir();
  if (
    !idPattern.test(options.storageProfileId) ||
    !bucketPattern.test(options.bucket) ||
    !isAbsolute(stagingDirectory) ||
    (options.encryption.mode === "aws:kms" &&
      (options.encryption.kmsKeyId.length < 1 ||
        options.encryption.kmsKeyId.length > 2_048 ||
        hasControlCharacter(options.encryption.kmsKeyId)))
  ) {
    return fail(
      "s3_storage.invalid_configuration",
      "S3-compatible storage configuration is invalid.",
    );
  }
  const adapter: StoragePort = {
    storageProfileId: options.storageProfileId,
    kind: options.kind ?? "s3",
    capabilities: capabilitiesFor(options.encryption),

    async writeObject(
      request: StorageWriteRequest,
    ): Promise<StorageWriteResult> {
      assertIdentity(
        options.storageProfileId,
        options.bucket,
        request.identity,
      );
      const maximum = parseS3ByteCount(request.maximumBytes, "Maximum bytes");
      const spooled = await spoolObject(
        request.body,
        maximum,
        stagingDirectory,
      );
      try {
        await options.operations.putObject({
          bucket: options.bucket,
          key: request.identity.objectKey,
          body: createReadStream(spooled.path),
          contentLength: Number(spooled.byteSize),
          checksumSha256Base64: spooled.sha256Base64,
          metadata: Object.freeze({
            "kanvas-byte-size": spooled.byteSize,
            "kanvas-sha256": spooled.sha256,
          }),
          ifNoneMatch: "*",
          encryption: options.encryption,
        });
        const found = await adapter.inspectObject(request.identity);
        if (
          !found ||
          found.byteSize !== spooled.byteSize ||
          found.sha256 !== spooled.sha256
        ) {
          return fail(
            "s3_storage.identity_mismatch",
            "S3-compatible object did not match its uploaded byte identity.",
          );
        }
        return Object.freeze({
          ...found,
          writeProtectionMode: "server_owned",
        });
      } finally {
        await rm(spooled.directory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    },

    async sealObject(
      request: StorageSealRequest,
    ): Promise<StorageObjectInspection> {
      if (!sha256Pattern.test(request.expectedSha256)) {
        return fail(
          "s3_storage.invalid_identity",
          "Expected object digest is invalid.",
        );
      }
      parseS3ByteCount(request.expectedByteSize, "Expected byte size");
      const found = await adapter.inspectObject(request.identity);
      if (!found) {
        return fail(
          "s3_storage.object_missing",
          "S3 object is missing at seal.",
        );
      }
      if (
        found.byteSize !== request.expectedByteSize ||
        found.sha256 !== request.expectedSha256
      ) {
        return fail(
          "s3_storage.identity_mismatch",
          "S3 object does not match the seal facts.",
        );
      }
      return found;
    },

    async inspectObject(
      identity: StorageObjectIdentity,
    ): Promise<StorageObjectInspection | undefined> {
      assertIdentity(options.storageProfileId, options.bucket, identity);
      const head = await options.operations.headObject(
        options.bucket,
        identity.objectKey,
      );
      if (!head) {
        return undefined;
      }
      const expectedSize = parseS3ByteCount(
        head.contentLength,
        "S3 object size",
      );
      const metadataSize = head.metadata["kanvas-byte-size"];
      const metadataSha256 = head.metadata["kanvas-sha256"];
      if (
        metadataSize !== head.contentLength ||
        metadataSha256 === undefined ||
        !sha256Pattern.test(metadataSha256)
      ) {
        return fail(
          "s3_storage.identity_mismatch",
          "S3 object is missing its Kanvas byte identity metadata.",
        );
      }
      const read = await options.operations.getObject({
        bucket: options.bucket,
        key: identity.objectKey,
        ifMatch: head.etag,
      });
      const hashed = await hashBody(read.body, expectedSize);
      if (
        hashed.byteSize !== head.contentLength ||
        hashed.sha256 !== metadataSha256
      ) {
        return fail(
          "s3_storage.identity_mismatch",
          "S3 object bytes do not match their immutable metadata.",
        );
      }
      return inspection(identity, hashed.byteSize, hashed.sha256);
    },

    async openRead(request: StorageReadRequest): Promise<StorageReadHandle> {
      assertIdentity(
        options.storageProfileId,
        options.bucket,
        request.identity,
      );
      const expectedSize = assertExpectedObjectFacts(
        request.identity,
        request.expectedByteSize,
        request.expectedSha256,
        request.expectedImmutableIdentityHash,
      );
      const head = await options.operations.headObject(
        options.bucket,
        request.identity.objectKey,
      );
      if (!head) {
        return fail("s3_storage.object_missing", "S3 object is missing.");
      }
      const full = await options.operations.getObject({
        bucket: options.bucket,
        key: request.identity.objectKey,
        ifMatch: head.etag,
      });
      const hashed = await hashBody(full.body, expectedSize);
      if (
        hashed.byteSize !== expectedSize.toString() ||
        hashed.sha256 !== request.expectedSha256 ||
        head.contentLength !== expectedSize.toString() ||
        head.metadata["kanvas-byte-size"] !== expectedSize.toString() ||
        head.metadata["kanvas-sha256"] !== request.expectedSha256
      ) {
        return fail(
          "s3_storage.identity_mismatch",
          "S3 object no longer matches committed size and digest facts.",
        );
      }
      const range = normalizedRange(request.range, expectedSize);
      const contentSize =
        range.end < range.start ? 0n : range.end - range.start + 1n;
      const opened = await options.operations.getObject({
        bucket: options.bucket,
        key: request.identity.objectKey,
        ifMatch: head.etag,
        ...(request.range
          ? {
              range: `bytes=${range.start.toString()}-${range.end.toString()}`,
            }
          : {}),
      });
      if (
        opened.contentLength !== undefined &&
        opened.contentLength !== contentSize.toString()
      ) {
        return fail(
          "s3_storage.object_changed",
          "S3-compatible range response returned an unexpected size.",
        );
      }
      return Object.freeze({
        identity: Object.freeze({ ...request.identity }),
        totalByteSize: expectedSize.toString(),
        contentByteSize: contentSize.toString(),
        ...(request.range
          ? {
              range: Object.freeze({
                start: range.start.toString(),
                endInclusive: range.end.toString(),
              }),
            }
          : {}),
        body: opened.body,
      });
    },

    ...(options.operations.createProviderReadUrl
      ? {
          async createProviderReadUrl(
            request: StorageProviderReadUrlRequest,
          ): Promise<StorageProviderReadUrl> {
            assertIdentity(
              options.storageProfileId,
              options.bucket,
              request.identity,
            );
            assertExpectedObjectFacts(
              request.identity,
              request.expectedByteSize,
              request.expectedSha256,
              request.expectedImmutableIdentityHash,
            );
            return options.operations.createProviderReadUrl!({
              bucket: options.bucket,
              key: request.identity.objectKey,
              responseContentType: request.responseContentType,
              expiresInSeconds: request.expiresInSeconds,
            });
          },
        }
      : {}),

    async deleteObject(
      request: StorageDeleteRequest,
    ): Promise<StorageDeleteResult> {
      assertIdentity(
        options.storageProfileId,
        options.bucket,
        request.identity,
      );
      const expectedSize = assertExpectedObjectFacts(
        request.identity,
        request.expectedByteSize,
        request.expectedSha256,
        request.expectedImmutableIdentityHash,
      );
      const head = await options.operations.headObject(
        options.bucket,
        request.identity.objectKey,
      );
      if (!head) {
        return Object.freeze({ disposition: "missing" });
      }
      const read = await options.operations.getObject({
        bucket: options.bucket,
        key: request.identity.objectKey,
        ifMatch: head.etag,
      });
      const hashed = await hashBody(read.body, expectedSize);
      if (
        hashed.byteSize !== expectedSize.toString() ||
        hashed.sha256 !== request.expectedSha256 ||
        head.metadata["kanvas-byte-size"] !== expectedSize.toString() ||
        head.metadata["kanvas-sha256"] !== request.expectedSha256
      ) {
        return fail(
          "s3_storage.identity_mismatch",
          "S3 object no longer matches committed delete facts.",
        );
      }
      return options.operations.deleteObject({
        bucket: options.bucket,
        key: request.identity.objectKey,
        ifMatch: head.etag,
      });
    },

    async cleanupUnpublishedObject(identity) {
      assertIdentity(options.storageProfileId, options.bucket, identity);
      const head = await options.operations.headObject(
        options.bucket,
        identity.objectKey,
      );
      if (!head) {
        return Object.freeze({ disposition: "missing" });
      }
      return options.operations.deleteObject({
        bucket: options.bucket,
        key: identity.objectKey,
        ifMatch: head.etag,
      });
    },
    ...(options.operations.close
      ? {
          close() {
            options.operations.close?.();
          },
        }
      : {}),
  };
  return Object.freeze(adapter);
}

// Compatibility export for existing S3 callers; the verification core above is
// transport-neutral and is also used by the native OSS provider.
export const createS3CompatibleStorageAdapter =
  createServerOwnedObjectStorageAdapter;

export function createAwsS3CompatibleStorageAdapter(
  options: CreateAwsS3CompatibleStorageOptions,
): StoragePort {
  return createServerOwnedObjectStorageAdapter({
    storageProfileId: options.storageProfileId,
    bucket: options.bucket,
    encryption: options.encryption,
    operations: createAwsS3CompatibleOperations(options),
    ...(options.stagingDirectory
      ? { stagingDirectory: options.stagingDirectory }
      : {}),
  });
}
