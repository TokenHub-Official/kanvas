import { Worker } from "node:worker_threads";
import {
  DomainError,
  libraryDocumentMaximumBytes,
  libraryPdfMediaType,
  libraryDocxMediaType,
  validateLibraryTextExtraction,
  type LibraryTextExtraction,
  type LibraryTextSource,
  type StorageProfileRegistry,
} from "@kanvas/application";
import { decodeLibraryText } from "./library-text.js";

/** Isolated CPU/memory lifetime; external resources and macros are not loaded. */
export async function extractLibraryDocument(
  bytes: Uint8Array,
  mediaType: string,
): Promise<LibraryTextExtraction> {
  if (mediaType === "text/plain" || mediaType === "text/markdown") {
    decodeLibraryText(bytes);
    return validateLibraryTextExtraction({
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ),
      extractorVersion: "utf8-v1",
      pageRanges: [],
    });
  }
  if (
    !bytes.length ||
    bytes.length > libraryDocumentMaximumBytes ||
    ![libraryPdfMediaType, libraryDocxMediaType].includes(mediaType)
  )
    throw new DomainError(
      "resource_library.document_invalid",
      "Unsupported document type or size.",
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./library-document-worker.js", import.meta.url),
      {
        workerData: { bytes, mediaType },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
      },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(
        new DomainError(
          "resource_library.document_timeout",
          "Document processing timed out.",
        ),
      );
    }, 15000);
    worker.once(
      "message",
      (message: { result?: LibraryTextExtraction; error?: string }) => {
        clearTimeout(timeout);
        void worker.terminate();
        if (!message.result) {
          reject(
            new DomainError(
              message.error === "limit"
                ? "resource_library.document_limit"
                : "resource_library.document_invalid",
              "The document exceeds processing limits, is encrypted, or contains no extractable text.",
            ),
          );
          return;
        }
        try {
          resolve(validateLibraryTextExtraction(message.result));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Invalid extraction result."),
          );
        }
      },
    );
    worker.once("error", () => {
      clearTimeout(timeout);
      reject(
        new DomainError(
          "resource_library.document_invalid",
          "Document processing failed.",
        ),
      );
    });
    worker.once("exit", () => {
      clearTimeout(timeout);
      reject(
        new DomainError(
          "resource_library.document_invalid",
          "Document processing stopped.",
        ),
      );
    });
  });
}

export async function loadLibraryDocumentText(
  source: LibraryTextSource,
  profiles: StorageProfileRegistry,
): Promise<{ extraction: LibraryTextExtraction; sourceBytes: Uint8Array }> {
  const size = Number(source.byteSize);
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > libraryDocumentMaximumBytes
  )
    throw new DomainError(
      "resource_library.document_invalid",
      "Document is too large to extract.",
    );
  const profile = profiles.resolve(source.storageProfileId);
  if (!profile)
    throw new DomainError(
      "resource_library.storage_unavailable",
      "Document storage is unavailable.",
    );
  const read = await profile.adapter.openRead({
    identity: {
      storageProfileId: source.storageProfileId,
      container: source.container,
      objectKey: source.objectKey,
    },
    expectedByteSize: source.byteSize,
    expectedSha256: source.sha256,
    expectedImmutableIdentityHash: source.immutableIdentityHash,
  });
  if (
    read.range ||
    read.totalByteSize !== source.byteSize ||
    read.contentByteSize !== source.byteSize
  )
    throw new DomainError(
      "resource_library.integrity",
      "Document byte length changed.",
    );
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of read.body) {
    length += chunk.byteLength;
    if (length > size)
      throw new DomainError(
        "resource_library.integrity",
        "Document exceeded its verified size.",
      );
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, length);
  const { createHash } = await import("node:crypto");
  if (
    length !== size ||
    createHash("sha256").update(bytes).digest("hex") !== source.sha256 ||
    source.contentDigest !== `sha256:${source.sha256}`
  )
    throw new DomainError(
      "resource_library.integrity",
      "Document digest changed.",
    );
  return {
    extraction: await extractLibraryDocument(bytes, source.mediaType),
    sourceBytes: bytes,
  };
}
