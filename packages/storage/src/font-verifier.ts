import { createHash } from "node:crypto";

import { MediaVerificationError } from "./media-verifier.js";
import type { ServerStreamMediaVerifier } from "./server-stream-upload-coordinator.js";

const sfntHeaderBytes = 12;
const sfntTableRecordBytes = 16;
const maximumSfntTables = 256;
const requiredCommonTables = ["cmap", "head", "hhea", "hmtx", "maxp", "name"];

function fail(
  code:
    | "media_verification.declared_type_mismatch"
    | "media_verification.input_too_large"
    | "media_verification.malformed"
    | "media_verification.truncated"
    | "media_verification.unsupported_media",
  message: string,
): never {
  throw new MediaVerificationError(code, message);
}

async function readBounded(
  body: AsyncIterable<Uint8Array>,
  maximumInputBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      return fail(
        "media_verification.malformed",
        "Font upload yielded a non-byte chunk.",
      );
    }
    total += chunk.byteLength;
    if (total > maximumInputBytes) {
      return fail(
        "media_verification.input_too_large",
        "Font file exceeds the configured input limit.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sfntMediaType(bytes: Buffer): "font/otf" | "font/ttf" {
  if (bytes.byteLength < sfntHeaderBytes) {
    return fail("media_verification.truncated", "Font header is truncated.");
  }
  if (bytes.subarray(0, 4).toString("ascii") === "OTTO") return "font/otf";
  if (bytes.readUInt32BE(0) === 0x0001_0000) return "font/ttf";
  return fail(
    "media_verification.unsupported_media",
    "Only uncompressed OpenType or TrueType font files are supported.",
  );
}

function verifySfntTables(
  bytes: Buffer,
  mediaType: "font/otf" | "font/ttf",
): void {
  const count = bytes.readUInt16BE(4);
  if (count < 1 || count > maximumSfntTables) {
    fail("media_verification.malformed", "Font table count is invalid.");
  }
  const directoryEnd = sfntHeaderBytes + count * sfntTableRecordBytes;
  if (directoryEnd > bytes.byteLength) {
    fail("media_verification.truncated", "Font table directory is truncated.");
  }
  const tables = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const recordOffset = sfntHeaderBytes + index * sfntTableRecordBytes;
    const tag = bytes
      .subarray(recordOffset, recordOffset + 4)
      .toString("ascii");
    const offset = bytes.readUInt32BE(recordOffset + 8);
    const length = bytes.readUInt32BE(recordOffset + 12);
    if (
      !/^[\x20-\x7e]{4}$/u.test(tag) ||
      tables.has(tag) ||
      length < 1 ||
      offset < directoryEnd ||
      offset + length > bytes.byteLength
    ) {
      fail("media_verification.malformed", "Font table directory is invalid.");
    }
    tables.add(tag);
  }
  if (requiredCommonTables.some((tag) => !tables.has(tag))) {
    fail("media_verification.malformed", "Font is missing required tables.");
  }
  if (
    mediaType === "font/ttf" &&
    (!tables.has("glyf") || !tables.has("loca"))
  ) {
    fail("media_verification.malformed", "TrueType outlines are incomplete.");
  }
  if (mediaType === "font/otf" && !tables.has("CFF ") && !tables.has("CFF2")) {
    fail(
      "media_verification.malformed",
      "OpenType CFF outlines are incomplete.",
    );
  }
}

export const verifyTrustedFont: ServerStreamMediaVerifier = async (options) => {
  if (
    !Number.isSafeInteger(options.maximumInputBytes) ||
    options.maximumInputBytes < 1
  ) {
    return fail(
      "media_verification.malformed",
      "Font verification limit is invalid.",
    );
  }
  const bytes = await readBounded(options.body, options.maximumInputBytes);
  try {
    const detectedMediaType = sfntMediaType(bytes);
    if (
      options.declaredMediaType &&
      options.declaredMediaType !== detectedMediaType
    ) {
      return fail(
        "media_verification.declared_type_mismatch",
        "Declared font type does not match the font container.",
      );
    }
    verifySfntTables(bytes, detectedMediaType);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const byteSize = String(bytes.byteLength);
    const verificationResultHash = `sha256:${createHash("sha256")
      .update("kanvas:trusted-font-verification:v1\0")
      .update(options.verificationProfileVersion)
      .update("\0")
      .update(detectedMediaType)
      .update("\0")
      .update(byteSize)
      .update("\0")
      .update(sha256)
      .digest("hex")}`;
    return {
      byteSize,
      sha256,
      detectedMediaType,
      verificationResultHash,
    };
  } finally {
    bytes.fill(0);
  }
};
