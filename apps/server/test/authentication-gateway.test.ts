import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";

import { createAuthenticationGateway } from "../src/auth/authentication-gateway.js";
import {
  createAuthenticationEngine,
  type AuthenticationDatabaseRuntime,
  type AuthenticationEngine,
} from "../src/auth/authentication-engine.js";
import { loadServerConfig } from "../src/config.js";

const config = loadServerConfig(
  {
    KANVAS_INSTANCE_ID: "invitation-gateway-test",
    KANVAS_DATABASE_HOST: "127.0.0.1",
    KANVAS_DATABASE_NAME: "kanvas",
    KANVAS_DATABASE_USER: "kanvas",
    KANVAS_DATABASE_PASSWORD: "test-only",
    KANVAS_AUTH_SECRET: "test-only-auth-secret-that-is-at-least-32-characters",
    KANVAS_AUTH_EMAIL_DEVELOPMENT_OUTBOX_FILE:
      "/tmp/unused-invitation-outbox.jsonl",
    KANVAS_AUTH_EMAIL_FROM_ADDRESS: "kanvas@localhost.invalid",
  },
  [],
);

describe("AuthenticationGateway invitation registration", () => {
  it("creates an unverified account and resends without replacing its password", async () => {
    const policyReader = {
      readRegistrationPolicy: () =>
        Promise.resolve({ emailVerificationRequired: true }),
    };
    const recordRegistration = vi.fn<
      AuthenticationDatabaseRuntime["defaultAccess"]["recordRegistration"]
    >(() => Promise.resolve());
    const processDefaultAccess = vi.fn<
      AuthenticationDatabaseRuntime["defaultAccess"]["process"]
    >(() => Promise.resolve({ state: "excluded", reason: "not_eligible" }));
    const template = createAuthenticationEngine({
      config,
      database: {
        authorization: {
          resolveHumanPrincipal: () =>
            Promise.resolve({
              principalId: "01K00000000000000000000001",
              status: "active" as const,
              version: 1,
              created: true,
            }),
        },
        db: {},
        defaultAccess: { recordRegistration, process: processDefaultAccess },
        instanceAccess: {
          registrationAllowed: () => Promise.resolve(false),
          ...policyReader,
        },
        team: {
          resolveInvitation: () => Promise.resolve(null),
        },
      } as unknown as AuthenticationDatabaseRuntime,
    });
    const sendVerificationEmail = vi.fn(
      (
        message: {
          readonly user: { readonly email: string };
          readonly url: string;
        },
        request?: Request,
      ) => {
        void message;
        void request;
        return Promise.resolve();
      },
    );
    const auth = betterAuth({
      ...template.options,
      database: memoryAdapter({
        user: [],
        account: [],
        session: [],
        verification: [],
      }),
      emailVerification: {
        ...template.options.emailVerification,
        sendVerificationEmail,
      },
      logger: { disabled: true },
      rateLimit: { enabled: false },
    }) as unknown as AuthenticationEngine;
    const gateway = createAuthenticationGateway(auth, policyReader);
    const register = (input: {
      readonly displayName: string;
      readonly email: string;
      readonly password: string;
      readonly verificationCallbackUrl: string;
    }) => {
      if (!gateway.registerInvitationEmailAccount) {
        throw new Error("Invitation registration is unavailable.");
      }
      return gateway.registerInvitationEmailAccount(input);
    };
    const callback =
      "http://127.0.0.1:3000/email-verification?returnTo=%2Finvite%2Ftoken";

    await expect(
      register({
        email: "Invited@Example.com",
        displayName: "Invited User",
        password: "first-password",
        verificationCallbackUrl: callback,
      }),
    ).resolves.toBe("created");

    expect(recordRegistration).toHaveBeenCalledWith(
      expect.any(String),
      "managed",
      null,
    );
    const context = await auth.$context;
    const created = await context.internalAdapter.findUserByEmail(
      "invited@example.com",
      { includeAccounts: true },
    );
    expect(created?.user).toMatchObject({
      email: "invited@example.com",
      emailVerified: false,
      name: "Invited User",
    });
    const originalPassword = created?.accounts.find(
      (account) => account.providerId === "credential",
    )?.password;
    expect(originalPassword).toBeTruthy();
    const firstDelivery = sendVerificationEmail.mock.calls[0]?.[0];
    expect(firstDelivery?.user.email).toBe("invited@example.com");
    expect(firstDelivery?.url).toContain(
      `callbackURL=${encodeURIComponent(callback)}`,
    );

    await expect(
      register({
        email: "invited@example.com",
        displayName: "Replacement Name",
        password: "replacement-password",
        verificationCallbackUrl: callback,
      }),
    ).resolves.toBe("verification_resent");
    const afterResend = await context.internalAdapter.findUserByEmail(
      "invited@example.com",
      { includeAccounts: true },
    );
    expect(afterResend?.user.name).toBe("Invited User");
    expect(
      afterResend?.accounts.find(
        (account) => account.providerId === "credential",
      )?.password,
    ).toBe(originalPassword);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(2);
    expect(recordRegistration).toHaveBeenCalledTimes(1);

    await context.internalAdapter.updateUser(created!.user.id, {
      emailVerified: true,
    });
    await expect(
      register({
        email: "invited@example.com",
        displayName: "Ignored",
        password: "ignored-password",
        verificationCallbackUrl: callback,
      }),
    ).resolves.toBe("account_exists");
    expect(sendVerificationEmail).toHaveBeenCalledTimes(2);
    expect(recordRegistration).toHaveBeenCalledTimes(1);
  });

  it("allows an unverified account only while the live policy exempts verification", async () => {
    let emailVerificationRequired = false;
    const policyReader = {
      readRegistrationPolicy: () =>
        Promise.resolve({ emailVerificationRequired }),
    };
    const noDeliveryConfig = loadServerConfig(
      {
        KANVAS_INSTANCE_ID: "unverified-invitation-gateway-test",
        KANVAS_DATABASE_HOST: "127.0.0.1",
        KANVAS_DATABASE_NAME: "kanvas",
        KANVAS_DATABASE_USER: "kanvas",
        KANVAS_DATABASE_PASSWORD: "test-only",
        KANVAS_AUTH_SECRET:
          "test-only-auth-secret-that-is-at-least-32-characters",
      },
      [],
    );
    const resolveHumanPrincipal = vi.fn(() =>
      Promise.resolve({
        principalId: "01K00000000000000000000002",
        status: "active" as const,
        version: 1,
        created: true,
      }),
    );
    const recordRegistration = vi.fn<
      AuthenticationDatabaseRuntime["defaultAccess"]["recordRegistration"]
    >(() => Promise.resolve());
    const processDefaultAccess = vi.fn<
      AuthenticationDatabaseRuntime["defaultAccess"]["process"]
    >(() => Promise.resolve({ state: "excluded", reason: "not_eligible" }));
    const template = createAuthenticationEngine({
      config: noDeliveryConfig,
      database: {
        authorization: { resolveHumanPrincipal },
        db: {},
        defaultAccess: { recordRegistration, process: processDefaultAccess },
        instanceAccess: {
          registrationAllowed: () => Promise.resolve(false),
          ...policyReader,
        },
        team: { resolveInvitation: () => Promise.resolve(null) },
      } as unknown as AuthenticationDatabaseRuntime,
    });
    const auth = betterAuth({
      ...template.options,
      database: memoryAdapter({
        user: [],
        account: [],
        session: [],
        verification: [],
      }),
      logger: { disabled: true },
      rateLimit: { enabled: false },
    }) as unknown as AuthenticationEngine;
    const gateway = createAuthenticationGateway(auth, policyReader);
    const registration = {
      email: "policy-exempt@example.com",
      displayName: "Policy Exempt",
      password: "first-password",
      verificationCallbackUrl: "http://127.0.0.1:3000/email-verification",
    };

    await expect(
      gateway.registerInvitationEmailAccount?.(registration),
    ).resolves.toBe("created");
    await expect(
      gateway.registerInvitationEmailAccount?.({
        ...registration,
        password: "replacement-password",
      }),
    ).resolves.toBe("account_exists");

    const signIn = await auth.handler(
      new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({
          email: registration.email,
          password: registration.password,
        }),
      }),
    );
    expect(signIn.status).toBe(200);
    expect(processDefaultAccess).toHaveBeenCalledOnce();
    expect(recordRegistration).toHaveBeenCalledOnce();
    const [sessionCookie] = signIn.headers
      .getSetCookie()
      .find((candidate) => candidate.startsWith("kanvas.session_token="))
      ?.split(";", 1) ?? [undefined];
    expect(sessionCookie).toBeTruthy();
    const headers = new Headers({ cookie: sessionCookie ?? "" });
    await expect(gateway.resolveBrowserSession(headers)).resolves.toMatchObject(
      {
        accountEmail: {
          email: registration.email,
          emailVerified: false,
        },
      },
    );
    expect(
      (await gateway.resolveBrowserSession(headers))?.verifiedContact,
    ).toBeUndefined();
    expect(resolveHumanPrincipal).toHaveBeenCalledOnce();

    emailVerificationRequired = true;
    await expect(gateway.resolveBrowserSession(headers)).resolves.toBeNull();
    await expect(auth.api.getSession({ headers })).resolves.toBeNull();

    const rejected = await auth.handler(
      new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({
          email: registration.email,
          password: registration.password,
        }),
      }),
    );
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
  });
});
