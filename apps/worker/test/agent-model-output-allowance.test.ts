import { describe, expect, it } from "vitest";
import { recoverAgentContextAllowance } from "../src/agent/agent-model-output-allowance.js";

const payload = {
  model: "alias",
  messages: [{ role: "user", content: "long context" }],
  tools: [{ name: "produce" }],
  max_tokens: 64000,
};
const rejection = (message: string) => ({
  error: { type: "invalid_request_error", message },
});

describe("context allowance recovery", () => {
  it("uses the supplier's input count, retaining the prompt and tools", () => {
    expect(
      recoverAgentContextAllowance(
        payload,
        rejection(
          "input length and `max_tokens` exceed context limit: 180000 + 64000 > 200000",
        ),
      ),
    ).toEqual({ ...payload, max_tokens: 20000 });
  });
  it("includes all input overhead in OpenAI's reported total", () => {
    expect(
      recoverAgentContextAllowance(payload, {
        error: {
          code: "context_length_exceeded",
          message:
            "This model's maximum context length is 200000 tokens. However, you requested 244000 tokens (179000 in the messages, 1000 in the functions, 64000 in the completion).",
        },
      }),
    ).toEqual({ ...payload, max_tokens: 20000 });
  });
  it.each([
    "input length and max_tokens exceed context limit: 200001 + 64000 > 200000",
    "input length and max_tokens exceed context limit: 200000 + 64000 > 200000",
    "input length and max_tokens exceed context limit: 180000 + 32000 > 200000",
    "input length and max_tokens exceed context limit: 1000 + 64000 > 200000",
    "input length and max_tokens exceed context limit: 90071992547409930 + 64000 > 90071992547409931",
    "prompt too long",
  ])(
    "does not guess a budget from inconsistent/insufficient counts: %s",
    (message) => {
      expect(
        recoverAgentContextAllowance(payload, rejection(message)),
      ).toBeUndefined();
    },
  );
  it("does not silently disable thinking when context leaves no room", () => {
    expect(
      recoverAgentContextAllowance(
        { ...payload, thinking: { type: "enabled", budget_tokens: 20000 } },
        rejection(
          "input length and max_tokens exceed context limit: 180000 + 64000 > 200000",
        ),
      ),
    ).toBeUndefined();
  });
  it("does not invent an output limit for an omitted parameter", () => {
    expect(
      recoverAgentContextAllowance(
        { model: "alias" },
        rejection(
          "input length and max_tokens exceed context limit: 180000 + 64000 > 200000",
        ),
      ),
    ).toBeUndefined();
  });
});
