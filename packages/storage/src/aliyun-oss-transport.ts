import { Readable } from "node:stream";

import OSS from "ali-oss";

export interface AliyunOssTransportOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly keyPrefix: string;
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
  readonly securityToken?: string;
}

interface NativeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

// Keep the SDK's incomplete/any-heavy declarations outside the storage contract.
export interface AliyunOssNativeClient {
  delete(key: string): Promise<unknown>;
  list(query: {
    prefix: string;
    marker?: string;
    "max-keys": number;
  }): Promise<{
    objects?: { name: string }[];
    nextMarker?: string;
    isTruncated?: boolean;
  }>;
  getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }>;
  putStream(
    key: string,
    body: Readable,
    options: {
      contentLength: number;
      mime: string;
      headers: Readonly<Record<string, string>>;
      meta: Readonly<Record<string, string>>;
    },
  ): Promise<unknown>;
  head(key: string): Promise<{ res: NativeResponse }>;
  getStream(
    key: string,
    options: { headers: Readonly<Record<string, string>> },
  ): Promise<{
    stream: AsyncIterable<Uint8Array>;
    res: NativeResponse;
  }>;
  signatureUrl(
    key: string,
    options: {
      expires: number;
      response?: Readonly<Record<string, string>>;
    },
  ): string;
}

export class AliyunOssTransportError extends Error {
  constructor(readonly code: string) {
    // Do not retain SDK causes: they can contain signed URLs or request headers.
    super(code);
    this.name = "AliyunOssTransportError";
  }
}

function mappedError(error: unknown): AliyunOssTransportError {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code === "FileAlreadyExists")
    return new AliyunOssTransportError("oss_storage.object_exists");
  if (code === "NoSuchKey")
    return new AliyunOssTransportError("oss_storage.object_missing");
  if (code === "PreconditionFailed")
    return new AliyunOssTransportError("oss_storage.object_changed");
  return new AliyunOssTransportError("oss_storage.provider_failure");
}

export function createAliyunOssTransport(
  options: AliyunOssTransportOptions,
  suppliedClient?: AliyunOssNativeClient,
) {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new AliyunOssTransportError("oss_storage.invalid_endpoint");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new AliyunOssTransportError("oss_storage.invalid_endpoint");
  }
  if (
    !/^(?:[A-Za-z0-9_-]+\/)+$/u.test(options.keyPrefix) ||
    options.keyPrefix.length > 200
  ) {
    throw new AliyunOssTransportError("oss_storage.invalid_prefix");
  }
  const client =
    suppliedClient ??
    (new OSS({
      endpoint: endpoint.origin,
      region: options.region,
      bucket: options.bucket,
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      ...(options.securityToken ? { stsToken: options.securityToken } : {}),
      secure: true,
      timeout: 30_000,
    }) as unknown as AliyunOssNativeClient);
  const physicalKey = (key: string): string => {
    if (
      !key ||
      key.length > 800 ||
      key.includes("\\") ||
      [...key].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }) ||
      key
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new AliyunOssTransportError("oss_storage.invalid_key");
    }
    return options.keyPrefix + key;
  };
  return Object.freeze({
    async remove(key: string): Promise<void> {
      const path = physicalKey(key);
      try {
        await client.delete(path);
      } catch (error) {
        throw mappedError(error);
      }
    },
    async list(prefix: string, marker?: string) {
      try {
        const result = await client.list({
          prefix: physicalKey(prefix),
          "max-keys": 100,
          ...(marker ? { marker } : {}),
        });
        if (result.isTruncated && !result.nextMarker)
          throw new AliyunOssTransportError("oss_storage.invalid_listing");
        return {
          keys: (result.objects ?? []).map(({ name }) => {
            if (!name.startsWith(options.keyPrefix))
              throw new AliyunOssTransportError("oss_storage.invalid_listing");
            return name.slice(options.keyPrefix.length);
          }),
          nextMarker: result.isTruncated ? result.nextMarker : undefined,
        };
      } catch (error) {
        throw mappedError(error);
      }
    },
    async assertUnversionedBucket(): Promise<void> {
      let state: string | undefined;
      try {
        state = (await client.getBucketVersioning(options.bucket))
          .versionStatus;
      } catch (error) {
        throw mappedError(error);
      }
      if (state)
        throw new AliyunOssTransportError(
          "oss_storage.versioning_incompatible",
        );
    },
    async putNew(
      key: string,
      body: Readable,
      length: number,
      metadata: Readonly<Record<string, string>>,
    ): Promise<void> {
      const path = physicalKey(key);
      if (!Number.isSafeInteger(length) || length < 1)
        throw new AliyunOssTransportError("oss_storage.invalid_length");
      try {
        const iterator = (body as AsyncIterable<Uint8Array>)[
          Symbol.asyncIterator
        ]();
        const first: Uint8Array[] = [];
        let size = 0;
        while (size < 16) {
          const chunk = await iterator.next();
          if (chunk.done) break;
          first.push(chunk.value);
          size += chunk.value.byteLength;
        }
        const prefix = Buffer.concat(first).subarray(0, 16);
        let mime = "application/octet-stream";
        if (
          prefix
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          mime = "image/png";
        else if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
          mime = "image/jpeg";
        else if (
          prefix.toString("ascii", 0, 4) === "RIFF" &&
          prefix.toString("ascii", 8, 12) === "WEBP"
        )
          mime = "image/webp";
        const replay = Readable.from(
          (async function* () {
            try {
              yield* first;
              for (;;) {
                const next = await iterator.next();
                if (next.done) break;
                yield next.value;
              }
            } finally {
              await iterator.return?.();
            }
          })(),
        );
        try {
          await client.putStream(path, replay, {
            contentLength: length,
            mime,
            headers: { "x-oss-forbid-overwrite": "true" },
            meta: metadata,
          });
        } finally {
          replay.destroy();
          await iterator.return?.();
        }
      } catch (error) {
        throw mappedError(error);
      }
    },
    async head(key: string): Promise<NativeResponse | undefined> {
      const path = physicalKey(key);
      try {
        return (await client.head(path)).res;
      } catch (error) {
        const mapped = mappedError(error);
        if (mapped.code === "oss_storage.object_missing") return undefined;
        throw mapped;
      }
    },
    async read(key: string, etag: string, range?: string) {
      const path = physicalKey(key);
      if (
        !etag ||
        /[\r\n]/u.test(etag) ||
        (range !== undefined && !/^bytes=\d+-\d+$/u.test(range))
      )
        throw new AliyunOssTransportError("oss_storage.invalid_read");
      try {
        const result = await client.getStream(path, {
          headers: { "If-Match": etag, ...(range ? { Range: range } : {}) },
        });
        if (!result.stream || ![200, 206].includes(result.res.status))
          throw new AliyunOssTransportError(
            "oss_storage.invalid_read_response",
          );
        return result;
      } catch (error) {
        throw mappedError(error);
      }
    },
    signRead(
      key: string,
      seconds: number,
      contentType: "image/jpeg" | "image/png" | "image/webp",
    ): string {
      const path = physicalKey(key);
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 900)
        throw new AliyunOssTransportError("oss_storage.invalid_expiry");
      if (!["image/png", "image/jpeg", "image/webp"].includes(contentType))
        throw new AliyunOssTransportError("oss_storage.invalid_media_type");
      try {
        return client.signatureUrl(path, {
          expires: seconds,
        });
      } catch (error) {
        throw mappedError(error);
      }
    },
  });
}
