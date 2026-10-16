import type {
  CapabilityAdminSummary,
  ModelResourceSummary,
  RuntimeAdapterSummary,
} from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  capabilityImplementationBody,
  compatibleRuntimeAdapters,
  emptyCapabilityImplementationDraft,
  selectCapabilityImplementationAdapter,
} from "./capability-implementation-editor.js";

const definition = {
  id: "01K00000000000000000000001",
  key: "image.example.process",
  status: "active",
  version: 1,
  contractRevisionId: "01K00000000000000000000002",
  contractRevision: 1,
  contractDigest: `sha256:${"a".repeat(64)}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["image"],
    properties: {
      image: {
        type: "string",
        examples: ["01K00000000000000000000003"],
        "x-kanvas-semantic-type": "artifact.image",
      },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: {
      result: {
        type: "object",
        "x-kanvas-semantic-type": "artifact.image",
      },
    },
  },
  bindings: [],
} as unknown as CapabilityAdminSummary;

const adapter = {
  id: "01K00000000000000000000004",
  key: "kanvas.image.example.v1",
  revision: 1,
  digest: `sha256:${"b".repeat(64)}`,
  displayName: {
    defaultLocale: "en-US",
    values: { "en-US": "Example runtime" },
  },
  executionTarget: "worker",
  sourceKinds: ["model_resource"],
  supportedModelFormats: ["onnx"],
  modelResourceInterfaceDigest: `sha256:${"c".repeat(64)}`,
  invocationInputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["image"],
    properties: {
      image: {
        type: "string",
        "x-kanvas-semantic-type": "artifact.image",
      },
    },
  },
  invocationOutputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["image"],
    properties: {
      image: {
        type: "object",
        "x-kanvas-semantic-type": "artifact.image",
      },
    },
  },
  configurationSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
} as RuntimeAdapterSummary;

describe("capability implementation editor", () => {
  it("maps the public contract to a selected data-defined runtime", () => {
    const selected = selectCapabilityImplementationAdapter(
      {
        ...emptyCapabilityImplementationDraft(definition),
        displayNameZh: "示例运行",
        displayNameEn: "Example runtime",
        source: {
          kind: "model_resource" as const,
          id: "01K00000000000000000000005",
        },
      },
      definition,
      adapter,
    );
    const body = capabilityImplementationBody(
      selected,
      definition,
      adapter,
      [
        {
          revisionId: "01K00000000000000000000005",
        } as never,
      ],
      [],
    );
    expect(body.inputMapping).toMatchObject({
      direction: "input",
      expression: {
        properties: {
          image: {
            op: "source",
            root: "input",
            pointer: "/image",
          },
        },
      },
    });
    expect(body.outputMapping).toMatchObject({
      direction: "output",
      expression: {
        properties: {
          result: {
            root: "result",
            pointer: "/image",
          },
        },
      },
    });
  });

  it("keeps same-named enum fields on their one-to-one identity mapping", () => {
    const enumDefinition = {
      ...definition,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          size: {
            type: "string",
            enum: ["auto", "1024x1024"],
            "x-kanvas-semantic-type": "text.plain",
          },
          quality: {
            type: "string",
            enum: ["auto", "high"],
            "x-kanvas-semantic-type": "text.plain",
          },
        },
      },
    } as CapabilityAdminSummary;
    const enumAdapter = {
      ...adapter,
      invocationInputSchema: enumDefinition.inputSchema,
    };
    const selected = selectCapabilityImplementationAdapter(
      {
        ...emptyCapabilityImplementationDraft(enumDefinition),
        source: { kind: "model_resource", id: "01K00000000000000000000005" },
      },
      enumDefinition,
      enumAdapter,
    );

    expect(selected.inputMappings).toMatchObject([
      { targetKey: "size", sourceKey: "size" },
      { targetKey: "quality", sourceKey: "quality" },
    ]);
  });

  it("does not invent mappings for unrelated optional runtime fields", () => {
    const focusedAdapter = {
      ...adapter,
      invocationInputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["image"],
        properties: {
          image: {
            type: "string",
            "x-kanvas-semantic-type": "artifact.image",
          },
          quality: {
            type: "string",
            "x-kanvas-semantic-type": "text.plain",
          },
          seed: {
            type: "string",
            "x-kanvas-semantic-type": "text.plain",
          },
        },
      },
    } as RuntimeAdapterSummary;
    const focusedDefinition = {
      ...definition,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["image"],
        properties: {
          image: {
            type: "string",
            "x-kanvas-semantic-type": "artifact.image",
          },
          quality: {
            type: "string",
            "x-kanvas-semantic-type": "text.plain",
          },
        },
      },
    } as CapabilityAdminSummary;

    const selected = selectCapabilityImplementationAdapter(
      {
        ...emptyCapabilityImplementationDraft(focusedDefinition),
        source: { kind: "model_resource", id: "resource" },
      },
      focusedDefinition,
      focusedAdapter,
    );

    expect(selected.inputMappings).toMatchObject([
      { targetKey: "image", sourceKey: "image" },
      { targetKey: "quality", sourceKey: "quality" },
    ]);
    expect(selected.inputMappings).toHaveLength(2);
    expect(selected.inputMappings).not.toContainEqual(
      expect.objectContaining({ targetKey: "seed" }),
    );
  });

  it("offers and publishes a compatible built-in plugin without a second fixed source list", () => {
    const pluginAdapter = {
      ...adapter,
      sourceKinds: ["plugin"],
      supportedModelFormats: [],
    } as RuntimeAdapterSummary;
    const source = {
      kind: "plugin" as const,
      id: pluginAdapter.id,
    };
    expect(
      compatibleRuntimeAdapters(source, [], [], [pluginAdapter], definition),
    ).toEqual([pluginAdapter]);
    const selected = selectCapabilityImplementationAdapter(
      {
        ...emptyCapabilityImplementationDraft(definition),
        displayNameZh: "内置运行",
        displayNameEn: "Built-in runtime",
        source,
      },
      definition,
      pluginAdapter,
    );

    expect(
      capabilityImplementationBody(selected, definition, pluginAdapter, [], [])
        .source,
    ).toEqual({ kind: "plugin" });
  });

  it("admits an Adapter Artifact reference for a public Artifact ID output", () => {
    const artifactIdDefinition = {
      ...definition,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["result"],
        properties: {
          result: {
            type: "string",
            "x-kanvas-semantic-type": "artifact.image",
          },
        },
      },
    } as CapabilityAdminSummary;
    const artifactAdapter = {
      ...adapter,
      sourceKinds: ["plugin"],
      supportedModelFormats: [],
      invocationOutputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["image"],
        properties: {
          image: {
            type: "object",
            "x-kanvas-semantic-type": "artifact.image",
            "x-kanvas-attempt-output-artifact": true,
          },
        },
      },
    } as RuntimeAdapterSummary;

    expect(
      compatibleRuntimeAdapters(
        { kind: "plugin", id: artifactAdapter.id },
        [],
        [],
        [artifactAdapter],
        artifactIdDefinition,
      ),
    ).toEqual([artifactAdapter]);
  });

  it("does not offer a model revision that was not verified for the runtime target", () => {
    const source = {
      kind: "model_resource" as const,
      id: "01K00000000000000000000005",
    };
    const resource = {
      revisionId: source.id,
      nativeInterfaceDigest: `sha256:${"c".repeat(64)}`,
      manifest: {
        format: "onnx",
        executionTargets: ["browser"],
      },
    } as unknown as ModelResourceSummary;

    expect(
      compatibleRuntimeAdapters(source, [resource], [], [adapter], definition),
    ).toEqual([]);
    expect(
      compatibleRuntimeAdapters(
        source,
        [
          {
            ...resource,
            manifest: {
              ...resource.manifest,
              executionTargets: ["worker"],
            },
          },
        ],
        [],
        [adapter],
        definition,
      ),
    ).toEqual([adapter]);
  });

  it("matches model-service Adapters by operation, API surface, and Provider preset", () => {
    const source = {
      kind: "model_service" as const,
      id: "01K00000000000000000000006",
    };
    const providerAdapter = {
      ...adapter,
      id: "01K00000000000000000000007",
      executionTarget: "provider",
      sourceKinds: ["model_service"],
      supportedModelFormats: [],
      modelServiceSelector: {
        operation: "image.generate",
        apiSurface: "images.generations.v1",
        providerPreset: "openai",
      },
    } as RuntimeAdapterSummary;
    const wrongPreset = {
      ...providerAdapter,
      id: "01K00000000000000000000008",
      modelServiceSelector: {
        ...providerAdapter.modelServiceSelector!,
        providerPreset: "gemini",
      },
    } as RuntimeAdapterSummary;
    const ignoresRequiredImage = {
      ...providerAdapter,
      id: "01K00000000000000000000009",
      invocationInputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["prompt"],
        properties: {
          prompt: {
            type: "string",
            "x-kanvas-semantic-type": "text.plain",
          },
        },
      },
    } as RuntimeAdapterSummary;

    expect(
      compatibleRuntimeAdapters(
        source,
        [],
        [
          {
            routePolicyRevisionId: source.id,
            providerPreset: "openai",
            apiSurface: "images.generations.v1",
            modelOperation: "image.generate",
          } as never,
        ],
        [providerAdapter, wrongPreset, ignoresRequiredImage],
        definition,
      ),
    ).toEqual([providerAdapter]);
  });

  it("does not treat an Adapter's generic metadata field as a business output", () => {
    const textDefinition = {
      ...definition,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            "x-kanvas-semantic-type": "text.plain",
          },
        },
      },
    } as CapabilityAdminSummary;
    const metadataAdapter = {
      ...adapter,
      sourceKinds: ["plugin"],
      supportedModelFormats: [],
      invocationOutputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion"],
        properties: {
          schemaVersion: {
            const: "kanvas.image-result/v1",
            "x-kanvas-semantic-type": "value.any",
          },
        },
      },
    } as RuntimeAdapterSummary;

    expect(
      compatibleRuntimeAdapters(
        { kind: "plugin", id: metadataAdapter.id },
        [],
        [],
        [metadataAdapter],
        textDefinition,
      ),
    ).toEqual([]);
  });
});
