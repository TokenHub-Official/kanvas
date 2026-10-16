import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  getWorkspaceAgentModelSettingsRoute,
  updateWorkspaceAgentModelSettingsRoute,
  UpdateWorkspaceAgentModelSettingsBodySchema,
  type UpdateWorkspaceAgentModelSettingsBody,
  type WorkspaceAgentModelSettings,
} from "@kanvas/contracts/api";
import {
  AgentProfilePublicationStoreError,
  type AgentModelSettingsRecord,
  type ControlPlaneAuditContext,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function response(
  record: AgentModelSettingsRecord,
): WorkspaceAgentModelSettings {
  return {
    version: record.version,
    ...(record.currentDefaultModelId
      ? { currentDefaultModelId: record.currentDefaultModelId }
      : {}),
    ...(record.currentFastModelId
      ? { currentFastModelId: record.currentFastModelId }
      : {}),
    reasoningLevel: record.reasoningLevel,
    webSearchMode: record.webSearchMode,
    actionConfirmationRequired: record.actionConfirmationRequired,
    options: record.options.map((option) => ({
      id: option.id,
      modelName: option.modelName,
      ready: option.ready,
      ...(option.unavailableReasons
        ? { unavailableReasons: [...option.unavailableReasons] }
        : {}),
    })),
  };
}

function auditFor(
  scope: TrustedWorkspaceScope,
  request: FastifyRequest,
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId: ulid(),
    actorPrincipalId: scope.principalId,
    actorType: scope.principalType,
    authenticationRefType: scope.authenticationRefType,
    authenticationRefHash: `sha256:${createHash("sha256")
      .update("kanvas:agent-model-settings-auth:v1\0")
      .update(scope.authenticationRefId)
      .digest("hex")}`,
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    requestId: request.id,
  });
}

function mapError(error: unknown): never {
  if (!(error instanceof AgentProfilePublicationStoreError)) throw error;
  if (error.code === "agent_model_settings.not_configured") {
    throw new NotFoundException(error.message);
  }
  if (
    error.code === "agent_model_settings.state_conflict" ||
    error.code === "agent_model_settings.model_unavailable"
  ) {
    throw new ConflictException(error.message);
  }
  if (error.code === "agent_model_settings.invalid") {
    throw new BadRequestException(error.message);
  }
  throw error;
}

@Controller()
export class WorkspaceAgentModelSettingsController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(getWorkspaceAgentModelSettingsRoute)
  @RequireWorkspacePermission("agent.run")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceAgentModelSettings> {
    const { scope } = this.contexts.require(request);
    try {
      return response(
        await this.database.agentProfilePublications.getModelSettings(
          scope,
          new Date(),
        ),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @ContractRoute(updateWorkspaceAgentModelSettingsRoute)
  @RequireWorkspacePermission("workspace.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async update(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(UpdateWorkspaceAgentModelSettingsBodySchema))
    body: UpdateWorkspaceAgentModelSettingsBody,
  ): Promise<WorkspaceAgentModelSettings> {
    const { scope } = this.contexts.require(request);
    try {
      return response(
        await this.database.agentProfilePublications.setModelSettings({
          authority: scope,
          expectedVersion: body.expectedVersion,
          defaultModelId: body.defaultModelId,
          fastModelId: body.fastModelId,
          reasoningLevel: body.reasoningLevel,
          webSearchMode: body.webSearchMode,
          actionConfirmationRequired: body.actionConfirmationRequired,
          now: new Date(),
          audit: auditFor(scope, request),
        }),
      );
    } catch (error) {
      return mapError(error);
    }
  }
}
