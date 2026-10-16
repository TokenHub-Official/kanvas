import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CancelCapabilityRunBodySchema,
  CanvasCapabilityCatalogQuerySchema,
  CapabilityRunPathSchema,
  CreateCanvasCapabilityRunBodySchema,
  CreateCapabilityRunBodySchema,
  cancelCapabilityRunRoute,
  createCanvasCapabilityRunRoute,
  createCapabilityRunRoute,
  getCapabilityRunRoute,
  getProviderResultRecoveryRoute,
  requestProviderResultRecoveryRoute,
  listCanvasCapabilitiesRoute,
  listUserCapabilitiesRoute,
  type UserCapabilityCatalog,
  type CancelCapabilityRunBody,
  type CanvasCapabilityCatalog,
  type CanvasCapabilityCatalogQuery,
  type CapabilityRunAccepted,
  type CapabilityRunDetails,
  type CreateCanvasCapabilityRunBody,
  type CreateCapabilityRunBody,
} from "@kanvas/contracts/api";
import type { FastifyRequest } from "fastify";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { CapabilityRunService } from "../capabilities/capability-run.service.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { capabilityRunDetails as details } from "./capability-run-presentation.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

@Controller()
export class CapabilityRunController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly runs: CapabilityRunService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(listUserCapabilitiesRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async listUser(
    @Req() request: FastifyRequest,
    @Headers("accept-language") acceptLanguage: string | undefined,
  ): Promise<UserCapabilityCatalog> {
    const locale = acceptLanguage?.toLowerCase().startsWith("en")
      ? "en-US"
      : "zh-CN";
    const items = await this.database.capabilityRuns.listUserCapabilities(
      this.contexts.require(request).scope,
      locale,
      new Date(),
    );
    return { items: [...items.slice(0, 100)], truncated: items.length > 100 };
  }

  @ContractRoute(listCanvasCapabilitiesRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async listCanvas(
    @Req() request: FastifyRequest,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Query(new ContractBodyPipe(CanvasCapabilityCatalogQuerySchema))
    query: CanvasCapabilityCatalogQuery,
  ): Promise<CanvasCapabilityCatalog> {
    const locale = acceptLanguage?.toLocaleLowerCase().startsWith("en")
      ? ("en-US" as const)
      : ("zh-CN" as const);
    const items = await this.database.capabilityRuns.listCanvasCapabilities(
      this.contexts.require(request).scope,
      { ...query, locale },
      new Date(),
    );
    return {
      items: [...items.slice(0, 100)],
      truncated: items.length > 100,
    };
  }

  @ContractRoute(createCanvasCapabilityRunRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  @HttpCode(201)
  public async createCanvas(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateCanvasCapabilityRunBodySchema))
    body: CreateCanvasCapabilityRunBody,
  ): Promise<CapabilityRunAccepted> {
    const { scope } = this.contexts.require(request);
    const result = await this.runs.start({
      authority: scope,
      invocationKind: "canvas",
      invocationReferenceId: idempotencyKey ?? "",
      contractRevisionId: body.contractRevisionId,
      idempotencyKey: idempotencyKey ?? "",
      input: body.input,
      requestId: request.id,
      now: new Date(),
    });
    return {
      ...details(result.run, scope.effectivePermissions.includes("audit.read")),
      replayed: result.replayed,
    };
  }

  @ContractRoute(createCapabilityRunRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  @HttpCode(201)
  public async create(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ContractBodyPipe(CreateCapabilityRunBodySchema))
    body: CreateCapabilityRunBody,
  ): Promise<CapabilityRunAccepted> {
    const { scope } = this.contexts.require(request);
    const result = await this.runs.start({
      authority: scope,
      invocationKind: "user",
      invocationReferenceId: idempotencyKey ?? "",
      contractRevisionId: body.contractRevisionId,
      idempotencyKey: idempotencyKey ?? "",
      input: body.input,
      requestId: request.id,
      now: new Date(),
    });
    return {
      ...details(result.run, scope.effectivePermissions.includes("audit.read")),
      replayed: result.replayed,
    };
  }

  @ContractRoute(getProviderResultRecoveryRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  resultRecovery(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CapabilityRunPathSchema))
    params: { readonly capabilityRunId: string },
  ) {
    return this.database.providerResultRecovery.view(
      this.contexts.require(request).scope,
      params.capabilityRunId,
      new Date(),
    );
  }
  @ContractRoute(requestProviderResultRecoveryRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  @HttpCode(200)
  recoverResult(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CapabilityRunPathSchema))
    params: { readonly capabilityRunId: string },
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.database.providerResultRecovery.enqueue(
      this.contexts.require(request).scope,
      params.capabilityRunId,
      key ?? "",
      new Date(),
    );
  }

  @ContractRoute(getCapabilityRunRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CapabilityRunPathSchema))
    params: { readonly capabilityRunId: string },
  ): Promise<CapabilityRunDetails> {
    const { scope } = this.contexts.require(request);
    return details(
      await this.runs.get(scope, params.capabilityRunId, new Date()),
      scope.effectivePermissions.includes("audit.read"),
    );
  }

  @ContractRoute(cancelCapabilityRunRoute)
  @RequireWorkspacePermission("capability.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async cancel(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(CapabilityRunPathSchema))
    params: { readonly capabilityRunId: string },
    @Body(new ContractBodyPipe(CancelCapabilityRunBodySchema))
    body: CancelCapabilityRunBody,
  ): Promise<CapabilityRunDetails> {
    const { scope } = this.contexts.require(request);
    void body;
    return details(
      await this.runs.cancel({
        authority: scope,
        capabilityRunId: params.capabilityRunId,
        requestId: request.id,
        now: new Date(),
      }),
      scope.effectivePermissions.includes("audit.read"),
    );
  }
}
