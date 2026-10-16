import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceCapabilityBindingsController } from "../src/http/workspace-capability-bindings.controller.js";

const workspaceId = "01K00000000000000000000001";
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

function authorizedContexts(
  request: FastifyRequest,
): RequestAuthorizationContextStore {
  const contexts = new RequestAuthorizationContextStore();
  contexts.set(request, {
    authentication: {
      authSubjectId: "binding-admin",
      sessionId: scope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return contexts;
}

function request(): FastifyRequest {
  return {
    id: "request-capability-binding",
  } as FastifyRequest;
}

describe("WorkspaceCapabilityBindingsController", () => {
  it("maps paused UI state to the physical disabled lifecycle", async () => {
    const currentRequest = request();
    const setStatus = vi
      .fn<ServerDatabaseRuntime["capabilityBindingAdmin"]["setStatus"]>()
      .mockResolvedValue({
        bindingId: "01K00000000000000000000006",
        version: 5,
      });
    const controller = new WorkspaceCapabilityBindingsController(
      {
        capabilityBindingAdmin: {
          setStatus,
        },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(currentRequest),
    );

    await controller.setStatus(currentRequest, "01K00000000000000000000006", {
      expectedVersion: 4,
      status: "paused",
    });

    expect(setStatus).toHaveBeenCalledOnce();
    const options = setStatus.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      scope,
      bindingId: "01K00000000000000000000006",
      expectedVersion: 4,
      status: "disabled",
    });
    expect(options?.audit.authorityVersion).toBe(3);
  });

  it("passes both adjacent versions to an atomic move", async () => {
    const currentRequest = request();
    const move = vi.fn().mockResolvedValue({
      bindingId: "01K00000000000000000000006",
      version: 6,
      adjacentBindingId: "01K00000000000000000000008",
      adjacentVersion: 3,
    });
    const controller = new WorkspaceCapabilityBindingsController(
      {
        capabilityBindingAdmin: {
          move,
        },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(currentRequest),
    );

    await controller.move(currentRequest, "01K00000000000000000000006", {
      expectedVersion: 4,
      adjacentBindingId: "01K00000000000000000000008",
      expectedAdjacentVersion: 2,
      direction: "later",
    });

    expect(move).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "01K00000000000000000000006",
        expectedVersion: 4,
        adjacentBindingId: "01K00000000000000000000008",
        expectedAdjacentVersion: 2,
        direction: "later",
      }),
    );
  });
});
