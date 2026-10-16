import { libraryTextPassages } from "./text-passages.js";
import { DomainError } from "../../foundation/domain-error.js";
export const libraryDocumentMaximumBytes = 16 * 1024 * 1024;
export const libraryExtractedMaximumCharacters = 1_000_000;
export const libraryPdfMediaType = "application/pdf";
export const libraryDocxMediaType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export interface LibraryPageRange {
  readonly page: number;
  readonly startOffset: number;
  readonly endOffset: number;
}
export interface LibraryTextExtraction {
  readonly text: string;
  readonly extractorVersion: string;
  readonly pageRanges: readonly LibraryPageRange[];
}
export function validateLibraryTextExtraction(
  value: LibraryTextExtraction,
): LibraryTextExtraction {
  if (
    typeof value.text !== "string" ||
    !value.text.trim() ||
    value.text.length > libraryExtractedMaximumCharacters ||
    !/^[a-z0-9.-]{1,80}$/u.test(value.extractorVersion) ||
    !Array.isArray(value.pageRanges) ||
    value.pageRanges.length > 200
  ) {
    throw new DomainError(
      "resource_library.extraction_invalid",
      "Invalid or empty document text.",
    );
  }
  let end = 0;
  let previousPage = 0;
  for (const range of value.pageRanges as readonly LibraryPageRange[]) {
    if (
      !Number.isSafeInteger(range.page) ||
      range.page <= previousPage ||
      !Number.isSafeInteger(range.startOffset) ||
      !Number.isSafeInteger(range.endOffset) ||
      range.startOffset !== end ||
      range.endOffset < range.startOffset ||
      range.endOffset > value.text.length
    )
      throw new DomainError(
        "resource_library.extraction_invalid",
        "Invalid page locations.",
      );
    end = range.endOffset;
    previousPage = range.page;
  }
  if (value.pageRanges.length && end !== value.text.length)
    throw new DomainError(
      "resource_library.extraction_invalid",
      "Incomplete page locations.",
    );
  libraryTextPassages(value.text, value.pageRanges);
  return value;
}

export interface LibraryTextSource {
  readonly artifactId: string;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: string;
  readonly storageProfileId: string;
  readonly container: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly immutableIdentityHash: string;
  readonly extraction?: LibraryTextExtraction;
}
