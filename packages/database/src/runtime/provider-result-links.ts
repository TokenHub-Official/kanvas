import { BlockList, isIP } from "node:net";
import type { ResultDownloadRule } from "@kanvas/contracts/api";

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  privateAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const)
  privateAddresses.addSubnet(address, prefix, "ipv6");

/** Authorized callers must resolve the current download rule before projection. */
export function projectProviderResultLinks(
  facts: unknown,
  rule: Readonly<ResultDownloadRule>,
): readonly string[] {
  if (!rule.enabled || !facts || typeof facts !== "object") return [];
  const evidence = "resultEvidence" in facts ? facts.resultEvidence : undefined;
  let candidates: unknown;
  if (evidence && typeof evidence === "object" && "urls" in evidence)
    candidates = evidence.urls;
  else if ("resultUrls" in facts) candidates = facts.resultUrls;
  return providerResultUrls(candidates).filter((value) => {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
    const family = isIP(host);
    return (
      host !== "localhost" &&
      !host.endsWith(".localhost") &&
      !(
        family && privateAddresses.check(host, family === 4 ? "ipv4" : "ipv6")
      ) &&
      (rule.allowedOrigins === null || rule.allowedOrigins.includes(url.origin))
    );
  });
}

/** Private evidence, never a download authorization or public link projection. */
export interface ProviderResultEvidence {
  readonly urls: readonly string[];
  readonly totalCount: number;
  readonly omittedCount: number;
}

/** Keep original HTTP(S) addresses, including signed paths, independently of origin policy. */
export function captureProviderResultEvidence(
  candidates: readonly unknown[],
  totalCount: number = candidates.length,
): ProviderResultEvidence {
  if (
    !Array.isArray(candidates) ||
    !Number.isSafeInteger(totalCount) ||
    totalCount < candidates.length
  ) {
    throw new TypeError("Provider result evidence count is invalid.");
  }
  const urls: string[] = [];
  for (const candidate of candidates) {
    if (urls.length === 16) break;
    if (typeof candidate !== "string" || candidate.length > 8192) continue;
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password
      )
        urls.push(candidate);
    } catch {
      /* Count malformed addresses as omitted rather than exposing arbitrary payloads. */
    }
  }
  return { urls, totalCount, omittedCount: totalCount - urls.length };
}

/** Defense in depth when reading old or malformed result evidence. */
export function providerResultUrls(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((candidate): candidate is string => {
          if (typeof candidate !== "string" || candidate.length > 8192)
            return false;
          try {
            const url = new URL(candidate);
            return (
              url.href.length <= 8192 &&
              url.protocol === "https:" &&
              !url.username &&
              !url.password &&
              !url.hash
            );
          } catch {
            return false;
          }
        })
        .map((candidate) => new URL(candidate).href),
    ),
  ].slice(0, 16);
}
