import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractLibraryDocument } from "../dist/library-document-extraction.js";
import { libraryTextPassages } from "@kanvas/application";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/library-documents/${name}`, import.meta.url));
describe("isolated document extraction", () => {
  it("extracts PDF text with exact page ranges and passage references", async () => {
    const result = await extractLibraryDocument(
      await fixture("product.pdf"),
      "application/pdf",
    );
    expect(result.text).toContain("durable aluminium");
    expect(result.pageRanges).toHaveLength(2);
    expect(
      libraryTextPassages(result.text, result.pageRanges).map(
        (part) => part.page,
      ),
    ).toEqual([1, 2]);
    expect(result.text.slice(result.pageRanges[1]!.startOffset)).toContain(
      "keep dry",
    );
  });
  it("extracts DOCX paragraphs including Chinese without converting the original file", async () => {
    const bytes = await fixture("product.docx");
    const original = Buffer.from(bytes);
    const result = await extractLibraryDocument(
      bytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.text).toContain("产品 KA-100\n\n耐用铝合金");
    expect(bytes).toEqual(original);
    expect(result.pageRanges).toEqual([]);
  });
  it("rejects compressed content whose true expansion exceeds the declared ZIP size", async () => {
    await expect(
      extractLibraryDocument(
        await fixture("forged-size.docx"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).rejects.toThrow();
  });
  // Each worker startup has its own test budget on CPU-limited runners.
  it.each([
    {
      name: "image-only PDF",
      errorCode: "resource_library.extraction_invalid",
      loadBytes: () => fixture("no-text.pdf"),
      mediaType: "application/pdf",
    },
    {
      name: "unreadable PDF",
      errorCode: "resource_library.document_invalid",
      loadBytes: () => Promise.resolve(Buffer.from("not a pdf")),
      mediaType: "application/pdf",
    },
    {
      name: "unreadable DOCX",
      errorCode: "resource_library.document_invalid",
      loadBytes: () => Promise.resolve(Buffer.from("not a docx")),
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  ])(
    "rejects $name rather than indexing blank content",
    async ({ loadBytes, mediaType, errorCode }) => {
      await expect(
        extractLibraryDocument(await loadBytes(), mediaType),
      ).rejects.toMatchObject({
        code: errorCode,
      });
    },
  );
});
