import { verifyLibraryDocxArchive } from "./library-docx-archive.js";
import { fileURLToPath } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import {
  libraryExtractedMaximumCharacters,
  libraryPdfMediaType,
  type LibraryTextExtraction,
} from "@kanvas/application";

const input = workerData as { bytes: Uint8Array; mediaType: string };
async function extract(): Promise<LibraryTextExtraction> {
  if (input.mediaType === libraryPdfMediaType) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const packageRoot = import.meta.resolve("pdfjs-dist/package.json");
    const task = getDocument({
      standardFontDataUrl: fileURLToPath(
        new URL("./standard_fonts/", packageRoot),
      ),
      cMapUrl: fileURLToPath(new URL("./cmaps/", packageRoot)),
      cMapPacked: true,
      data: new Uint8Array(input.bytes),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
    });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 200) throw new Error("Too many pages");
      let text = "";
      const pageRanges = [];
      for (let page = 1; page <= pdf.numPages; page += 1) {
        const documentPage = await pdf.getPage(page);
        const content = await documentPage.getTextContent();
        const startOffset = text.length;
        for (const item of content.items)
          if ("str" in item) {
            text += item.str + (item.hasEOL ? "\n" : " ");
            if (text.length > libraryExtractedMaximumCharacters)
              throw new Error("Document is too long");
          }
        text += "\n\n";
        pageRanges.push({ page, startOffset, endOffset: text.length });
        documentPage.cleanup();
      }
      return { text, pageRanges, extractorVersion: "pdfjs-text-v1" };
    } finally {
      await task.destroy();
    }
  }
  await verifyLibraryDocxArchive(input.bytes);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(input.bytes),
  });
  if (result.value.length > libraryExtractedMaximumCharacters)
    throw new Error("Document is too long");
  return {
    text: result.value,
    pageRanges: [],
    extractorVersion: "mammoth-text-v1",
  };
}
try {
  parentPort?.postMessage({ result: await extract() });
} catch (error) {
  parentPort?.postMessage({
    error:
      error instanceof Error && /limit|too long|Too many/iu.test(error.message)
        ? "limit"
        : "unreadable",
  });
}
