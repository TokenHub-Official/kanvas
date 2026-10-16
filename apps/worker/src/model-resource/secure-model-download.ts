import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { HttpsProxyAgent } from "https-proxy-agent";

import {
  createPinnedProviderLookup,
  isBlockedProviderAddress,
  type PinnedProviderAddress,
} from "../provider/provider-http-transport.js";

export type SecureModelDownloadErrorCode =
  | "model_import.invalid_url"
  | "model_import.dns_failed"
  | "model_import.private_address"
  | "model_import.too_many_redirects"
  | "model_import.http_failed"
  | "model_import.http_status"
  | "model_import.content_too_large"
  | "model_import.deadline_exceeded";

export class SecureModelDownloadError extends Error {
  public constructor(
    readonly code: SecureModelDownloadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SecureModelDownloadError";
  }
}

export interface SecureModelDownload {
  readonly body: AsyncIterable<Uint8Array>;
  readonly path: string;
  readonly sourceMetadata: Readonly<Record<string, string>>;
}

export interface SecureModelDownloadOptions {
  readonly url: string;
  readonly maximumBytes: number;
  readonly deadlineAt: Date;
  readonly lookup?: typeof dnsLookup;
  readonly request?: typeof requestHttps;
  /** Explicit deployment-owned CONNECT proxy; ambient proxy variables are ignored. */
  readonly proxyUrl?: string;
}

const maximumRedirectLocationLength = 8_192;

function fail(
  code: SecureModelDownloadErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new SecureModelDownloadError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function targetUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    return fail("model_import.invalid_url", "Model download URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port === "0"
  ) {
    return fail(
      "model_import.invalid_url",
      "Model download URL must be credential-free HTTPS.",
    );
  }
  if (isIP(url.hostname) && isBlockedProviderAddress(url.hostname)) {
    return fail(
      "model_import.private_address",
      "Model URL points to a forbidden network address.",
    );
  }
  return url;
}

function modelImportProxyAgent(
  proxyUrl: string | undefined,
): HttpsProxyAgent<string> | undefined {
  if (!proxyUrl) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    return fail(
      "model_import.invalid_url",
      "Model import proxy target is invalid.",
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    return fail(
      "model_import.invalid_url",
      "Model import proxy must be an exact HTTP(S) origin without credentials.",
    );
  }
  return new HttpsProxyAgent(parsed, { keepAlive: true });
}

export function normalizeHuggingFaceFileUrl(value: string): URL {
  const url = targetUrl(value);
  if (url.hostname.toLowerCase() !== "huggingface.co") return url;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 5 && segments[2] === "blob") {
    segments[2] = "resolve";
    url.pathname = `/${segments.join("/")}`;
  }
  return url;
}

async function pinPublicAddress(
  hostname: string,
  lookup: typeof dnsLookup,
): Promise<PinnedProviderAddress> {
  const literalFamily = isIP(hostname);
  let addresses: readonly PinnedProviderAddress[];
  try {
    addresses =
      literalFamily === 4 || literalFamily === 6
        ? [{ address: hostname, family: literalFamily }]
        : ((await lookup(hostname, {
            all: true,
            verbatim: true,
          })) as readonly PinnedProviderAddress[]);
  } catch (error) {
    return fail(
      "model_import.dns_failed",
      "Model host could not be resolved.",
      error,
    );
  }
  if (!hasOnlyPublicAddresses(addresses)) {
    return fail(
      "model_import.private_address",
      "Model URL resolved to a forbidden network address.",
    );
  }
  return Object.freeze(addresses[0] as PinnedProviderAddress);
}

export function hasOnlyPublicAddresses(
  addresses: readonly PinnedProviderAddress[],
): boolean {
  return (
    addresses.length > 0 &&
    addresses.every(
      ({ address, family }) =>
        (family === 4 || family === 6) && !isBlockedProviderAddress(address),
    )
  );
}

function boundedHeader(
  response: IncomingMessage,
  name: string,
  maximumLength = 255,
): string | undefined {
  const value = response.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" &&
    text.length > 0 &&
    text.length <= maximumLength
    ? text
    : undefined;
}

function filePath(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const huggingFaceMarker = segments[2];
  const candidate =
    url.hostname.toLowerCase() === "huggingface.co" &&
    (huggingFaceMarker === "resolve" || huggingFaceMarker === "blob")
      ? segments.slice(4).join("/")
      : segments.at(-1);
  const decoded = candidate ? decodeURIComponent(candidate) : "model.bin";
  return decoded && decoded.length <= 700 && !decoded.includes("\0")
    ? decoded
    : "model.bin";
}

async function* boundedBody(
  response: IncomingMessage,
  maximumBytes: number,
): AsyncGenerator<Uint8Array> {
  let received = 0;
  try {
    for await (const chunk of response) {
      const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      received += bytes.byteLength;
      if (received > maximumBytes) {
        response.destroy();
        return fail(
          "model_import.content_too_large",
          "Model download exceeds the configured size limit.",
        );
      }
      yield bytes;
    }
  } catch (error) {
    if (error instanceof SecureModelDownloadError) throw error;
    return fail(
      "model_import.http_failed",
      "Model download stream failed.",
      error,
    );
  } finally {
    response.destroy();
  }
}

async function openResponse(
  url: URL,
  options: SecureModelDownloadOptions,
  proxyAgent: HttpsProxyAgent<string> | undefined,
): Promise<IncomingMessage> {
  const remaining = options.deadlineAt.getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return fail(
      "model_import.deadline_exceeded",
      "Model download deadline elapsed.",
    );
  }
  const pinned = proxyAgent
    ? undefined
    : await pinPublicAddress(url.hostname, options.lookup ?? dnsLookup);
  const request = options.request ?? requestHttps;
  const signal = AbortSignal.timeout(
    Math.min(Math.max(1, Math.floor(remaining)), 2_147_483_647),
  );
  return new Promise<IncomingMessage>((resolve, reject) => {
    const outbound = request(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/octet-stream,*/*;q=0.1",
          "accept-encoding": "identity",
          "user-agent": "Kanvas-Model-Importer/1",
        },
        ...(proxyAgent
          ? { agent: proxyAgent }
          : { lookup: createPinnedProviderLookup(pinned!) }),
        signal,
      },
      resolve,
    );
    outbound.once("error", (error) => {
      reject(
        new SecureModelDownloadError(
          signal.aborted
            ? "model_import.deadline_exceeded"
            : "model_import.http_failed",
          signal.aborted
            ? "Model download deadline elapsed."
            : "Model download request failed.",
          { cause: error },
        ),
      );
    });
    outbound.end();
  });
}

export async function downloadModelResource(
  options: SecureModelDownloadOptions,
): Promise<SecureModelDownload> {
  if (
    !Number.isSafeInteger(options.maximumBytes) ||
    options.maximumBytes < 1 ||
    !(options.deadlineAt instanceof Date) ||
    !Number.isFinite(options.deadlineAt.getTime())
  ) {
    throw new TypeError("Secure model download options are invalid.");
  }
  const original = normalizeHuggingFaceFileUrl(options.url);
  const proxyAgent = modelImportProxyAgent(options.proxyUrl);
  let current = original;
  const metadata: Record<string, string> = {};
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await openResponse(current, options, proxyAgent);
    const repoCommit = boundedHeader(response, "x-repo-commit");
    if (repoCommit) metadata.huggingFaceCommit = repoCommit;
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = boundedHeader(
        response,
        "location",
        maximumRedirectLocationLength,
      );
      response.resume();
      if (!location) {
        return fail(
          "model_import.http_status",
          "Model host returned a redirect without a target.",
        );
      }
      if (redirect === 5) {
        return fail(
          "model_import.too_many_redirects",
          "Model download returned too many redirects.",
        );
      }
      current = targetUrl(new URL(location, current));
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      return fail(
        "model_import.http_status",
        `Model host returned HTTP ${String(status)}.`,
      );
    }
    const contentLength = boundedHeader(response, "content-length");
    if (
      contentLength &&
      (!/^\d+$/u.test(contentLength) ||
        BigInt(contentLength) > BigInt(options.maximumBytes))
    ) {
      response.destroy();
      return fail(
        "model_import.content_too_large",
        "Model download exceeds the configured size limit.",
      );
    }
    const contentEncoding = boundedHeader(response, "content-encoding");
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
      response.destroy();
      return fail(
        "model_import.http_status",
        "Model host returned an encoded byte stream.",
      );
    }
    const etag = boundedHeader(response, "etag");
    const lastModified = boundedHeader(response, "last-modified");
    if (etag) metadata.etag = etag;
    if (lastModified) metadata.lastModified = lastModified;
    const contentType = boundedHeader(response, "content-type");
    if (contentType)
      metadata.contentType = contentType.split(";", 1)[0]!.trim();
    return Object.freeze({
      body: boundedBody(response, options.maximumBytes),
      path: filePath(original),
      sourceMetadata: Object.freeze(metadata),
    });
  }
  return fail(
    "model_import.too_many_redirects",
    "Model download returned too many redirects.",
  );
}
