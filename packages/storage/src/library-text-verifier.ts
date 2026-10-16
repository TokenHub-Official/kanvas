import { createHash } from "node:crypto";
import { libraryTextMaximumBytes } from "@kanvas/application";
import { decodeLibraryText } from "./library-text.js";
import type { ServerStreamMediaVerifier } from "./server-stream-upload-coordinator.js";

/** Strict text verifier for the same seal/verify/commit protocol used by images. */
export const verifyLibraryText: ServerStreamMediaVerifier = async (options) => {
  if (
    options.declaredMediaType !== "text/plain" &&
    options.declaredMediaType !== "text/markdown"
  ) {
    throw new TypeError(
      "Library text must declare text/plain or text/markdown.",
    );
  }
  const limit = Math.min(options.maximumInputBytes, libraryTextMaximumBytes);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Invalid text verification limit.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of options.body) {
    if (!(chunk instanceof Uint8Array))
      throw new TypeError("Text upload must yield bytes.");
    size += chunk.byteLength;
    if (size > limit)
      throw new RangeError("Library text exceeds the byte limit.");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, size);
  decodeLibraryText(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return Object.freeze({
    byteSize: String(size),
    sha256,
    detectedMediaType: options.declaredMediaType,
    verificationResultHash: `sha256:${createHash("sha256")
      .update(
        JSON.stringify([
          "kanvas:library-text:v1",
          options.verificationProfileVersion,
          options.declaredMediaType,
          size,
          sha256,
        ]),
      )
      .digest("hex")}`,
  });
};
