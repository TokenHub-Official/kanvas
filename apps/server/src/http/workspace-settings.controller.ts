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
  getWorkspaceGeneralSettingsRoute,
  renameWorkspaceRoute,
  RenameWorkspaceBodySchema,
  type RenameWorkspaceBody,
  type WorkspaceGeneralSettings,
} from "@kanvas/contracts/api";
import type {
  ControlPlaneAuditContext,
  WorkspaceSettingsRecord,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:workspace-settings-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
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
    authenticationRefHash: authenticationReferenceHash(
      scope.authenticationRefId,
    ),
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    requestId: request.id,
  });
}

function settingsFrom(
  record: WorkspaceSettingsRecord,
): WorkspaceGeneralSettings {
  return {
    workspaceId: record.workspaceId,
    slug: record.slug,
    name: record.name,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapSettingsError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }
  if (error.message.includes("were not found")) {
    throw new NotFoundException(error.message);
  }
  if (
    error.message.includes("changed before") ||
    error.message.includes("cannot be changed")
  ) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller()
export class WorkspaceSettingsController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(getWorkspaceGeneralSettingsRoute)
  @RequireWorkspacePermission("workspace.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceGeneralSettings> {
    const { scope } = this.contexts.require(request);
    return settingsFrom(
      await this.database.workspaceSettings.get(scope, new Date()),
    );
  }

  @ContractRoute(renameWorkspaceRoute)
  @RequireWorkspacePermission("workspace.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async rename(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(RenameWorkspaceBodySchema))
    body: RenameWorkspaceBody,
  ): Promise<WorkspaceGeneralSettings> {
    const name = body.name.trim();
    if (!name) {
      throw new BadRequestException("Workspace name cannot be empty.");
    }
    const { scope } = this.contexts.require(request);
    try {
      return settingsFrom(
        await this.database.workspaceSettings.rename({
          scope,
          expectedVersion: body.expectedVersion,
          name,
          now: new Date(),
          audit: auditFor(scope, request),
        }),
      );
    } catch (error) {
      return mapSettingsError(error);
    }
  }
}
