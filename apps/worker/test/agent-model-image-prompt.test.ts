import type { KanvasAgentModelRequest } from "@kanvas/agent-runtime";
import { describe, expect, it } from "vitest";
import { agentModelPrompt } from "../src/agent/ai-sdk-agent-model-transport.js";

const request: KanvasAgentModelRequest = {
  schemaVersion: "kanvas.agent-model-request/v1",
  controls: { reasoningLevel: "off", webSearchMode: "off" },
  tools: [],
  prompt: [
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "skill_read",
          toolCallId: "logo",
          output: {
            type: "content",
            value: [
              { type: "text", text: "Logo artifact" },
              { type: "image-data", data: "AQID", mediaType: "image/png" },
            ],
          },
        },
      ],
    },
  ],
};
describe("Agent image tool results at the provider boundary", () => {
  it("sends Chat images as actual image inputs rather than JSON in a tool message", () => {
    const result = agentModelPrompt(request, true, true);
    expect(result).toHaveLength(2);
    expect(JSON.stringify(result[0])).not.toContain("AQID");
    expect(result[1]?.role).toBe("user");
    expect(result[1]?.content).toContainEqual({
      type: "file",
      data: "AQID",
      mediaType: "image/png",
    });
  });
  it("does not pretend a text-only model can see an image", () => {
    const result = agentModelPrompt(request, false, true);
    expect(JSON.stringify(result)).not.toContain("AQID");
    expect(JSON.stringify(result)).toContain("cannot view images");
  });
});
