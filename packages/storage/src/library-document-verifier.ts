import { createHash } from "node:crypto";
import { libraryDocumentMaximumBytes } from "@kanvas/application";
import { extractLibraryDocument } from "./library-document-extraction.js";
import type { ServerStreamMediaVerifier } from "./server-stream-upload-coordinator.js";

export const verifyLibraryDocument: ServerStreamMediaVerifier = async (
  options,
) => {
  if (!options.declaredMediaType)
    throw new TypeError("Document media type is required.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of options.body) {
    size += chunk.byteLength;
    if (size > Math.min(options.maximumInputBytes, libraryDocumentMaximumBytes))
      throw new RangeError("Document exceeds upload limit.");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, size);
  await extractLibraryDocument(bytes, options.declaredMediaType);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteSize: String(size),
    sha256,
    detectedMediaType: options.declaredMediaType,
    verificationResultHash: `sha256:${createHash("sha256")
      .update(
        JSON.stringify([
          "library-document-v1",
          options.verificationProfileVersion,
          options.declaredMediaType,
          size,
          sha256,
        ]),
      )
      .digest("hex")}`,
  };
};
