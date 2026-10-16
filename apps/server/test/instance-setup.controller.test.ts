import {
  InstanceBootstrapStoreError,
  type InspectInstanceSetupTokenOptions,
  type InstanceBootstrapStore,
  type RedeemInstanceSetupTokenOptions,
} from "@kanvas/database/runtime";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";
import type { ServerConfig } from "../src/config.js";
import { InstanceSetupController } from "../src/http/instance-setup.controller.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const sessionId = "01K00000000000000000000001";
const rawToken = "knv_setup_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567";
const config = {
  auth: {
    secret: "test-only-auth-secret-that-is-at-least-32-characters",
    trustedOrigins: ["https://kanvas.example"],
  },
} as unknown as ServerConfig;

function request(
  csrfToken: string,
  origin = "https://kanvas.example",
): FastifyRequest {
  const headers = {
    cookie: "kanvas.session_token=opaque",
    origin,
    "sec-fetch-site": "same-origin",
    "x-kanvas-csrf": csrfToken,
  };
  return {
    id: "request-1",
    headers,
    raw: {
      headers,
    },
  } as unknown as FastifyRequest;
}

const authentication = {
  resolveBrowserSession: () =>
    Promise.resolve({
      authSubjectId: "auth-user-1",
      sessionId,
      authenticationStrength: "single_factor" as const,
      verifiedContact: {
        email: "owner@example.com",
      },
    }),
  revokeSession: () => Promise.resolve(false),
  revokeAllHumanSessions: () => Promise.resolve(),
  getVerifiedContact: () => Promise.resolve(null),
} satisfies AuthenticationGateway;

describe("InstanceSetupController", () => {
  it("resolves only the bounded registration capability and keeps the raw token out of persistence", async () => {
    const inspectSetupToken = vi.fn(
      (options: InspectInstanceSetupTokenOptions) => {
        expect(options.now).toBeInstanceOf(Date);
        return Promise.resolve({
          bindingMode: "verified_email_hash" as const,
          verifiedEmailMatches: null,
        });
      },
    );
    const controller = new InstanceSetupController(
      config,
      authentication,
      {
        instanceBootstrap: {
          inspectSetupToken,
          issueSetupToken: vi.fn(),
          redeemSetupToken: vi.fn(),
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
    );

    await expect(controller.resolve({ setupToken: rawToken })).resolves.toEqual(
      {
        accountRegistration: "available",
      },
    );
    const inspected = inspectSetupToken.mock.calls[0]?.[0];
    expect(inspected?.tokenHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(inspected)).not.toContain(rawToken);
  });

  it.each(["auth_subject", "unbound"] as const)(
    "keeps %s setup grants login-only",
    async (bindingMode) => {
      const controller = new InstanceSetupController(
        config,
        authentication,
        {
          instanceBootstrap: {
            inspectSetupToken: () =>
              Promise.resolve({
                bindingMode,
                verifiedEmailMatches: null,
              }),
            issueSetupToken: vi.fn(),
            redeemSetupToken: vi.fn(),
          },
        } as unknown as ServerDatabaseRuntime,
        new CsrfTokenService(config),
      );

      await expect(
        controller.resolve({ setupToken: rawToken }),
      ).resolves.toEqual({ accountRegistration: "login_only" });
    },
  );

  it("registers the verified email bound to a trusted setup request", async () => {
    const registerVerifiedEmailAccount = vi.fn(() =>
      Promise.resolve("created" as const),
    );
    const controller = new InstanceSetupController(
      config,
      {
        ...authentication,
        registerVerifiedEmailAccount,
      },
      {
        instanceBootstrap: {
          inspectSetupToken: () =>
            Promise.resolve({
              bindingMode: "verified_email_hash" as const,
              verifiedEmailMatches: true,
            }),
          issueSetupToken: vi.fn(),
          redeemSetupToken: vi.fn(),
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
    );

    await expect(
      controller.registerAccount(request(""), {
        setupToken: rawToken,
        email: "Owner@Example.com",
        displayName: "Owner",
        password: "long-enough-password",
      }),
    ).resolves.toEqual({ accountCreated: true });
    expect(registerVerifiedEmailAccount).toHaveBeenCalledWith({
      email: "Owner@Example.com",
      displayName: "Owner",
      password: "long-enough-password",
    });
  });

  it("rejects setup registration when the bound email does not match", async () => {
    const registerVerifiedEmailAccount = vi.fn();
    const controller = new InstanceSetupController(
      config,
      {
        ...authentication,
        registerVerifiedEmailAccount,
      },
      {
        instanceBootstrap: {
          inspectSetupToken: () =>
            Promise.resolve({
              bindingMode: "verified_email_hash" as const,
              verifiedEmailMatches: false,
            }),
          issueSetupToken: vi.fn(),
          redeemSetupToken: vi.fn(),
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
    );

    await expect(
      controller.registerAccount(request(""), {
        setupToken: rawToken,
        email: "other@example.com",
        displayName: "Other",
        password: "long-enough-password",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(registerVerifiedEmailAccount).not.toHaveBeenCalled();
  });

  it("rejects setup registration from an untrusted browser origin before inspecting the grant", async () => {
    const inspectSetupToken = vi.fn();
    const controller = new InstanceSetupController(
      config,
      authentication,
      {
        instanceBootstrap: {
          inspectSetupToken,
          issueSetupToken: vi.fn(),
          redeemSetupToken: vi.fn(),
        },
      } as unknown as ServerDatabaseRuntime,
      new CsrfTokenService(config),
    );

    await expect(
      controller.registerAccount(request("", "https://attacker.example"), {
        setupToken: rawToken,
        email: "owner@example.com",
        displayName: "Owner",
        password: "long-enough-password",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(inspectSetupToken).not.toHaveBeenCalled();
  });

  it("requires a session-bound mutation and sends only a token digest into the transaction store", async () => {
    const redeemSetupToken = vi.fn((options: RedeemInstanceSetupTokenOptions) =>
      Promise.resolve({
        principalId: options.principalId,
        organizationId: options.organizationId,
        workspaceId: options.workspaceId,
        bindingMode: "verified_email_hash" as const,
      }),
    );
    const instanceBootstrap = {
      inspectSetupToken: vi.fn(),
      issueSetupToken: vi.fn(),
      redeemSetupToken,
    } satisfies InstanceBootstrapStore;
    const csrf = new CsrfTokenService(config);
    const controller = new InstanceSetupController(
      config,
      authentication,
      {
        instanceBootstrap,
      } as unknown as ServerDatabaseRuntime,
      csrf,
    );

    await expect(
      controller.redeem(request(csrf.issue(sessionId)), {
        setupToken: rawToken,
        organizationSlug: "kanvas",
        organizationName: "Kanvas",
        workspaceSlug: "design",
        workspaceName: "Design",
      }),
    ).resolves.toMatchObject({
      bindingMode: "verified_email_hash",
    });
    expect(redeemSetupToken).toHaveBeenCalledOnce();
    const stored = redeemSetupToken.mock.calls[0]?.[0];
    expect(stored?.tokenHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(rawToken);
    expect(stored).toMatchObject({
      authSubjectId: "auth-user-1",
      verifiedEmail: "owner@example.com",
      organizationSlug: "kanvas",
      workspaceSlug: "design",
      requestId: "request-1",
    });
  });

  it("rejects a mutation before touching the setup store when CSRF is invalid", async () => {
    const redeemSetupToken = vi.fn();
    const csrf = new CsrfTokenService(config);
    const controller = new InstanceSetupController(
      config,
      authentication,
      {
        instanceBootstrap: {
          inspectSetupToken: vi.fn(),
          issueSetupToken: vi.fn(),
          redeemSetupToken,
        },
      } as unknown as ServerDatabaseRuntime,
      csrf,
    );

    await expect(
      controller.redeem(request("a".repeat(43)), {
        setupToken: rawToken,
        organizationSlug: "kanvas",
        organizationName: "Kanvas",
        workspaceSlug: "design",
        workspaceName: "Design",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(redeemSetupToken).not.toHaveBeenCalled();
  });

  it.each([
    [
      "instance_bootstrap.token_invalid",
      ForbiddenException,
      "instance_setup.token_rejected",
    ],
    [
      "instance_bootstrap.token_expired",
      ForbiddenException,
      "instance_setup.token_rejected",
    ],
    [
      "instance_bootstrap.binding_mismatch",
      ForbiddenException,
      "instance_setup.identity_mismatch",
    ],
    [
      "instance_bootstrap.already_initialized",
      ConflictException,
      "instance_setup.already_initialized",
    ],
    [
      "instance_bootstrap.concurrent_change",
      ConflictException,
      "instance_setup.changed",
    ],
    [
      "instance_bootstrap.identity_conflict",
      ConflictException,
      "instance_setup.changed",
    ],
  ] as const)(
    "maps %s to a non-disclosing browser response",
    async (code, expectedError, expectedProblemCode) => {
      const redeemSetupToken = vi.fn(() =>
        Promise.reject(
          new InstanceBootstrapStoreError(code, "sensitive store detail"),
        ),
      );
      const csrf = new CsrfTokenService(config);
      const controller = new InstanceSetupController(
        config,
        authentication,
        {
          instanceBootstrap: {
            inspectSetupToken: vi.fn(),
            issueSetupToken: vi.fn(),
            redeemSetupToken,
          },
        } as unknown as ServerDatabaseRuntime,
        csrf,
      );

      const redemption = controller.redeem(request(csrf.issue(sessionId)), {
        setupToken: rawToken,
        organizationSlug: "kanvas",
        organizationName: "Kanvas",
        workspaceSlug: "design",
        workspaceName: "Design",
      });
      await expect(redemption).rejects.toBeInstanceOf(expectedError);
      await expect(redemption).rejects.toMatchObject({
        response: {
          code: expectedProblemCode,
        },
      });
      await expect(redemption).rejects.not.toThrow("sensitive store detail");
    },
  );
});
