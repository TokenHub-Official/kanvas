import { createHash } from "node:crypto";

import {
  authorizationModelVersion,
  type WorkspacePermissionId,
} from "@kanvas/application";
import {
  getCurrentHumanContextRoute,
  type CurrentHumanContext,
} from "@kanvas/contracts/api";
import type { DatabaseRuntime } from "@kanvas/database";
import {
  Controller,
  Header,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import { AUTHENTICATION_GATEWAY, DATABASE_RUNTIME } from "../tokens.js";
import { CsrfTokenService } from "../security/csrf-token-service.js";
import { ContractRoute } from "./contract-route.decorator.js";

type CurrentHumanContextDatabase = Pick<
  DatabaseRuntime,
  "authorization" | "instanceAccess" | "defaultAccess"
>;

function authenticationReferenceHash(sessionId: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:current-human-context-auth-ref:v1\0")
    .update(sessionId)
    .digest("hex")}`;
}

function contextVersion(
  principal: {
    readonly principalId: string;
    readonly status: string;
    readonly version: number;
  },
  workspaces: readonly {
    readonly organizationId: string;
    readonly organizationVersion: number;
    readonly workspaceId: string;
    readonly workspaceVersion: number;
    readonly membershipId: string;
    readonly membershipRole: string;
    readonly membershipVersion: number;
    readonly permissions: readonly WorkspacePermissionId[];
  }[],
  instanceAdministrator:
    | {
        readonly authorityId: string;
        readonly authorityVersion: number;
      }
    | undefined,
): `sha256:${string}` {
  const digest = createHash("sha256")
    .update("kanvas:current-human-context:v1\0")
    .update(
      JSON.stringify({
        principal,
        instanceAdministrator,
        authorizationModelVersion,
        workspaces: workspaces.map((workspace) => ({
          organizationId: workspace.organizationId,
          organizationVersion: workspace.organizationVersion,
          workspaceId: workspace.workspaceId,
          workspaceVersion: workspace.workspaceVersion,
          membershipId: workspace.membershipId,
          membershipRole: workspace.membershipRole,
          membershipVersion: workspace.membershipVersion,
          permissions: workspace.permissions,
        })),
      }),
    )
    .digest("hex");
  return `sha256:${digest}`;
}

@Controller()
export class CurrentHumanContextController {
  public constructor(
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
    @Inject(DATABASE_RUNTIME)
    private readonly database: CurrentHumanContextDatabase,
    private readonly csrf: CsrfTokenService,
  ) {}

  @ContractRoute(getCurrentHumanContextRoute)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<CurrentHumanContext> {
    const authenticated = await this.authentication.resolveBrowserSession(
      fromNodeHeaders(request.raw.headers),
    );
    if (!authenticated) {
      throw new UnauthorizedException("A valid browser session is required.");
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
        ...(request.id
          ? {
              requestId: request.id,
            }
          : {}),
      },
    });
    const workspaces =
      principal.status === "active"
        ? await this.database.authorization.listHumanWorkspaceContexts({
            principalId: principal.principalId,
          })
        : [];
    const administrator =
      principal.status === "active"
        ? await this.database.instanceAccess.resolveAdministrator({
            authSubjectId: authenticated.authSubjectId,
            sessionId: authenticated.sessionId,
          })
        : ({ status: "forbidden" } as const);

    return {
      authenticated: true,
      defaultAccess: await this.database.defaultAccess.readStatus(
        authenticated.authSubjectId,
      ),
      csrfToken: this.csrf.issue(authenticated.sessionId),
      human: {
        principalId: principal.principalId,
        status: principal.status,
        displayName: authenticated.displayName?.trim() || "Kanvas User",
        ...(authenticated.verifiedContact
          ? {
              verifiedEmail: authenticated.verifiedContact.email,
            }
          : {}),
      },
      ...(administrator.status === "authorized"
        ? {
            instanceAdministrator: {
              version: administrator.scope.authorityVersion,
            },
          }
        : {}),
      workspaces: workspaces.map((workspace) => ({
        id: workspace.workspaceId,
        slug: workspace.workspaceSlug,
        name: workspace.workspaceName,
        organization: {
          id: workspace.organizationId,
          name: workspace.organizationName,
        },
        membership: {
          id: workspace.membershipId,
          role: workspace.membershipRole,
          version: workspace.membershipVersion,
        },
        permissions: [...workspace.permissions],
      })),
      authorizationModelVersion,
      contextVersion: contextVersion(
        principal,
        workspaces,
        administrator.status === "authorized"
          ? {
              authorityId: administrator.scope.authorityId,
              authorityVersion: administrator.scope.authorityVersion,
            }
          : undefined,
      ),
    };
  }
}
