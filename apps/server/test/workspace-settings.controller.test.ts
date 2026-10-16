import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { WorkspaceSettingsController } from "../src/http/workspace-settings.controller.js";

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
  effectivePermissions: ["workspace.manage"],
  trusted: true,
};

function request(): FastifyRequest {
  return {
    id: "request-workspace-settings",
  } as FastifyRequest;
}

function contexts(
  currentRequest: FastifyRequest,
): RequestAuthorizationContextStore {
  const value = new RequestAuthorizationContextStore();
  value.set(currentRequest, {
    authentication: {
      authSubjectId: "workspace-admin",
      sessionId: scope.authenticationRefId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return value;
}

describe("WorkspaceSettingsController", () => {
  it("returns only the bounded general settings projection", async () => {
    const currentRequest = request();
    const get = vi
      .fn<ServerDatabaseRuntime["workspaceSettings"]["get"]>()
      .mockResolvedValue({
        workspaceId,
        slug: "kanvas-studio",
        name: "Kanvas Studio",
        version: 4,
        updatedAt: new Date("2026-08-06T00:00:00.000Z"),
      });
    const controller = new WorkspaceSettingsController(
      {
        workspaceSettings: { get },
      } as unknown as ServerDatabaseRuntime,
      contexts(currentRequest),
    );

    const result = await controller.get(currentRequest);

    expect(get).toHaveBeenCalledWith(scope, expect.any(Date));
    expect(result).toEqual({
      workspaceId,
      slug: "kanvas-studio",
      name: "Kanvas Studio",
      version: 4,
      updatedAt: "2026-08-06T00:00:00.000Z",
    });
  });

  it("trims the name and forwards the expected version", async () => {
    const currentRequest = request();
    const rename = vi
      .fn<ServerDatabaseRuntime["workspaceSettings"]["rename"]>()
      .mockResolvedValue({
        workspaceId,
        slug: "kanvas-studio",
        name: "设计团队",
        version: 5,
        updatedAt: new Date("2026-08-06T00:00:00.000Z"),
      });
    const controller = new WorkspaceSettingsController(
      {
        workspaceSettings: { rename },
      } as unknown as ServerDatabaseRuntime,
      contexts(currentRequest),
    );

    await controller.rename(currentRequest, {
      expectedVersion: 4,
      name: "  设计团队  ",
    });

    expect(rename).toHaveBeenCalledOnce();
    expect(rename.mock.calls[0]?.[0]).toMatchObject({
      scope,
      expectedVersion: 4,
      name: "设计团队",
      audit: {
        authorityVersion: 3,
      },
    });
  });
});
