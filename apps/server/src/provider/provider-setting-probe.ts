import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";

import type { ProviderSettingPreset } from "@kanvas/contracts/api";

const defaultMaximumResponseBytes = 262_144;
const absoluteMaximumResponseBytes = 4 * 1_024 * 1_024;
const probeTimeoutMs = 8_000;
const resourceDownloadTimeoutMs = 30_000;

export class ProviderSettingProbeError extends Error {
  public constructor(
    public readonly code:
      | "authentication_failed"
      | "access_denied"
      | "model_not_found"
      | "rate_limited"
      | "unavailable"
      | "unsafe_endpoint"
      | "invalid_response",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderSettingProbeError";
  }
}

export interface ProviderProbeRequest {
  readonly baseUrl: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly maximumResponseBytes?: number;
}

export type ProviderProbeRequester = (
  request: ProviderProbeRequest,
) => Promise<{
  readonly statusCode: number;
  readonly body: unknown;
}>;

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function mappedIpv4Address(normalizedIpv6: string): string | undefined {
  if (!normalizedIpv6.startsWith("::ffff:")) {
    return undefined;
  }
  const suffix = normalizedIpv6.slice("::ffff:".length);
  if (isIP(suffix) === 4) {
    return suffix;
  }
  const words = suffix.split(":");
  if (
    words.length !== 2 ||
    words.some((word) => !/^[0-9a-f]{1,4}$/u.test(word))
  ) {
    return undefined;
  }
  const high = Number.parseInt(words[0]!, 16);
  const low = Number.parseInt(words[1]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function blockedProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return blockedIpv4(address);
  }
  if (family !== 6) {
    return true;
  }
  const normalized = address.toLowerCase().split("%", 1)[0] ?? "";
  const mappedIpv4 = mappedIpv4Address(normalized);
  if (mappedIpv4) {
    return blockedIpv4(mappedIpv4);
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^(?:fe[89ab])/u.test(normalized) ||
    normalized.startsWith("ff")
  );
}

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function exactProxyOrigin(value: string): URL {
  let proxy: URL;
  try {
    proxy = new URL(value);
  } catch {
    throw new ProviderSettingProbeError(
      "unsafe_endpoint",
      "模型服务代理地址不符合安全策略。",
    );
  }
  if (
    (proxy.protocol !== "http:" && proxy.protocol !== "https:") ||
    proxy.username !== "" ||
    proxy.password !== "" ||
    proxy.pathname !== "/" ||
    proxy.search !== "" ||
    proxy.hash !== ""
  ) {
    throw new ProviderSettingProbeError(
      "unsafe_endpoint",
      "模型服务代理地址不符合安全策略。",
    );
  }
  return proxy;
}

function proxyTunnelAgent(proxyUrl: string, target: URL): HttpsAgent {
  const proxy = exactProxyOrigin(proxyUrl);
  const targetPort = Number.parseInt(target.port || "443", 10);
  const targetHostname =
    target.hostname.startsWith("[") && target.hostname.endsWith("]")
      ? target.hostname.slice(1, -1)
      : target.hostname;
  const targetAuthority = `${
    isIP(targetHostname) === 6 ? `[${targetHostname}]` : targetHostname
  }:${String(targetPort)}`;
  const agent = new HttpsAgent({ keepAlive: false });

  agent.createConnection = (_options, callback) => {
    const completeConnection = callback as
      ((error: Error | null, socket?: Duplex) => void) | undefined;
    let settled = false;
    const finish = (
      error: Error | null,
      socket?: ReturnType<typeof tlsConnect>,
    ): void => {
      if (settled) {
        socket?.destroy();
        return;
      }
      settled = true;
      completeConnection?.(error, socket);
    };
    const connectRequest = (
      proxy.protocol === "https:" ? httpsRequest : httpRequest
    )({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === "https:" ? "443" : "80"),
      method: "CONNECT",
      path: targetAuthority,
      headers: {
        host: targetAuthority,
      },
      agent: false,
    });
    connectRequest.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200 || head.byteLength !== 0) {
        socket.destroy();
        finish(
          new ProviderSettingProbeError(
            "unavailable",
            "模型服务代理无法建立安全连接。",
          ),
        );
        return;
      }
      const secureSocket = tlsConnect({
        socket,
        ...(isIP(targetHostname) === 0 ? { servername: targetHostname } : {}),
      });
      secureSocket.once("secureConnect", () => {
        finish(null, secureSocket);
      });
      secureSocket.once("error", (error: Error) => {
        finish(error);
      });
    });
    connectRequest.once("error", (error: Error) => {
      finish(error);
    });
    connectRequest.end();
    return undefined;
  };
  return agent;
}

export async function requestProviderProbeJson(
  request: ProviderProbeRequest,
  options: {
    readonly proxyUrl?: string;
  } = {},
): Promise<{
  readonly statusCode: number;
  readonly body: unknown;
}> {
  const maximumResponseBytes =
    request.maximumResponseBytes ?? defaultMaximumResponseBytes;
  if (
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1 ||
    maximumResponseBytes > absoluteMaximumResponseBytes
  ) {
    throw new ProviderSettingProbeError(
      "invalid_response",
      "模型服务响应上限不符合安全策略。",
    );
  }
  const base = new URL(request.baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !request.path.startsWith("/") ||
    request.path.startsWith("//") ||
    request.path.includes("\\") ||
    request.path.includes("\0")
  ) {
    throw new ProviderSettingProbeError(
      "unsafe_endpoint",
      "模型服务地址不符合安全策略。",
    );
  }
  const proxyAgent = options.proxyUrl
    ? proxyTunnelAgent(options.proxyUrl, base)
    : undefined;
  const pinned = proxyAgent
    ? undefined
    : await (async () => {
        const addresses = await dnsLookup(base.hostname, {
          all: true,
          verbatim: true,
        }).catch((error: unknown) => {
          throw new ProviderSettingProbeError(
            "unavailable",
            "无法解析模型服务地址。",
            { cause: error },
          );
        });
        if (
          addresses.length < 1 ||
          addresses.some(
            ({ address, family }) =>
              (family !== 4 && family !== 6) || blockedProviderAddress(address),
          )
        ) {
          throw new ProviderSettingProbeError(
            "unsafe_endpoint",
            "模型服务地址解析到了不允许的网络。",
          );
        }
        return addresses.find(({ family }) => family === 4) ?? addresses[0]!;
      })();
  const basePath = base.pathname.replace(/\/+$/u, "");
  const target = new URL(`${basePath}${request.path}`, base.origin);
  if (target.origin !== base.origin) {
    throw new ProviderSettingProbeError(
      "unsafe_endpoint",
      "模型服务请求路径不符合安全策略。",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
  try {
    return await new Promise((resolve, reject) => {
      const outbound = httpsRequest(
        target,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            ...request.headers,
          },
          ...(proxyAgent
            ? { agent: proxyAgent }
            : {
                lookup: pinnedLookup(pinned!.address, pinned!.family as 4 | 6),
              }),
          signal: controller.signal,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer | string) => {
            const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += value.byteLength;
            if (total > maximumResponseBytes) {
              response.destroy();
              reject(
                new ProviderSettingProbeError(
                  "invalid_response",
                  "模型服务校验响应过大。",
                ),
              );
              return;
            }
            chunks.push(value);
          });
          response.once("error", reject);
          response.once("end", () => {
            const statusCode = response.statusCode;
            if (!statusCode) {
              reject(
                new ProviderSettingProbeError(
                  "invalid_response",
                  "模型服务未返回有效状态。",
                ),
              );
              return;
            }
            if (statusCode >= 300 && statusCode < 400) {
              reject(
                new ProviderSettingProbeError(
                  "unsafe_endpoint",
                  "模型服务校验不允许重定向。",
                ),
              );
              return;
            }
            const encoded = Buffer.concat(chunks);
            try {
              const body = JSON.parse(encoded.toString("utf8")) as unknown;
              resolve({ statusCode, body });
            } catch (error) {
              reject(
                new ProviderSettingProbeError(
                  "invalid_response",
                  "模型服务未返回有效 JSON。",
                  { cause: error },
                ),
              );
            } finally {
              encoded.fill(0);
            }
          });
        },
      );
      outbound.once("error", (error) => {
        reject(
          error instanceof ProviderSettingProbeError
            ? error
            : new ProviderSettingProbeError(
                "unavailable",
                "无法连接模型服务。",
                { cause: error },
              ),
        );
      });
      outbound.end();
    });
  } finally {
    clearTimeout(timeout);
    proxyAgent?.destroy();
  }
}

export interface ProviderBinaryRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly maximumBytes: number;
}

export async function requestProviderBinary(
  request: ProviderBinaryRequest,
  options: { readonly proxyUrl?: string } = {},
): Promise<{
  readonly statusCode: number;
  readonly contentType: string | undefined;
  readonly body: Uint8Array;
}> {
  if (
    !Number.isSafeInteger(request.maximumBytes) ||
    request.maximumBytes < 1 ||
    request.maximumBytes > 67_108_864
  ) {
    throw new ProviderSettingProbeError(
      "invalid_response",
      "资源下载大小上限不符合安全策略。",
    );
  }
  let target: URL;
  try {
    target = new URL(request.url);
  } catch {
    throw new ProviderSettingProbeError(
      "unsafe_endpoint",
      "资源下载地址不符合安全策略。",
    );
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.hash
  ) {
    throw new ProviderSettingProbeError(
      "unsafe_endpoint",
      "资源下载地址不符合安全策略。",
    );
  }
  const proxyAgent = options.proxyUrl
    ? proxyTunnelAgent(options.proxyUrl, target)
    : undefined;
  const pinned = proxyAgent
    ? undefined
    : await (async () => {
        const addresses = await dnsLookup(target.hostname, {
          all: true,
          verbatim: true,
        }).catch((error: unknown) => {
          throw new ProviderSettingProbeError(
            "unavailable",
            "无法解析资源下载地址。",
            { cause: error },
          );
        });
        if (
          addresses.length < 1 ||
          addresses.some(
            ({ address, family }) =>
              (family !== 4 && family !== 6) || blockedProviderAddress(address),
          )
        ) {
          throw new ProviderSettingProbeError(
            "unsafe_endpoint",
            "资源下载地址解析到了不允许的网络。",
          );
        }
        return addresses.find(({ family }) => family === 4) ?? addresses[0]!;
      })();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    resourceDownloadTimeoutMs,
  );
  try {
    return await new Promise((resolve, reject) => {
      const outbound = httpsRequest(
        target,
        {
          method: "GET",
          headers: request.headers,
          ...(proxyAgent
            ? { agent: proxyAgent }
            : {
                lookup: pinnedLookup(pinned!.address, pinned!.family as 4 | 6),
              }),
          signal: controller.signal,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer | string) => {
            const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += value.byteLength;
            if (total > request.maximumBytes) {
              response.destroy();
              reject(
                new ProviderSettingProbeError(
                  "invalid_response",
                  "资源文件超过允许的大小。",
                ),
              );
              return;
            }
            chunks.push(value);
          });
          response.once("error", reject);
          response.once("end", () => {
            const statusCode = response.statusCode;
            if (!statusCode) {
              reject(
                new ProviderSettingProbeError(
                  "invalid_response",
                  "资源服务未返回有效状态。",
                ),
              );
              return;
            }
            if (statusCode >= 300 && statusCode < 400) {
              reject(
                new ProviderSettingProbeError(
                  "unsafe_endpoint",
                  "资源下载不允许重定向。",
                ),
              );
              return;
            }
            resolve({
              statusCode,
              contentType:
                typeof response.headers["content-type"] === "string"
                  ? response.headers["content-type"].split(";", 1)[0]
                  : undefined,
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      outbound.once("error", (error) => {
        reject(
          error instanceof ProviderSettingProbeError
            ? error
            : new ProviderSettingProbeError(
                "unavailable",
                "无法下载资源文件。",
                { cause: error },
              ),
        );
      });
      outbound.end();
    });
  } finally {
    clearTimeout(timeout);
    proxyAgent?.destroy();
  }
}

function encodedModelPath(model: string): string {
  return model
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function assertSuccessfulStatus(statusCode: number): void {
  if (statusCode >= 200 && statusCode < 300) {
    return;
  }
  if (statusCode === 401) {
    throw new ProviderSettingProbeError(
      "authentication_failed",
      "API Key 无效或已失效。",
    );
  }
  if (statusCode === 403) {
    throw new ProviderSettingProbeError(
      "access_denied",
      "API Key 没有访问该模型的权限。",
    );
  }
  if (statusCode === 404) {
    throw new ProviderSettingProbeError(
      "model_not_found",
      "模型不存在，或当前 API Key 无权访问。",
    );
  }
  if (statusCode === 429) {
    throw new ProviderSettingProbeError(
      "rate_limited",
      "模型服务暂时限制了校验请求，请稍后重试。",
    );
  }
  throw new ProviderSettingProbeError(
    "unavailable",
    "模型服务暂时无法完成校验。",
  );
}

export async function probeProviderSetting(
  options: {
    readonly preset: ProviderSettingPreset;
    readonly baseUrl: string;
    readonly apiKey: Uint8Array;
    readonly modelKeys: readonly string[];
  },
  request: ProviderProbeRequester = requestProviderProbeJson,
): Promise<void> {
  const apiKey = Buffer.from(options.apiKey).toString("utf8");
  const bearerHeaders = {
    authorization: `Bearer ${apiKey}`,
  };
  const anthropicHeaders = {
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey,
  };
  const probeOne = async (
    path: string,
    headers: Readonly<Record<string, string>> = bearerHeaders,
  ) => {
    const response = await request({
      baseUrl: options.baseUrl,
      path,
      headers,
    });
    assertSuccessfulStatus(response.statusCode);
    return response.body;
  };

  if (options.preset === "openrouter") {
    await probeOne("/key");
  }
  if (options.preset === "newapi" || options.preset === "tokenhub") {
    const body = await probeOne(
      options.preset === "tokenhub" ? "/v1/models" : "/models",
    );
    const root =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Readonly<Record<string, unknown>>)
        : {};
    let entries: readonly unknown[] = [];
    if (Array.isArray(root.data)) {
      entries = root.data;
    } else if (Array.isArray(root.models)) {
      entries = root.models;
    }
    const ids = new Set(
      entries.flatMap((entry) => {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const value = entry as Readonly<Record<string, unknown>>;
          const id = value.id ?? value.name;
          return typeof id === "string" ? [id.replace(/^models\//u, "")] : [];
        }
        return [];
      }),
    );
    if (options.modelKeys.some((model) => !ids.has(model))) {
      throw new ProviderSettingProbeError(
        "model_not_found",
        "至少一个模型不存在，或当前 API Key 无权访问。",
      );
    }
    return;
  }
  for (const model of options.modelKeys) {
    const encoded = encodedModelPath(model);
    if (options.preset === "gemini") {
      await probeOne(`/models/${encoded}`, {
        "x-goog-api-key": apiKey,
      });
    } else if (options.preset === "anthropic") {
      await probeOne(`/models/${encoded}`, anthropicHeaders);
    } else if (options.preset === "xai") {
      await probeOne(`/image-generation-models/${encoded}`);
    } else if (options.preset === "openrouter") {
      await probeOne(`/images/models/${encoded}/endpoints`);
    } else {
      await probeOne(`/models/${encoded}`);
    }
  }
}
