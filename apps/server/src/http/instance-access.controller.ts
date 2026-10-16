import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type ChangeInstancePrincipalStatusBody,
  type ChangedInstancePrincipalStatus,
  type ChangedWorkspaceMembership,
  ChangeInstancePrincipalStatusBodySchema,
  ChangeWorkspaceMembershipBodySchema,
  changeInstancePrincipalStatusRoute,
  changeInstanceWorkspaceMembershipRoute,
  type CreateWorkspaceInvitationBody,
  CreateWorkspaceInvitationBodySchema,
  createInstanceInvitationRoute,
  type GrantInstanceWorkspaceAccessBody,
  type GrantedInstanceWorkspaceAccess,
  GrantInstanceWorkspaceAccessBodySchema,
  type InstanceAccessOverview,
  InstanceInvitationPathSchema,
  InstanceWorkspacePathSchema,
  InstanceWorkspaceMemberPathSchema,
  TargetPrincipalPathSchema,
  type RevokeWorkspaceInvitationBody,
  RevokeWorkspaceInvitationBodySchema,
  revokeInstanceInvitationRoute,
  type WorkspaceInvitationCreated,
  type WorkspaceInvitationRevoked,
  getInstanceAccessOverviewRoute,
  grantInstanceWorkspaceAccessRoute,
} from "@kanvas/contracts/api";
import {
  AuthorizationStoreError,
  digestInvitationToken,
  InstanceAccessStoreError,
  invitationTokenPrefix,
  TeamStoreError,
} from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";

function authenticationReferenceHash(sessionId: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:instance-access-auth-ref:v1\0")
    .update(sessionId)
    .digest("hex")}`;
}

function issueInvitationToken(): string {
  return `knv_invite_v1_${randomBytes(32).toString("base64url")}`;
}

function invitationExpiresAt(now: Date, hours = 168): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1_000);
}

function mapInstanceAccessError(error: unknown): never {
  if (error instanceof TeamStoreError) {
    if (error.code === "team.invitation_not_found") {
      throw new NotFoundException(error.message);
    }
    if (error.code === "team.concurrent_change") {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/instance-invitation-changed",
        title: "Workspace invitation changed",
        status: 409,
        code: "instance_invitation.changed",
        detail: error.message,
      });
    }
    if (error.code === "team.forbidden") {
      throw new ForbiddenException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  if (error instanceof AuthorizationStoreError) {
    if (
      error.code === "authorization.last_owner" ||
      error.code === "authorization.scope_stale" ||
      error.code === "authorization.membership_exists"
    ) {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/instance-workspace-access-changed",
        title: "Workspace membership changed",
        status: 409,
        code:
          error.code === "authorization.last_owner"
            ? "workspace_team.last_owner"
            : "instance_workspace_access.changed",
        detail: error.message,
      });
    }
    if (error.code === "authorization.forbidden") {
      throw new ForbiddenException({
        type: "https://kanvas.invalid/problems/instance-workspace-access-forbidden",
        title: "Workspace membership operation is forbidden",
        status: 403,
        code: "instance_workspace_access.forbidden",
      });
    }
    throw new BadRequestException(error.message);
  }
  if (!(error instanceof InstanceAccessStoreError)) throw error;
  if (error.code === "instance_access.invalid_argument") {
    throw new BadRequestException({
      type: "https://kanvas.invalid/problems/instance-workspace-access-invalid",
      title: "Workspace access assignment is invalid",
      status: 400,
      code: "instance_workspace_access.invalid",
      detail: error.message,
    });
  }
  if (
    error.code === "instance_access.concurrent_change" ||
    error.code === "instance_access.state_invalid"
  ) {
    throw new ConflictException({
      type: "https://kanvas.invalid/problems/instance-workspace-access-changed",
      title: "Workspace access state changed",
      status: 409,
      code: "instance_workspace_access.changed",
      detail: "Reload the current access state before assigning again.",
    });
  }
  if (error.code === "instance_access.last_owner") {
    throw new ConflictException({
      type: "https://kanvas.invalid/problems/workspace-team-last-owner",
      title: "Workspace must retain an active Owner",
      status: 409,
      code: "workspace_team.last_owner",
      detail: error.message,
    });
  }
  if (error.code === "instance_access.protected_principal") {
    throw new ConflictException({
      type: "https://kanvas.invalid/problems/instance-principal-protected",
      title: "This account is protected",
      status: 409,
      code: "instance_principal.protected",
      detail: error.message,
    });
  }
  throw new ForbiddenException({
    type: "https://kanvas.invalid/problems/instance-workspace-access-forbidden",
    title: "Instance administration is unavailable",
    status: 403,
    code: "instance_workspace_access.forbidden",
  });
}

@Controller()
@UseGuards(InstanceAdministratorGuard)
export class InstanceAccessController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}

  @ContractRoute(getInstanceAccessOverviewRoute)
  @Header("Cache-Control", "no-store")
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<InstanceAccessOverview> {
    const { scope } = this.contexts.require(request);
    try {
      const overview =
        await this.database.instanceAccess.listAccessOverview(scope);
      return {
        principals: overview.principals.map((principal) => ({
          principalId: principal.principalId,
          displayName: principal.displayName,
          email: principal.email,
          emailVerified: principal.emailVerified,
          status: principal.status,
          version: principal.version,
          isInstanceAdministrator: principal.isInstanceAdministrator,
          memberships: principal.memberships.map((membership) => ({
            ...membership,
          })),
          registeredAt: principal.registeredAt.toISOString(),
        })),
        workspaces: overview.workspaces.map((workspace) => ({ ...workspace })),
        invitations: overview.invitations.map((invitation) => ({
          ...invitation,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        })),
      };
    } catch (error) {
      return mapInstanceAccessError(error);
    }
  }

  @ContractRoute(grantInstanceWorkspaceAccessRoute)
  public async grant(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(TargetPrincipalPathSchema))
    params: { readonly targetPrincipalId: string },
    @Body(new ContractBodyPipe(GrantInstanceWorkspaceAccessBodySchema))
    body: GrantInstanceWorkspaceAccessBody,
  ): Promise<GrantedInstanceWorkspaceAccess> {
    const { authentication, scope } = this.contexts.require(request);
    try {
      const memberships =
        await this.database.instanceAccess.grantWorkspaceAccess({
          authority: scope,
          targetPrincipalId: params.targetPrincipalId,
          assignments: body.assignments,
          now: new Date(),
          audit: {
            authenticationRefHash: authenticationReferenceHash(
              authentication.sessionId,
            ),
            requestId: request.id,
          },
        });
      return {
        memberships: memberships.map((membership) => ({ ...membership })),
      };
    } catch (error) {
      return mapInstanceAccessError(error);
    }
  }

  @ContractRoute(changeInstanceWorkspaceMembershipRoute)
  public async changeMembership(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(InstanceWorkspaceMemberPathSchema))
    params: {
      readonly workspaceId: string;
      readonly targetPrincipalId: string;
    },
    @Body(new ContractBodyPipe(ChangeWorkspaceMembershipBodySchema))
    body: {
      readonly expectedVersion: number;
      readonly role:
        "owner" | "admin" | "editor" | "operator" | "reviewer" | "viewer";
      readonly status: "active" | "suspended" | "revoked";
    },
  ): Promise<ChangedWorkspaceMembership> {
    const { authentication, scope } = this.contexts.require(request);
    try {
      const changed =
        await this.database.authorization.changeWorkspaceMembership({
          authority: scope,
          workspaceId: params.workspaceId,
          targetPrincipalId: params.targetPrincipalId,
          expectedTargetVersion: body.expectedVersion,
          nextRole: body.role,
          nextStatus: body.status,
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              authentication.sessionId,
            ),
            requestId: request.id,
          },
        });
      return {
        membershipId: changed.membershipId,
        role: changed.role as ChangedWorkspaceMembership["role"],
        status: changed.status,
        version: changed.version,
      };
    } catch (error) {
      return mapInstanceAccessError(error);
    }
  }

  @ContractRoute(changeInstancePrincipalStatusRoute)
  public async changePrincipalStatus(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(TargetPrincipalPathSchema))
    params: { readonly targetPrincipalId: string },
    @Body(new ContractBodyPipe(ChangeInstancePrincipalStatusBodySchema))
    body: ChangeInstancePrincipalStatusBody,
  ): Promise<ChangedInstancePrincipalStatus> {
    const { authentication, scope } = this.contexts.require(request);
    try {
      return await this.database.instanceAccess.changePrincipalStatus({
        authority: scope,
        targetPrincipalId: params.targetPrincipalId,
        expectedVersion: body.expectedVersion,
        status: body.status,
        now: new Date(),
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: authenticationReferenceHash(
            authentication.sessionId,
          ),
          requestId: request.id,
        },
      });
    } catch (error) {
      return mapInstanceAccessError(error);
    }
  }

  @ContractRoute(createInstanceInvitationRoute)
  public async createInvitation(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(InstanceWorkspacePathSchema))
    params: { readonly workspaceId: string },
    @Body(new ContractBodyPipe(CreateWorkspaceInvitationBodySchema))
    body: CreateWorkspaceInvitationBody,
  ): Promise<WorkspaceInvitationCreated> {
    const { authentication, scope } = this.contexts.require(request);
    const now = new Date();
    const invitationToken = issueInvitationToken();
    try {
      const created = await this.database.team.createWorkspaceInvitation({
        authority: scope,
        workspaceId: params.workspaceId,
        invitationId: ulid(),
        targetEmail: body.targetEmail,
        workspaceRole: body.workspaceRole,
        tokenHash: digestInvitationToken(invitationToken),
        tokenPrefix: invitationTokenPrefix(invitationToken),
        expiresAt: invitationExpiresAt(now, body.expiresInHours),
        now,
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: authenticationReferenceHash(
            authentication.sessionId,
          ),
          requestId: request.id,
        },
      });
      return {
        invitationId: created.invitationId,
        invitationToken,
        invitePath: `/invite/${invitationToken}`,
        targetEmailMasked: created.targetEmailMasked,
        workspaceRole: created.workspaceRole,
        expiresAt: created.expiresAt.toISOString(),
        version: created.version,
      };
    } catch (error) {
      return mapInstanceAccessError(error);
    }
  }

  @ContractRoute(revokeInstanceInvitationRoute)
  public async revokeInvitation(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(InstanceInvitationPathSchema))
    params: { readonly workspaceId: string; readonly invitationId: string },
    @Body(new ContractBodyPipe(RevokeWorkspaceInvitationBodySchema))
    body: RevokeWorkspaceInvitationBody,
  ): Promise<WorkspaceInvitationRevoked> {
    const { authentication, scope } = this.contexts.require(request);
    try {
      const revoked = await this.database.team.revokeWorkspaceInvitation({
        authority: scope,
        workspaceId: params.workspaceId,
        invitationId: params.invitationId,
        expectedVersion: body.expectedVersion,
        reasonCode: "cancelled",
        now: new Date(),
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: authenticationReferenceHash(
            authentication.sessionId,
          ),
          requestId: request.id,
        },
      });
      return {
        invitationId: revoked.invitationId,
        state: revoked.state,
        version: revoked.version,
        revokedAt: revoked.revokedAt.toISOString(),
      };
    } catch (error) {
      return mapInstanceAccessError(error);
    }
  }
}
