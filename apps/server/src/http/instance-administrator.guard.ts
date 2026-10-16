import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";

import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import type { ServerConfig } from "../config.js";
import { CsrfTokenService } from "../security/csrf-token-service.js";
import {
  AUTHENTICATION_GATEWAY,
  DATABASE_RUNTIME,
  SERVER_CONFIG,
} from "../tokens.js";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function singleHeader(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

@Injectable()
export class InstanceAdministratorGuard implements CanActivate {
  public constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly csrf: CsrfTokenService,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authenticated = await this.authentication.resolveBrowserSession(
      fromNodeHeaders(request.raw.headers),
    );
    if (!authenticated) {
      throw new UnauthorizedException("A valid browser session is required.");
    }
    this.assertBrowserMutation(request, authenticated.sessionId);
    const resolution = await this.database.instanceAccess.resolveAdministrator({
      authSubjectId: authenticated.authSubjectId,
      sessionId: authenticated.sessionId,
    });
    if (resolution.status !== "authorized") {
      throw new ForbiddenException(
        "Current account is not an active Instance Administrator.",
      );
    }
    this.contexts.set(request, {
      authentication: authenticated,
      scope: resolution.scope,
    });
    return true;
  }

  private assertBrowserMutation(
    request: FastifyRequest,
    sessionId: string,
  ): void {
    if (!mutationMethods.has(request.method.toUpperCase())) return;
    const origin = singleHeader(request.headers.origin);
    if (!origin || !this.config.auth.trustedOrigins.includes(origin)) {
      throw new ForbiddenException("Mutation request Origin is not trusted.");
    }
    if (singleHeader(request.headers["sec-fetch-site"]) === "cross-site") {
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
