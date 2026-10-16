import { createHash } from "node:crypto";

import type { InstanceRegistrationPolicy as DomainInstanceRegistrationPolicy } from "@kanvas/application";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  InternalServerErrorException,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type InstanceRegistrationSettings,
  type UpdateInstanceRegistrationPolicyBody,
  UpdateInstanceRegistrationPolicyBodySchema,
  getInstanceRegistrationSettingsRoute,
  updateInstanceRegistrationPolicyRoute,
} from "@kanvas/contracts/api";
import { InstanceAccessStoreError } from "@kanvas/database";
import type { FastifyRequest } from "fastify";
import { ulid } from "ulid";

import type { ServerConfig } from "../config.js";
import { DATABASE_RUNTIME, SERVER_CONFIG } from "../tokens.js";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";

function authenticationReferenceHash(sessionId: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:instance-registration-auth-ref:v1\0")
    .update(sessionId)
    .digest("hex")}`;
}

function mapInstanceAccessError(error: unknown): never {
  if (!(error instanceof InstanceAccessStoreError)) throw error;
  if (error.code === "instance_access.invalid_argument") {
    throw new BadRequestException({
      type: "https://kanvas.invalid/problems/instance-registration-policy-invalid",
      title: "Registration policy is invalid",
      status: 400,
      code: "instance_registration_policy.invalid",
      detail: error.message,
    });
  }
  if (error.code === "instance_access.concurrent_change") {
    throw new ConflictException({
      type: "https://kanvas.invalid/problems/instance-registration-policy-changed",
      title: "Registration policy changed",
      status: 409,
      code: "instance_registration_policy.changed",
      detail: "Reload the current policy before saving again.",
    });
  }
  if (error.code === "instance_access.forbidden") {
    throw new ForbiddenException({
      type: "https://kanvas.invalid/problems/instance-registration-forbidden",
      title: "Instance administration is unavailable",
      status: 403,
      code: "instance_registration_policy.forbidden",
    });
  }
  throw new InternalServerErrorException(
    "Instance Registration Policy facts are invalid.",
  );
}

@Controller()
@UseGuards(InstanceAdministratorGuard)
export class InstanceRegistrationController {
  public constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}

  @ContractRoute(getInstanceRegistrationSettingsRoute)
  @Header("Cache-Control", "no-store")
  public async get(): Promise<InstanceRegistrationSettings> {
    return this.settingsFrom(
      await this.database.instanceAccess.readRegistrationPolicy(),
    );
  }

  @ContractRoute(updateInstanceRegistrationPolicyRoute)
  public async update(
    @Req() request: FastifyRequest,
    @Body(new ContractBodyPipe(UpdateInstanceRegistrationPolicyBodySchema))
    body: UpdateInstanceRegistrationPolicyBody,
  ): Promise<InstanceRegistrationSettings> {
    const configuredProviderIds = new Set(
      this.oidcProviders().map(({ id }) => id),
    );
    if (
      body.emailPasswordEnabled &&
      !this.config.auth.emailAndPasswordEnabled
    ) {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/email-registration-unavailable",
        title: "Email registration is unavailable",
        status: 409,
        code: "instance_registration_policy.email_password_unavailable",
        detail: "Enable email and password authentication before registration.",
      });
    }
    if (
      body.emailPasswordEnabled &&
      body.emailVerificationRequired &&
      !this.config.auth.emailVerificationDelivery
    ) {
      throw new ConflictException({
        type: "https://kanvas.invalid/problems/email-registration-unavailable",
        title: "Email registration is unavailable",
        status: 409,
        code: "instance_registration_policy.email_verification_unavailable",
        detail:
          "Configure verified email delivery before enabling direct email registration.",
      });
    }
    if (
      body.oidcProviderIds.some(
        (providerId) => !configuredProviderIds.has(providerId),
      )
    ) {
      throw new BadRequestException({
        type: "https://kanvas.invalid/problems/oidc-registration-provider-invalid",
        title: "OIDC registration provider is unavailable",
        status: 400,
        code: "instance_registration_policy.provider_unavailable",
      });
    }
    const { authentication, scope } = this.contexts.require(request);
    try {
      const policy =
        await this.database.instanceAccess.updateRegistrationPolicy({
          authority: scope,
          expectedVersion: body.expectedVersion,
          mode: body.mode,
          emailPasswordEnabled: body.emailPasswordEnabled,
          emailVerificationRequired: body.emailVerificationRequired,
          oidcProviderIds: body.oidcProviderIds,
          now: new Date(),
          audit: {
            auditEventId: ulid(),
            authenticationRefHash: authenticationReferenceHash(
              authentication.sessionId,
            ),
            requestId: request.id,
          },
        });
      return this.settingsFrom(policy);
    } catch (error) {
      return mapInstanceAccessError(error);
    }
  }

  private oidcProviders(): readonly {
    readonly id: string;
    readonly name: string;
  }[] {
    return (this.config.auth.oauthProviders ?? [])
      .filter((provider) => provider.type === "oidc")
      .map(({ id, name }) => ({ id, name }));
  }

  private settingsFrom(
    policy: DomainInstanceRegistrationPolicy,
  ): InstanceRegistrationSettings {
    return {
      policy: {
        ...policy,
        oidcProviderIds: [...policy.oidcProviderIds],
      },
      capabilities: {
        emailPasswordRegistrationAvailable: Boolean(
          this.config.auth.emailAndPasswordEnabled,
        ),
        emailVerificationDelivery:
          this.config.auth.emailVerificationDelivery?.kind ?? "unavailable",
        oidcProviders: [...this.oidcProviders()],
      },
    };
  }
}
