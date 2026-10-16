import {
  BadRequestException,
  ForbiddenException,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  requireToolFrameRequest,
  ToolRuntimeWorkspaceGuard,
} from "../src/http/tool-runtime.guard.js";
import type { WorkspaceAuthorizationGuard } from "../src/http/workspace-authorization.guard.js";
import type { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
const workspaceId = "01K00000000000000000000001";
const req = (
  headers: Record<string, string> = { "sec-fetch-dest": "iframe" },
  url = "/runtime",
) => ({ headers, url, params: { workspaceId } }) as unknown as FastifyRequest;
const context = (request: FastifyRequest) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;
describe("tool runtime frame authorization", () => {
  it("rejects direct navigation, script fetches, service bearer and query-string payloads", () => {
    for (const request of [
      req({}),
      req({ "sec-fetch-dest": "document" }),
      req({ "sec-fetch-dest": "iframe", authorization: "Bearer test" }),
      req({ "sec-fetch-dest": "iframe" }, "/runtime?leak=value"),
    ])
      expect(() => requireToolFrameRequest(request)).toThrow(
        ForbiddenException,
      );
  });
  it("derives the Workspace from the path then invokes normal authorization", async () => {
    const canActivate = vi.fn().mockResolvedValue(true);
    const request = req();
    const guard = new ToolRuntimeWorkspaceGuard(
      { canActivate } as unknown as WorkspaceAuthorizationGuard,
      {
        require: () => ({ scope: { workspaceId } }),
      } as unknown as RequestAuthorizationContextStore,
    );
    expect(await guard.canActivate(context(request))).toBe(true);
    expect(request.headers["x-kanvas-workspace-id"]).toBe(workspaceId);
    expect(canActivate).toHaveBeenCalledOnce();
  });
  it("rejects mismatched scope instead of retargeting an existing authority", async () => {
    const canActivate = vi.fn().mockResolvedValue(true);
    const guard = new ToolRuntimeWorkspaceGuard(
      { canActivate } as unknown as WorkspaceAuthorizationGuard,
      {
        require: () => ({ scope: { workspaceId: "different" } }),
      } as unknown as RequestAuthorizationContextStore,
    );
    await expect(
      guard.canActivate(
        context(
          req({
            "sec-fetch-dest": "iframe",
            "x-kanvas-workspace-id": "different",
          }),
        ),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(canActivate).not.toHaveBeenCalled();
    await expect(guard.canActivate(context(req()))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
