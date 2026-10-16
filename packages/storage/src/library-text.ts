import { TextDecoder } from "node:util";
import { DomainError, libraryTextMaximumBytes } from "@kanvas/application";

/** Validate original bytes before making a text upload available. Never truncate. */
export function decodeLibraryText(bytes: Uint8Array): string {
  if (bytes.byteLength === 0 || bytes.byteLength > libraryTextMaximumBytes) {
    throw new DomainError(
      "resource_library.text_size",
      "Text must contain 1 to 131072 bytes.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainError(
      "resource_library.text_encoding",
      "Text must use valid UTF-8.",
    );
  }
  if (
    Array.from(text).some((character) => {
      const code = character.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
      );
    })
  ) {
    throw new DomainError(
      "resource_library.text_encoding",
      "Binary control characters are not accepted as text.",
    );
  }
  return text;
}
