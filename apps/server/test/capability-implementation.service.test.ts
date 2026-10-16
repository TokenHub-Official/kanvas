import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  digestProviderValue,
  type PublishCapabilityImplementationRevisionOptions,
} from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { CapabilityImplementationService } from "../src/capabilities/capability-implementation.service.js";

const workspaceId = "01K00000000000000000000001";
const nativeInterface = {
  protocol: "tensor" as const,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["input"],
    properties: { input: { type: "array", items: { type: "number" } } },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["output"],
    properties: { output: { type: "array", items: { type: "number" } } },
  },
};
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000004",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["capability.configure"],
  trusted: true,
};

describe("CapabilityImplementationService", () => {
  it("compiles mappings, runs the fixture, and publishes one model-backed binding", async () => {
    const publish = vi.fn().mockResolvedValue({
      bindingId: "01K00000000000000000000020",
      version: 1,
      replayed: false,
    });
    const database = {
      capabilityDefinitions: {
        list: vi.fn().mockResolvedValue([
          {
            id: "01K00000000000000000000006",
            key: "image.example.process",
            status: "active",
            version: 1,
            contractRevisionId: "01K00000000000000000000007",
            contractRevision: 1,
            contractDigest: `sha256:${"a".repeat(64)}`,
            inputSchema: {
              type: "object",
              additionalProperties: false,
              required: ["image"],
              properties: {
                image: {
                  type: "string",
                  pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
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
          },
        ]),
      },
      capabilityBindingAdmin: {
        list: vi.fn().mockResolvedValue([]),
        listProviderRoutes: vi.fn().mockResolvedValue([]),
      },
      modelResourceImports: {
        listPublishedRuntimeAdapters: vi.fn().mockResolvedValue([
          {
            id: "01K00000000000000000000008",
            adapterKey: "kanvas.image.example.v1",
            revision: 1,
            canonicalDigest: `sha256:${"b".repeat(64)}`,
            document: {
              schemaVersion: "kanvas.runtime-adapter-definition/v1",
              adapterKey: "kanvas.image.example.v1",
              revision: 1,
              displayName: {
                defaultLocale: "en-US",
                values: { "en-US": "Example runtime" },
              },
              executionTarget: "worker",
              sourceKinds: ["model_resource"],
              supportedModelFormats: ["onnx"],
              modelResourceInterfaceDigest:
                digestProviderValue(nativeInterface),
              invocationInputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["source"],
                properties: {
                  source: {
                    type: "string",
                    pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
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
              artifactInputs: [],
              executable: {
                kind: "built_in",
                packageKey: "kanvas.image-example",
                packageVersion: "1.0.0",
                entrypoint: "image.example",
                releaseDigest: `sha256:${"c".repeat(64)}`,
              },
            },
          },
        ]),
      },
      modelResources: {
        list: vi.fn().mockResolvedValue([
          {
            id: "01K00000000000000000000009",
            key: "model.example.onnx",
            status: "active",
            revisionId: "01K00000000000000000000010",
            revision: 1,
            revisionDigest: `sha256:${"d".repeat(64)}`,
            manifest: {
              format: "onnx",
              executionTargets: ["worker"],
              nativeInterface,
            },
          },
        ]),
      },
      capabilityImplementations: { publish },
    } as unknown as ServerDatabaseRuntime;
    const service = new CapabilityImplementationService(database);

    const result = await service.publish(
      scope,
      "01K00000000000000000000006",
      "publish-example",
      {
        expectedDefinitionVersion: 1,
        displayName: {
          defaultLocale: "en-US",
          values: { "en-US": "Example implementation" },
        },
        source: {
          kind: "model_resource",
          modelResourceRevisionId: "01K00000000000000000000010",
        },
        runtimeAdapterRevisionId: "01K00000000000000000000008",
        configuration: {},
        inputMapping: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "input",
          expression: {
            op: "object",
            properties: {
              source: { op: "source", root: "input", pointer: "/image" },
            },
          },
        },
        outputMapping: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "output",
          expression: {
            op: "object",
            properties: {
              result: { op: "source", root: "result", pointer: "/image" },
            },
          },
        },
        sampleCapabilityInput: {
          image: "01K00000000000000000000011",
        },
        sampleAdapterResult: { image: {} },
        priority: 10,
        eligibility: {},
        fallbackOn: ["unavailable"],
      },
      "request-1",
    );

    expect(result).toEqual({
      bindingId: "01K00000000000000000000020",
      version: 1,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: "model_resource",
        modelResourceRevisionId: "01K00000000000000000000010",
        adapterKey: "kanvas.image.example.v1",
        fixtureSuite: [
          expect.objectContaining({
            expectedAdapterInput: {
              source: "01K00000000000000000000011",
            },
            expectedCapabilityOutput: { result: {} },
          }),
        ],
      }),
    );
    const publication = publish.mock.calls[0]?.[0] as
      PublishCapabilityImplementationRevisionOptions | undefined;
    expect(publication?.inputMappingDigest).toBe(
      digestProviderValue(publication?.compiledInputMapping),
    );
    expect(publication?.outputMappingDigest).toBe(
      digestProviderValue(publication?.compiledOutputMapping),
    );
  });

  it("publishes a Catalog runtime as a plugin source without a model route", async () => {
    const publish = vi.fn().mockResolvedValue({
      bindingId: "01K00000000000000000000030",
      version: 1,
      replayed: false,
    });
    const emptySchema = {
      type: "object",
      additionalProperties: false,
      properties: {},
    };
    const adapterId = "01K00000000000000000000031";
    const targetContractRevisionId = "01K00000000000000000000034";
    const releaseDigest = `sha256:${"e".repeat(64)}`;
    const listProviderRoutes = vi.fn();
    const database = {
      capabilityDefinitions: {
        list: vi.fn().mockResolvedValue([
          {
            id: "01K00000000000000000000032",
            key: "example.built-in.run",
            status: "active",
            version: 1,
            contractRevisionId: targetContractRevisionId,
            contractRevision: 1,
            contractDigest: `sha256:${"d".repeat(64)}`,
            inputSchema: emptySchema,
            outputSchema: emptySchema,
          },
        ]),
      },
      capabilityBindingAdmin: {
        list: vi.fn().mockResolvedValue([]),
        listProviderRoutes,
      },
      modelResourceImports: {
        listPublishedRuntimeAdapters: vi.fn().mockResolvedValue([
          {
            id: adapterId,
            adapterKey: "kanvas.example.built-in.v1",
            revision: 1,
            canonicalDigest: `sha256:${"a".repeat(64)}`,
            document: {
              schemaVersion: "kanvas.runtime-adapter-definition/v1",
              adapterKey: "kanvas.example.built-in.v1",
              revision: 1,
              displayName: {
                defaultLocale: "en-US",
                values: { "en-US": "Built-in runtime" },
              },
              executionTarget: "worker",
              sourceKinds: ["plugin"],
              supportedModelFormats: [],
              invocationInputSchema: emptySchema,
              invocationOutputSchema: emptySchema,
              configurationSchema: emptySchema,
              artifactInputs: [],
              executable: {
                kind: "built_in",
                packageKey: "kanvas.example-runtime",
                packageVersion: "1.0.0",
                entrypoint: "example.run",
                releaseDigest,
              },
            },
          },
        ]),
      },
      capabilityImplementations: { publish },
    } as unknown as ServerDatabaseRuntime;

    await new CapabilityImplementationService(database).publish(
      scope,
      "01K00000000000000000000032",
      "publish-built-in",
      {
        expectedDefinitionVersion: 1,
        displayName: {
          defaultLocale: "en-US",
          values: { "en-US": "Built-in implementation" },
        },
        source: { kind: "plugin" },
        runtimeAdapterRevisionId: adapterId,
        configuration: {},
        inputMapping: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "input",
          expression: { op: "object", properties: {} },
        },
        outputMapping: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "output",
          expression: { op: "object", properties: {} },
        },
        sampleCapabilityInput: {},
        sampleAdapterResult: {},
        priority: 1,
        eligibility: {},
        fallbackOn: [],
      },
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        contractRevisionId: targetContractRevisionId,
        sourceKind: "plugin",
        sourceReference: {
          kind: "plugin",
          plugin: {
            key: "kanvas.example-runtime",
            revision: 1,
            canonicalDigest: releaseDigest,
          },
        },
      }),
    );
    expect(listProviderRoutes).not.toHaveBeenCalled();
  });

  it("publishes a text model service through a data-defined Adapter selector", async () => {
    const publish = vi.fn().mockResolvedValue({
      bindingId: "01K00000000000000000000040",
      version: 1,
      replayed: false,
    });
    const emptySchema = {
      type: "object",
      additionalProperties: false,
      properties: {},
    };
    const routePolicyRevisionId = "01K00000000000000000000041";
    const adapterId = "01K00000000000000000000042";
    const database = {
      capabilityDefinitions: {
        list: vi.fn().mockResolvedValue([
          {
            id: "01K00000000000000000000043",
            key: "document.summary.create",
            status: "active",
            version: 1,
            contractRevisionId: "01K00000000000000000000044",
            contractRevision: 1,
            contractDigest: `sha256:${"a".repeat(64)}`,
            inputSchema: emptySchema,
            outputSchema: emptySchema,
          },
        ]),
      },
      capabilityBindingAdmin: {
        list: vi.fn().mockResolvedValue([]),
        listProviderRoutes: vi.fn().mockResolvedValue([
          {
            routePolicyRevisionId,
            providerName: "OpenAI",
            providerModelId: "gpt-text",
            providerPreset: "openai",
            apiSurface: "responses.v1",
            modelOperation: "text.generate",
            availabilityReason: "ready",
            availableBudgetAmount: "10",
          },
        ]),
      },
      modelResourceImports: {
        listPublishedRuntimeAdapters: vi.fn().mockResolvedValue([
          {
            id: adapterId,
            adapterKey: "openai.text.summary.v1",
            revision: 1,
            canonicalDigest: `sha256:${"b".repeat(64)}`,
            document: {
              schemaVersion: "kanvas.runtime-adapter-definition/v1",
              adapterKey: "openai.text.summary.v1",
              revision: 1,
              displayName: {
                defaultLocale: "en-US",
                values: { "en-US": "Text summary" },
              },
              executionTarget: "provider",
              sourceKinds: ["model_service"],
              supportedModelFormats: [],
              invocationInputSchema: emptySchema,
              invocationOutputSchema: emptySchema,
              configurationSchema: emptySchema,
              modelServiceSelector: {
                operation: "text.generate",
                apiSurface: "responses.v1",
                providerPreset: "openai",
              },
              artifactInputs: [],
              executable: {
                kind: "built_in",
                packageKey: "kanvas.openai-text",
                packageVersion: "1.0.0",
                entrypoint: "text.summary",
                releaseDigest: `sha256:${"c".repeat(64)}`,
              },
            },
          },
        ]),
      },
      capabilityImplementations: { publish },
    } as unknown as ServerDatabaseRuntime;

    await new CapabilityImplementationService(database).publish(
      scope,
      "01K00000000000000000000043",
      "publish-text-model-service",
      {
        expectedDefinitionVersion: 1,
        displayName: {
          defaultLocale: "en-US",
          values: { "en-US": "Text summary" },
        },
        source: { kind: "model_service", routePolicyRevisionId },
        runtimeAdapterRevisionId: adapterId,
        configuration: {},
        inputMapping: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "input",
          expression: { op: "object", properties: {} },
        },
        outputMapping: {
          schemaVersion: "kanvas.capability-mapping/v1",
          direction: "output",
          expression: { op: "object", properties: {} },
        },
        sampleCapabilityInput: {},
        sampleAdapterResult: {},
        priority: 1,
        eligibility: {},
        fallbackOn: [],
      },
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: "model_service",
        routePolicyRevisionId,
        sourceReference: {
          kind: "model_service",
          routePolicyRevisionId,
          selector: {
            operation: "text.generate",
            apiSurface: "responses.v1",
          },
        },
      }),
    );
  });
});
