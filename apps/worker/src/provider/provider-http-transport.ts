import { lookup as dnsLookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { TLSSocket } from "node:tls";
import { HttpsProxyAgent } from "https-proxy-agent";

import {
  ProviderAdapterCallError,
  ProviderAdapterContractError,
} from "./provider-adapter.js";

const maximumHeaderValueLength = 8_192;
const headerNamePattern = /^[a-z0-9][a-z0-9-]{0,79}$/u;

export interface ProviderResultTimeouts {
  /** Bound one address so another validated address still has time to run. */
  readonly addressMs?: number;
  readonly progressWindowMs?: number;
  readonly minimumBytesPerSecond?: number;
  /** Includes TCP, proxy negotiation and TLS establishment. */
  readonly connectMs: number;
  readonly headersMs: number;
  readonly firstByteMs: number;
  readonly idleMs: number;
}

export interface ProviderResultPolicyContext {
  readonly invocationId?: string;
  readonly workspaceId: string;
  readonly providerEndpointId: string;
}
export interface ProviderResultPolicySnapshot {
  readonly version: number | null;
  readonly source?: "environment" | "instance";
  readonly enabled: boolean;
  readonly allowedOrigins: readonly string[] | null;
}
export interface ProviderHttpTransportOptions {
  readonly recordResultPolicyDecision?: (decision: {
    context: ProviderResultPolicyContext;
    origin: string;
    version: number | null;
    source: "environment" | "instance";
    outcome: string;
  }) => Promise<void>;
  readonly resolveResultPolicy?: (
    context: ProviderResultPolicyContext,
  ) => Promise<ProviderResultPolicySnapshot>;
  /** Result-body phase limits; never applied to generation POSTs or text streams. */
  readonly resultTimeouts?: ProviderResultTimeouts;
  /** Optional operator restriction on API endpoints from validated execution contexts. */
  readonly allowedOrigins?: readonly string[];
  readonly resultDownloadsEnabled?: boolean;
  readonly resultAllowedOrigins?: readonly string[];
  /**
   * Explicit CONNECT proxy used as a deployment trust boundary. Ambient
   * HTTP_PROXY/HTTPS_PROXY variables are intentionally ignored.
   */
  readonly proxyUrl?: string;
  readonly allowPrivateNetworks: boolean;
  readonly allowHttp: boolean;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly lookup?: typeof dnsLookup;
}

export interface ProviderHttpRequest {
  readonly onResultPolicyResolved?: (
    policy: ProviderResultPolicySnapshot | undefined,
  ) => Promise<void>;
  readonly resultPolicyContext?: ProviderResultPolicyContext;
  /** API calls must use the validated execution-context endpoint, never task input.
   * Remote output URLs must select targetKind: provider_result. */
  readonly baseUrl: string;
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /**
   * Bounded, already-encoded request payload for protocol surfaces such as
   * multipart image edits. It is mutually exclusive with `body`.
   */
  readonly binaryBody?: Uint8Array;
  readonly contentType?: string;
  /**
   * Provider control-plane calls default to bounded JSON. Generated assets
   * may opt into bounded binary bytes, while keeping the same origin
   * allowlist, DNS pinning, redirect rejection and deadline enforcement.
   */
  readonly responseMode?: "json" | "binary" | "stream";
  readonly onData?: (chunk: Uint8Array) => "complete" | void;
  /** Selects the independent deployment trust boundary for remote outputs. */
  readonly targetKind?: "provider_api" | "provider_result";
  readonly deadlineAt: Date;
  readonly signal: AbortSignal;
}

export interface ProviderHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ProviderHttpTransport {
  /** Applies the same URL policy before persisting a user-visible result link. */
  isResultUrlAllowed?(value: string): boolean;
  request(options: ProviderHttpRequest): Promise<ProviderHttpResponse>;
}

export interface PinnedProviderAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export function createPinnedProviderLookup(
  pinned: PinnedProviderAddress,
): LookupFunction {
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [
        {
          address: pinned.address,
          family: pinned.family,
        },
      ]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function transportFailure(
  stableErrorCode: string,
  effect: "not_started" | "unknown",
  cause?: unknown,
): never {
  const error = new ProviderAdapterCallError(stableErrorCode, effect);
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
    });
  }
  throw error;
}

function assertLimit(value: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${field} is outside its supported range.`);
  }
}

function parseIpv4(address: string): readonly number[] | undefined {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return undefined;
  }
  const parsed = octets.map((octet) => Number(octet));
  if (
    parsed.some(
      (octet, index) =>
        !Number.isSafeInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== octets[index],
    )
  ) {
    return undefined;
  }
  return parsed;
}

function parseIpv6(address: string): bigint | undefined {
  const withoutZone = address.split("%", 1)[0]?.toLowerCase();
  if (!withoutZone || isIP(withoutZone) !== 6) {
    return undefined;
  }
  let normalized = withoutZone;
  const lastColon = normalized.lastIndexOf(":");
  const possibleIpv4 = normalized.slice(lastColon + 1);
  if (possibleIpv4.includes(".")) {
    const octets = parseIpv4(possibleIpv4);
    if (!octets) {
      return undefined;
    }
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    normalized = `${normalized.slice(0, lastColon)}:${high.toString(
      16,
    )}:${low.toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return undefined;
  }
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return undefined;
  }
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)),
    0n,
  );
}

function inIpv4Range(
  octets: readonly number[],
  network: number,
  prefix: number,
): boolean {
  const value =
    (((octets[0] ?? 0) << 24) |
      ((octets[1] ?? 0) << 16) |
      ((octets[2] ?? 0) << 8) |
      (octets[3] ?? 0)) >>>
    0;
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) {
    return true;
  }
  const blocked: readonly [number, number][] = [
    [0x0000_0000, 8],
    [0x0a00_0000, 8],
    [0x6440_0000, 10],
    [0x7f00_0000, 8],
    [0xa9fe_0000, 16],
    [0xac10_0000, 12],
    [0xc000_0000, 24],
    [0xc000_0200, 24],
    [0xc0a8_0000, 16],
    [0xc612_0000, 15],
    [0xc633_6400, 24],
    [0xcb00_7100, 24],
    [0xe000_0000, 4],
    [0xf000_0000, 4],
  ];
  return blocked.some(([network, prefix]) =>
    inIpv4Range(octets, network, prefix),
  );
}

function isBlockedIpv6(address: string): boolean {
  const value = parseIpv6(address);
  if (value === undefined) {
    return true;
  }
  if (value === 0n || value === 1n) {
    return true;
  }
  const inPrefix = (network: bigint, prefix: number): boolean =>
    value >> BigInt(128 - prefix) === network >> BigInt(128 - prefix);
  if (
    inPrefix(0xfc00n << 112n, 7) ||
    inPrefix(0xfe80n << 112n, 10) ||
    inPrefix(0xff00n << 112n, 8) ||
    inPrefix(0x20010db8n << 96n, 32)
  ) {
    return true;
  }
  const mappedPrefix = 0x0000_0000_0000_0000_0000_ffffn;
  if (value >> 32n === mappedPrefix) {
    const mapped = Number(value & 0xffff_ffffn);
    const mappedAddress = [
      (mapped >>> 24) & 0xff,
      (mapped >>> 16) & 0xff,
      (mapped >>> 8) & 0xff,
      mapped & 0xff,
    ].join(".");
    return isBlockedIpv4(mappedAddress);
  }
  return false;
}

export function isBlockedProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isBlockedIpv4(address);
  }
  if (family === 6) {
    return isBlockedIpv6(address);
  }
  return true;
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (
      !headerNamePattern.test(lowerName) ||
      value.length < 1 ||
      value.length > maximumHeaderValueLength ||
      /[\r\n\0]/u.test(value) ||
      lowerName === "host" ||
      lowerName === "content-length" ||
      lowerName === "connection" ||
      lowerName === "transfer-encoding"
    ) {
      return contract("Provider HTTP header is invalid or reserved.");
    }
    normalized[lowerName] = value;
  }
  return Object.freeze(normalized);
}

function resolveUrl(
  baseUrl: string,
  path: string,
  allowedOrigins: ReadonlySet<string> | undefined,
  resultDownloadsEnabled: boolean,
  resultAllowedOrigins: ReadonlySet<string> | undefined,
  targetKind: "provider_api" | "provider_result",
  allowHttp: boolean,
): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return contract("Provider base URL is invalid.");
  }
  if (
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    !path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return contract("Provider HTTP target is invalid.");
  }
  if (base.protocol !== "https:" && !(allowHttp && base.protocol === "http:")) {
    return contract("Provider HTTP target uses a forbidden protocol.");
  }
  if (targetKind === "provider_result") {
    if (!resultDownloadsEnabled) {
      return transportFailure(
        "provider.output_download_disabled",
        "not_started",
      );
    }
    if (resultAllowedOrigins && !resultAllowedOrigins.has(base.origin)) {
      return transportFailure(
        "provider.output_origin_not_allowed",
        "not_started",
      );
    }
  } else if (allowedOrigins && !allowedOrigins.has(base.origin)) {
    return contract("Provider origin is not in the deployment allowlist.");
  }
  const basePath = base.pathname.replace(/\/+$/u, "");
  const target = new URL(`${basePath}${path}`, base.origin);
  if (target.origin !== base.origin) {
    return contract("Provider target escaped its pinned origin.");
  }
  return target;
}

function providerProxyAgent(
  proxyUrl: string | undefined,
): HttpsProxyAgent<string> | undefined {
  if (!proxyUrl) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    return contract("Provider proxy target is invalid.");
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
  ) {
    return contract(
      "Provider proxy must be an exact HTTP(S) origin without credentials.",
    );
  }
  return new HttpsProxyAgent(parsed, {
    keepAlive: true,
  });
}

async function pinAddress(
  hostname: string,
  allowPrivateNetworks: boolean,
  lookup: typeof dnsLookup,
  attempted: Set<string>,
): Promise<PinnedProviderAddress> {
  let addresses: readonly PinnedProviderAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    addresses = [
      {
        address: hostname,
        family: literalFamily,
      },
    ];
  } else {
    try {
      addresses = (await lookup(hostname, {
        all: true,
        verbatim: true,
      })) as readonly PinnedProviderAddress[];
    } catch (error) {
      return transportFailure(
        "provider.transport_dns_failed",
        "not_started",
        error,
      );
    }
  }
  if (addresses.length < 1) {
    return transportFailure("provider.transport_dns_empty", "not_started");
  }
  if (
    addresses.some(
      ({ address, family }) =>
        (family !== 4 && family !== 6) ||
        (!allowPrivateNetworks && isBlockedProviderAddress(address)),
    )
  ) {
    return transportFailure(
      "provider.transport_address_forbidden",
      "not_started",
    );
  }
  const selected = addresses.find(
    ({ address, family }) => !attempted.has(`${family}:${address}`),
  );
  if (!selected)
    return transportFailure(
      "provider.transport_addresses_exhausted",
      "not_started",
    );
  attempted.add(`${selected.family}:${selected.address}`);
  return Object.freeze(selected);
}

async function pinAddressWithinDeadline(
  target: URL,
  options: ProviderHttpTransportOptions,
  lookup: typeof dnsLookup,
  request: ProviderHttpRequest,
  attempted: Set<string>,
): Promise<PinnedProviderAddress> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
    };
    const fail = (code: string): void => {
      cleanup();
      reject(new ProviderAdapterCallError(code, "not_started"));
    };
    const onAbort = (): void => fail("provider.transport_aborted");
    const remainingMs = request.deadlineAt.getTime() - Date.now();
    const timer = setTimeout(
      () => fail("provider.transport_deadline_exceeded"),
      Math.min(Math.max(1, remainingMs), 2_147_483_647),
    );
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) {
      onAbort();
      return;
    }
    // The OS lookup is not cancellable. A late answer is ignored and can never
    // open a socket after the enclosing request has expired.
    void pinAddress(
      target.hostname,
      options.allowPrivateNetworks,
      lookup,
      attempted,
    ).then(
      (address) => {
        cleanup();
        resolve(address);
      },
      (error: unknown) => {
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new ProviderAdapterCallError(
                "provider.transport_dns_failed",
                "not_started",
              ),
        );
      },
    );
  });
}

function decodeResponseHeaders(
  headers: NodeJS.Dict<string | string[] | undefined>,
): Readonly<Record<string, string>> {
  const decoded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      decoded[name.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      decoded[name.toLowerCase()] = value.join(", ");
    }
  }
  return Object.freeze(decoded);
}

function serializeBody(
  request: Pick<ProviderHttpRequest, "body" | "binaryBody" | "contentType">,
  maximumRequestBytes: number,
): {
  readonly encodedBody?: Buffer;
  readonly contentType?: string;
} {
  if (request.body !== undefined && request.binaryBody !== undefined) {
    return contract(
      "Provider request cannot contain both JSON and binary bodies.",
    );
  }
  if (request.binaryBody !== undefined) {
    if (
      !request.contentType ||
      request.contentType.length > maximumHeaderValueLength ||
      /[\r\n\0]/u.test(request.contentType)
    ) {
      return contract(
        "Provider binary request requires a bounded content type.",
      );
    }
    const encodedBody = Buffer.from(request.binaryBody);
    if (encodedBody.byteLength > maximumRequestBytes) {
      encodedBody.fill(0);
      return contract("Provider request body exceeds the configured limit.");
    }
    return {
      encodedBody,
      contentType: request.contentType,
    };
  }
  if (request.contentType !== undefined) {
    return contract("Provider content type is only valid with a binary body.");
  }
  if (request.body === undefined) {
    return {};
  }
  let encoded: Buffer;
  try {
    encoded = Buffer.from(JSON.stringify(request.body), "utf8");
  } catch {
    return contract("Provider request body is not JSON serializable.");
  }
  if (encoded.byteLength > maximumRequestBytes) {
    encoded.fill(0);
    return contract("Provider request body exceeds the configured limit.");
  }
  return {
    encodedBody: encoded,
    contentType: "application/json",
  };
}

function parseResponseBody(
  body: Buffer,
  contentType: string | undefined,
  responseMode: "json" | "binary",
): unknown {
  if (responseMode === "binary") {
    return Buffer.from(body);
  }
  if (
    !contentType
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase()
      .match(/^(?:application\/json|application\/[^/+]+\+json)$/u)
  ) {
    return transportFailure("provider.transport_non_json_response", "unknown");
  }
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch (error) {
    return transportFailure(
      "provider.transport_invalid_json_response",
      "unknown",
      error,
    );
  }
}

export function createProviderHttpTransport(
  options: ProviderHttpTransportOptions,
): ProviderHttpTransport {
  assertLimit(options.maximumRequestBytes, 67_108_864, "maximumRequestBytes");
  assertLimit(
    options.maximumResponseBytes,
    134_217_728,
    "maximumResponseBytes",
  );
  const allowedOrigins =
    options.allowedOrigins === undefined
      ? undefined
      : new Set(options.allowedOrigins.map((origin) => new URL(origin).origin));
  const resultAllowedOrigins =
    options.resultAllowedOrigins === undefined
      ? undefined
      : new Set(
          options.resultAllowedOrigins.map((origin) => new URL(origin).origin),
        );
  if (
    resultAllowedOrigins?.size === 0 &&
    options.resultDownloadsEnabled !== false
  ) {
    throw new RangeError(
      "At least one result origin must be allowed when a restriction is supplied.",
    );
  }
  if (allowedOrigins && allowedOrigins.size < 1) {
    throw new RangeError("At least one Provider origin must be allowed.");
  }
  if (options.resultTimeouts) {
    for (const name of [
      "addressMs",
      "progressWindowMs",
      "minimumBytesPerSecond",
    ] as const) {
      const value = options.resultTimeouts[name];
      if (value !== undefined)
        assertLimit(value, 2_147_483_647, `resultTimeouts.${name}`);
    }
    for (const name of [
      "connectMs",
      "headersMs",
      "firstByteMs",
      "idleMs",
    ] as const) {
      assertLimit(
        options.resultTimeouts[name],
        2_147_483_647,
        `resultTimeouts.${name}`,
      );
    }
  }
  const lookup = options.lookup ?? dnsLookup;
  const proxyAgent = providerProxyAgent(options.proxyUrl);

  const direct = {
    async request(
      requestOptions: ProviderHttpRequest,
      attempted: Set<string>,
      policy?: ProviderResultPolicySnapshot,
    ): Promise<ProviderHttpResponse> {
      requestOptions.signal.throwIfAborted();
      let effectiveOrigins = resultAllowedOrigins;
      if (policy)
        effectiveOrigins =
          policy.allowedOrigins === null
            ? undefined
            : new Set(policy.allowedOrigins);
      const target = resolveUrl(
        requestOptions.baseUrl,
        requestOptions.path,
        allowedOrigins,
        (options.resultDownloadsEnabled ?? true) && (policy?.enabled ?? true),
        effectiveOrigins,
        requestOptions.targetKind ?? "provider_api",
        options.allowHttp,
      );
      const remainingMs = requestOptions.deadlineAt.getTime() - Date.now();
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        return transportFailure(
          "provider.transport_deadline_exceeded",
          "not_started",
        );
      }
      const pinned = proxyAgent
        ? undefined
        : await pinAddressWithinDeadline(
            target,
            options,
            lookup,
            requestOptions,
            attempted,
          );
      requestOptions.signal.throwIfAborted();
      const remainingAfterDnsMs =
        requestOptions.deadlineAt.getTime() - Date.now();
      if (remainingAfterDnsMs <= 0) {
        return transportFailure(
          "provider.transport_deadline_exceeded",
          "not_started",
        );
      }
      const phaseLimits =
        requestOptions.targetKind === "provider_result" &&
        requestOptions.responseMode === "binary"
          ? options.resultTimeouts
          : undefined;
      const headers = normalizeHeaders(requestOptions.headers);
      if (
        requestOptions.targetKind === "provider_result" &&
        ["authorization", "cookie", "proxy-authorization"].some(
          (name) => name in headers,
        )
      ) {
        return contract(
          "Provider result downloads must not forward credentials.",
        );
      }
      const serializedBody = serializeBody(
        requestOptions,
        options.maximumRequestBytes,
      );
      const encodedBody = serializedBody.encodedBody;
      const client = target.protocol === "https:" ? requestHttps : requestHttp;

      try {
        return await new Promise<ProviderHttpResponse>((resolve, reject) => {
          let requestStarted = false;
          let settled = false;
          let streamController:
            ReadableStreamDefaultController<Uint8Array> | undefined;
          const deadlineTimerRef: {
            current?: ReturnType<typeof setTimeout>;
          } = {};
          let phaseTimer: ReturnType<typeof setTimeout> | undefined;
          let addressTimer: ReturnType<typeof setTimeout> | undefined;
          let progressTimer: ReturnType<typeof setInterval> | undefined;
          const clearTimers = (): void => {
            if (deadlineTimerRef.current)
              clearTimeout(deadlineTimerRef.current);
            if (phaseTimer) clearTimeout(phaseTimer);
            if (addressTimer) clearTimeout(addressTimer);
            if (progressTimer) clearInterval(progressTimer);
          };
          const setPhase = (
            duration: number | undefined,
            code: string,
          ): void => {
            if (phaseTimer) clearTimeout(phaseTimer);
            if (duration === undefined || settled) return;
            phaseTimer = setTimeout(() => {
              failOnce(code, requestStarted ? "unknown" : "not_started");
              outbound.destroy();
            }, duration);
          };
          const failOnce = (
            code: string,
            effect: "not_started" | "unknown",
            cause?: unknown,
          ): void => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimers();
            const error = new ProviderAdapterCallError(code, effect);
            if (cause !== undefined) {
              Object.defineProperty(error, "cause", {
                configurable: true,
                enumerable: false,
                value: cause,
              });
            }
            reject(error);
          };
          const outbound = client(
            target,
            {
              method: requestOptions.method,
              headers: {
                ...headers,
                ...(encodedBody
                  ? {
                      "content-type": serializedBody.contentType,
                      "content-length": String(encodedBody.byteLength),
                    }
                  : {}),
              },
              ...(proxyAgent
                ? { agent: proxyAgent }
                : {
                    lookup: createPinnedProviderLookup(pinned!),
                  }),
              signal: requestOptions.signal,
            },
            (response) => {
              setPhase(
                phaseLimits?.firstByteMs,
                "provider.transport_first_byte_timeout",
              );
              const statusCode = response.statusCode;
              if (!statusCode) {
                failOnce("provider.transport_status_missing", "unknown");
                return;
              }
              if (statusCode >= 300 && statusCode < 400) {
                failOnce("provider.transport_redirect_forbidden", "unknown");
                return;
              }
              if (requestOptions.responseMode === "stream") {
                let total = 0;
                const body = new ReadableStream<Uint8Array>({
                  start(controller) {
                    streamController = controller;
                    const close = (): void => {
                      if (!streamController) return;
                      streamController.close();
                      streamController = undefined;
                      if (deadlineTimerRef.current) {
                        clearTimeout(deadlineTimerRef.current);
                      }
                    };
                    const fail = (code: string, cause?: unknown): void => {
                      if (!streamController) return;
                      const error = new ProviderAdapterCallError(
                        code,
                        "unknown",
                      );
                      if (cause !== undefined) {
                        Object.defineProperty(error, "cause", {
                          configurable: true,
                          enumerable: false,
                          value: cause,
                        });
                      }
                      streamController.error(error);
                      streamController = undefined;
                      if (deadlineTimerRef.current) {
                        clearTimeout(deadlineTimerRef.current);
                      }
                    };
                    response.on("data", (chunk: Buffer | string) => {
                      const value = Buffer.isBuffer(chunk)
                        ? chunk
                        : Buffer.from(chunk);
                      total += value.byteLength;
                      if (total > options.maximumResponseBytes) {
                        fail("provider.transport_response_too_large");
                        response.destroy();
                        return;
                      }
                      controller.enqueue(new Uint8Array(value));
                    });
                    response.once("error", (error) => {
                      fail(
                        requestOptions.signal.aborted
                          ? "provider.transport_aborted"
                          : "provider.transport_response_failed",
                        error,
                      );
                    });
                    response.once("aborted", () => {
                      fail(
                        requestOptions.signal.aborted
                          ? "provider.transport_aborted"
                          : "provider.transport_response_failed",
                      );
                    });
                    response.once("end", close);
                  },
                  cancel() {
                    streamController = undefined;
                    if (deadlineTimerRef.current) {
                      clearTimeout(deadlineTimerRef.current);
                    }
                    response.destroy();
                  },
                });
                settled = true;
                resolve(
                  Object.freeze({
                    statusCode,
                    headers: decodeResponseHeaders(response.headers),
                    body,
                  }),
                );
                return;
              }
              const chunks: Buffer[] = [];
              let total = 0;
              if (phaseLimits) {
                const windowMs = phaseLimits.progressWindowMs ?? 15_000;
                const minimumRate = phaseLimits.minimumBytesPerSecond ?? 1024;
                let previousTotal = 0;
                let previousAt = Date.now();
                progressTimer = setInterval(() => {
                  const at = Date.now();
                  const bytes = total - previousTotal;
                  if (bytes * 1000 < minimumRate * (at - previousAt)) {
                    failOnce("provider.transport_slow_transfer", "unknown");
                    response.destroy();
                    outbound.destroy();
                  }
                  previousTotal = total;
                  previousAt = at;
                }, windowMs);
              }
              const finishResponse = (): void => {
                if (settled) return;
                const body = Buffer.concat(chunks);
                let decoded: unknown;
                try {
                  decoded = parseResponseBody(
                    body,
                    response.headers["content-type"],
                    requestOptions.responseMode === "binary"
                      ? "binary"
                      : "json",
                  );
                } catch (error) {
                  clearTimers();
                  reject(
                    error instanceof Error
                      ? error
                      : new ProviderAdapterCallError(
                          "provider.transport_invalid_response",
                          "unknown",
                        ),
                  );
                  settled = true;
                  return;
                } finally {
                  body.fill(0);
                }
                settled = true;
                clearTimers();
                resolve(
                  Object.freeze({
                    statusCode,
                    headers: decodeResponseHeaders(response.headers),
                    body: decoded,
                  }),
                );
              };
              response.on("data", (chunk: Buffer | string) => {
                const value = Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(chunk);
                total += value.byteLength;
                if (total > options.maximumResponseBytes) {
                  response.destroy();
                  failOnce("provider.transport_response_too_large", "unknown");
                  return;
                }
                if (value.byteLength > 0) {
                  setPhase(
                    phaseLimits?.idleMs,
                    "provider.transport_idle_timeout",
                  );
                }
                chunks.push(value);
                if (requestOptions.onData?.(value) === "complete") {
                  finishResponse();
                  response.destroy();
                }
              });
              response.once("error", (error) => {
                failOnce(
                  "provider.transport_response_failed",
                  "unknown",
                  error,
                );
              });
              response.once("end", finishResponse);
            },
          );
          setPhase(
            phaseLimits?.connectMs,
            "provider.transport_connect_timeout",
          );
          if (phaseLimits) {
            addressTimer = setTimeout(() => {
              failOnce(
                "provider.transport_address_timeout",
                requestStarted ? "unknown" : "not_started",
              );
              outbound.destroy();
            }, phaseLimits.addressMs ?? 60_000);
          }
          if (phaseLimits) {
            outbound.once("socket", (socket) => {
              const connected = (): void =>
                setPhase(
                  phaseLimits.headersMs,
                  "provider.transport_headers_timeout",
                );
              if (target.protocol === "https:") {
                if (
                  socket instanceof TLSSocket &&
                  socket.authorized &&
                  !socket.connecting
                )
                  connected();
                else socket.once("secureConnect", connected);
              } else if (socket.connecting) {
                socket.once("connect", connected);
              } else {
                connected();
              }
            });
          }
          deadlineTimerRef.current = setTimeout(
            () => {
              outbound.destroy();
              if (streamController) {
                streamController.error(
                  new ProviderAdapterCallError(
                    "provider.transport_deadline_exceeded",
                    "unknown",
                  ),
                );
                streamController = undefined;
                return;
              }
              failOnce(
                "provider.transport_deadline_exceeded",
                requestStarted ? "unknown" : "not_started",
              );
            },
            Math.min(
              Math.max(1, Math.floor(remainingAfterDnsMs)),
              2_147_483_647,
            ),
          );
          outbound.once("finish", () => {
            requestStarted = true;
          });
          outbound.once("error", (error) => {
            failOnce(
              requestOptions.signal.aborted
                ? "provider.transport_aborted"
                : "provider.transport_failed",
              requestStarted ? "unknown" : "not_started",
              error,
            );
          });
          if (encodedBody) {
            outbound.write(encodedBody);
          }
          outbound.end();
        });
      } finally {
        encodedBody?.fill(0);
      }
    },
  };
  const retryable = new Set([
    "provider.transport_slow_transfer",
    "provider.transport_address_timeout",
    "provider.transport_failed",
    "provider.transport_response_failed",
    "provider.transport_connect_timeout",
    "provider.transport_headers_timeout",
    "provider.transport_first_byte_timeout",
    "provider.transport_idle_timeout",
  ]);
  return Object.freeze({
    isResultUrlAllowed(value: string): boolean {
      // Governed links require an async policy decision. Raw evidence is retained
      // independently; do not advertise a link based on deployment defaults.
      if (options.resolveResultPolicy) return false;
      try {
        if (value.length > 8192) return false;
        const url = new URL(value);
        if (url.href.length > 8192) return false;
        const hostname = url.hostname.replace(/^\[|\]$/gu, "");
        if (
          url.protocol !== "https:" ||
          url.hash ||
          url.username ||
          url.password ||
          hostname === "localhost" ||
          hostname.endsWith(".localhost") ||
          (isIP(hostname) && isBlockedProviderAddress(hostname))
        )
          return false;
        resolveUrl(
          url.origin,
          `${url.pathname}${url.search}`,
          allowedOrigins,
          options.resultDownloadsEnabled ?? true,
          resultAllowedOrigins,
          "provider_result",
          false,
        );
        return true;
      } catch {
        return false;
      }
    },
    async request(
      requestOptions: ProviderHttpRequest,
    ): Promise<ProviderHttpResponse> {
      let policy: ProviderResultPolicySnapshot | undefined;
      const recordDecision = async (
        outcome: string,
        version: number | null,
      ) => {
        if (
          !requestOptions.resultPolicyContext ||
          !options.recordResultPolicyDecision
        )
          return;
        try {
          await options.recordResultPolicyDecision({
            context: requestOptions.resultPolicyContext,
            origin: new URL(requestOptions.baseUrl).origin,
            version,
            source:
              policy?.source ??
              (options.resolveResultPolicy ? "instance" : "environment"),
            outcome,
          });
        } catch {
          return transportFailure(
            "provider.output_policy_unavailable",
            "not_started",
          );
        }
      };
      if (
        requestOptions.targetKind === "provider_result" &&
        options.resolveResultPolicy
      ) {
        if (!requestOptions.resultPolicyContext)
          return transportFailure(
            "provider.output_policy_unavailable",
            "not_started",
          );
        try {
          policy = await options.resolveResultPolicy(
            requestOptions.resultPolicyContext,
          );
        } catch {
          await recordDecision("provider.output_policy_unavailable", null);
          return transportFailure(
            "provider.output_policy_unavailable",
            "not_started",
          );
        }
      }
      if (requestOptions.targetKind === "provider_result") {
        const enabled =
          (options.resultDownloadsEnabled ?? true) && (policy?.enabled ?? true);
        const origins = policy
          ? policy.allowedOrigins
          : options.resultAllowedOrigins;
        let outcome = "allowed";
        if (!enabled) outcome = "provider.output_download_disabled";
        else if (
          origins &&
          !origins.includes(new URL(requestOptions.baseUrl).origin)
        )
          outcome = "provider.output_origin_not_allowed";
        await recordDecision(outcome, policy?.version ?? null);
      }
      if (requestOptions.targetKind === "provider_result")
        await requestOptions.onResultPolicyResolved?.(policy);
      const mayChangeAddress =
        !proxyAgent &&
        requestOptions.method === "GET" &&
        requestOptions.targetKind === "provider_result" &&
        requestOptions.responseMode === "binary" &&
        requestOptions.body === undefined &&
        requestOptions.binaryBody === undefined;
      const attempted = new Set<string>();
      let previous: unknown;
      for (
        let attempt = 0;
        attempt < (mayChangeAddress ? 3 : 1);
        attempt += 1
      ) {
        try {
          return await direct.request(requestOptions, attempted, policy);
        } catch (error) {
          if (
            error instanceof ProviderAdapterCallError &&
            error.stableErrorCode ===
              "provider.transport_addresses_exhausted" &&
            previous instanceof Error
          )
            throw previous;
          if (
            !mayChangeAddress ||
            requestOptions.signal.aborted ||
            !(error instanceof ProviderAdapterCallError) ||
            !retryable.has(error.stableErrorCode) ||
            requestOptions.deadlineAt.getTime() <= Date.now()
          )
            throw error;
          previous = error;
        }
      }
      throw previous instanceof Error
        ? previous
        : new ProviderAdapterCallError("provider.transport_failed", "unknown");
    },
  });
}
