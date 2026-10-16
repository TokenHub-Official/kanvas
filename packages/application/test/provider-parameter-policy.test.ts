import { describe, expect, it } from "vitest";

import {
  compileEffectiveProviderParameters,
  DomainError,
  parseModelProfileDocumentV1,
} from "../src/index.js";

const evidence = Object.freeze([
  Object.freeze({
    kind: "provider_api" as const,
    reference: "provider.models.image",
    observedAt: "2026-08-12T06:00:00.000Z",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    confidence: "high" as const,
    claim: "supported" as const,
  }),
]);

const profile = Object.freeze({
  schemaVersion: 1,
  model: Object.freeze({
    displayName: "GPT Image 2",
    family: "gpt-image",
    inputModalities: Object.freeze(["text", "image"]),
    outputModalities: Object.freeze(["image"]),
  }),
  operations: Object.freeze({
    "image.generate": Object.freeze({
      parameters: Object.freeze([
        Object.freeze({
          key: "resolution",
          label: "Resolution",
          required: false,
          valueType: "enum",
          values: Object.freeze(["1k", "2k", "4k"]),
          evidence,
        }),
        Object.freeze({
          key: "outputCompression",
          label: "Output compression",
          required: false,
          valueType: "integer",
          minimum: 0,
          maximum: 100,
          step: 5,
          evidence,
        }),
      ]),
      evidence,
    }),
    "image.edit": Object.freeze({
      parameters: Object.freeze([
        Object.freeze({
          key: "quality",
          label: "Quality",
          required: true,
          valueType: "enum",
          values: Object.freeze(["low", "high"]),
          evidence,
        }),
      ]),
      evidence,
    }),
  }),
  sources: Object.freeze([
    Object.freeze({
      kind: "provider" as const,
      reference: "provider.models.image",
      observedAt: "2026-08-12T06:00:00.000Z",
      sourceDigest: `sha256:${"a".repeat(64)}`,
    }),
  ]),
});

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected DomainError ${code}.`);
}

describe("ModelProfileDocumentV1", () => {
  it("accepts an evidenced text.generate profile without an image operation", () => {
    const parsed = parseModelProfileDocumentV1({
      schemaVersion: 1,
      model: {
        displayName: "DeepSeek V4 Flash",
        family: "deepseek",
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCall: true,
      },
      operations: {
        "text.generate": {
          parameters: [],
          evidence,
        },
      },
      sources: [],
    });

    expect(parsed.operations["text.generate"]?.parameters).toEqual([]);
  });

  it("strictly parses immutable model identity and image operations", () => {
    const parsed = parseModelProfileDocumentV1(profile);

    expect(parsed).toEqual(profile);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.model)).toBe(true);
    expect(Object.isFrozen(parsed.operations)).toBe(true);
    expect(
      Object.isFrozen(parsed.operations["image.generate"]?.parameters),
    ).toBe(true);
  });

  it("rejects unknown fields at document, operation, and parameter boundaries", () => {
    expectCode(
      () =>
        parseModelProfileDocumentV1({
          ...profile,
          credential: "must-not-pass",
        }),
      "model_profile.invalid",
    );
    expectCode(
      () =>
        parseModelProfileDocumentV1({
          ...profile,
          operations: {
            "image.generate": {
              ...profile.operations["image.generate"],
              providerBody: {},
            },
          },
        }),
      "model_profile.invalid",
    );
    expectCode(
      () =>
        parseModelProfileDocumentV1({
          ...profile,
          operations: {
            "image.generate": {
              ...profile.operations["image.generate"],
              parameters: [
                {
                  ...profile.operations["image.generate"].parameters[0],
                  wirePath: "$.resolution",
                },
              ],
            },
          },
        }),
      "model_profile.invalid",
    );
  });

  it("rejects empty or unsupported operation maps", () => {
    expectCode(
      () =>
        parseModelProfileDocumentV1({
          ...profile,
          operations: {},
        }),
      "model_profile.invalid",
    );
    expectCode(
      () =>
        parseModelProfileDocumentV1({
          ...profile,
          operations: {
            "image.video": profile.operations["image.generate"],
          },
        }),
      "model_profile.invalid",
    );
    expect(
      parseModelProfileDocumentV1({
        ...profile,
        operations: {
          "image.generate": {
            ...profile.operations["image.generate"],
            parameters: [],
          },
        },
      }).operations["image.generate"]?.parameters,
    ).toEqual([]);
  });
});

describe("compileEffectiveProviderParameters", () => {
  it("resolves the Capability, model, and Route intersection", () => {
    expect(
      compileEffectiveProviderParameters({
        modelProfileDocument: profile,
        capabilityKey: "image.generate",
        capabilityParameterKeys: ["resolution", "outputCompression"],
        routeParameterPolicies: {
          resolution: {
            callerPolicy: "optional",
            defaultValue: "1k",
            allowedValues: ["1k", "2k"],
          },
          outputCompression: {
            callerPolicy: "fixed",
            defaultValue: 80,
            minimum: 50,
            maximum: 90,
          },
        },
        callerParameterValues: {
          resolution: "2k",
        },
      }),
    ).toEqual({
      values: {
        resolution: "2k",
        outputCompression: 80,
      },
      facts: [
        {
          key: "resolution",
          value: "2k",
          source: "caller",
        },
        {
          key: "outputCompression",
          value: 80,
          source: "route_default",
        },
      ],
    });
  });

  it("rejects fixed policies without defaults and required policies with defaults", () => {
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["resolution"],
          routeParameterPolicies: {
            resolution: {
              callerPolicy: "fixed",
            },
          },
          callerParameterValues: {},
        }),
      "effective_provider_parameters.invalid",
    );
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["resolution"],
          routeParameterPolicies: {
            resolution: {
              callerPolicy: "required",
              defaultValue: "1k",
            },
          },
          callerParameterValues: {
            resolution: "1k",
          },
        }),
      "effective_provider_parameters.invalid",
    );
  });

  it("accepts a caller-required value without a Route default", () => {
    expect(
      compileEffectiveProviderParameters({
        modelProfileDocument: profile,
        capabilityKey: "image.edit",
        capabilityParameterKeys: ["quality"],
        routeParameterPolicies: {
          quality: {
            callerPolicy: "required",
            allowedValues: ["high"],
          },
        },
        callerParameterValues: {
          quality: "high",
        },
      }),
    ).toEqual({
      values: {
        quality: "high",
      },
      facts: [
        {
          key: "quality",
          value: "high",
          source: "caller",
        },
      ],
    });
  });

  it("rejects unknown Route policy fields and missing policies for required model parameters", () => {
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["resolution"],
          routeParameterPolicies: {
            resolution: {
              callerPolicy: "fixed",
              defaultValue: "1k",
              providerField: "resolution",
            },
          },
          callerParameterValues: {},
        }),
      "effective_provider_parameters.invalid",
    );
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.edit",
          capabilityParameterKeys: ["quality"],
          routeParameterPolicies: {},
          callerParameterValues: {},
        }),
      "effective_provider_parameters.invalid",
    );
  });

  it("rejects Route domains that exceed or do not intersect the model", () => {
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["resolution"],
          routeParameterPolicies: {
            resolution: {
              callerPolicy: "optional",
              defaultValue: "1k",
              allowedValues: ["1k", "8k"],
            },
          },
          callerParameterValues: {},
        }),
      "effective_provider_parameters.invalid",
    );
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["outputCompression"],
          routeParameterPolicies: {
            outputCompression: {
              callerPolicy: "fixed",
              defaultValue: 80,
              minimum: -5,
              maximum: 90,
            },
          },
          callerParameterValues: {},
        }),
      "effective_provider_parameters.invalid",
    );
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: {
            ...profile,
            operations: {
              "image.generate": {
                ...profile.operations["image.generate"],
                parameters: [
                  {
                    key: "steps",
                    label: "Steps",
                    required: false,
                    valueType: "integer",
                    minimum: 0,
                    maximum: 10,
                    step: 10,
                    evidence,
                  },
                ],
              },
            },
          },
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["steps"],
          routeParameterPolicies: {
            steps: {
              callerPolicy: "required",
              minimum: 1,
              maximum: 9,
            },
          },
          callerParameterValues: {
            steps: 5,
          },
        }),
      "effective_provider_parameters.invalid",
    );
  });

  it("rejects parameters outside the Capability or selected Route", () => {
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["outputCompression"],
          routeParameterPolicies: {
            resolution: {
              callerPolicy: "fixed",
              defaultValue: "1k",
            },
          },
          callerParameterValues: {},
        }),
      "effective_provider_parameters.invalid",
    );
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: profile,
          capabilityKey: "image.generate",
          capabilityParameterKeys: ["resolution"],
          routeParameterPolicies: {},
          callerParameterValues: {
            resolution: "1k",
          },
        }),
      "effective_provider_parameters.invalid",
    );
  });

  it("requires the selected operation", () => {
    expectCode(
      () =>
        compileEffectiveProviderParameters({
          modelProfileDocument: {
            ...profile,
            operations: {
              "image.generate": profile.operations["image.generate"],
            },
          },
          capabilityKey: "image.edit",
          capabilityParameterKeys: ["quality"],
          routeParameterPolicies: {
            quality: {
              callerPolicy: "fixed",
              defaultValue: "high",
            },
          },
          callerParameterValues: {},
        }),
      "effective_provider_parameters.invalid",
    );
  });
});
