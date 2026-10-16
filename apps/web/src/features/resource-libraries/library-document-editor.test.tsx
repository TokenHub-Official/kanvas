import { describe, expect, it } from "vitest";
import {
  documentFile,
  maximumDocumentBytes,
} from "./library-document-editor.js";
import { libraryFileMediaType } from "./api.js";

describe("editable library documents", () => {
  it("preserves the exact UTF-8 body and normalizes the selected document format", async () => {
    const text = "# 产品\n\n尺寸：20 × 10 cm\n";
    const file = documentFile(" 产品说明.txt ", text, "text/markdown");
    expect(file.name).toBe("产品说明.md");
    expect(await file.text()).toBe(text);
    expect(libraryFileMediaType(file)).toBe("text/markdown");
    expect(file.size).toBe(new TextEncoder().encode(text).byteLength);
  });
  it("applies the upload byte limit to multibyte text, not character count", () => {
    const file = documentFile(
      "说明",
      "中".repeat(Math.floor(maximumDocumentBytes / 3) + 1),
      "text/plain",
    );
    expect(file.name).toBe("说明.txt");
    expect(libraryFileMediaType(file)).toBeUndefined();
    expect(
      libraryFileMediaType(
        documentFile("说明", "a".repeat(maximumDocumentBytes), "text/plain"),
      ),
    ).toBe("text/plain");
  });
});
