import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { CapabilityRunController } from "../src/http/capability-run.controller.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";

const workspaceId = "01K00000000000000000000001";
const capabilityRunId = "01K00000000000000000000002";
const baseScope = {
  workspaceId,
  organizationId: "01K00000000000000000000003",
  principalId: "01K00000000000000000000004",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "01K00000000000000000000005",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000006",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["capability.run"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

function contextWith(scope: TrustedWorkspaceScope): {
  readonly contexts: RequestAuthorizationContextStore;
  readonly request: FastifyRequest;
} {
  const contexts = new RequestAuthorizationContextStore();
  const request = {} as FastifyRequest;
  contexts.set(request, {
    authentication: {
      authSubjectId: "01K00000000000000000000007",
      sessionId: scope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return { contexts, request };
}

const diagnosticError = {
  code: "provider.remote_invalid_request",
  upstream: {
    statusCode: 400,
    requestId: "provider-request-400",
    body: '{"message":"private filename.png"}',
  },
};

function capabilityRun() {
  const instant = new Date("2026-09-15T10:00:00.000Z");
  return {
    id: capabilityRunId,
    contractRevisionId: "01K00000000000000000000008",
    invocationKind: "agent" as const,
    lifecycleStatus: "failed" as const,
    input: { source: "artifact" },
    output: { colors: ["#112233", "#ddeeff"] },
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
        semanticType: "value.any" as const,
        primary: true,
        visibility: "author" as const,
      },
    ],
    error: diagnosticError,
    browserExecution: {
      requiredCapabilityKeys: ["browser.image.palette.extract"],
    },
    version: 2,
    executionDeadlineAt: instant,
    createdAt: instant,
    updatedAt: instant,
    completedAt: instant,
  };
}

describe("CapabilityRunController error projection", () => {
  it("omits upstream response bodies for a normal runner", async () => {
    const { contexts, request } = contextWith(baseScope);
    const get = vi.fn().mockResolvedValue(capabilityRun());
    const controller = new CapabilityRunController(
      {} as never,
      { get } as never,
      contexts,
    );

    const result = await controller.get(request, { capabilityRunId });

    expect(result.error).toEqual({
      code: "provider.remote_invalid_request",
      upstream: { requestId: "provider-request-400" },
    });
    expect(result.browserExecution).toEqual({
      requiredCapabilityKeys: ["browser.image.palette.extract"],
    });
    expect(result.inputDeclarations).toEqual(capabilityRun().inputDeclarations);
    expect(result.outputDeclarations).toEqual([
      {
        key: "colors",
        label: { "zh-CN": "主要颜色", "en-US": "Dominant colors" },
        semanticType: "value.any",
        primary: true,
        visibility: "author",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private filename.png");
  });

  it("retains bounded upstream diagnostics for an audit reader", async () => {
    const auditScope: TrustedWorkspaceScope = {
      ...baseScope,
      effectivePermissions: ["capability.run", "audit.read"],
    };
    const { contexts, request } = contextWith(auditScope);
    const controller = new CapabilityRunController(
      {} as never,
      { get: vi.fn().mockResolvedValue(capabilityRun()) } as never,
      contexts,
    );

    await expect(
      controller.get(request, { capabilityRunId }),
    ).resolves.toMatchObject({ error: diagnosticError });
  });
});

describe("user capability discovery", () => {
  it("uses the current authorized scope and bounds the public catalogue", async () => {
    const { contexts, request } = contextWith(baseScope);
    const listUserCapabilities = vi.fn().mockResolvedValue(
      Array.from({ length: 101 }, () => ({
        contractRevisionId: capabilityRunId,
      })),
    );
    const controller = new CapabilityRunController(
      { capabilityRuns: { listUserCapabilities } } as never,
      {} as never,
      contexts,
    );
    const result = await controller.listUser(request, "en-US");
    expect(listUserCapabilities).toHaveBeenCalledWith(
      baseScope,
      "en-US",
      expect.any(Date),
    );
    expect(result.items).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });
});
