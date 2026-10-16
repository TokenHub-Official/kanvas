import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  InstanceSetupRedemptionBodySchema,
  RegisterInstanceSetupAccountBodySchema,
  ResolveInstanceSetupBodySchema,
  redeemInstanceSetupRoute,
  registerInstanceSetupAccountRoute,
  resolveInstanceSetupRoute,
  type InstanceSetupAccountRegistered,
  type InstanceSetupRedemptionBody,
  type InstanceSetupRedemptionResponse,
  type InstanceSetupSummary,
  type RegisterInstanceSetupAccountBody,
  type ResolveInstanceSetupBody,
} from "@kanvas/contracts/api";
import {
  digestInstanceSetupToken,
  type InspectedInstanceSetupToken,
  InstanceBootstrapStoreError,
} from "@kanvas/database/runtime";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import type { ServerConfig } from "../config.js";
import { CsrfTokenService } from "../security/csrf-token-service.js";
import {
  AUTHENTICATION_GATEWAY,
  DATABASE_RUNTIME,
  SERVER_CONFIG,
} from "../tokens.js";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";

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

@Controller()
export class InstanceSetupController {
  public constructor(
    @Inject(SERVER_CONFIG)
    private readonly config: ServerConfig,
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly csrf: CsrfTokenService,
  ) {}

  @ContractRoute(resolveInstanceSetupRoute)
  public async resolve(
    @Body(new ContractBodyPipe(ResolveInstanceSetupBodySchema))
    body: ResolveInstanceSetupBody,
  ): Promise<InstanceSetupSummary> {
    try {
      const inspected = await this.database.instanceBootstrap.inspectSetupToken(
        {
          tokenHash: digestInstanceSetupToken(body.setupToken),
          now: new Date(),
        },
      );
      return {
        accountRegistration:
          inspected.bindingMode === "verified_email_hash"
            ? "available"
            : "login_only",
      };
    } catch (error) {
      this.throwSetupAccessError(error);
    }
  }

  @ContractRoute(registerInstanceSetupAccountRoute)
  public async registerAccount(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(RegisterInstanceSetupAccountBodySchema))
    body: RegisterInstanceSetupAccountBody,
  ): Promise<InstanceSetupAccountRegistered> {
    this.assertTrustedBrowserRequest(request);
    let inspected: InspectedInstanceSetupToken;
    try {
      inspected = await this.database.instanceBootstrap.inspectSetupToken({
        tokenHash: digestInstanceSetupToken(body.setupToken),
        verifiedEmail: body.email,
        now: new Date(),
      });
    } catch (error) {
      this.throwSetupAccessError(error);
    }
    if (inspected.bindingMode !== "verified_email_hash") {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/instance-setup-registration-login-required",
        title: "Existing account required",
        status: 409,
        code: "instance_setup_registration.login_required",
        detail: "This setup key requires an existing authenticated account.",
      });
    }
    if (inspected.verifiedEmailMatches !== true) {
      throw new BadRequestException({
        type: "https://kanvas.invalid/problems/instance-setup-registration-email-mismatch",
        title: "Setup email does not match",
        status: 400,
        code: "instance_setup_registration.email_mismatch",
        detail: "Registration email does not match this setup key.",
      });
    }
    const registerVerifiedEmailAccount =
      this.authentication.registerVerifiedEmailAccount?.bind(
        this.authentication,
      );
    if (!registerVerifiedEmailAccount) {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/instance-setup-registration-unavailable",
        title: "Setup registration is unavailable",
        status: 409,
        code: "instance_setup_registration.unavailable",
        detail: "Setup registration is unavailable.",
      });
    }
    const result = await registerVerifiedEmailAccount({
      email: body.email,
      displayName: body.displayName,
      password: body.password,
    });
    if (result === "exists") {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/instance-setup-registration-account-exists",
        title: "Account already exists",
        status: 409,
        code: "instance_setup_registration.account_exists",
        detail: "An account already exists for this setup identity.",
      });
    }
    return { accountCreated: true };
  }

  @ContractRoute(redeemInstanceSetupRoute)
  public async redeem(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(InstanceSetupRedemptionBodySchema))
    body: InstanceSetupRedemptionBody,
  ): Promise<InstanceSetupRedemptionResponse> {
    const authenticated = await this.authentication.resolveBrowserSession(
      fromNodeHeaders(request.raw.headers),
    );
    if (!authenticated) {
      throw new UnauthorizedException("A valid browser session is required.");
    }
    this.assertBrowserMutation(request, authenticated.sessionId);
    try {
      return await this.database.instanceBootstrap.redeemSetupToken({
        tokenHash: digestInstanceSetupToken(body.setupToken),
        authSubjectId: authenticated.authSubjectId,
        ...(authenticated.verifiedContact
          ? {
              verifiedEmail: authenticated.verifiedContact.email,
            }
          : {}),
        principalId: ulid(),
        organizationId: ulid(),
        organizationMembershipId: ulid(),
        organizationSlug: body.organizationSlug,
        organizationName: body.organizationName,
        workspaceId: ulid(),
        workspaceMembershipId: ulid(),
        workspaceSlug: body.workspaceSlug,
        workspaceName: body.workspaceName,
        now: new Date(),
        authenticationRefHash: authenticationReferenceHash(
          authenticated.sessionId,
        ),
        requestId: request.id,
        auditEventId: ulid(),
      });
    } catch (error) {
      if (!(error instanceof InstanceBootstrapStoreError)) {
        throw error;
      }
      if (
        error.code === "instance_bootstrap.identity_conflict" ||
        error.code === "instance_bootstrap.concurrent_change"
      ) {
        throw new ConflictException({
          type: "https://kanvas.invalid/problems/instance-setup-changed",
          title: "Instance setup authority changed",
          status: 409,
          code: "instance_setup.changed",
          detail: "Instance setup authority changed during redemption.",
        });
      }
      if (error.code === "instance_bootstrap.binding_mismatch") {
        throw new ForbiddenException({
          type: "https://kanvas.invalid/problems/instance-setup-identity-mismatch",
          title: "Setup identity does not match",
          status: 403,
          code: "instance_setup.identity_mismatch",
          detail: "The setup key is bound to another authenticated identity.",
        });
      }
      this.throwSetupAccessError(error);
    }
  }

  private throwSetupAccessError(error: unknown): never {
    if (!(error instanceof InstanceBootstrapStoreError)) {
      throw error;
    }
    if (error.code === "instance_bootstrap.already_initialized") {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/instance-setup-already-initialized",
        title: "Instance is already initialized",
        status: 409,
        code: "instance_setup.already_initialized",
        detail: "The instance has already been initialized.",
      });
    }
    if (
      error.code === "instance_bootstrap.token_invalid" ||
      error.code === "instance_bootstrap.token_expired"
    ) {
      throw new ForbiddenException({
        type: "https://kanvas.invalid/problems/instance-setup-token-rejected",
        title: "Setup key cannot be redeemed",
        status: 403,
        code: "instance_setup.token_rejected",
        detail: "The setup key is invalid or has expired.",
      });
    }
    throw error;
  }

  private assertTrustedBrowserRequest(request: FastifyRequest): void {
    const origin = singleHeader(request.headers.origin);
    if (!origin || !this.config.auth.trustedOrigins.includes(origin)) {
      throw new ForbiddenException("Mutation request Origin is not trusted.");
    }
    if (singleHeader(request.headers["sec-fetch-site"]) === "cross-site") {
      throw new ForbiddenException(
        "Cross-site browser mutation is not allowed.",
      );
    }
  }

  private assertBrowserMutation(
    request: FastifyRequest,
    sessionId: string,
  ): void {
    this.assertTrustedBrowserRequest(request);
    const csrfToken = singleHeader(request.headers["x-kanvas-csrf"]);
    if (!csrfToken || !this.csrf.verify(sessionId, csrfToken)) {
      throw new ForbiddenException(
        "A valid session-bound CSRF token is required.",
      );
    }
  }
}
