import { describe, expect, it, vi } from "vitest";

import { createThreadWorkQueryToolProjection } from "../src/index.js";

describe("Thread work Query Tool projection", () => {
  it("projects one bounded read Tool and delegates to the canonical executor", async () => {
    const inspect = vi.fn(() =>
      Promise.resolve({ modelOutput: { tasks: [] } }),
    );
    const projection = createThreadWorkQueryToolProjection(
      { inspect },
      { includeArtifacts: true },
    );

    expect(projection.family).toBe("query");
    expect(projection.digestMaterial).toEqual({
      schemaVersion: 1,
      includeArtifacts: true,
      webSearch: false,
    });
    expect(projection.descriptors).toHaveLength(1);
    await expect(
      projection.descriptors[0]!.executeCanonical({}),
    ).resolves.toEqual({ modelOutput: { tasks: [] } });
    expect(inspect).toHaveBeenCalledWith({});
  });

  it("projects governed web search as a Query Tool", async () => {
    const search = vi.fn(() =>
      Promise.resolve({
        modelOutput: {
          answer: "Current answer",
          sources: [{ url: "https://example.com/source" }],
        },
      }),
    );
    const projection = createThreadWorkQueryToolProjection(
      { search },
      { includeArtifacts: false },
    );

    expect(projection.digestMaterial).toEqual({
      schemaVersion: 1,
      includeArtifacts: false,
      webSearch: true,
    });
    expect(projection.descriptors).toHaveLength(1);
    expect(projection.descriptors[0]?.key).toBe("web_search");
    await expect(
      projection.descriptors[0]!.executeCanonical({ query: "latest fact" }),
    ).resolves.toEqual({
      modelOutput: {
        answer: "Current answer",
        sources: [{ url: "https://example.com/source" }],
      },
    });
    expect(search).toHaveBeenCalledWith({ query: "latest fact" });
  });
});
