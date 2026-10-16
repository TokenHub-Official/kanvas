import { WORKSPACE_PERMISSION_METADATA } from "../src/http/workspace-permission.decorator.js";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { OperationalTimelineStore } from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { OperationalTimelineController } from "../src/operations/operational-timeline.controller.js";

const workspaceId = "01K00000000000000000000001";
const workflowRunId = "01K00000000000000000000002";
const request = {} as FastifyRequest;
const scope: TrustedWorkspaceScope = {
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
  effectivePermissions: ["audit.read"],
  trusted: true,
};

describe("OperationalTimelineController", () => {
  it("requires audit permission on both administrator entrypoints", () => {
    for (const name of ["list", "taskTimeline"]) {
      const handler: unknown = Reflect.get(
        OperationalTimelineController.prototype,
        name,
      );
      if (typeof handler !== "function")
        throw new Error("Missing administrator handler");
      expect(Reflect.getMetadata(WORKSPACE_PERMISSION_METADATA, handler)).toBe(
        "audit.read",
      );
    }
  });

  it("queries with the trusted scope and converts only timestamps at the HTTP boundary", async () => {
    const get = vi.fn<OperationalTimelineStore["get"]>().mockResolvedValue({
      workflowRunId,
      generatedAt: new Date("2026-07-28T20:00:00.000Z"),
      items: [
        {
          id: workflowRunId,
          source: "workflow_run",
          kind: "workflow.snapshot",
          resourceType: "workflow_run",
          resourceId: workflowRunId,
          status: "completed",
          occurredAt: new Date("2026-07-28T19:59:00.000Z"),
          facts: {
            version: 4,
          },
        },
      ],
      truncated: false,
    });
    const contexts = new RequestAuthorizationContextStore();
    contexts.set(request, {
      authentication: {
        authSubjectId: "01K00000000000000000000007",
        sessionId: scope.authenticationRefId,
        authenticationStrength: "single_factor",
      },
      scope,
    });
    const controller = new OperationalTimelineController(
      {
        operationalTimeline: {
          get,
        },
      } as unknown as ServerDatabaseRuntime,
      contexts,
    );

    await expect(
      controller.get(request, {
        workflowRunId,
      }),
    ).resolves.toEqual({
      workflowRunId,
      generatedAt: "2026-07-28T20:00:00.000Z",
      items: [
        {
          id: workflowRunId,
          source: "workflow_run",
          kind: "workflow.snapshot",
          resourceType: "workflow_run",
          resourceId: workflowRunId,
          status: "completed",
          occurredAt: "2026-07-28T19:59:00.000Z",
          facts: {
            version: 4,
          },
        },
      ],
      truncated: false,
    });
    expect(get).toHaveBeenCalledOnce();
    const query = get.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      authority: scope,
      workflowRunId,
      limit: 500,
    });
    expect(query?.now).toBeInstanceOf(Date);
  });
});
