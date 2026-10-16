import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { ServerConfig } from "../src/config.js";
import { InstanceAdministratorContextStore } from "../src/http/instance-administrator-context.js";
import { InstanceRegistrationController } from "../src/http/instance-registration.controller.js";

const principalId = "01K00000000000000000000001";
const sessionId = "01K00000000000000000000002";
const scope: TrustedInstanceAdministratorScope = {
  instanceId: "kanvas-test",
  principalId,
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: sessionId,
  authorityType: "instance_administrator",
  authorityId: principalId,
  authorityVersion: 2,
  authorizationModelVersion: 1,
  trusted: true,
};
const config = {
  auth: {
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
    oauthProviders: [
      {
        id: "matrix",
        name: "Internal SSO",
        type: "oidc",
        clientId: "client",
        clientSecret: "secret",
        discoveryUrl:
          "https://identity.example.com/.well-known/openid-configuration",
        issuer: "https://identity.example.com",
        tokenEndpointAuthMethod: "client_secret_basic",
      },
      {
        id: "github",
        name: "GitHub",
        type: "github",
        clientId: "client",
        clientSecret: "secret",
      },
    ],
  },
} as unknown as ServerConfig;
const configWithEmailDelivery = {
  ...config,
  auth: {
    ...config.auth,
    emailAndPasswordEnabled: true,
    emailVerificationDelivery: {
      kind: "development_outbox",
      file: "/tmp/kanvas-email-outbox.jsonl",
      fromAddress: "kanvas@localhost.invalid",
      fromName: "Kanvas",
    },
  },
} as ServerConfig;
const configWithoutEmailDelivery = {
  ...config,
  auth: {
    ...config.auth,
    emailAndPasswordEnabled: true,
  },
} as ServerConfig;

function authorizedContexts(
  request: FastifyRequest,
): InstanceAdministratorContextStore {
  const contexts = new InstanceAdministratorContextStore();
  contexts.set(request, {
    authentication: {
      authSubjectId: "auth-subject",
      sessionId,
      authenticationStrength: "single_factor",
    },
    scope,
  });
  return contexts;
}

describe("InstanceRegistrationController", () => {
  it("returns the persisted policy and only deployable OIDC capabilities", async () => {
    const request = { id: "request-1" } as FastifyRequest;
    const controller = new InstanceRegistrationController(
      config,
      {
        instanceAccess: {
          readRegistrationPolicy: () =>
            Promise.resolve({
              mode: "closed",
              emailPasswordEnabled: false,
              emailVerificationRequired: true,
              oidcProviderIds: [],
              version: 0,
            }),
        },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    await expect(controller.get()).resolves.toEqual({
      policy: {
        mode: "closed",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: [],
        version: 0,
      },
      capabilities: {
        emailPasswordRegistrationAvailable: false,
        emailVerificationDelivery: "unavailable",
        oidcProviders: [{ id: "matrix", name: "Internal SSO" }],
      },
    });
  });

  it("updates only configured OIDC providers with trusted Instance authority", async () => {
    const request = { id: "request-update" } as FastifyRequest;
    const updateRegistrationPolicy = vi.fn<
      ServerDatabaseRuntime["instanceAccess"]["updateRegistrationPolicy"]
    >((input) =>
      Promise.resolve({
        mode: input.mode,
        emailPasswordEnabled: input.emailPasswordEnabled,
        emailVerificationRequired: input.emailVerificationRequired,
        oidcProviderIds: input.oidcProviderIds,
        version: 1,
      }),
    );
    const controller = new InstanceRegistrationController(
      config,
      {
        instanceAccess: { updateRegistrationPolicy },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    await expect(
      controller.update(request, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: true,
        emailVerificationRequired: true,
        oidcProviderIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateRegistrationPolicy).not.toHaveBeenCalled();
    await expect(
      controller.update(request, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: ["matrix"],
      }),
    ).resolves.toMatchObject({
      policy: {
        mode: "account_only",
        oidcProviderIds: ["matrix"],
        version: 1,
      },
    });
    const policyInput = updateRegistrationPolicy.mock.calls[0]?.[0];
    expect(policyInput).toMatchObject({
      authority: scope,
      expectedVersion: 0,
      mode: "account_only",
      oidcProviderIds: ["matrix"],
    });
    expect(policyInput?.audit.requestId).toBe("request-update");
  });

  it("rejects unavailable registration methods before persistence", async () => {
    const request = { id: "request-invalid" } as FastifyRequest;
    const updateRegistrationPolicy = vi.fn();
    const controller = new InstanceRegistrationController(
      config,
      {
        instanceAccess: { updateRegistrationPolicy },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    await expect(
      controller.update(request, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: false,
        emailVerificationRequired: true,
        oidcProviderIds: ["unknown"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.update(request, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: true,
        emailVerificationRequired: true,
        oidcProviderIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateRegistrationPolicy).not.toHaveBeenCalled();
  });

  it("publishes and persists verified email registration when delivery is configured", async () => {
    const request = { id: "request-email" } as FastifyRequest;
    const updateRegistrationPolicy = vi.fn<
      ServerDatabaseRuntime["instanceAccess"]["updateRegistrationPolicy"]
    >((input) =>
      Promise.resolve({
        mode: input.mode,
        emailPasswordEnabled: input.emailPasswordEnabled,
        emailVerificationRequired: input.emailVerificationRequired,
        oidcProviderIds: input.oidcProviderIds,
        version: 2,
      }),
    );
    const controller = new InstanceRegistrationController(
      configWithEmailDelivery,
      {
        instanceAccess: {
          readRegistrationPolicy: () =>
            Promise.resolve({
              mode: "account_only",
              emailPasswordEnabled: true,
              emailVerificationRequired: true,
              oidcProviderIds: ["matrix"],
              version: 1,
            }),
          updateRegistrationPolicy,
        },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    await expect(controller.get()).resolves.toMatchObject({
      capabilities: {
        emailPasswordRegistrationAvailable: true,
        emailVerificationDelivery: "development_outbox",
      },
    });
    await expect(
      controller.update(request, {
        expectedVersion: 1,
        mode: "account_only",
        emailPasswordEnabled: true,
        emailVerificationRequired: true,
        oidcProviderIds: ["matrix"],
      }),
    ).resolves.toMatchObject({
      policy: {
        emailPasswordEnabled: true,
        version: 2,
      },
    });
    expect(updateRegistrationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        emailPasswordEnabled: true,
        emailVerificationRequired: true,
      }),
    );
  });

  it("allows explicitly unverified email registration without delivery", async () => {
    const request = { id: "request-email-unverified" } as FastifyRequest;
    const updateRegistrationPolicy = vi.fn<
      ServerDatabaseRuntime["instanceAccess"]["updateRegistrationPolicy"]
    >((input) => Promise.resolve({ ...input, version: 1 }));
    const controller = new InstanceRegistrationController(
      configWithoutEmailDelivery,
      {
        instanceAccess: { updateRegistrationPolicy },
      } as unknown as ServerDatabaseRuntime,
      authorizedContexts(request),
    );

    await expect(
      controller.update(request, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: true,
        emailVerificationRequired: true,
        oidcProviderIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(updateRegistrationPolicy).not.toHaveBeenCalled();
    await expect(
      controller.update(request, {
        expectedVersion: 0,
        mode: "account_only",
        emailPasswordEnabled: true,
        emailVerificationRequired: false,
        oidcProviderIds: [],
      }),
    ).resolves.toMatchObject({
      policy: {
        emailPasswordEnabled: true,
        emailVerificationRequired: false,
      },
      capabilities: {
        emailPasswordRegistrationAvailable: true,
        emailVerificationDelivery: "unavailable",
      },
    });
  });
});
