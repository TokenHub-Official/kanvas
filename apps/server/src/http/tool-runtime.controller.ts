import {
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  getToolRuntimeHostRoute,
  getToolRuntimeContentRoute,
  getToolPreviewHostRoute,
  getToolPreviewContentRoute,
} from "@kanvas/contracts/api";
import {
  SiteToolStoreError,
  InstanceAccessStoreError,
  AuthorizationStoreError,
  type ToolSessionActor,
} from "@kanvas/database";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerDatabaseRuntime } from "../app.module.js";
import type { ServerConfig } from "../config.js";
import { DATABASE_RUNTIME, SERVER_CONFIG } from "../tokens.js";
import {
  createToolHostDocument,
  createToolContentDocument,
} from "../tools/tool-runtime-document.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";
import {
  ToolRuntimeWorkspaceGuard,
  requireToolFrameRequest,
} from "./tool-runtime.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

async function render(
  database: ServerDatabaseRuntime,
  config: ServerConfig,
  actor: ToolSessionActor,
  sessionId: string,
  request: FastifyRequest,
  reply: FastifyReply,
  kind: "host" | "content",
): Promise<string> {
  requireToolFrameRequest(request);
  const parentOrigins = [
    ...new Set([
      ...config.auth.trustedOrigins,
      new URL(config.auth.baseUrl).origin,
    ]),
  ];
  try {
    const session = await database.toolSessions.get(actor, sessionId);
    if (!session.available)
      throw new ForbiddenException("The tool session is no longer available.");
    const document =
      kind === "host"
        ? createToolHostDocument({
            sessionId,
            ...(actor.kind === "use"
              ? { workspaceId: actor.scope.workspaceId }
              : {}),
            parentOrigins,
            locale: String(request.headers["accept-language"] ?? "")
              .toLowerCase()
              .startsWith("en")
              ? "en-US"
              : "zh-CN",
          })
        : createToolContentDocument(
            await database.toolSessions.document(actor, sessionId),
            parentOrigins,
            actor.kind === "preview",
          );
    for (const [name, value] of Object.entries(document.headers))
      reply.header(name, value);
    return document.body;
  } catch (error) {
    if (
      error instanceof SiteToolStoreError ||
      error instanceof InstanceAccessStoreError ||
      error instanceof AuthorizationStoreError
    )
      throw new ForbiddenException("The tool session is unavailable.");
    throw error;
  }
}
@Controller()
@UseGuards(ToolRuntimeWorkspaceGuard)
export class ToolRuntimeController {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}
  @ContractRoute(getToolRuntimeHostRoute)
  @RequireWorkspacePermission("workspace.read")
  public host(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return render(
      this.database,
      this.config,
      { kind: "use", scope: this.contexts.require(request).scope },
      sessionId,
      request,
      reply,
      "host",
    );
  }
  @ContractRoute(getToolRuntimeContentRoute)
  @RequireWorkspacePermission("workspace.read")
  public content(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return render(
      this.database,
      this.config,
      { kind: "use", scope: this.contexts.require(request).scope },
      sessionId,
      request,
      reply,
      "content",
    );
  }
}
@Controller()
@UseGuards(InstanceAdministratorGuard)
export class ToolPreviewRuntimeController {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}
  @ContractRoute(getToolPreviewHostRoute)
  public host(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return render(
      this.database,
      this.config,
      { kind: "preview", authority: this.contexts.require(request).scope },
      sessionId,
      request,
      reply,
      "host",
    );
  }
  @ContractRoute(getToolPreviewContentRoute)
  public content(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return render(
      this.database,
      this.config,
      { kind: "preview", authority: this.contexts.require(request).scope },
      sessionId,
      request,
      reply,
      "content",
    );
  }
}
