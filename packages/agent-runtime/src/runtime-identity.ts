import { createHash } from "node:crypto";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function stableAgentRuntimeId(
  namespace: string,
  ownerId: string,
  ordinal: number,
): string {
  const bytes = createHash("sha256")
    .update("kanvas:agent-runtime-id:v1\0")
    .update(namespace)
    .update("\0")
    .update(ownerId)
    .update("\0")
    .update(String(ordinal))
    .digest()
    .subarray(0, 16);
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let result = "";
  for (let index = 0; index < 26; index += 1) {
    result = (alphabet[Number(value & 31n)] ?? "0") + result;
    value >>= 5n;
  }
  return result;
}
