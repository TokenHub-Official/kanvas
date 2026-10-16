import { describe, expect, it } from "vitest";
import {
  libraryTextPassages,
  readLibraryTextPassages,
} from "../src/modules/resource-library/text-passages.js";

describe("versioned text passage locations", () => {
  it("preserves all original text and locates CRLF paragraphs", () => {
    const text = "# 产品\r\n\r\n型号 KA-100\r\n尺寸 20cm\r\n\r\n尾段";
    const passages = libraryTextPassages(text);
    expect(passages.map((item) => item.text).join("")).toBe(text);
    expect(passages[1]).toMatchObject({ number: 2, startLine: 3, endLine: 5 });
    for (const item of passages)
      expect(text.slice(item.startOffset, item.endOffset)).toBe(item.text);
    expect(readLibraryTextPassages(text, 2, 1)).toMatchObject({
      complete: false,
      nextPassage: 3,
      passages: [passages[1]],
    });
  });
  it("bounds long paragraphs without corrupting emoji or dropping content", () => {
    const text = "a".repeat(3999) + "🟦" + "b".repeat(20000);
    const passages = libraryTextPassages(text);
    expect(passages.map((item) => item.text).join("")).toBe(text);
    expect(
      passages.every(
        (item) =>
          item.text.length <= 4000 &&
          Array.from(item.text).every(
            (character) =>
              character.length === 2 || !/[\uD800-\uDFFF]/u.test(character),
          ),
      ),
    ).toBe(true);
    const first = readLibraryTextPassages(text);
    expect(first.complete).toBe(false);
    expect(first.nextPassage).toBe(5);
    const rest = readLibraryTextPassages(text, first.nextPassage);
    expect(first.text + rest.text).toBe(text);
    expect(rest.complete).toBe(false);
    expect(rest.nextPassage).toBeUndefined();
  });
  it("rejects misleading or excessive ranges", () => {
    for (const [start, count] of [
      [0, 1],
      [2, 1],
      [1, 13],
      [1.5, 1],
      [1, 0],
    ]) {
      expect(() => readLibraryTextPassages("one", start, count)).toThrow(
        "Invalid passage range",
      );
    }
  });
});
