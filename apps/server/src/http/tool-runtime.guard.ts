import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";

export function requireToolFrameRequest(request: FastifyRequest): void {
  if (
    request.headers["sec-fetch-dest"] !== "iframe" ||
    request.headers.authorization ||
    request.url.includes("?")
  )
    throw new ForbiddenException(
      "Tool content is only available inside its authenticated frame.",
    );
}
@Injectable()
export class ToolRuntimeWorkspaceGuard implements CanActivate {
  public constructor(
    private readonly authorization: WorkspaceAuthorizationGuard,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    requireToolFrameRequest(request);
    const workspaceId = (request.params as Record<string, unknown>).workspaceId;
    if (
      typeof workspaceId !== "string" ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(workspaceId)
    )
      throw new BadRequestException("Invalid Workspace identity.");
    const header = request.headers["x-kanvas-workspace-id"];
    if (header !== undefined && header !== workspaceId)
      throw new BadRequestException(
        "Runtime Workspace does not match the request.",
      );
    request.headers["x-kanvas-workspace-id"] = workspaceId;
    const authorized = await this.authorization.canActivate(context);
    if (this.contexts.require(request).scope.workspaceId !== workspaceId)
      throw new ForbiddenException("Runtime Workspace is unavailable.");
    return authorized;
  }
}
