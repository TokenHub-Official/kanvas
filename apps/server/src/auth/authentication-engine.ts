import { createHash } from "node:crypto";

import type { RegistrationMethod } from "@kanvas/application";
import { betterAuthSchema, type DatabaseRuntime } from "@kanvas/database";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { ulid } from "ulid";

import type { ServerConfig } from "../config.js";
import {
  createEmailVerificationDelivery,
  emailVerificationTokenLifetimeSeconds,
} from "./email-verification-delivery.js";
import {
  clearInvitationAdmissionAfterOAuth,
  invitationAdmissionTokenHash,
} from "./invitation-admission.js";
import { trustedClientIpHeader } from "./authentication-http-bridge.js";
import { oidcToken } from "./oidc-token.js";
import { oidcUserInfo } from "./oidc-user-info.js";
import { oauthRedirectGuard } from "./oauth-redirect-guard.js";

export type AuthenticationDatabaseRuntime = Pick<
  DatabaseRuntime,
  "authorization" | "db" | "instanceAccess" | "team" | "defaultAccess"
>;

export interface CreateAuthenticationEngineOptions {
  readonly config: ServerConfig;
  readonly database: AuthenticationDatabaseRuntime;
}

function registrationMethodForUserCreation(
  path: string | undefined,
  params: Record<string, unknown> | undefined,
  oidcProviderIds: ReadonlySet<string>,
): RegistrationMethod | undefined {
  if (path?.endsWith("/sign-up/email")) return { kind: "email_password" };
  const parameterProviderId = params?.providerId ?? params?.id;
  const providerId =
    typeof parameterProviderId === "string"
      ? parameterProviderId
      : path?.match(/\/(?:oauth2\/)?callback\/([a-z][a-z0-9-]{0,63})$/u)?.[1];
  return providerId && oidcProviderIds.has(providerId)
    ? { kind: "oidc", providerId }
    : undefined;
}

function authenticationReferenceHash(sessionToken: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:auth-session-principal:v1\0")
    .update(sessionToken)
    .digest("hex")}`;
}

function emailNotVerified(): never {
  throw new APIError("FORBIDDEN", {
    code: "EMAIL_NOT_VERIFIED",
    message: "Email not verified",
  });
}

export function createAuthenticationEngine(
  options: CreateAuthenticationEngineOptions,
) {
  const authConfig = options.config.auth;
  const cookiePrefix = authConfig.secureCookies ? "__Host-kanvas" : "kanvas";
  const emailVerificationDelivery = authConfig.emailVerificationDelivery
    ? createEmailVerificationDelivery(
        authConfig.emailVerificationDelivery,
        authConfig.baseUrl,
      )
    : undefined;
  const oidcProviderIds = new Set(
    (authConfig.oauthProviders ?? [])
      .filter((provider) => provider.type === "oidc")
      .map((provider) => provider.id),
  );

  return betterAuth({
    appName: "Kanvas",
    baseURL: authConfig.baseUrl,
    basePath: authConfig.basePath,
    secret: authConfig.secret,
    trustedOrigins: [...authConfig.trustedOrigins],
    hooks: {
      before: oauthRedirectGuard(authConfig.baseUrl, authConfig.trustedOrigins),
      after: clearInvitationAdmissionAfterOAuth(authConfig),
    },
    socialProviders: Object.fromEntries(
      (authConfig.oauthProviders ?? [])
        .filter((provider) => provider.type !== "oidc")
        .map((provider) => [
          provider.type,
          {
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
            disableSignUp: true,
          },
        ]),
    ),
    plugins: [
      {
        id: "kanvas-internal-oidc-linking",
        hooks: {
          before: [
            {
              matcher: (context) =>
                context.path !== undefined &&
                ["/oauth2/callback/:providerId", "/callback/:id"].includes(
                  context.path,
                ) &&
                registrationMethodForUserCreation(
                  context.path,
                  context.params,
                  oidcProviderIds,
                )?.kind === "oidc",
              // Override only this request. Both the local email and the OIDC
              // email must still be verified; social callbacks stay explicit.
              handler: createAuthMiddleware(() =>
                Promise.resolve({
                  context: {
                    context: {
                      options: {
                        account: {
                          accountLinking: { disableImplicitLinking: false },
                        },
                      },
                    },
                  },
                }),
              ),
            },
          ],
        },
      },
      genericOAuth({
        config: (authConfig.oauthProviders ?? [])
          .filter((provider) => provider.type === "oidc")
          .map((provider) => ({
            providerId: provider.id,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
            discoveryUrl: provider.discoveryUrl,
            issuer: provider.issuer,
            authentication:
              provider.tokenEndpointAuthMethod === "client_secret_post"
                ? "post"
                : "basic",
            scopes: ["openid", "profile", "email"],
            pkce: true,
            // The database hook below enforces the current Instance policy.
            // This plugin flag must remain open so policy changes do not
            // require rebuilding the Authentication Engine.
            disableSignUp: false,
            getToken: oidcToken(provider),
            getUserInfo: oidcUserInfo(provider),
          })),
      }),
    ] as BetterAuthPlugin[],
    database: drizzleAdapter(options.database.db, {
      provider: "mysql",
      schema: betterAuthSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: authConfig.emailAndPasswordEnabled,
      // Signup and verification requirements are mutable Instance policy. The
      // database hooks below evaluate them for every account and session.
      disableSignUp: false,
      requireEmailVerification: false,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    ...(emailVerificationDelivery
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            expiresIn: emailVerificationTokenLifetimeSeconds,
            sendVerificationEmail: async ({ user, url }, request) => {
              if (
                request &&
                new URL(request.url).pathname.endsWith("/sign-up/email") &&
                !(
                  await options.database.instanceAccess.readRegistrationPolicy()
                ).emailVerificationRequired
              ) {
                return;
              }
              await emailVerificationDelivery.send({
                recipient: user.email,
                displayName:
                  user.name.trim() ||
                  user.email.split("@", 1)[0] ||
                  "Kanvas User",
                verificationUrl: url,
              });
            },
          },
        }
      : {}),
    session: {
      expiresIn: authConfig.sessionExpiresInSeconds,
      updateAge: authConfig.sessionUpdateAgeSeconds,
      cookieCache: {
        enabled: false,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
      encryptOAuthTokens: true,
      skipStateCookieCheck: false,
      storeStateStrategy: "database",
      storeAccountCookie: false,
    },
    verification: {
      storeIdentifier: "hashed",
      storeInDatabase: true,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            const method = context
              ? registrationMethodForUserCreation(
                  context.path,
                  context.params as Record<string, unknown> | undefined,
                  oidcProviderIds,
                )
              : undefined;
            const invitationHash = context
              ? invitationAdmissionTokenHash(
                  context.headers,
                  authConfig,
                  new Date(),
                )
              : undefined;
            const invitation = invitationHash
              ? await options.database.team.resolveInvitation(
                  invitationHash,
                  new Date(),
                )
              : null;
            const invited =
              invitation?.state === "pending" &&
              invitation.targetEmail.trim().toLowerCase() ===
                user.email.trim().toLowerCase();
            // Internal account creation is reserved for managed invitation/setup enrollment.
            let source: "self" | "invitation" | "managed" = "managed";
            if (method) source = "self";
            if (invited) source = "invitation";
            await options.database.defaultAccess.recordRegistration(
              user.id,
              source,
              method?.kind === "oidc" ? method.providerId : null,
            );
          },
          // Also cover the generic plugin's alternate core callback route.
          before: (user, context) =>
            (async () => {
              if (!context) return { data: user };
              const method = registrationMethodForUserCreation(
                context.path,
                context.params as Record<string, unknown> | undefined,
                oidcProviderIds,
              );
              if (!method) return false;
              if (
                await options.database.instanceAccess.registrationAllowed(
                  method,
                )
              ) {
                return { data: user };
              }
              if (method.kind !== "oidc" || user.emailVerified !== true) {
                return false;
              }
              const now = new Date();
              const tokenHash = invitationAdmissionTokenHash(
                context.headers,
                authConfig,
                now,
              );
              if (!tokenHash) return false;
              const invitation = await options.database.team.resolveInvitation(
                tokenHash,
                now,
              );
              return invitation?.state === "pending" &&
                invitation.targetEmail.trim().toLowerCase() ===
                  user.email.trim().toLowerCase()
                ? { data: user }
                : false;
            })(),
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            const user = await context?.context.internalAdapter.findUserById(
              session.userId,
            );
            if (!user) return false;
            if (
              !user.emailVerified &&
              (await options.database.instanceAccess.readRegistrationPolicy())
                .emailVerificationRequired
            ) {
              return emailNotVerified();
            }
            const now = new Date();
            const principal =
              await options.database.authorization.resolveHumanPrincipal({
                principalId: ulid(),
                authSubjectId: session.userId,
                now,
                audit: {
                  auditEventId: ulid(),
                  authenticationRefHash: authenticationReferenceHash(
                    session.token,
                  ),
                },
              });
            if (principal.status !== "active") return false;
            await options.database.defaultAccess.process(session.userId);
            return {
              data: {
                ...session,
                ipAddress: null,
                userAgent: null,
              },
            };
          },
        },
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: [trustedClientIpHeader],
      },
      // Better Auth otherwise prepends __Secure-. Production deliberately
      // supplies an explicit __Host- name and all corresponding attributes.
      useSecureCookies: false,
      cookiePrefix,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: authConfig.secureCookies,
        sameSite: "lax",
        path: "/",
      },
      database: {
        generateId: () => ulid(),
      },
    },
    telemetry: {
      enabled: false,
    },
  });
}

export type AuthenticationEngine = ReturnType<
  typeof createAuthenticationEngine
>;
