import { compile } from "@fastify/proxy-addr";

export function parseTrustedProxyCidrs(
  value: string | undefined,
): readonly string[] {
  const addresses =
    value === undefined
      ? ["127.0.0.1/32", "::1/128"]
      : value
          .split(",")
          .map((address) => address.trim())
          .filter(Boolean);
  if (addresses.length === 0) {
    throw new Error(
      "KANVAS_HTTP_TRUSTED_PROXY_CIDRS must contain at least one proxy address.",
    );
  }
  compile(addresses);
  return Object.freeze(addresses);
}

export function createTrustedProxyPolicy(
  hops: number,
  addresses: readonly string[],
): false | ((address: string, hop: number) => boolean) {
  const trustAddress = compile([...addresses]);
  if (hops === 0) return false;
  return (address, hop) => hop < hops && trustAddress(address, hop);
}
