import { fromBuffer, type Entry } from "yauzl";

/** Drain each entry with a hard expanded-byte budget before the document parser allocates strings. */
export function verifyLibraryDocxArchive(bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error("Invalid DOCX archive."));
          return;
        }
        let expanded = 0;
        let entries = 0;
        const names = new Set<string>();
        const fail = (reason: Error) => {
          zip.close();
          reject(reason);
        };
        zip.once("error", fail);
        zip.once("end", () => {
          if (
            !names.has("word/document.xml") ||
            !names.has("[Content_Types].xml")
          )
            reject(new Error("Not a DOCX document."));
          else resolve();
        });
        zip.on("entry", (entry: Entry) => {
          entries += 1;
          if (
            entries > 2048 ||
            names.has(entry.fileName) ||
            (entry.generalPurposeBitFlag & 1) !== 0 ||
            entry.uncompressedSize > 16 * 1024 * 1024
          ) {
            fail(new Error("DOCX archive exceeds processing limits."));
            return;
          }
          names.add(entry.fileName);
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail(streamError ?? new Error("Unreadable DOCX entry."));
              return;
            }
            stream.on("data", (chunk: Buffer) => {
              expanded += chunk.length;
              if (expanded > 32 * 1024 * 1024)
                stream.destroy(
                  new Error(
                    "DOCX expanded content exceeds the processing limit.",
                  ),
                );
            });
            stream.once("error", fail);
            stream.once("end", () => zip.readEntry());
          });
        });
        zip.readEntry();
      },
    );
  });
}
