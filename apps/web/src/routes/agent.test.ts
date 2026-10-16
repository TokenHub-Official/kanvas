import { describe, expect, it } from "vitest";

import {
  agentSelectedElementKeys,
  validateAgentCanvasSearch,
} from "../features/agent/agent-entry-search.js";

describe("Agent route Canvas handoff", () => {
  it("carries a complete brand selection and rejects invalid or partial identifiers", () => {
    const brand = {
      brandKitId: "01K00000000000000000000001",
      brandKitRevisionId: "01K00000000000000000000002",
    };
    expect(validateAgentCanvasSearch(brand)).toMatchObject(brand);
    expect(
      validateAgentCanvasSearch({
        brandKitRevisionId: brand.brandKitRevisionId,
      }),
    ).not.toHaveProperty("brandKitRevisionId");
    expect(
      validateAgentCanvasSearch({ ...brand, brandKitId: "not-an-id" }),
    ).not.toHaveProperty("brandKitId");
  });
  it("recovers bounded selection keys after TanStack search serialization", () => {
    expect(agentSelectedElementKeys('["headline","subtitle"]')).toEqual([
      "headline",
      "subtitle",
    ]);
    expect(
      agentSelectedElementKeys(["headline", "headline", "bad key"]),
    ).toEqual(["headline"]);
  });

  it("shares the same structured Canvas search contract with existing threads", () => {
    expect(
      validateAgentCanvasSearch({
        canvasDraftId: "01K00000000000000000000001",
        canvasDraftVersion: "3",
        selectedElementKeys: '["headline"]',
      }),
    ).toMatchObject({
      canvasDraftVersion: 3,
      selectedElementKeys: ["headline"],
    });
  });
});

it("preserves a fresh draft identity on refresh and rejects malformed identities", () => {
  const draftId = "76d97f53-3e71-4f6b-a270-d7c74aeb0b2c";
  expect(validateAgentCanvasSearch({ draftId })).toEqual({ draftId });
  expect(validateAgentCanvasSearch({ draftId: "../other" })).not.toHaveProperty(
    "draftId",
  );
});
