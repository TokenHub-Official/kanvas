import { describe, expect, it } from "vitest";
import { sourceLineRange } from "./html-source-editor.js";
describe("HTML error location", () => {
  it("selects the whole requested line including multibyte characters", () => {
    const source = "<html>\n中文 😀\n</html>";
    const [start, end] = sourceLineRange(source, 2);
    expect(source.slice(start, end)).toBe("中文 😀");
  });
  it("clamps stale error lines to the edited document", () => {
    expect(sourceLineRange("abc", 20)).toEqual([0, 3]);
    expect(sourceLineRange("", 1)).toEqual([0, 0]);
  });
});
