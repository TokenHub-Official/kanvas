import { describe, expect, it } from "vitest";

import { productDocumentTitle } from "./use-document-title.js";

describe("productDocumentTitle", () => {
  it("names a product page and normalizes whitespace", () => {
    expect(productDocumentTitle("  项目   详情  ")).toBe("项目 详情 · Kanvas");
  });

  it("falls back to the product name for an empty title", () => {
    expect(productDocumentTitle(" \n ")).toBe("Kanvas");
    expect(productDocumentTitle()).toBe("Kanvas");
  });

  it("bounds long titles without splitting Unicode characters", () => {
    const title = `${"画".repeat(79)}😀继续`;
    const result = productDocumentTitle(title);

    expect([...result.replace(" · Kanvas", "")]).toHaveLength(80);
    expect(result.endsWith("… · Kanvas")).toBe(true);
  });
});
