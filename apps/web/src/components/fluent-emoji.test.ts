import { describe, expect, it } from "vitest";
import { fluentEmojiSource } from "./fluent-emoji.js";

describe("local Fluent emoji lookup", () => {
  it("resolves Unicode and optional presentation selectors to the same pinned asset", () => {
    expect(fluentEmojiSource("🐱")).toBe("/fluent-emoji/1.1.0/1f431.webp");
    expect(fluentEmojiSource("❤")).toBe(fluentEmojiSource("❤️"));
    expect(fluentEmojiSource("❤️")).toContain("/fluent-emoji/1.1.0/");
  });
  it("retains skin tones and compound sequences", () => {
    expect(fluentEmojiSource("👋🏽")).toContain("1f44b-1f3fd");
    expect(fluentEmojiSource("👩🏽‍💻")).toContain("1f469-1f3fd-200d-1f4bb");
  });
  it("leaves unsupported values available for native fallback", () => {
    expect(fluentEmojiSource("not-an-emoji")).toBeUndefined();
    expect(fluentEmojiSource("")).toBeUndefined();
  });
});
