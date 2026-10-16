import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { CapabilityDefinitionRecord } from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceCapabilityDefinitionsController } from "../src/http/workspace-capability-definitions.controller.js";

const workspaceId = "01K00000000000000000000001";
const currentContractRevisionId = "01K00000000000000000000007";
const scope: TrustedWorkspaceScope = {
  workspaceId,
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000004",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000005",
  authorityVersion: 3,
  authorizationModelVersion: 1,
  effectivePermissions: ["capability.configure"],
  trusted: true,
};

function request(): FastifyRequest {
  return { id: "request-capability-definition" } as FastifyRequest;
}

function authorizedContexts(
  currentRequest: FastifyRequest,
): RequestAuthorizationContextStore {
  const contexts = new RequestAuthorizationContextStore();
  contexts.set(currentRequest, {
    authentication: {
      authSubjectId: "capability-admin",
      sessionId: scope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return contexts;
}

const definition = {
  id: "01K00000000000000000000006",
  workspaceId,
  key: "image.background.remove",
  status: "active",
  version: 2,
  contractRevisionId: currentContractRevisionId,
  contractRevision: 2,
  contractDigest: `sha256:${"a".repeat(64)}`,
  contractStatus: "published",
  inputSchema: { type: "object", additionalProperties: false },
  outputSchema: { type: "object", additionalProperties: false },
  idempotencyMode: "keyed",
  supportedInvokers: ["workflow", "agent"],
  declarationRevisionId: "01K00000000000000000000008",
  declarationRevision: 2,
  declarationDigest: `sha256:${"b".repeat(64)}`,
  declaration: {
    schemaVersion: "kanvas.capability-declaration/v1",
    origin: "declared",
    catalog: {
      title: { "zh-CN": "去除背景", "en-US": "Remove background" },
      category: { "zh-CN": "图像处理", "en-US": "Image processing" },
      sourceKind: "built_in",
      tags: ["image"],
    },
    parameters: [],
    outputs: [],
  },
  bindingCount: 2,
  activeBindingCount: 1,
  createdAt: new Date("2026-08-06T00:00:00.000Z"),
  updatedAt: new Date("2026-08-06T00:00:00.000Z"),
} as CapabilityDefinitionRecord;

describe("WorkspaceCapabilityDefinitionsController", () => {
  it("returns only runtime candidates owned by the current Definition revision", async () => {
    const currentRequest = request();
    const listDefinitions = vi.fn().mockResolvedValue([definition]);
    const listBindings = vi.fn().mockResolvedValue([
      {
        id: "01K00000000000000000000009",
        contractRevisionId: currentContractRevisionId,
        capabilityKey: definition.key,
        capabilityRevision: 2,
        bindingStatus: "active",
        priority: 1,
        version: 4,
        executionTarget: "browser",
        implementationKey: "first-party.background-remove.browser",
        implementationRevision: 1,
        adapterKey: "background-remove.browser.v1",
        implementationConfiguration: {},
        availabilityReason: "ready",
        updatedAt: new Date("2026-08-06T00:00:00.000Z"),
      },
      {
        id: "01K00000000000000000000010",
        contractRevisionId: "01K00000000000000000000011",
        capabilityKey: definition.key,
        capabilityRevision: 1,
        bindingStatus: "active",
        priority: 1,
        version: 1,
        executionTarget: "worker",
        implementationKey: "legacy.background-remove.worker",
        implementationRevision: 1,
        adapterKey: "legacy.background-remove.worker.v1",
        implementationConfiguration: {},
        availabilityReason: "ready",
        updatedAt: new Date("2026-08-05T00:00:00.000Z"),
      },
      {
        id: "01K00000000000000000000012",
        contractRevisionId: currentContractRevisionId,
        capabilityKey: definition.key,
        capabilityRevision: 2,
        bindingStatus: "revoked",
        priority: 2,
        version: 2,
        executionTarget: "provider",
        implementationKey: "retired.background-remove.provider",
        implementationRevision: 1,
        adapterKey: "retired.background-remove.provider.v1",
        implementationConfiguration: {},
        availabilityReason: "provider_unavailable",
        updatedAt: new Date("2026-08-05T00:00:00.000Z"),
      },
    ]);
    const listProviderRoutes = vi.fn().mockResolvedValue([]);
    const controller = new WorkspaceCapabilityDefinitionsController(
      {
        capabilityDefinitions: { list: listDefinitions },
        capabilityBindingAdmin: {
          list: listBindings,
          listProviderRoutes,
        },
        modelResourceImports: {
          listPublishedRuntimeAdapters: vi.fn().mockResolvedValue([]),
        },
        capabilityInstallations: {
          listCatalogEntries: vi.fn().mockResolvedValue([]),
        },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(currentRequest),
      {} as never,
      {} as never,
    );

    const result = await controller.list(currentRequest);

    expect(listDefinitions).toHaveBeenCalledWith(scope, expect.any(Date));
    expect(listBindings).toHaveBeenCalledWith(scope, expect.any(Date));
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({
      key: definition.key,
      bindings: [
        {
          id: "01K00000000000000000000009",
          status: "enabled",
        },
      ],
    });
    expect(result.providerRoutes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("legacy.background-remove");
    expect(JSON.stringify(result)).not.toContain("retired.background-remove");
  });

  it("publishes discovery metadata without accepting Contract fields", async () => {
    const currentRequest = request();
    const update = vi.fn().mockResolvedValue({
      value: {
        ...definition,
        version: 3,
        declarationRevision: 3,
        declaration: {
          ...definition.declaration,
          catalog: {
            ...definition.declaration.catalog,
            title: {
              "zh-CN": "背景移除",
              "en-US": "Background removal",
            },
          },
        },
      },
      replayed: false,
    });
    const controller = new WorkspaceCapabilityDefinitionsController(
      {
        capabilityDefinitions: { update },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(currentRequest),
      {} as never,
      {} as never,
    );

    const result = await controller.update(
      currentRequest,
      "capability-metadata-test",
      { capabilityDefinitionId: definition.id },
      {
        expectedVersion: definition.version,
        title: {
          "zh-CN": "背景移除",
          "en-US": "Background removal",
        },
        category: {
          "zh-CN": "图像处理",
          "en-US": "Image processing",
        },
        tags: ["image"],
      },
    );

    expect(result.definition).toMatchObject({
      version: 3,
      contractRevisionId: definition.contractRevisionId,
      contractRevision: definition.contractRevision,
      declarationRevision: 3,
    });
    const command = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(command).toMatchObject({
      definitionId: definition.id,
      expectedVersion: definition.version,
      title: {
        "zh-CN": "背景移除",
        "en-US": "Background removal",
      },
      tags: ["image"],
    });
    expect(command).not.toHaveProperty("contractRevisionId");
    expect(command).not.toHaveProperty("inputSchema");
    expect(command).not.toHaveProperty("outputSchema");
  });
});
