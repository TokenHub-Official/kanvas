import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { DomainError, type TrustedWorkspaceScope } from "@kanvas/application";
import {
  moveCapabilityBindingRoute,
  MoveCapabilityBindingBodySchema,
  setCapabilityBindingStatusRoute,
  SetCapabilityBindingStatusBodySchema,
  type CapabilityBindingMutationResult,
  type MoveCapabilityBindingBody,
  type SetCapabilityBindingStatusBody,
} from "@kanvas/contracts/api";
import type { ControlPlaneAuditContext } from "@kanvas/database/runtime";
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

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:capability-bindings-auth-ref:v1\0")
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

function requireBindingId(value: string): string {
  if (!ulidPattern.test(value)) {
    throw new BadRequestException(
      "Capability Binding ID must be a canonical uppercase ULID.",
    );
  }
  return value;
}

function mapBindingError(error: unknown): never {
  if (error instanceof DomainError) {
    throw new BadRequestException(error.message);
  }
  if (!(error instanceof Error)) throw error;
  if (error.message.includes("was not found")) {
    throw new NotFoundException(error.message);
  }
  if (
    error.message.includes("changed before") ||
    error.message.includes("cannot be changed") ||
    error.message.includes("not ready") ||
    error.message.includes("cannot be reordered")
  ) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller()
export class WorkspaceCapabilityBindingsController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(setCapabilityBindingStatusRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async setStatus(
    @Req() request: FastifyRequest,
    @Param("capabilityBindingId") capabilityBindingId: string,
    @Body(new ContractBodyPipe(SetCapabilityBindingStatusBodySchema))
    body: SetCapabilityBindingStatusBody,
  ): Promise<CapabilityBindingMutationResult> {
    const bindingId = requireBindingId(capabilityBindingId);
    const { scope } = this.contexts.require(request);
    try {
      return await this.database.capabilityBindingAdmin.setStatus({
        scope,
        bindingId,
        expectedVersion: body.expectedVersion,
        status: body.status === "enabled" ? "active" : "disabled",
        now: new Date(),
        audit: auditFor(scope, request),
      });
    } catch (error) {
      return mapBindingError(error);
    }
  }

  @ContractRoute(moveCapabilityBindingRoute)
  @RequireWorkspacePermission("capability.configure")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async move(
    @Req() request: FastifyRequest,
    @Param("capabilityBindingId") capabilityBindingId: string,
    @Body(new ContractBodyPipe(MoveCapabilityBindingBodySchema))
    body: MoveCapabilityBindingBody,
  ): Promise<CapabilityBindingMutationResult> {
    const bindingId = requireBindingId(capabilityBindingId);
    const { scope } = this.contexts.require(request);
    try {
      return await this.database.capabilityBindingAdmin.move({
        scope,
        bindingId,
        expectedVersion: body.expectedVersion,
        adjacentBindingId: body.adjacentBindingId,
        expectedAdjacentVersion: body.expectedAdjacentVersion,
        direction: body.direction,
        now: new Date(),
        audit: auditFor(scope, request),
      });
    } catch (error) {
      return mapBindingError(error);
    }
  }
}
