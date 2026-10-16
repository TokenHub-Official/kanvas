import { describe, expect, it } from "vitest";

import {
  effectiveAgentModelCapabilities,
  selectAgentWebSearchMode,
} from "../src/agent/effective-agent-model-capabilities.js";

const evidence = [
  {
    kind: "administrator" as const,
    reference: "capability-test",
    observedAt: "2026-08-28T00:00:00.000Z",
    sourceDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    confidence: "high" as const,
    claim: "supported" as const,
  },
];

describe("effectiveAgentModelCapabilities", () => {
  it("projects only evidence-backed model inputs and controls", () => {
    const capabilities = effectiveAgentModelCapabilities({
      protocolKind: "gemini_generate_content",
      modelProfile: {
        schemaVersion: 1,
        model: {
          slug: "gemini-test",
          displayName: "Gemini Test",
          family: "gemini-test",
          description: "Test model.",
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          contextWindow: 128_000,
          maximumOutputTokens: 8_192,
          attachment: true,
          reasoning: true,
          toolCall: true,
          structuredOutput: true,
          temperature: true,
        },
        operations: {
          "text.generate": {
            parameters: [
              {
                key: "reasoningEffort",
                label: "Reasoning",
                required: false,
                valueType: "enum",
                values: ["low", "high"],
                evidence,
              },
              {
                key: "webSearch",
                label: "Web search",
                required: false,
                valueType: "boolean",
                evidence,
              },
            ],
            evidence,
          },
        },
        sources: [
          {
            kind: "manual",
            reference: "capability-test",
            observedAt: "2026-08-28T00:00:00.000Z",
            sourceDigest:
              "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        ],
      },
    });

    expect(capabilities).toMatchObject({
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      reasoning: true,
      reasoningLevels: ["low", "high"],
      webSearch: "native",
      toolCalling: true,
      structuredOutput: true,
    });
    expect(capabilities.acceptedProviderParameters).toEqual(
      new Set([
        "reasoningEffort",
        "webSearch",
        "maxOutputTokens",
        "responseFormat",
        "temperature",
      ]),
    );
  });

  it("selects native, function-tool fallback, disabled and unavailable search", () => {
    expect(
      selectAgentWebSearchMode({
        requested: "auto",
        nativeAvailable: true,
        nativeToolCompatible: true,
        toolAvailable: true,
      }),
    ).toBe("native");
    expect(
      selectAgentWebSearchMode({
        requested: "auto",
        nativeAvailable: true,
        nativeToolCompatible: false,
        toolAvailable: true,
      }),
    ).toBe("tool");
    expect(
      selectAgentWebSearchMode({
        requested: "off",
        nativeAvailable: true,
        nativeToolCompatible: true,
        toolAvailable: true,
      }),
    ).toBe("disabled");
    expect(
      selectAgentWebSearchMode({
        requested: "required",
        nativeAvailable: false,
        nativeToolCompatible: true,
        toolAvailable: false,
      }),
    ).toBe("unavailable");
  });
});
