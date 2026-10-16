import { describe, expect, it } from "vitest";
import { decodeLibraryText } from "../src/library-text.js";

describe("Library text bytes", () => {
  it("preserves Unicode, Markdown, and complete bounded content", () => {
    const text = "# 产品\n参数：尺寸 20 cm\n";
    expect(decodeLibraryText(Buffer.from(text))).toBe(text);
    expect(decodeLibraryText(Buffer.alloc(128 * 1024, 65))).toHaveLength(
      128 * 1024,
    );
  });
  it("rejects overlong, truncated UTF-8, binary, and empty input without replacement or truncation", () => {
    for (const bytes of [
      Buffer.alloc(128 * 1024 + 1, 65),
      Buffer.from([0xe4, 0xb8]),
      Buffer.from([0xc0, 0xaf]),
      Buffer.from([65, 0, 66]),
      Buffer.alloc(0),
    ]) {
      expect(() => decodeLibraryText(bytes)).toThrow();
    }
  });
});
