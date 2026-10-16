import { createHash } from "node:crypto";
import {
  Body,
  Controller,
  Header,
  Inject,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  getRuntimeConfigurationRoute,
  publishRuntimeConfigurationRoute,
  listRuntimeConfigurationHistoryRoute,
  restoreRuntimeConfigurationRoute,
  PublishRuntimeConfigurationSchema,
  RestoreRuntimeConfigurationSchema,
  type PublishRuntimeConfiguration,
  type RestoreRuntimeConfiguration,
} from "@kanvas/contracts/api";
import { RuntimeConfigurationError } from "@kanvas/database/runtime";
import { InstanceAccessStoreError } from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";

async function mapped<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InstanceAccessStoreError)
      throw new ForbiddenException(error.message);
    if (error instanceof RuntimeConfigurationError) {
      if (error.code === "runtime_configuration.conflict")
        throw new ConflictException(error.message);
      if (error.code === "runtime_configuration.invalid")
        throw new BadRequestException(error.message);
    }
    throw new ServiceUnavailableException(
      "Runtime configuration is temporarily unavailable.",
    );
  }
}
@Controller()
@UseGuards(InstanceAdministratorGuard)
export class RuntimeConfigurationController {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}
  private audit(request: FastifyRequest) {
    return {
      auditEventId: ulid(),
      authenticationRefHash: `sha256:${createHash("sha256").update(this.contexts.require(request).authentication.sessionId).digest("hex")}`,
      requestId: request.id,
    };
  }
  @ContractRoute(getRuntimeConfigurationRoute)
  @Header("Cache-Control", "no-store")
  get(@Req() request: FastifyRequest) {
    return mapped(() =>
      this.database.runtimeConfiguration.overview(
        this.contexts.require(request).scope,
      ),
    );
  }
  @ContractRoute(listRuntimeConfigurationHistoryRoute)
  @Header("Cache-Control", "no-store")
  history(@Req() request: FastifyRequest) {
    return mapped(() =>
      this.database.runtimeConfiguration.history(
        this.contexts.require(request).scope,
      ),
    );
  }
  @ContractRoute(publishRuntimeConfigurationRoute)
  publish(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(PublishRuntimeConfigurationSchema))
    body: PublishRuntimeConfiguration,
  ) {
    return mapped(() =>
      this.database.runtimeConfiguration.publish(
        this.contexts.require(request).scope,
        body,
        this.audit(request),
      ),
    );
  }
  @ContractRoute(restoreRuntimeConfigurationRoute)
  restore(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(RestoreRuntimeConfigurationSchema))
    body: RestoreRuntimeConfiguration,
  ) {
    return mapped(() =>
      this.database.runtimeConfiguration.restore(
        this.contexts.require(request).scope,
        body,
        this.audit(request),
      ),
    );
  }
}
