import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  AcceptWorkspaceInvitationBodySchema,
  acceptWorkspaceInvitationRoute,
  AddWorkspaceMemberBodySchema,
  addWorkspaceMemberRoute,
  ChangeWorkspaceMembershipBodySchema,
  changeWorkspaceMembershipRoute,
  ChangeWorkspaceMembershipsBodySchema,
  changeWorkspaceMembershipsRoute,
  CreateWorkspaceInvitationBodySchema,
  createWorkspaceInvitationRoute,
  getWorkspaceTeamRoute,
  InvitationPathSchema,
  registerInvitationAccountRoute,
  RegisterInvitationAccountBodySchema,
  resendWorkspaceInvitationRoute,
  ResendWorkspaceInvitationBodySchema,
  resolveInvitationRoute,
  ResolveInvitationBodySchema,
  RevokeWorkspaceInvitationBodySchema,
  revokeWorkspaceInvitationRoute,
  TargetPrincipalPathSchema,
  WorkspaceTeamQuerySchema,
  type AcceptWorkspaceInvitationBody,
  type AddWorkspaceMemberBody,
  type ChangeWorkspaceMembershipBody,
  type ChangeWorkspaceMembershipsBody,
  type ChangedWorkspaceMembership,
  type ChangedWorkspaceMemberships,
  type CreateWorkspaceInvitationBody,
  type InvitationSummary,
  type InvitationAccountRegistered,
  type RegisterInvitationAccountBody,
  type ResendWorkspaceInvitationBody,
  type ResolveInvitationBody,
  type RevokeWorkspaceInvitationBody,
  type WorkspaceInvitationAccepted,
  type WorkspaceInvitationCreated,
  type WorkspaceInvitationRevoked,
  type WorkspaceTeam,
  type WorkspaceTeamQuery,
} from "@kanvas/contracts/api";
import {
  AuthorizationStoreError,
  digestInvitationToken,
  invitationTokenPrefix,
  TeamStoreError,
  type WorkspaceTeamQuery as DatabaseWorkspaceTeamQuery,
} from "@kanvas/database/runtime";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import {
  clearInvitationAdmissionCookie,
  issueInvitationAdmissionCookie,
} from "../auth/invitation-admission.js";
import type { ServerConfig } from "../config.js";
import {
  AUTHENTICATION_GATEWAY,
  DATABASE_RUNTIME,
  SERVER_CONFIG,
} from "../tokens.js";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { CsrfTokenService } from "../security/csrf-token-service.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";

const workspaceRoles = new Set([
  "owner",
  "admin",
  "editor",
  "operator",
  "reviewer",
  "viewer",
]);
const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

function decodeTeamCursor(
  cursor: string,
  pageKind: NonNullable<WorkspaceTeamQuery["pageKind"]>,
): NonNullable<DatabaseWorkspaceTeamQuery["cursor"]> {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Cursor payload must be an object.");
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    if (typeof record.id !== "string" || !idPattern.test(record.id)) {
      throw new TypeError("Cursor id is invalid.");
    }
    if (
      pageKind === "members" &&
      typeof record.statusRank === "number" &&
      typeof record.roleRank === "number"
    ) {
      return {
        statusRank: record.statusRank,
        roleRank: record.roleRank,
        id: record.id,
      };
    }
    if (pageKind === "invitations" && typeof record.createdAt === "string") {
      const createdAt = new Date(record.createdAt);
      if (!Number.isFinite(createdAt.getTime())) {
        throw new TypeError("Cursor timestamp is invalid.");
      }
      return {
        createdAt,
        id: record.id,
      };
    }
    throw new TypeError("Cursor fields are invalid.");
  } catch {
    throw new BadRequestException("Workspace Team cursor is invalid.");
  }
}

function encodeTeamCursor(
  cursor: NonNullable<DatabaseWorkspaceTeamQuery["cursor"]>,
): string {
  return Buffer.from(
    JSON.stringify(
      "createdAt" in cursor
        ? {
            createdAt: cursor.createdAt.toISOString(),
            id: cursor.id,
          }
        : cursor,
    ),
    "utf8",
  ).toString("base64url");
}

function singleHeader(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function authenticationReferenceHash(sessionId: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:team-auth-ref:v1\0")
    .update(sessionId)
    .digest("hex")}`;
}

function issueInvitationToken(): string {
  return `knv_invite_v1_${randomBytes(32).toString("base64url")}`;
}

function expiresAt(now: Date, hours = 168): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1_000);
}

function mapTeamError(error: unknown): never {
  if (error instanceof AuthorizationStoreError) {
    if (error.code === "authorization.last_owner") {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/workspace-team-last-owner",
        title: "Workspace must retain an active Owner",
        status: 409,
        code: "workspace_team.last_owner",
        detail: "Workspace must retain at least one active Owner.",
      });
    }
    if (error.code === "authorization.scope_stale") {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/workspace-team-concurrent-change",
        title: "Workspace membership changed",
        status: 409,
        code: "workspace_team.concurrent_change",
        detail: "Membership or authority changed before this operation.",
      });
    }
    if (error.code === "authorization.membership_exists") {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/workspace-team-member-exists",
        title: "Account already belongs to this Workspace",
        status: 409,
        code: "workspace_team.member_exists",
        detail: "Use the existing membership to change its role or status.",
      });
    }
    if (error.code === "authorization.account_not_found") {
      throw new NotFoundException({
        type: "https://kanvas.invalid/problems/workspace-team-account-not-found",
        title: "Verified account was not found",
        status: 404,
        code: "workspace_team.account_not_found",
        detail: error.message,
      });
    }
    if (error.code === "authorization.forbidden") {
      throw new ForbiddenException({
        type: "https://kanvas.invalid/problems/workspace-team-forbidden",
        title: "Workspace membership operation is forbidden",
        status: 403,
        code: "workspace_team.forbidden",
        detail: "Current membership cannot perform this operation.",
      });
    }
    throw new BadRequestException(error.message);
  }
  if (!(error instanceof TeamStoreError)) {
    throw error;
  }
  if (error.code === "team.invitation_not_found") {
    throw new NotFoundException("Invitation was not found.");
  }
  if (
    error.code === "team.invitation_expired" ||
    error.code === "team.invitation_inactive" ||
    error.code === "team.identity_mismatch" ||
    error.code === "team.forbidden"
  ) {
    throw new ForbiddenException(error.message);
  }
  if (error.code === "team.concurrent_change") {
    throw new ConflictException({
      type: "https://kanvas.invalid/problems/workspace-team-concurrent-change",
      title: "Workspace membership changed",
      status: 409,
      code: "workspace_team.concurrent_change",
      detail: error.message,
    });
  }
  throw new BadRequestException(error.message);
}

@Controller()
export class WorkspaceTeamController {
  public constructor(
    @Inject(SERVER_CONFIG)
    private readonly config: ServerConfig,
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly csrf: CsrfTokenService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(resolveInvitationRoute)
  public async resolve(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(ResolveInvitationBodySchema))
    body: ResolveInvitationBody,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ): Promise<InvitationSummary> {
    reply?.header("cache-control", "no-store");
    reply?.header(
      "set-cookie",
      clearInvitationAdmissionCookie(this.config.auth),
    );
    try {
      const now = new Date();
      const tokenHash = digestInvitationToken(body.invitationToken);
      const result = await this.database.team.resolveInvitation(tokenHash, now);
      if (!result) {
        throw new NotFoundException("Invitation was not found.");
      }
      if (result.state === "pending" && result.expiresAt > now) {
        reply?.header(
          "set-cookie",
          issueInvitationAdmissionCookie({
            config: this.config.auth,
            invitationExpiresAt: result.expiresAt,
            invitationTokenHash: tokenHash,
            now,
          }),
        );
      }
      const authenticated = await this.authentication.resolveBrowserSession(
        fromNodeHeaders(request.raw.headers),
      );
      let identityStatus:
        "matched" | "mismatched" | "signed_out" | "unverified" = "signed_out";
      const accountEmail =
        authenticated?.accountEmail ??
        (authenticated?.verifiedContact
          ? {
              email: authenticated.verifiedContact.email,
              emailVerified: true,
            }
          : undefined);
      const emailMayBeUsed =
        accountEmail?.emailVerified === true ||
        (accountEmail
          ? !(await this.database.instanceAccess.readRegistrationPolicy())
              .emailVerificationRequired
          : false);
      if (accountEmail && emailMayBeUsed) {
        identityStatus =
          normalizeInvitationEmail(accountEmail.email) === result.targetEmail
            ? "matched"
            : "mismatched";
      } else if (authenticated) {
        identityStatus = "unverified";
      }
      return {
        invitationId: result.invitationId,
        state: result.state,
        organization: {
          id: result.organizationId,
          name: result.organizationName,
        },
        workspace: {
          id: result.workspaceId,
          name: result.workspaceName,
        },
        workspaceRole: result.workspaceRole,
        targetEmailMasked: result.targetEmailMasked,
        identityStatus,
        expiresAt: result.expiresAt.toISOString(),
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(registerInvitationAccountRoute)
  public async registerInvitationAccount(
    @Body(new ContractBodyPipe(RegisterInvitationAccountBodySchema))
    body: RegisterInvitationAccountBody,
  ): Promise<InvitationAccountRegistered> {
    try {
      const invitation = await this.database.team.resolveInvitation(
        digestInvitationToken(body.invitationToken),
        new Date(),
      );
      if (!invitation) {
        throw new NotFoundException("Invitation was not found.");
      }
      if (invitation.state !== "pending") {
        throw new ConflictException({
          type: "https://kanvas.invalid/problems/invitation-registration-changed",
          title: "Invitation is no longer available",
          status: 409,
          code: "invitation_registration.changed",
          detail: "Invitation is no longer available for registration.",
        });
      }
      if (normalizeInvitationEmail(body.email) !== invitation.targetEmail) {
        throw new BadRequestException({
          type: "https://kanvas.invalid/problems/invitation-registration-email-mismatch",
          title: "Invitation email does not match",
          status: 400,
          code: "invitation_registration.email_mismatch",
          detail: "Registration email does not match this invitation.",
        });
      }
      const registerInvitationEmailAccount =
        this.authentication.registerInvitationEmailAccount?.bind(
          this.authentication,
        );
      if (!registerInvitationEmailAccount) {
        throw new ConflictException({
          type: "https://kanvas.invalid/problems/invitation-registration-unavailable",
          title: "Invitation registration is unavailable",
          status: 409,
          code: "invitation_registration.unavailable",
          detail: "Invitation registration is unavailable.",
        });
      }
      const verificationCallback = new URL(
        "/email-verification",
        this.config.auth.baseUrl,
      );
      verificationCallback.searchParams.set(
        "returnTo",
        `/invite/${body.invitationToken}`,
      );
      const result = await registerInvitationEmailAccount({
        email: invitation.targetEmail,
        displayName: body.displayName,
        password: body.password,
        verificationCallbackUrl: verificationCallback.toString(),
      });
      if (result === "account_exists") {
        throw new ConflictException({
          type: "https://kanvas.invalid/problems/invitation-registration-account-exists",
          title: "Account already exists",
          status: 409,
          code: "invitation_registration.account_exists",
          detail: "An account already exists for this invitation.",
        });
      }
      if (result === "unavailable") {
        throw new ConflictException({
          type: "https://kanvas.invalid/problems/invitation-registration-unavailable",
          title: "Invitation registration is unavailable",
          status: 409,
          code: "invitation_registration.unavailable",
          detail: "Invitation email verification is unavailable.",
        });
      }
      return {
        targetEmailMasked: invitation.targetEmailMasked,
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(getWorkspaceTeamRoute)
  @RequireWorkspacePermission("membership.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
    @Query(new ContractBodyPipe(WorkspaceTeamQuerySchema))
    query: WorkspaceTeamQuery = {},
  ): Promise<WorkspaceTeam> {
    const { scope } = this.contexts.require(request);
    try {
      if (query.cursor && !query.pageKind) {
        throw new BadRequestException(
          "Workspace Team cursor requires pageKind.",
        );
      }
      const projection = await this.database.team.listWorkspaceTeam(
        scope,
        new Date(),
        {
          ...(query.pageKind ? { pageKind: query.pageKind } : {}),
          ...(query.cursor && query.pageKind
            ? {
                cursor: decodeTeamCursor(query.cursor, query.pageKind),
              }
            : {}),
          ...(query.limit ? { limit: Number.parseInt(query.limit, 10) } : {}),
        },
      );
      const profiles = await Promise.all(
        projection.members.map(async (member) => {
          const profile = await this.authentication.getHumanProfile?.(
            member.authSubjectId,
          );
          return {
            member,
            profile,
          };
        }),
      );
      return {
        members: profiles.map(({ member, profile }) => ({
          membershipId: member.membershipId,
          principalId: member.principalId,
          displayName:
            profile?.displayName ?? `成员 ${member.principalId.slice(-6)}`,
          ...(profile?.verifiedEmail
            ? { verifiedEmail: profile.verifiedEmail }
            : {}),
          role: member.role,
          status: member.status,
          version: member.version,
          isCurrentHuman: member.principalId === scope.principalId,
          createdAt: member.createdAt.toISOString(),
          updatedAt: member.updatedAt.toISOString(),
        })),
        invitations: projection.invitations.map((invitation) => ({
          invitationId: invitation.invitationId,
          targetEmail: invitation.targetEmail,
          workspaceRole: invitation.workspaceRole,
          state: invitation.state,
          expiresAt: invitation.expiresAt.toISOString(),
          version: invitation.version,
          invitedByPrincipalId: invitation.invitedByPrincipalId,
          createdAt: invitation.createdAt.toISOString(),
          updatedAt: invitation.updatedAt.toISOString(),
        })),
        ...(projection.membersNextCursor
          ? {
              membersNextCursor: encodeTeamCursor(projection.membersNextCursor),
            }
          : {}),
        ...(projection.invitationsNextCursor
          ? {
              invitationsNextCursor: encodeTeamCursor(
                projection.invitationsNextCursor,
              ),
            }
          : {}),
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(createWorkspaceInvitationRoute)
  @RequireWorkspacePermission("membership.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(CreateWorkspaceInvitationBodySchema))
    body: CreateWorkspaceInvitationBody,
  ): Promise<WorkspaceInvitationCreated> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const token = issueInvitationToken();
    try {
      const created = await this.database.team.createWorkspaceInvitation({
        authority: scope,
        workspaceId: scope.workspaceId,
        invitationId: ulid(),
        targetEmail: body.targetEmail,
        workspaceRole: body.workspaceRole,
        tokenHash: digestInvitationToken(token),
        tokenPrefix: invitationTokenPrefix(token),
        expiresAt: expiresAt(now, body.expiresInHours),
        now,
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: authenticationReferenceHash(
            scope.authenticationRefId,
          ),
          requestId: request.id,
        },
      });
      return {
        invitationId: created.invitationId,
        invitationToken: token,
        invitePath: `/invite/${token}`,
        targetEmailMasked: created.targetEmailMasked,
        workspaceRole: created.workspaceRole,
        expiresAt: created.expiresAt.toISOString(),
        version: created.version,
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(resendWorkspaceInvitationRoute)
  @RequireWorkspacePermission("membership.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async resend(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(InvitationPathSchema))
    params: { readonly invitationId: string },
    @Body(new ContractBodyPipe(ResendWorkspaceInvitationBodySchema))
    body: ResendWorkspaceInvitationBody,
  ): Promise<WorkspaceInvitationCreated> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const token = issueInvitationToken();
    try {
      const created = await this.database.team.resendWorkspaceInvitation({
        authority: scope,
        invitationId: params.invitationId,
        expectedVersion: body.expectedVersion,
        replacementInvitationId: ulid(),
        tokenHash: digestInvitationToken(token),
        tokenPrefix: invitationTokenPrefix(token),
        expiresAt: expiresAt(now, body.expiresInHours),
        now,
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: authenticationReferenceHash(
            scope.authenticationRefId,
          ),
          requestId: request.id,
        },
      });
      return {
        invitationId: created.invitationId,
        invitationToken: token,
        invitePath: `/invite/${token}`,
        targetEmailMasked: created.targetEmailMasked,
        workspaceRole: created.workspaceRole,
        expiresAt: created.expiresAt.toISOString(),
        version: created.version,
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(revokeWorkspaceInvitationRoute)
  @RequireWorkspacePermission("membership.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async revoke(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(InvitationPathSchema))
    params: { readonly invitationId: string },
    @Body(new ContractBodyPipe(RevokeWorkspaceInvitationBodySchema))
    body: RevokeWorkspaceInvitationBody,
  ): Promise<WorkspaceInvitationRevoked> {
    const { scope } = this.contexts.require(request);
    try {
      const revoked = await this.database.team.revokeWorkspaceInvitation({
        authority: scope,
        workspaceId: scope.workspaceId,
        invitationId: params.invitationId,
        expectedVersion: body.expectedVersion,
        reasonCode: "cancelled",
        now: new Date(),
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: authenticationReferenceHash(
            scope.authenticationRefId,
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
      return mapTeamError(error);
    }
  }

  @ContractRoute(acceptWorkspaceInvitationRoute)
  public async accept(
    @Req() request: FastifyRequest,
    @Headers("x-kanvas-csrf") csrfToken: string | undefined,
    @Body(new ContractBodyPipe(AcceptWorkspaceInvitationBodySchema))
    body: AcceptWorkspaceInvitationBody,
  ): Promise<WorkspaceInvitationAccepted> {
    const authenticated = await this.authentication.resolveBrowserSession(
      fromNodeHeaders(request.raw.headers),
    );
    if (!authenticated) {
      throw new UnauthorizedException("A valid browser session is required.");
    }
    this.assertBrowserMutation(request, authenticated.sessionId, csrfToken);
    const accountEmail =
      authenticated.accountEmail ??
      (authenticated.verifiedContact
        ? {
            email: authenticated.verifiedContact.email,
            emailVerified: true,
          }
        : undefined);
    if (!accountEmail) {
      throw new ForbiddenException(
        "An account email is required to accept an invitation.",
      );
    }
    if (
      !accountEmail.emailVerified &&
      (await this.database.instanceAccess.readRegistrationPolicy())
        .emailVerificationRequired
    ) {
      throw new ForbiddenException(
        "Email verification is required to accept an invitation.",
      );
    }
    const now = new Date();
    const principal = await this.database.authorization.resolveHumanPrincipal({
      principalId: ulid(),
      authSubjectId: authenticated.authSubjectId,
      now,
      audit: {
        auditEventId: ulid(),
        authenticationRefHash: authenticationReferenceHash(
          authenticated.sessionId,
        ),
        requestId: request.id,
      },
    });
    try {
      const accepted = await this.database.team.acceptWorkspaceInvitation({
        tokenHash: digestInvitationToken(body.invitationToken),
        principalId: principal.principalId,
        email: accountEmail.email,
        emailVerified: accountEmail.emailVerified,
        organizationMembershipId: ulid(),
        workspaceMembershipId: ulid(),
        now,
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: authenticationReferenceHash(
            authenticated.sessionId,
          ),
          requestId: request.id,
        },
      });
      return {
        invitationId: accepted.invitationId,
        organizationId: accepted.organizationId,
        workspaceId: accepted.workspaceId,
        membershipId: accepted.membershipId,
        membershipRole: accepted.membershipRole,
        membershipVersion: accepted.membershipVersion,
        acceptedAt: accepted.acceptedAt.toISOString(),
        replayed: accepted.replayed,
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(changeWorkspaceMembershipRoute)
  @RequireWorkspacePermission("membership.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async changeMembership(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(TargetPrincipalPathSchema))
    params: { readonly targetPrincipalId: string },
    @Body(new ContractBodyPipe(ChangeWorkspaceMembershipBodySchema))
    body: ChangeWorkspaceMembershipBody,
  ): Promise<ChangedWorkspaceMembership> {
    const { scope } = this.contexts.require(request);
    try {
      const changed =
        await this.database.authorization.changeWorkspaceMembership({
          authority: scope,
          targetPrincipalId: params.targetPrincipalId,
          workspaceId: scope.workspaceId,
          expectedTargetVersion: body.expectedVersion,
          nextRole: body.role,
          nextStatus: body.status,
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              scope.authenticationRefId,
            ),
            requestId: request.id,
          },
        });
      if (
        typeof changed.role !== "string" ||
        !workspaceRoles.has(changed.role)
      ) {
        throw new BadRequestException("Membership role projection is invalid.");
      }
      return {
        membershipId: changed.membershipId,
        role: changed.role as
          "owner" | "admin" | "editor" | "operator" | "reviewer" | "viewer",
        status: changed.status,
        version: changed.version,
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(addWorkspaceMemberRoute)
  @RequireWorkspacePermission("membership.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async addMember(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(AddWorkspaceMemberBodySchema))
    body: AddWorkspaceMemberBody,
  ): Promise<ChangedWorkspaceMembership> {
    const { scope } = this.contexts.require(request);
    try {
      const added =
        await this.database.authorization.addExistingWorkspaceMember({
          authority: scope,
          workspaceId: scope.workspaceId,
          email: body.email,
          role: body.role,
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              scope.authenticationRefId,
            ),
            requestId: request.id,
          },
        });
      if (typeof added.role !== "string" || !workspaceRoles.has(added.role)) {
        throw new BadRequestException("Membership role projection is invalid.");
      }
      return {
        membershipId: added.membershipId,
        role: added.role as ChangedWorkspaceMembership["role"],
        status: added.status,
        version: added.version,
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @ContractRoute(changeWorkspaceMembershipsRoute)
  @RequireWorkspacePermission("membership.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async changeMemberships(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(ChangeWorkspaceMembershipsBodySchema))
    body: ChangeWorkspaceMembershipsBody,
  ): Promise<ChangedWorkspaceMemberships> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    try {
      const changed =
        await this.database.authorization.changeWorkspaceMemberships(
          body.changes.map((change) => ({
            authority: scope,
            targetPrincipalId: change.targetPrincipalId,
            workspaceId: scope.workspaceId,
            expectedTargetVersion: change.expectedVersion,
            nextRole: change.role,
            nextStatus: change.status,
            now,
            audit: {
              auditEventId: ulid(),
              authenticationRefHash: authenticationReferenceHash(
                scope.authenticationRefId,
              ),
              requestId: request.id,
            },
          })),
        );
      return {
        members: changed.map((member) => {
          if (
            typeof member.role !== "string" ||
            !workspaceRoles.has(member.role)
          ) {
            throw new BadRequestException(
              "Membership role projection is invalid.",
            );
          }
          return {
            membershipId: member.membershipId,
            role: member.role as
              "owner" | "admin" | "editor" | "operator" | "reviewer" | "viewer",
            status: member.status,
            version: member.version,
          };
        }),
      };
    } catch (error) {
      return mapTeamError(error);
    }
  }

  private assertBrowserMutation(
    request: FastifyRequest,
    sessionId: string,
    csrfToken: string | undefined,
  ): void {
    const origin = singleHeader(request.headers.origin);
    if (
      !origin ||
      !this.config.auth.trustedOrigins.includes(origin) ||
      singleHeader(request.headers["sec-fetch-site"]) === "cross-site" ||
      !csrfToken ||
      !this.csrf.verify(sessionId, csrfToken)
    ) {
      throw new ForbiddenException(
        "A trusted same-origin request with valid CSRF is required.",
      );
    }
  }
}
