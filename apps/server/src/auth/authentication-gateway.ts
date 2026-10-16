import type { InstanceRegistrationPolicy } from "@kanvas/application";

import type { AuthenticationEngine } from "./authentication-engine.js";

export interface AuthenticationPolicyReader {
  readRegistrationPolicy(): Promise<
    Pick<InstanceRegistrationPolicy, "emailVerificationRequired">
  >;
}

export interface AuthenticatedHuman {
  readonly authSubjectId: string;
  readonly sessionId: string;
  readonly authenticationStrength: "single_factor";
  readonly displayName?: string;
  readonly accountEmail?: {
    readonly email: string;
    readonly emailVerified: boolean;
  };
  readonly verifiedContact?: {
    readonly email: string;
  };
}

export interface AuthenticationGateway {
  resolveBrowserSession(headers: Headers): Promise<AuthenticatedHuman | null>;
  revokeSession(sessionId: string): Promise<boolean>;
  revokeAllHumanSessions(authSubjectId: string): Promise<void>;
  getVerifiedContact(
    authSubjectId: string,
  ): Promise<{ readonly email: string } | null>;
  getHumanProfile?(authSubjectId: string): Promise<{
    readonly displayName: string;
    readonly verifiedEmail?: string;
  } | null>;
  registerVerifiedEmailAccount?(input: {
    readonly email: string;
    readonly displayName: string;
    readonly password: string;
  }): Promise<"created" | "exists">;
  registerInvitationEmailAccount?(input: {
    readonly email: string;
    readonly displayName: string;
    readonly password: string;
    readonly verificationCallbackUrl: string;
  }): Promise<
    "created" | "verification_resent" | "account_exists" | "unavailable"
  >;
}

export function createAuthenticationGateway(
  auth: AuthenticationEngine,
  policyReader: AuthenticationPolicyReader,
): AuthenticationGateway {
  const revokeSessionById = async (sessionId: string): Promise<boolean> => {
    const context = await auth.$context;
    const session = await context.adapter.findOne<{
      readonly token?: unknown;
    }>({
      model: "session",
      where: [
        {
          field: "id",
          value: sessionId,
        },
      ],
    });
    if (!session || typeof session.token !== "string") {
      return false;
    }
    await context.internalAdapter.deleteSession(session.token);
    return true;
  };

  return Object.freeze({
    async resolveBrowserSession(
      headers: Headers,
    ): Promise<AuthenticatedHuman | null> {
      const resolved = await auth.api.getSession({
        headers,
        query: {
          disableCookieCache: true,
          disableRefresh: true,
        },
      });
      if (!resolved) {
        return null;
      }
      if (!resolved.user.emailVerified) {
        let policy: Pick<
          InstanceRegistrationPolicy,
          "emailVerificationRequired"
        >;
        try {
          policy = await policyReader.readRegistrationPolicy();
        } catch {
          return null;
        }
        if (policy.emailVerificationRequired) {
          await revokeSessionById(resolved.session.id);
          return null;
        }
      }
      return Object.freeze({
        authSubjectId: resolved.user.id,
        sessionId: resolved.session.id,
        authenticationStrength: "single_factor" as const,
        displayName:
          resolved.user.name.trim() ||
          resolved.user.email.split("@", 1)[0] ||
          "Kanvas User",
        accountEmail: Object.freeze({
          email: resolved.user.email,
          emailVerified: resolved.user.emailVerified,
        }),
        ...(resolved.user.emailVerified
          ? {
              verifiedContact: Object.freeze({
                email: resolved.user.email,
              }),
            }
          : {}),
      });
    },

    async revokeSession(sessionId: string): Promise<boolean> {
      return revokeSessionById(sessionId);
    },

    async revokeAllHumanSessions(authSubjectId: string): Promise<void> {
      const context = await auth.$context;
      await context.internalAdapter.deleteUserSessions(authSubjectId);
    },

    async getVerifiedContact(
      authSubjectId: string,
    ): Promise<{ readonly email: string } | null> {
      const context = await auth.$context;
      const user = await context.internalAdapter.findUserById(authSubjectId);
      if (!user?.emailVerified) {
        return null;
      }
      return Object.freeze({
        email: user.email,
      });
    },

    async getHumanProfile(authSubjectId: string) {
      const context = await auth.$context;
      const user = await context.internalAdapter.findUserById(authSubjectId);
      if (!user) {
        return null;
      }
      return Object.freeze({
        displayName:
          user.name.trim() || user.email.split("@", 1)[0] || "Kanvas User",
        ...(user.emailVerified
          ? {
              verifiedEmail: user.email,
            }
          : {}),
      });
    },

    async registerVerifiedEmailAccount(input: {
      readonly email: string;
      readonly displayName: string;
      readonly password: string;
    }) {
      const context = await auth.$context;
      const email = input.email.trim().toLowerCase();
      const existing = await context.internalAdapter.findUserByEmail(email, {
        includeAccounts: false,
      });
      if (existing) {
        return "exists" as const;
      }
      const passwordHash = await context.password.hash(input.password);
      const user = await context.internalAdapter.createUser({
        email,
        emailVerified: true,
        name: input.displayName.trim(),
      });
      await context.internalAdapter.createAccount({
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      });
      return "created" as const;
    },

    async registerInvitationEmailAccount(input: {
      readonly email: string;
      readonly displayName: string;
      readonly password: string;
      readonly verificationCallbackUrl: string;
    }) {
      if (auth.options.emailAndPassword?.enabled !== true) {
        return "unavailable" as const;
      }
      const { emailVerificationRequired } =
        await policyReader.readRegistrationPolicy();
      const verificationDelivery =
        auth.options.emailVerification?.sendVerificationEmail;
      if (emailVerificationRequired && !verificationDelivery) {
        return "unavailable" as const;
      }
      const context = await auth.$context;
      const email = input.email.trim().toLowerCase();
      const sendVerification = async (): Promise<void> => {
        await auth.api.sendVerificationEmail({
          body: {
            email,
            callbackURL: input.verificationCallbackUrl,
          },
        });
      };
      const existing = await context.internalAdapter.findUserByEmail(email, {
        includeAccounts: false,
      });
      if (existing) {
        if (!existing.user.emailVerified && emailVerificationRequired) {
          await sendVerification();
          return "verification_resent" as const;
        }
        return "account_exists" as const;
      }
      const passwordHash = await context.password.hash(input.password);
      const user = await context.internalAdapter.createUser({
        email,
        emailVerified: false,
        name: input.displayName.trim(),
      });
      await context.internalAdapter.createAccount({
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      });
      if (emailVerificationRequired) await sendVerification();
      return "created" as const;
    },
  });
}
