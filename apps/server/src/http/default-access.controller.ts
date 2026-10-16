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
  UnauthorizedException,
} from "@nestjs/common";
import {
  getDefaultAccessPolicyRoute,
  updateDefaultAccessPolicyRoute,
  previewDefaultAccessRoute,
  applyDefaultAccessRoute,
  retryDefaultAccessRoute,
  UpdateDefaultAccessPolicyBodySchema,
  ApplyDefaultAccessBodySchema,
  type UpdateDefaultAccessPolicyBody,
  type ApplyDefaultAccessBody,
} from "@kanvas/contracts/api";
import { InstanceAccessStoreError } from "@kanvas/database";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";
import type { ServerDatabaseRuntime } from "../app.module.js";
import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import type { ServerConfig } from "../config.js";
import {
  DATABASE_RUNTIME,
  AUTHENTICATION_GATEWAY,
  SERVER_CONFIG,
} from "../tokens.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";
import { CsrfTokenService } from "../security/csrf-token-service.js";

async function mapped<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof InstanceAccessStoreError)) throw error;
    if (error.code === "instance_access.forbidden")
      throw new ForbiddenException(error.message);
    if (error.code === "instance_access.concurrent_change")
      throw new ConflictException(error.message);
    throw new BadRequestException(error.message);
  }
}
@Controller()
@UseGuards(InstanceAdministratorGuard)
export class DefaultAccessController {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}
  private audit(request: FastifyRequest) {
    return {
      auditEventId: ulid(),
      authenticationRefHash: `sha256:${createHash("sha256").update(this.contexts.require(request).authentication.sessionId).digest("hex")}`,
      requestId: request.id,
    };
  }
  @ContractRoute(getDefaultAccessPolicyRoute)
  @Header("Cache-Control", "no-store")
  get() {
    return this.database.defaultAccess.readPolicy();
  }
  @ContractRoute(updateDefaultAccessPolicyRoute)
  update(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(UpdateDefaultAccessPolicyBodySchema))
    body: UpdateDefaultAccessPolicyBody,
  ) {
    const ids = new Set(
      (this.config.auth.oauthProviders ?? [])
        .filter((p) => p.type === "oidc")
        .map((p) => p.id),
    );
    if (body.enabled && body.oidcProviderIds.some((id) => !ids.has(id)))
      throw new BadRequestException(
        "Choose a configured enterprise OIDC provider.",
      );
    const { expectedVersion, ...policy } = body;
    return mapped(() =>
      this.database.defaultAccess.updatePolicy(
        this.contexts.require(request).scope,
        { ...policy, version: expectedVersion },
        this.audit(request),
      ),
    );
  }
  @ContractRoute(previewDefaultAccessRoute)
  @Header("Cache-Control", "no-store")
  preview(@Req() request: FastifyRequest) {
    return mapped(() =>
      this.database.defaultAccess.preview(this.contexts.require(request).scope),
    );
  }
  @ContractRoute(applyDefaultAccessRoute)
  apply(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(ApplyDefaultAccessBodySchema))
    body: ApplyDefaultAccessBody,
  ) {
    return mapped(() =>
      this.database.defaultAccess.apply(
        this.contexts.require(request).scope,
        body.expectedVersion,
        body.principalIds,
        this.audit(request),
      ),
    );
  }
}
@Controller()
export class DefaultAccessRecoveryController {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    private readonly csrf: CsrfTokenService,
  ) {}
  @ContractRoute(retryDefaultAccessRoute)
  async retry(@Req() request: FastifyRequest) {
    const user = await this.authentication.resolveBrowserSession(
      fromNodeHeaders(request.raw.headers),
    );
    if (!user) throw new UnauthorizedException();
    const origin = request.headers.origin;
    const token = request.headers["x-kanvas-csrf"];
    if (
      !origin ||
      !this.config.auth.trustedOrigins.includes(origin) ||
      request.headers["sec-fetch-site"] === "cross-site" ||
      typeof token !== "string" ||
      !this.csrf.verify(user.sessionId, token)
    )
      throw new ForbiddenException();
    return this.database.defaultAccess.process(user.authSubjectId);
  }
}
