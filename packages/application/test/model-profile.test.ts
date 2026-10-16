import { describe, expect, it } from "vitest";

import {
  compileEffectiveProviderParameters,
  DomainError,
  parseModelProfileDocumentV1,
  parseTextGenerationModelProfile,
} from "../src/index.js";

const evidence = [
  {
    kind: "provider_api",
    reference: "provider.models",
    observedAt: "2026-08-27T00:00:00.000Z",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    confidence: "high",
    claim: "supported",
  },
];

describe("ModelProfileDocumentV1", () => {
  it("compiles operation parameters without encoding Provider route identity", () => {
    const profile = {
      schemaVersion: 1,
      model: {
        slug: "vendor/image-test",
        displayName: "Image Test",
        family: "image-test",
        description: "Canonical image model",
        inputModalities: ["text"],
        outputModalities: ["image"],
        contextWindow: 8_192,
        maximumOutputTokens: 1_024,
      },
      operations: {
        "image.generate": {
          parameters: [
            {
              key: "quality",
              label: "Quality",
              required: false,
              valueType: "enum",
              values: ["medium", "high"],
              evidence,
            },
          ],
          evidence,
        },
      },
      sources: [],
    };

    expect(
      compileEffectiveProviderParameters({
        modelProfileDocument: profile,
        capabilityKey: "image.generate",
        capabilityParameterKeys: ["quality"],
        routeParameterPolicies: {
          quality: { callerPolicy: "optional", defaultValue: "medium" },
        },
        callerParameterValues: { quality: "high" },
      }).values,
    ).toEqual({ quality: "high" });
    expect(profile.operations["image.generate"]).not.toHaveProperty(
      "apiSurfaces",
    );
  });

  it("preserves official mixed-case model slugs", () => {
    const profile = parseModelProfileDocumentV1({
      schemaVersion: 1,
      model: {
        slug: "minimax/MiniMax-M3",
        displayName: "MiniMax M3",
        family: "minimax-m3",
        description: "MiniMax M3 model",
        inputModalities: ["text"],
        outputModalities: ["text"],
        contextWindow: 1_000_000,
        maximumOutputTokens: 128_000,
      },
      operations: {
        "text.generate": { parameters: [], evidence },
      },
      sources: [
        {
          kind: "models_dev",
          reference: "minimax/MiniMax-M3",
          observedAt: "2026-08-27T00:00:00.000Z",
          sourceDigest: `sha256:${"b".repeat(64)}`,
        },
      ],
    });
    expect(profile.model.slug).toBe("minimax/MiniMax-M3");
  });

  it("keeps canonical Model identity independent from Provider identity", () => {
    const profile = parseModelProfileDocumentV1({
      schemaVersion: 1,
      model: {
        slug: "openai/gpt-test",
        displayName: "GPT Test",
        family: "gpt-test",
        description: "Canonical test model",
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        contextWindow: 1_000_000,
        maximumInputTokens: 900_000,
        maximumOutputTokens: 128_000,
        reasoning: true,
        toolCall: true,
      },
      operations: {
        "text.generate": {
          parameters: [],
          evidence,
        },
      },
      sources: [
        {
          kind: "models_dev",
          reference: "openai/gpt-test",
          observedAt: "2026-08-27T00:00:00.000Z",
          sourceDigest: `sha256:${"b".repeat(64)}`,
        },
      ],
    });
    expect(profile.model).toMatchObject({
      slug: "openai/gpt-test",
      displayName: "GPT Test",
      contextWindow: 1_000_000,
    });
    expect(profile.model).not.toHaveProperty("providerPreset");
    expect(profile.model).not.toHaveProperty("providerModelId");
    expect(profile.operations["text.generate"]).toBeDefined();
    expect(parseTextGenerationModelProfile(profile)).toEqual({
      displayName: "GPT Test",
      parameters: [],
    });
  });

  it("rejects Provider identity and invalid token limits", () => {
    expect(() =>
      parseModelProfileDocumentV1({
        schemaVersion: 1,
        model: {
          slug: "openai/gpt-test",
          displayName: "GPT Test",
          family: "gpt-test",
          description: "Canonical test model",
          inputModalities: ["text"],
          outputModalities: ["text"],
          contextWindow: 100,
          maximumInputTokens: 101,
          maximumOutputTokens: 10,
          providerModelId: "must-not-pass",
        },
        operations: {
          "text.generate": {
            parameters: [],
            evidence,
          },
        },
        sources: [],
      }),
    ).toThrow(DomainError);
  });

  it("accepts only the current v1 document", () => {
    for (const schemaVersion of [2, 3]) {
      expect(() =>
        parseModelProfileDocumentV1({
          schemaVersion,
          model: {
            displayName: "Legacy profile",
            family: "legacy",
            inputModalities: ["text"],
            outputModalities: ["text"],
          },
          operations: {
            "text.generate": { parameters: [], evidence },
          },
          sources: [],
        }),
      ).toThrow(DomainError);
    }
  });
});
