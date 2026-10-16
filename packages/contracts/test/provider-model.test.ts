import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { FormatRegistry } from "@sinclair/typebox/type";

import {
  parseProviderModelCatalogDocument,
  ProviderModelContractError,
  resolveProviderModelParameters,
} from "../src/provider-model/index.js";
import { ProviderModelCatalogEntrySchema } from "../src/api/schemas.js";

const identityEvidence = [
  {
    kind: "provider_api" as const,
    reference: "openrouter.images.models",
    observedAt: "2026-08-12T06:00:00.000Z",
    sourceDigest: `sha256:${"f".repeat(64)}`,
    confidence: "high" as const,
    claim: "identity" as const,
  },
];

const supportedEvidence = [
  {
    kind: "provider_api" as const,
    reference: "openrouter.images.models",
    observedAt: "2026-08-12T06:00:00.000Z",
    sourceDigest: `sha256:${"f".repeat(64)}`,
    confidence: "high" as const,
    claim: "supported" as const,
  },
];

describe("provider model contracts", () => {
  it("accepts text.generate only with explicit supported evidence", () => {
    const catalog = parseProviderModelCatalogDocument({
      schemaVersion: 1,
      providerPreset: "tokenhub",
      discoveryMethod: "administrator.agent-model-review",
      sourceDigest: `sha256:${"c".repeat(64)}`,
      models: [
        {
          providerModelId: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          inputModalities: ["text"],
          outputModalities: ["text"],
          operations: {
            "text.generate": {
              apiSurfaces: ["chat.completions.v1"],
              parameters: [],
              evidence: [
                {
                  kind: "administrator",
                  reference: "workspace-agent-model-review",
                  observedAt: "2026-08-24T10:00:00.000Z",
                  sourceDigest: `sha256:${"c".repeat(64)}`,
                  confidence: "high",
                  claim: "supported",
                },
              ],
            },
          },
          completeness: "partial",
          evidence: identityEvidence,
        },
      ],
    });

    expect(catalog.models[0]?.operations["text.generate"]).toMatchObject({
      apiSurfaces: ["chat.completions.v1"],
    });
  });

  it("parses a bounded discovered image model catalog", () => {
    expect(
      parseProviderModelCatalogDocument({
        schemaVersion: 1,
        providerPreset: "openrouter",
        discoveryMethod: "openrouter.images.models",
        sourceDigest: `sha256:${"a".repeat(64)}`,
        models: [
          {
            providerModelId: "openai/gpt-image-1",
            displayName: "GPT Image 1",
            inputModalities: ["text", "image"],
            outputModalities: ["image"],
            operations: {
              "image.generate": {
                apiSurfaces: ["images.generations.v1"],
                parameters: [
                  {
                    key: "resolution",
                    label: "Resolution",
                    valueType: "enum",
                    values: ["1k", "2k"],
                    required: false,
                    evidence: supportedEvidence,
                  },
                ],
                evidence: supportedEvidence,
              },
              "image.edit": {
                apiSurfaces: ["images.generations.v1"],
                parameters: [],
                evidence: supportedEvidence,
              },
            },
            completeness: "complete",
            evidence: identityEvidence,
          },
        ],
      }),
    ).toMatchObject({
      providerPreset: "openrouter",
      models: [
        {
          providerModelId: "openai/gpt-image-1",
          operations: {
            "image.generate": {
              parameters: [
                {
                  key: "resolution",
                  values: ["1k", "2k"],
                },
              ],
            },
            "image.edit": {
              apiSurfaces: ["images.generations.v1"],
            },
          },
        },
      ],
    });
  });

  it("rejects duplicate catalog model identities", () => {
    const model = {
      providerModelId: "duplicate",
      displayName: "Duplicate",
      inputModalities: ["text"],
      outputModalities: ["image"],
      operations: {},
      completeness: "identity_only",
      evidence: identityEvidence,
    };
    expect(() =>
      parseProviderModelCatalogDocument({
        schemaVersion: 1,
        providerPreset: "openai",
        discoveryMethod: "openai.models",
        sourceDigest: `sha256:${"b".repeat(64)}`,
        models: [model, model],
      }),
    ).toThrow(ProviderModelContractError);
  });

  it("resolves caller values inside model and route bounds", () => {
    expect(
      resolveProviderModelParameters({
        definitions: [
          {
            key: "resolution",
            label: "Resolution",
            valueType: "enum",
            values: ["1k", "2k", "4k"],
            required: false,
            evidence: supportedEvidence,
          },
          {
            key: "outputCompression",
            label: "Output compression",
            valueType: "integer",
            minimum: 0,
            maximum: 100,
            required: false,
            evidence: supportedEvidence,
          },
        ],
        policies: {
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
        callerValues: {
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

  it("accepts the full unsigned 32-bit range used by image seeds", () => {
    expect(
      resolveProviderModelParameters({
        definitions: [
          {
            key: "seed",
            label: "Seed",
            valueType: "integer",
            minimum: 0,
            maximum: 4_294_967_295,
            required: false,
            evidence: supportedEvidence,
          },
        ],
        policies: {
          seed: {
            callerPolicy: "optional",
            maximum: 4_294_967_295,
          },
        },
        callerValues: {
          seed: 4_294_967_295,
        },
      }),
    ).toMatchObject({
      values: {
        seed: 4_294_967_295,
      },
    });
  });

  it("rejects fixed overrides and values outside route bounds", () => {
    const definitions = [
      {
        key: "quality",
        label: "Quality",
        valueType: "enum" as const,
        values: ["low", "high"],
        required: false,
        evidence: supportedEvidence,
      },
    ];
    expect(() =>
      resolveProviderModelParameters({
        definitions,
        policies: {
          quality: {
            callerPolicy: "fixed",
            defaultValue: "high",
          },
        },
        callerValues: {
          quality: "low",
        },
      }),
    ).toThrow("cannot override fixed parameter");
    expect(() =>
      resolveProviderModelParameters({
        definitions,
        policies: {
          quality: {
            callerPolicy: "optional",
            defaultValue: "low",
            allowedValues: ["low"],
          },
        },
        callerValues: {
          quality: "high",
        },
      }),
    ).toThrow("outside the effective model and route bounds");
  });

  it("rejects flat capabilities and mismatched completeness", () => {
    const base = {
      providerModelId: "image-model",
      displayName: "Image model",
      inputModalities: ["text"],
      outputModalities: ["image"],
      evidence: identityEvidence,
    };
    expect(() =>
      parseProviderModelCatalogDocument({
        schemaVersion: 1,
        providerPreset: "openai",
        discoveryMethod: "openai.models",
        sourceDigest: `sha256:${"c".repeat(64)}`,
        models: [
          {
            ...base,
            capabilities: ["image.generate"],
            apiSurfaces: ["images.generations.v1"],
            parameters: [],
            operations: {},
            completeness: "identity_only",
          },
        ],
      }),
    ).toThrow("legacy flat operation fields");
    expect(() =>
      parseProviderModelCatalogDocument({
        schemaVersion: 1,
        providerPreset: "openai",
        discoveryMethod: "openai.models",
        sourceDigest: `sha256:${"d".repeat(64)}`,
        models: [
          {
            ...base,
            operations: {
              "image.generate": {
                apiSurfaces: ["images.generations.v1"],
                parameters: [],
                evidence: supportedEvidence,
              },
            },
            completeness: "identity_only",
          },
        ],
      }),
    ).toThrow("must be empty for identity-only");
    expect(() =>
      parseProviderModelCatalogDocument({
        schemaVersion: 1,
        providerPreset: "openai",
        discoveryMethod: "openai.models",
        sourceDigest: `sha256:${"e".repeat(64)}`,
        models: [
          {
            ...base,
            operations: {},
            completeness: "partial",
          },
        ],
      }),
    ).toThrow("requires at least one evidenced operation");
  });

  it("rejects extension fields and impossible image operation modalities", () => {
    const model = {
      providerModelId: "image-model",
      displayName: "Image model",
      inputModalities: ["text"],
      outputModalities: ["text"],
      operations: {
        "image.generate": {
          apiSurfaces: ["images.generations.v1"],
          parameters: [],
          evidence: supportedEvidence,
        },
      },
      completeness: "partial",
      evidence: identityEvidence,
    };
    expect(() =>
      parseProviderModelCatalogDocument({
        schemaVersion: 1,
        providerPreset: "openai",
        discoveryMethod: "openai.models",
        sourceDigest: `sha256:${"d".repeat(64)}`,
        models: [
          {
            ...model,
            inventedCapability: true,
          },
        ],
      }),
    ).toThrow("inventedCapability is unsupported");
    expect(() =>
      parseProviderModelCatalogDocument({
        schemaVersion: 1,
        providerPreset: "openai",
        discoveryMethod: "openai.models",
        sourceDigest: `sha256:${"d".repeat(64)}`,
        models: [model],
      }),
    ).toThrow("without image output");
  });

  it("keeps the API schema aligned with operation-scoped catalogs", () => {
    FormatRegistry.Set(
      "date-time",
      (value) =>
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString() === value,
    );
    const common = {
      providerModelId: "image-model",
      displayName: "Image model",
      inputModalities: ["text"],
      outputModalities: ["image"],
      evidence: identityEvidence,
    };
    expect(
      Value.Check(ProviderModelCatalogEntrySchema, {
        ...common,
        operations: {},
        completeness: "identity_only",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProviderModelCatalogEntrySchema, {
        providerModelId: "text-model",
        displayName: "Text model",
        inputModalities: ["text"],
        outputModalities: ["text"],
        evidence: identityEvidence,
        operations: {
          "text.generate": {
            apiSurfaces: ["chat.completions.v1"],
            parameters: [],
            evidence: supportedEvidence,
          },
        },
        completeness: "partial",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProviderModelCatalogEntrySchema, {
        ...common,
        operations: {
          "image.generate": {
            apiSurfaces: ["images.generations.v1"],
            parameters: [],
            evidence: supportedEvidence,
          },
        },
        completeness: "partial",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProviderModelCatalogEntrySchema, {
        ...common,
        capabilities: ["image.generate"],
        apiSurfaces: ["images.generations.v1"],
        parameters: [],
        operations: {},
        completeness: "identity_only",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProviderModelCatalogEntrySchema, {
        ...common,
        operations: {},
        completeness: "partial",
      }),
    ).toBe(false);
  });
});
