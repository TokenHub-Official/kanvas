import { createHash } from "node:crypto";

import type { ServerStreamMediaVerifier } from "./server-stream-upload-coordinator.js";

const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/iu;

export const verifyOpaqueModelResource: ServerStreamMediaVerifier = async (
  options,
) => {
  if (
    !Number.isSafeInteger(options.maximumInputBytes) ||
    options.maximumInputBytes < 1
  ) {
    throw new TypeError("Model Resource verification byte limit is invalid.");
  }
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of options.body) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("Model Resource body yielded a non-byte chunk.");
    }
    byteSize += chunk.byteLength;
    if (byteSize > options.maximumInputBytes) {
      throw new RangeError("Model Resource exceeds the configured byte limit.");
    }
    hash.update(chunk);
  }
  if (byteSize < 1) {
    throw new RangeError("Model Resource body is empty.");
  }
  const sha256 = hash.digest("hex");
  const detectedMediaType =
    options.declaredMediaType &&
    mediaTypePattern.test(options.declaredMediaType)
      ? options.declaredMediaType.toLowerCase()
      : "application/octet-stream";
  return Object.freeze({
    byteSize: String(byteSize),
    sha256,
    detectedMediaType,
    verificationResultHash: `sha256:${createHash("sha256")
      .update("kanvas:model-resource-verification:v1\0")
      .update(options.verificationProfileVersion)
      .update("\0")
      .update(detectedMediaType)
      .update("\0")
      .update(String(byteSize))
      .update("\0")
      .update(sha256)
      .digest("hex")}`,
  });
};
