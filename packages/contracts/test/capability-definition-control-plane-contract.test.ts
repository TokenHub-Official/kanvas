import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  CanvasCapabilityCatalogSchema,
  CapabilityRunDetailsSchema,
  CreateCapabilityDefinitionBodySchema,
  createWorkspaceCapabilityDefinitionRoute,
  createCanvasCapabilityRunRoute,
  createCapabilityRunRoute,
  getCapabilityRunRoute,
  cancelCapabilityRunRoute,
  installCapabilityRecommendationRoute,
  listWorkspaceCapabilityDefinitionsRoute,
  listCanvasCapabilitiesRoute,
  routeRegistry,
  setWorkspaceCapabilityDefinitionStatusRoute,
  UpdateCapabilityDefinitionBodySchema,
  updateWorkspaceCapabilityDefinitionRoute,
  WorkspaceCapabilityDefinitionsSchema,
} from "../src/api/index.js";
import {
  CapabilityMappingExpressionV1Schema,
  CapabilityMappingJsonValueSchema,
} from "../src/capability/mapping.js";
import { WorkflowJsonValueSchema } from "../src/workflow/index.js";

function createAjv() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  ajv.addSchema(WorkflowJsonValueSchema);
  ajv.addSchema(CapabilityMappingJsonValueSchema);
  ajv.addSchema(CapabilityMappingExpressionV1Schema);
  return ajv;
}

function validator() {
  return createAjv().compile(CreateCapabilityDefinitionBodySchema);
}

describe("Capability Definition control-plane contracts", () => {
  it("registers list, publish, revise, and archive routes", () => {
    expect(listWorkspaceCapabilityDefinitionsRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/capability-definitions",
    });
    expect(createWorkspaceCapabilityDefinitionRoute).toMatchObject({
      method: "POST",
      idempotency: "required",
    });
    expect(installCapabilityRecommendationRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/capability-recommendations/{catalogEntryId}/install",
      idempotency: "required",
    });
    expect(updateWorkspaceCapabilityDefinitionRoute).toMatchObject({
      method: "PUT",
      idempotency: "required",
    });
    expect(setWorkspaceCapabilityDefinitionStatusRoute).toMatchObject({
      method: "PATCH",
      path: "/api/v1/capability-definitions/{capabilityDefinitionId}/status",
    });
    for (const route of [
      listWorkspaceCapabilityDefinitionsRoute,
      createWorkspaceCapabilityDefinitionRoute,
      installCapabilityRecommendationRoute,
      updateWorkspaceCapabilityDefinitionRoute,
      setWorkspaceCapabilityDefinitionStatusRoute,
    ]) {
      expect(routeRegistry).toContain(route);
      expect(route.security).toEqual(["sessionOrServiceToken"]);
    }
  });

  it("registers direct Canvas discovery and Capability Run routes", () => {
    expect(listCanvasCapabilitiesRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/canvas-capabilities",
    });
    expect(createCanvasCapabilityRunRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/canvas-capability-runs",
      idempotency: "required",
    });
    expect(createCapabilityRunRoute).toMatchObject({
      method: "POST",
      path: "/api/v1/capability-runs",
      idempotency: "required",
    });
    expect(getCapabilityRunRoute).toMatchObject({
      method: "GET",
      path: "/api/v1/capability-runs/{capabilityRunId}",
    });
    expect(cancelCapabilityRunRoute).toMatchObject({
      method: "POST",
      idempotency: "required",
    });
    for (const route of [
      listCanvasCapabilitiesRoute,
      createCanvasCapabilityRunRoute,
      createCapabilityRunRoute,
      getCapabilityRunRoute,
      cancelCapabilityRunRoute,
    ]) {
      expect(routeRegistry).toContain(route);
      expect(route.security).toEqual(["sessionOrServiceToken"]);
    }
  });

  it("exposes Canvas placement and direct run state without Workflow identity", () => {
    const catalog = createAjv().compile(CanvasCapabilityCatalogSchema);
    expect(
      catalog({
        items: [
          {
            contractRevisionId: "01K00000000000000000000001",
            capabilityKey: "image.background.remove",
            displayName: "背景移除",
            category: "图像处理",
            inputSchema: { type: "object" },
            parameters: [],
            outputs: [],
            canvas: {
              actionGroup: "image.edit",
              interactionBehavior: "direct",
              completionBehavior: "review_required",
              outputModes: ["replace_content"],
              order: 10,
            },
          },
        ],
        truncated: false,
      }),
    ).toBe(true);
    const run = createAjv().compile(CapabilityRunDetailsSchema);
    expect(
      run({
        id: "01K00000000000000000000002",
        contractRevisionId: "01K00000000000000000000001",
        invocationKind: "canvas",
        lifecycleStatus: "queued",
        input: {},
        browserExecution: {
          requiredCapabilityKeys: ["browser.image.palette.extract"],
        },
        inputDeclarations: [
          {
            key: "quality",
            label: { "zh-CN": "细节程度", "en-US": "Detail level" },
            semanticType: "value.any",
            required: false,
            exposurePolicy: {
              allowed: ["workflow_author"],
              default: "workflow_author",
            },
            sourcePolicy: {
              allowed: ["workflow_input"],
              default: "workflow_input",
            },
            editor: "text",
          },
        ],
        outputDeclarations: [
          {
            key: "colors",
            label: { "zh-CN": "主要颜色", "en-US": "Dominant colors" },
            semanticType: "value.any",
            primary: true,
            visibility: "author",
          },
        ],
        version: 1,
        executionDeadlineAt: "2026-09-02T00:05:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      run({
        id: "01K00000000000000000000003",
        contractRevisionId: "01K00000000000000000000001",
        invocationKind: "user",
        lifecycleStatus: "queued",
        input: {},
        version: 1,
        executionDeadlineAt: "2026-09-02T00:05:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("accepts a readable declared Capability and rejects unstable keys", () => {
    const validate = validator();
    const body = {
      key: "image.example.process",
      title: { "zh-CN": "示例处理", "en-US": "Example process" },
      category: { "zh-CN": "图像处理", "en-US": "Image processing" },
      tags: ["image"],
      sourceKind: "plugin",
      surfaces: ["workflow", "agent"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      parameters: [],
      outputs: [],
      idempotencyMode: "keyed",
      supportedInvokers: ["workflow", "agent"],
      runMethod: {
        displayName: {
          defaultLocale: "en-US",
          values: { "en-US": "Example plugin" },
        },
        source: { kind: "plugin" },
        runtimeAdapterRevisionId: "01K00000000000000000000009",
        configuration: {},
        inputMapping: {},
        outputMapping: {},
        sampleCapabilityInput: {},
        sampleAdapterResult: {},
        priority: 10,
        eligibility: {},
        fallbackOn: [],
      },
    };
    expect(validate(body)).toBe(true);
    const { runMethod, ...withoutRunMethod } = body;
    void runMethod;
    expect(validate(withoutRunMethod)).toBe(false);
    expect(validate({ ...body, key: "Image Example" })).toBe(false);
  });

  it("limits ordinary updates to discovery metadata", () => {
    const validate = createAjv().compile(UpdateCapabilityDefinitionBodySchema);
    const metadata = {
      expectedVersion: 2,
      title: { "zh-CN": "示例处理", "en-US": "Example process" },
      category: { "zh-CN": "图像处理", "en-US": "Image processing" },
      tags: ["image"],
    };
    expect(validate(metadata)).toBe(true);
    expect(
      validate({
        ...metadata,
        inputSchema: { type: "object" },
      }),
    ).toBe(false);
  });

  it("returns Definition semantics and current run methods in one projection", () => {
    const validate = createAjv().compile(WorkspaceCapabilityDefinitionsSchema);
    const value = {
      generatedAt: "2026-08-30T00:00:00.000Z",
      providerRoutes: [],
      runtimeAdapters: [],
      recommendations: [],
      definitions: [
        {
          id: "01K00000000000000000000001",
          key: "image.example.process",
          status: "active",
          version: 1,
          contractRevisionId: "01K00000000000000000000002",
          contractRevision: 1,
          contractDigest: `sha256:${"a".repeat(64)}`,
          inputSchema: { type: "object", additionalProperties: false },
          outputSchema: { type: "object", additionalProperties: false },
          idempotencyMode: "keyed",
          supportedInvokers: ["workflow"],
          declarationRevisionId: "01K00000000000000000000003",
          declarationRevision: 1,
          declarationDigest: `sha256:${"b".repeat(64)}`,
          declaration: {
            schemaVersion: "kanvas.capability-declaration/v1",
            origin: "declared",
            catalog: {
              title: { "zh-CN": "示例处理", "en-US": "Example process" },
              category: { "zh-CN": "图像处理", "en-US": "Image processing" },
              sourceKind: "plugin",
              tags: ["image"],
            },
            parameters: [],
            outputs: [],
          },
          bindingCount: 1,
          activeBindingCount: 1,
          bindings: [
            {
              id: "01K00000000000000000000004",
              status: "enabled",
              order: 1,
              version: 1,
              executionTarget: "worker",
              displayName: {
                defaultLocale: "zh-CN",
                values: { "zh-CN": "云端执行", "en-US": "Cloud runtime" },
              },
              sourceKind: "plugin",
              availabilityReason: "ready",
              implementationKey: "first-party.image.example.worker",
              implementationRevision: 1,
              adapterKey: "image.example.worker.v1",
              updatedAt: "2026-08-30T00:00:00.000Z",
            },
          ],
          createdAt: "2026-08-30T00:00:00.000Z",
          updatedAt: "2026-08-30T00:00:00.000Z",
        },
      ],
    };
    expect(validate(value)).toBe(true);
    const incompleteDefinition = Object.fromEntries(
      Object.entries(value.definitions[0]!).filter(
        ([key]) => key !== "bindings",
      ),
    );
    expect(
      validate({
        ...value,
        definitions: [incompleteDefinition],
      }),
    ).toBe(false);
  });
});
