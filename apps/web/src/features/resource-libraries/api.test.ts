import { describe, expect, it } from "vitest";
import { libraryFileMediaType } from "./api.js";
describe("Library file chooser validation", () => {
  it("accepts supported bounded formats and rejects misleading image extensions", () => {
    expect(
      libraryFileMediaType({ name: "photo.PNG", type: "image/png", size: 100 }),
    ).toBe("image/png");
    expect(
      libraryFileMediaType({ name: "facts.md", type: "", size: 131072 }),
    ).toBe("text/markdown");
    expect(
      libraryFileMediaType({
        name: "facts.txt",
        type: "text/plain",
        size: 131073,
      }),
    ).toBeUndefined();
    expect(
      libraryFileMediaType({
        name: "photo.jpg",
        type: "application/pdf",
        size: 100,
      }),
    ).toBeUndefined();
    expect(
      libraryFileMediaType({
        name: "guide.pdf",
        type: "application/pdf",
        size: 100,
      }),
    ).toBe("application/pdf");
    expect(
      libraryFileMediaType({
        name: "large.docx",
        type: "",
        size: 16 * 1024 * 1024 + 1,
      }),
    ).toBeUndefined();
    expect(
      libraryFileMediaType({ name: "empty.txt", type: "text/plain", size: 0 }),
    ).toBeUndefined();
  });
});
