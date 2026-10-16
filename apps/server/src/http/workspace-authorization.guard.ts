import { createHash } from "node:crypto";

import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  permissionsForWorkspaceRole,
  type TrustedWorkspaceScope,
  type WorkspacePermissionId,
} from "@kanvas/application";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import type { ServerConfig } from "../config.js";
import {
  AUTHENTICATION_GATEWAY,
  DATABASE_RUNTIME,
  SERVER_CONFIG,
} from "../tokens.js";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { CsrfTokenService } from "../security/csrf-token-service.js";
import {
  digestServiceApiToken,
  readBearerToken,
  ServiceApiTokenFormatError,
} from "../security/service-api-token.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { WORKSPACE_PERMISSION_METADATA } from "./workspace-permission.decorator.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function singleHeader(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function authenticationReferenceHash(sessionId: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:authentication-ref:v1\0")
    .update(sessionId)
    .digest("hex")}`;
}

@Injectable()
export class WorkspaceAuthorizationGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly csrf: CsrfTokenService,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<
      WorkspacePermissionId | undefined
    >(WORKSPACE_PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) {
      throw new InternalServerErrorException(
        "Protected route has no workspace permission declaration.",
      );
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (this.config.environment !== "production" && this.config.demo.enabled) {
      const scope: TrustedWorkspaceScope = Object.freeze({
        workspaceId: this.config.demo.workspaceId,
        organizationId: this.config.demo.workspaceId,
        principalId: this.config.demo.actorId,
        principalType: "human",
        authenticationRefType: "session",
        authenticationRefId: "development-demo",
        authorityType: "human_membership",
        authorityId: this.config.demo.actorId,
        authorityVersion: 1,
        authorizationModelVersion: 1,
        effectivePermissions: permissionsForWorkspaceRole("owner"),
        trusted: true,
      });
      this.contexts.set(request, {
        authentication: {
          authSubjectId: "development-demo",
          sessionId: "development-demo",
          authenticationStrength: "development_demo",
        },
        scope,
      });
      return true;
    }

    const authorization = singleHeader(request.headers.authorization);
    let bearerToken: string | undefined;
    try {
      bearerToken = readBearerToken(authorization);
    } catch (error) {
      if (error instanceof ServiceApiTokenFormatError) {
        throw new UnauthorizedException("Service API token format is invalid.");
      }
      throw error;
    }
    if (bearerToken) {
      await this.resolveServiceRequest(request, permission, bearerToken);
      return true;
    }

    const authenticated = await this.authentication.resolveBrowserSession(
      fromNodeHeaders(request.raw.headers),
    );
    if (!authenticated) {
      throw new UnauthorizedException("A valid browser session is required.");
    }
    this.assertBrowserMutation(request, authenticated.sessionId);

    const requestedWorkspaceId = singleHeader(
      request.headers["x-kanvas-workspace-id"],
    );
    if (!requestedWorkspaceId || !idPattern.test(requestedWorkspaceId)) {
      throw new BadRequestException(
        "x-kanvas-workspace-id must be a canonical uppercase ULID.",
      );
    }

    const now = new Date();
    await this.database.authorization.resolveHumanPrincipal({
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
    const resolution =
      await this.database.authorization.resolveHumanWorkspaceScope({
        authSubjectId: authenticated.authSubjectId,
        sessionId: authenticated.sessionId,
        requestedWorkspaceId,
        requiredPermission: permission,
        now,
      });
    if (resolution.status !== "authorized") {
      if (resolution.status === "not_found") {
        throw new NotFoundException("Workspace resource was not found.");
      }
      throw new ForbiddenException(
        "Current workspace authority does not allow this action.",
      );
    }
    this.contexts.set(request, {
      authentication: authenticated,
      scope: resolution.scope,
    });
    return true;
  }

  private async resolveServiceRequest(
    request: FastifyRequest,
    permission: WorkspacePermissionId,
    bearerToken: string,
  ): Promise<void> {
    if (request.headers.cookie) {
      throw new BadRequestException(
        "Cookie and Service Bearer authentication cannot be combined.",
      );
    }
    const requestedWorkspaceId = singleHeader(
      request.headers["x-kanvas-workspace-id"],
    );
    if (!requestedWorkspaceId || !idPattern.test(requestedWorkspaceId)) {
      throw new BadRequestException(
        "x-kanvas-workspace-id must be a canonical uppercase ULID.",
      );
    }
    let tokenHash: string;
    try {
      tokenHash = digestServiceApiToken(bearerToken);
    } catch (error) {
      if (error instanceof ServiceApiTokenFormatError) {
        throw new UnauthorizedException("Service API token format is invalid.");
      }
      throw error;
    }
    const resolution =
      await this.database.authorization.resolveServiceWorkspaceScope({
        tokenHash,
        requestedWorkspaceId,
        requiredPermission: permission,
        now: new Date(),
      });
    if (resolution.status !== "authorized") {
      if (resolution.reason === "authentication_not_found") {
        throw new UnauthorizedException("Service API token is invalid.");
      }
      if (resolution.status === "not_found") {
        throw new NotFoundException("Workspace resource was not found.");
      }
      throw new ForbiddenException(
        "Current service authority does not allow this action.",
      );
    }
    this.contexts.set(request, {
      authentication: {
        tokenHash,
        authenticationStrength: "service_token",
      },
      scope: resolution.scope,
    });
  }

  private assertBrowserMutation(
    request: FastifyRequest,
    sessionId: string,
  ): void {
    if (!mutationMethods.has(request.method.toUpperCase())) {
      return;
    }
    const origin = singleHeader(request.headers.origin);
    if (!origin || !this.config.auth.trustedOrigins.includes(origin)) {
      throw new ForbiddenException("Mutation request Origin is not trusted.");
    }
    const fetchSite = singleHeader(request.headers["sec-fetch-site"]);
    if (fetchSite === "cross-site") {
      throw new ForbiddenException(
        "Cross-site browser mutation is not allowed.",
      );
    }
    const csrfToken = singleHeader(request.headers["x-kanvas-csrf"]);
    if (!csrfToken || !this.csrf.verify(sessionId, csrfToken)) {
      throw new ForbiddenException(
        "A valid session-bound CSRF token is required.",
      );
    }
  }
}
