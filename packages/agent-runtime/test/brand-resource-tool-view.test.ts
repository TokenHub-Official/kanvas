import { describe, expect, it, vi } from "vitest";

import { createBrandCommandToolProjection } from "../src/brand-command-tool-view.js";
import { createBrandResourceToolProjection } from "../src/brand-resource-tool-view.js";
import { mergeAgentToolFamilyProjections } from "../src/dynamic-tool-view.js";
import { createKanvasMastraTools } from "../src/tool-view.js";

describe("createBrandResourceToolProjection", () => {
  it("exposes published search and inspection without a Draft command", async () => {
    const search = vi.fn(() =>
      Promise.resolve({
        modelOutput: { brands: [{ name: "Example Studio" }] },
      }),
    );
    const inspectPublished = vi.fn(() =>
      Promise.resolve({ modelOutput: { brand: { name: "Example Studio" } } }),
    );
    const projection = createBrandResourceToolProjection({
      search,
      inspectPublished,
    });
    const tools = createKanvasMastraTools(projection.descriptors);

    expect(Object.keys(tools)).toEqual([
      "brand.search-published",
      "brand.inspect-published",
    ]);
    expect(Object.keys(tools)).not.toContain("brand.inspect-draft");
    await expect(
      projection.descriptors[0]!.executeCanonical({ query: "Example Studio" }),
    ).resolves.toMatchObject({
      modelOutput: { brands: [{ name: "Example Studio" }] },
    });
    await expect(
      projection.descriptors[1]!.executeCanonical({
        brandKitRevisionId: "01K00000000000000000000001",
      }),
    ).resolves.toMatchObject({
      modelOutput: { brand: { name: "Example Studio" } },
    });
  });

  it("merges read and maintenance descriptors into one Tool Family", () => {
    const resource = createBrandResourceToolProjection({
      search: () => Promise.resolve({ modelOutput: {} }),
      inspectPublished: () => Promise.resolve({ modelOutput: {} }),
    });
    const management = createBrandCommandToolProjection({
      list: () => Promise.resolve({ modelOutput: {} }),
      inspectDraft: () => Promise.resolve({ modelOutput: {} }),
      createDraft: () => Promise.resolve({ modelOutput: {} }),
      updateDraft: () => Promise.resolve({ modelOutput: {} }),
      proposePublish: () => Promise.resolve({ modelOutput: {} }),
    });
    const merged = mergeAgentToolFamilyProjections([resource, management]);

    expect(merged.family).toBe("brand_command");
    expect(merged.descriptors.map((descriptor) => descriptor.key)).toEqual([
      "brand.search-published",
      "brand.inspect-published",
      ...management.descriptors.map((descriptor) => descriptor.key),
    ]);
  });
});
