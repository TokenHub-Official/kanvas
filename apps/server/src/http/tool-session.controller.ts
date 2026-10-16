import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CreateToolSessionBodySchema,
  InvokeToolCapabilityBodySchema,
  CancelCapabilityRunBodySchema,
  type CreateToolSessionBody,
  type InvokeToolCapabilityBody,
  createToolSessionRoute,
  getToolSessionRoute,
  closeToolSessionRoute,
  listToolSessionCapabilitiesRoute,
  startToolSessionRunRoute,
  getToolSessionRunRoute,
  cancelToolSessionRunRoute,
  createToolPreviewRoute,
  getToolPreviewRoute,
  closeToolPreviewRoute,
} from "@kanvas/contracts/api";
import {
  SiteToolStoreError,
  InstanceAccessStoreError,
  AuthorizationStoreError,
  type ToolSessionActor,
} from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { CapabilityRunService } from "../capabilities/capability-run.service.js";
import { capabilityRunDetails } from "./capability-run-presentation.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

async function execute<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SiteToolStoreError) {
      if (error.code === "not_found")
        throw new NotFoundException({
          code: "tool_session.unavailable",
          detail: error.message,
        });
      if (error.code === "invalid")
        throw new BadRequestException(error.message);
      throw new ConflictException({
        code: `tool_session.${error.code}`,
        detail: error.message,
      });
    }
    if (
      error instanceof InstanceAccessStoreError ||
      error instanceof AuthorizationStoreError
    )
      throw new ForbiddenException(
        "Tool session access is no longer authorized.",
      );
    throw error;
  }
}
@Controller()
@UseGuards(WorkspaceAuthorizationGuard)
export class ToolSessionController {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
    private readonly runs: CapabilityRunService,
  ) {}
  private actor(
    request: FastifyRequest,
  ): Extract<ToolSessionActor, { kind: "use" }> {
    return { kind: "use", scope: this.contexts.require(request).scope };
  }

  @ContractRoute(createToolSessionRoute)
  @RequireWorkspacePermission("workspace.read")
  public create(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(CreateToolSessionBodySchema))
    body: CreateToolSessionBody,
  ) {
    if (!key) throw new BadRequestException("Idempotency-Key is required.");
    return execute(() =>
      this.database.toolSessions.create(
        this.actor(request),
        toolId,
        body.expectedRevisionId,
        key,
      ),
    );
  }
  @ContractRoute(getToolSessionRoute)
  @Header("Cache-Control", "no-store")
  @RequireWorkspacePermission("workspace.read")
  public get(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
  ) {
    return execute(() =>
      this.database.toolSessions.get(this.actor(request), sessionId),
    );
  }

  @ContractRoute(closeToolSessionRoute)
  @RequireWorkspacePermission("workspace.read")
  public close(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Body(new ContractBodyPipe(CancelCapabilityRunBodySchema))
    _body: Record<string, never>,
  ) {
    void _body;
    return execute(() =>
      this.database.toolSessions.close(this.actor(request), sessionId),
    );
  }

  @ContractRoute(listToolSessionCapabilitiesRoute)
  @Header("Cache-Control", "no-store")
  @RequireWorkspacePermission("workspace.read")
  public capabilities(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Headers("accept-language") language: string | undefined,
  ) {
    return execute(async () => {
      const actor = this.actor(request);
      const session = await this.database.toolSessions.get(actor, sessionId);
      if (!session.available)
        throw new ConflictException("The tool session is no longer available.");
      if (!session.allowedContractRevisionIds.length)
        return { items: [], truncated: false };
      const items = await this.database.capabilityRuns.listUserCapabilities(
        actor.scope,
        language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN",
        new Date(),
        session.allowedContractRevisionIds,
      );
      return {
        items: items.filter((item) =>
          session.allowedContractRevisionIds.includes(item.contractRevisionId),
        ),
        truncated: false,
      };
    });
  }

  @ContractRoute(startToolSessionRunRoute)
  @RequireWorkspacePermission("capability.run")
  public start(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Body(new ContractBodyPipe(InvokeToolCapabilityBodySchema))
    body: InvokeToolCapabilityBody,
  ) {
    return execute(async () => {
      const actor = this.actor(request);
      const session = await this.database.toolSessions.get(actor, sessionId);
      if (
        !session.available ||
        !session.allowedContractRevisionIds.includes(body.contractRevisionId)
      )
        throw new ForbiddenException(
          "This tool session cannot invoke that capability.",
        );
      const result = await this.runs.start({
        authority: actor.scope,
        invocationKind: "user",
        invocationReferenceId: `tool:${sessionId}`,
        contractRevisionId: body.contractRevisionId,
        idempotencyKey: `tool:${sessionId}:${body.requestKey}`,
        input: body.input,
        requestId: request.id,
        now: new Date(),
        toolSession: { sessionId, requestKey: body.requestKey },
      });
      return {
        ...capabilityRunDetails(
          result.run,
          actor.scope.effectivePermissions.includes("audit.read"),
        ),
        replayed: result.replayed,
      };
    });
  }

  @ContractRoute(getToolSessionRunRoute)
  @Header("Cache-Control", "no-store")
  @RequireWorkspacePermission("capability.run")
  public getRun(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Param("runId") runId: string,
  ) {
    return execute(async () => {
      const actor = this.actor(request);
      await this.database.toolSessions.assertRun(actor, sessionId, runId);
      return capabilityRunDetails(
        await this.runs.get(actor.scope, runId, new Date()),
        actor.scope.effectivePermissions.includes("audit.read"),
      );
    });
  }

  @ContractRoute(cancelToolSessionRunRoute)
  @RequireWorkspacePermission("capability.run")
  public cancelRun(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Param("runId") runId: string,
    @Body(new ContractBodyPipe(CancelCapabilityRunBodySchema))
    _body: Record<string, never>,
  ) {
    void _body;
    return execute(async () => {
      const actor = this.actor(request);
      await this.database.toolSessions.assertRun(actor, sessionId, runId);
      return capabilityRunDetails(
        await this.runs.cancel({
          authority: actor.scope,
          capabilityRunId: runId,
          requestId: request.id,
          now: new Date(),
        }),
        actor.scope.effectivePermissions.includes("audit.read"),
      );
    });
  }
}

@Controller()
@UseGuards(InstanceAdministratorGuard)
export class ToolPreviewController {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}
  private actor(request: FastifyRequest): ToolSessionActor {
    return { kind: "preview", authority: this.contexts.require(request).scope };
  }
  @ContractRoute(createToolPreviewRoute)
  public create(
    @Req() request: FastifyRequest,
    @Param("toolId") toolId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(CreateToolSessionBodySchema))
    body: CreateToolSessionBody,
  ) {
    if (!key) throw new BadRequestException("Idempotency-Key is required.");
    return execute(() =>
      this.database.toolSessions.create(
        this.actor(request),
        toolId,
        body.expectedRevisionId,
        key,
      ),
    );
  }
  @ContractRoute(getToolPreviewRoute)
  @Header("Cache-Control", "no-store")
  public get(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
  ) {
    return execute(() =>
      this.database.toolSessions.get(this.actor(request), sessionId),
    );
  }
  @ContractRoute(closeToolPreviewRoute)
  public close(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Body(new ContractBodyPipe(CancelCapabilityRunBodySchema))
    _body: Record<string, never>,
  ) {
    void _body;
    return execute(() =>
      this.database.toolSessions.close(this.actor(request), sessionId),
    );
  }
}
