import "reflect-metadata";
import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  CreateToolSessionBodySchema,
  type ToolSession,
  type UserCapabilitySummary,
} from "@kanvas/contracts/api";
import { SiteToolStoreError } from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { CapabilityRunService } from "../src/capabilities/capability-run.service.js";
import { ToolSessionController } from "../src/http/tool-session.controller.js";
import { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
import { ContractBodyPipe } from "../src/http/contract-body.pipe.js";
const id = (n: number) => `01K${String(n).padStart(23, "0")}`;
const scope: TrustedWorkspaceScope = {
  workspaceId: id(1),
  organizationId: id(2),
  principalId: id(3),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "session",
  authorityType: "human_membership",
  authorityId: id(4),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["workspace.read", "capability.run"],
  trusted: true,
};
const session: ToolSession = {
  id: id(5),
  toolId: id(6),
  revisionId: id(7),
  revisionDigest: `sha256:${"a".repeat(64)}`,
  kind: "use",
  available: true,
  unavailableReason: null,
  expiresAt: "2026-09-23T12:00:00Z",
  allowedContractRevisionIds: [id(8)],
  maximumRuns: 3,
  runIds: [],
};
function fixture() {
  const request = { id: "request" } as FastifyRequest;
  const contexts = new RequestAuthorizationContextStore();
  contexts.set(request, {
    scope,
    authentication: {
      authSubjectId: "subject",
      sessionId: "session",
      authenticationStrength: "single_factor",
    },
  });
  const get = vi
    .fn<ServerDatabaseRuntime["toolSessions"]["get"]>()
    .mockResolvedValue(session);
  const create = vi
    .fn<ServerDatabaseRuntime["toolSessions"]["create"]>()
    .mockResolvedValue(session);
  const assertRun = vi.fn<ServerDatabaseRuntime["toolSessions"]["assertRun"]>();
  const list = vi
    .fn<ServerDatabaseRuntime["capabilityRuns"]["listUserCapabilities"]>()
    .mockResolvedValue([
      { contractRevisionId: id(8) },
      { contractRevisionId: id(9) },
    ] as UserCapabilitySummary[]);
  const runGet = vi.fn();
  const start = vi.fn();
  const cancel = vi.fn();
  const controller = new ToolSessionController(
    {
      toolSessions: { get, create, assertRun },
      capabilityRuns: { listUserCapabilities: list },
    } as unknown as ServerDatabaseRuntime,
    contexts,
    { get: runGet, start, cancel } as unknown as CapabilityRunService,
  );
  return {
    request,
    controller,
    get,
    create,
    assertRun,
    list,
    runGet,
    start,
    cancel,
  };
}
describe("tool session API boundary", () => {
  it("derives use scope from authenticated context and does not accept preview selection", async () => {
    const f = fixture();
    expect(() =>
      new ContractBodyPipe(CreateToolSessionBodySchema).transform({
        expectedRevisionId: id(7),
        kind: "preview",
      }),
    ).toThrow(BadRequestException);
    await f.controller.create(f.request, id(6), "open-tool", {
      expectedRevisionId: id(7),
    });
    expect(f.create).toHaveBeenCalledWith(
      { kind: "use", scope },
      id(6),
      id(7),
      "open-tool",
    );
  });
  it("returns only granted capabilities and avoids discovery for a closed utility", async () => {
    const f = fixture();
    expect(
      await f.controller.capabilities(f.request, session.id, "en"),
    ).toEqual({ items: [{ contractRevisionId: id(8) }], truncated: false });
    f.get.mockResolvedValue({ ...session, allowedContractRevisionIds: [] });
    f.list.mockClear();
    expect(
      await f.controller.capabilities(f.request, session.id, "en"),
    ).toEqual({ items: [], truncated: false });
    expect(f.list).not.toHaveBeenCalled();
  });
  it("rejects an ungranted capability before starting execution", async () => {
    const f = fixture();
    await expect(
      f.controller.start(f.request, session.id, {
        contractRevisionId: id(9),
        input: {},
        requestKey: "run-1",
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(f.start).not.toHaveBeenCalled();
  });
  it("requires session lineage before reading or cancelling a run", async () => {
    const f = fixture();
    f.assertRun.mockRejectedValue(
      new SiteToolStoreError("not_found", "Unrelated run"),
    );
    await expect(
      f.controller.getRun(f.request, session.id, id(20)),
    ).rejects.toThrow(NotFoundException);
    await expect(
      f.controller.cancelRun(f.request, session.id, id(20), {}),
    ).rejects.toThrow(NotFoundException);
    expect(f.runGet).not.toHaveBeenCalled();
    expect(f.cancel).not.toHaveBeenCalled();
  });
});
