import { describe, expect, it, vi } from "vitest";

import {
  createBrandCommandToolProjection,
  parseBrandPublishProposalToolInput,
} from "../src/brand-command-tool-view.js";

const brandKitId = "01K00000000000000000000001";

describe("Brand command ToolView", () => {
  it("exposes read, draft mutation, and reviewable publication commands", () => {
    const unavailable = () => Promise.reject(new Error("unused"));
    const projection = createBrandCommandToolProjection({
      list: unavailable,
      inspectDraft: unavailable,
      createDraft: unavailable,
      updateDraft: unavailable,
      proposePublish: unavailable,
    });

    expect(projection.family).toBe("brand_command");
    expect(projection.descriptors.map((descriptor) => descriptor.key)).toEqual([
      "brand.list",
      "brand.inspect-draft",
      "brand.create-draft",
      "brand.update-draft",
      "brand.propose-publish",
    ]);
    expect(projection.descriptors.at(-1)?.approvalMode).toBe("before-commit");
  });

  it("passes a bounded publication proposal to the executor", async () => {
    const proposePublish = vi.fn(() =>
      Promise.resolve({ modelOutput: { status: "awaiting_approval" } }),
    );
    const unavailable = () => Promise.reject(new Error("unused"));
    const projection = createBrandCommandToolProjection({
      list: unavailable,
      inspectDraft: unavailable,
      createDraft: unavailable,
      updateDraft: unavailable,
      proposePublish,
    });
    const input = { brandKitId, expectedDraftVersion: 3 };

    await projection.descriptors.at(-1)?.executeCanonical(input);

    expect(proposePublish).toHaveBeenCalledWith(input);
    expect(parseBrandPublishProposalToolInput(input)).toEqual(input);
    expect(() =>
      parseBrandPublishProposalToolInput({ ...input, publishLatest: true }),
    ).toThrow("invalid");
  });
});
