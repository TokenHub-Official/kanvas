import { describe, expect, it } from "vitest";
import { AgentHubAgentAvatarSchema } from "@kanvas/contracts/api";
import { agentAvatarIconOptions } from "./agent-avatar.js";

import { centeredSquareCrop } from "./agent-avatar-editor.js";

describe("Agent avatar crop", () => {
  it("centers a square crop for landscape and portrait images", () => {
    expect(centeredSquareCrop(1_200, 800)).toEqual({ x: 200, y: 0, size: 800 });
    expect(centeredSquareCrop(600, 1_000)).toEqual({ x: 0, y: 200, size: 600 });
    expect(centeredSquareCrop(1_200, 800, "left")).toEqual({
      x: 0,
      y: 0,
      size: 800,
    });
    expect(centeredSquareCrop(1_200, 800, "right")).toEqual({
      x: 400,
      y: 0,
      size: 800,
    });
    expect(centeredSquareCrop(600, 1_000, "top")).toEqual({
      x: 0,
      y: 0,
      size: 600,
    });
    expect(centeredSquareCrop(600, 1_000, "bottom")).toEqual({
      x: 0,
      y: 400,
      size: 600,
    });
  });
});

describe("Agent semantic avatar catalog", () => {
  it("keeps every selectable icon admissible for save and readback", () => {
    expect(new Set(agentAvatarIconOptions.map((item) => item.value)).size).toBe(
      agentAvatarIconOptions.length,
    );
    const allowed =
      AgentHubAgentAvatarSchema.anyOf[1].properties.value.anyOf.map(
        (item) => item.const,
      );
    expect(new Set(agentAvatarIconOptions.map((item) => item.value))).toEqual(
      new Set(allowed),
    );
  });
});
