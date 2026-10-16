import type { LibraryPageRange } from "./document-text.js";
import { DomainError } from "../../foundation/domain-error.js";

export interface LibraryTextPassage {
  readonly number: number;
  readonly page?: number;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Zero-based UTF-16 offsets into the decoded original text; end is exclusive. */
  readonly startOffset: number;
  readonly endOffset: number;
}

const passageCharacters = 4000;
const defaultPassageCount = 4;
const maximumPassageCount = 12;

/** Deterministic, lossless passages. Blank lines delimit paragraphs; long paragraphs split at lines. */
export function libraryTextPassages(
  text: string,
  pages: readonly LibraryPageRange[] = [],
): readonly LibraryTextPassage[] {
  const passages: LibraryTextPassage[] = [];
  let offset = 0;
  let line = 1;
  while (offset < text.length) {
    if (passages.length >= 4096)
      throw new DomainError(
        "resource_library.document_complex",
        "Document contains too many passages.",
      );
    const page = pages.find(
      (range) => offset >= range.startOffset && offset < range.endOffset,
    );
    const limit = Math.min(
      text.length,
      offset + passageCharacters,
      page?.endOffset ?? text.length,
    );
    let end = limit;
    const window = text.slice(offset, limit);
    const match = /\r?\n[\t ]*\r?\n/u.exec(window);
    if (match) {
      end = offset + match.index + match[0].length;
    } else if (limit < text.length) {
      const newline = window.lastIndexOf("\n");
      if (newline >= 0) end = offset + newline + 1;
      // Never split a surrogate pair or CRLF sequence at a hard character boundary.
      else if (/[\uD800-\uDBFF\r]/u.test(text[end - 1] ?? "")) end -= 1;
    }
    const value = text.slice(offset, end);
    const newlines = value.match(/\n/gu)?.length ?? 0;
    passages.push({
      number: passages.length + 1,
      ...(page ? { page: page.page } : {}),
      text: value,
      startLine: line,
      endLine: line + newlines - (value.endsWith("\n") ? 1 : 0),
      startOffset: offset,
      endOffset: end,
    });
    offset = end;
    line += newlines;
  }
  return passages;
}

export function readLibraryTextPassages(
  text: string,
  startPassage = 1,
  passageCount = defaultPassageCount,
  pages: readonly LibraryPageRange[] = [],
) {
  const passages = libraryTextPassages(text, pages);
  if (
    !Number.isSafeInteger(startPassage) ||
    startPassage < 1 ||
    startPassage > Math.max(1, passages.length) ||
    !Number.isSafeInteger(passageCount) ||
    passageCount < 1 ||
    passageCount > maximumPassageCount
  )
    throw new DomainError(
      "resource_library.invalid_argument",
      "Invalid passage range.",
    );
  const selected = passages.slice(
    startPassage - 1,
    startPassage - 1 + passageCount,
  );
  const nextPassage = startPassage + selected.length;
  return {
    text: selected.map((passage) => passage.text).join(""),
    passages: selected,
    totalPassages: passages.length,
    complete: startPassage === 1 && nextPassage > passages.length,
    ...(nextPassage <= passages.length ? { nextPassage } : {}),
    locatorVersion: "text-passages-v1" as const,
    offsetUnit: "utf16" as const,
  };
}
