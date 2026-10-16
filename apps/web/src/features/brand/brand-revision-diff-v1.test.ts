import { describe, expect, it } from "vitest";

import { brandRevisionChangesV1 } from "./brand-revision-diff-v1.js";

const base = {
  name: "Acme",
  colors: [
    {
      key: "color.primary",
      name: "主色",
      role: "primary" as const,
      value: "#2457F5",
      position: 0,
    },
  ],
  logos: [],
  referenceImages: [],
  textStyles: [],
  guidelines: { principles: ["清晰"], avoid: ["夸张"] },
};

describe("brandRevisionChangesV1", () => {
  it("reports user-facing collection changes without exposing stable keys", () => {
    const changes = brandRevisionChangesV1(base, {
      ...base,
      colors: [
        { ...base.colors[0]!, value: "#FF5C35" },
        {
          key: "color.accent",
          name: "强调色",
          role: "accent",
          value: "#F6C845",
          position: 1,
        },
      ],
      guidelines: { principles: ["清晰", "准确"], avoid: ["夸张"] },
    });

    expect(changes).toMatchObject({
      colors: { added: ["强调色"], changed: ["主色"], removed: [] },
      guidelinesChanged: true,
      hasChanges: true,
    });
    expect(JSON.stringify(changes)).not.toContain("color.primary");
  });

  it("reports equivalent documents as unchanged", () => {
    expect(brandRevisionChangesV1(base, base).hasChanges).toBe(false);
  });
});
