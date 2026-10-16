import { ulid } from "ulid";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createDatabaseRuntime, type DatabaseRuntime } from "@kanvas/database";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import type { FastifyRequest } from "fastify";

import { createAuthenticationGateway } from "../src/auth/authentication-gateway.js";
import {
  createAuthenticationEngine,
  type AuthenticationEngine,
} from "../src/auth/authentication-engine.js";
import type { ServerConfig } from "../src/config.js";
import { CurrentHumanContextController } from "../src/http/current-human-context.controller.js";
import { CsrfTokenService } from "../src/security/csrf-token-service.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const email = "designer@example.com";
const password = "correct horse battery staple";
const oidcIssuer = "https://identity.example.com";
const oidcProvider = {
  id: "company",
  name: "Company",
  type: "oidc" as const,
  clientId: "integration-client",
  clientSecret: "integration-secret",
  discoveryUrl: `${oidcIssuer}/.well-known/openid-configuration`,
  issuer: oidcIssuer,
  tokenEndpointAuthMethod: "client_secret_basic" as const,
};

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let signingKey: SigningKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

interface SessionPrivacyRow extends RowDataPacket {
  readonly id: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

function databaseName(): string {
  const name = `kanvas_auth_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function adminPool(): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 2,
      multipleStatements: true,
      timezone: "Z",
    });
  }
  return createPool({
    host: process.env.KANVAS_DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.KANVAS_DATABASE_PORT ?? "3306"),
    user: process.env.KANVAS_DATABASE_USER ?? "root",
    password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
    connectionLimit: 2,
    multipleStatements: true,
    timezone: "Z",
  });
}

function directPool(name: string): Pool {
  return createPool({
    host: process.env.KANVAS_DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.KANVAS_DATABASE_PORT ?? "3306"),
    database: name,
    user: process.env.KANVAS_DATABASE_USER ?? "root",
    password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
    connectionLimit: 2,
    timezone: "Z",
  });
}

function requestUrl(input: string | URL | Request): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

function stubOidcProvider(
  emailAddress: string,
  subject = "integration-subject",
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === oidcProvider.discoveryUrl) {
        return Response.json({
          issuer: oidcIssuer,
          authorization_endpoint: `${oidcIssuer}/auth`,
          token_endpoint: `${oidcIssuer}/token`,
          userinfo_endpoint: `${oidcIssuer}/userinfo`,
          jwks_uri: `${oidcIssuer}/keys`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        });
      }
      if (url === `${oidcIssuer}/token`) {
        const now = Math.floor(Date.now() / 1_000);
        const idToken = await new SignJWT({ sub: subject })
          .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
          .setIssuer(oidcIssuer)
          .setAudience(oidcProvider.clientId)
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(signingKey);
        return Response.json({
          access_token: "integration-access-token",
          expires_in: 300,
          id_token: idToken,
          token_type: "Bearer",
        });
      }
      if (url === `${oidcIssuer}/keys`) {
        return Response.json({ keys: [publicJwk] });
      }
      if (url === `${oidcIssuer}/userinfo`) {
        return Response.json({
          sub: subject,
          email: emailAddress,
          email_verified: true,
          name: "OIDC Registration",
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.skipIf(!integrationEnabled)(
  "Better Auth 1.6.25 against disposable MySQL 8.0",
  () => {
    const name = databaseName();
    let admin!: Pool;
    let direct!: Pool;
    let database!: DatabaseRuntime;
    let auth!: AuthenticationEngine;
    let closedRegistrationAuth!: AuthenticationEngine;
    let registrationAuth!: AuthenticationEngine;
    let config!: ServerConfig;
    let outboxDirectory!: string;
    let outboxFile!: string;

    beforeAll(async () => {
      const keyPair = await generateKeyPair("RS256");
      signingKey = keyPair.privateKey;
      publicJwk = {
        ...(await exportJWK(keyPair.publicKey)),
        alg: "RS256",
        kid: "integration-key",
        use: "sig",
      };
      admin = adminPool();
      await admin.query(
        `CREATE DATABASE \`${name}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const migrationsDirectory = resolve(
        import.meta.dirname,
        "../../../packages/database/migrations",
      );
      const migrationNames = (await readdir(migrationsDirectory))
        .filter((candidate) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(candidate))
        .sort();
      const connection = await admin.getConnection();
      try {
        await connection.query(`USE \`${name}\``);
        for (const migrationName of migrationNames) {
          await connection.query(
            await readFile(resolve(migrationsDirectory, migrationName), "utf8"),
          );
        }
      } finally {
        connection.release();
      }
      direct = directPool(name);
      config = {
        environment: "test",
        auth: {
          baseUrl: "http://127.0.0.1:3000",
          basePath: "/api/auth",
          secret: "test-only-auth-secret-that-is-at-least-32-characters",
          trustedOrigins: ["http://127.0.0.1:3000"],
          secureCookies: false,
          emailAndPasswordEnabled: true,
          sessionExpiresInSeconds: 604_800,
          sessionUpdateAgeSeconds: 86_400,
        },
      } as unknown as ServerConfig;
      database = createDatabaseRuntime({
        connection: {
          host: process.env.KANVAS_DATABASE_HOST ?? "127.0.0.1",
          port: Number(process.env.KANVAS_DATABASE_PORT ?? "3306"),
          database: name,
          user: process.env.KANVAS_DATABASE_USER ?? "root",
          password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
          connectionLimit: 4,
        },
        instanceId: "auth-integration",
        enabledExecutionTargets: ["worker"],
      });
      await direct.execute(
        "INSERT INTO instance_runtime_state (instance_id,state,execution_generation,state_version,reason,changed_by,changed_at) VALUES ('auth-integration','ACTIVE',1,1,'test','test',NOW(3))",
      );
      auth = createAuthenticationEngine({
        config,
        database,
      });
      outboxDirectory = await mkdtemp(
        join(tmpdir(), "kanvas-auth-registration-"),
      );
      outboxFile = join(outboxDirectory, "verification.jsonl");
      closedRegistrationAuth = createAuthenticationEngine({
        config: {
          ...config,
          auth: {
            ...config.auth,
            emailVerificationDelivery: {
              kind: "development_outbox",
              file: outboxFile,
              fromAddress: "kanvas@localhost.invalid",
              fromName: "Kanvas",
            },
          },
        },
        database: {
          defaultAccess: database.defaultAccess,
          authorization: database.authorization,
          db: database.db,
          instanceAccess: {
            registrationAllowed: () => Promise.resolve(false),
            readRegistrationPolicy: () =>
              Promise.resolve({ emailVerificationRequired: true }),
          },
          team: database.team,
        } as unknown as DatabaseRuntime,
      });
      registrationAuth = createAuthenticationEngine({
        config: {
          ...config,
          auth: {
            ...config.auth,
            emailVerificationDelivery: {
              kind: "development_outbox",
              file: outboxFile,
              fromAddress: "kanvas@localhost.invalid",
              fromName: "Kanvas",
            },
          },
        },
        database: {
          defaultAccess: database.defaultAccess,
          authorization: database.authorization,
          db: database.db,
          instanceAccess: {
            registrationAllowed: () => Promise.resolve(true),
            readRegistrationPolicy: () =>
              Promise.resolve({ emailVerificationRequired: true }),
          },
          team: database.team,
        } as unknown as DatabaseRuntime,
      });
      const context = await auth.$context;
      const user = await context.internalAdapter.createUser({
        email,
        emailVerified: true,
        name: "Kanvas Designer",
      });
      await context.internalAdapter.createAccount({
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: await context.password.hash(password),
      });
    }, 120_000);

    afterAll(async () => {
      if (database) {
        await database.close();
      }
      if (outboxDirectory) {
        await rm(outboxDirectory, { recursive: true, force: true });
      }
      if (direct) {
        await direct.end();
      }
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
        await admin.end();
      }
    }, 30_000);

    it("keeps public signup closed", async () => {
      const response = await closedRegistrationAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            email: "uninvited@example.com",
            name: "Uninvited",
            password,
          }),
        }),
      );

      expect(response.status).toBe(400);
      const [rows] = await direct.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM auth_user",
      );
      expect(Number(rows[0]?.count ?? 0)).toBe(1);
    });

    it("keeps delivery failures unverified and supports resend recovery", async () => {
      const blockedParent = join(outboxDirectory, "not-a-directory");
      await writeFile(blockedParent, "blocked");
      const failingAuth = createAuthenticationEngine({
        config: {
          ...config,
          auth: {
            ...config.auth,
            emailVerificationDelivery: {
              kind: "development_outbox",
              file: join(blockedParent, "verification.jsonl"),
              fromAddress: "kanvas@localhost.invalid",
              fromName: "Kanvas",
            },
          },
        },
        database: {
          defaultAccess: database.defaultAccess,
          authorization: database.authorization,
          db: database.db,
          instanceAccess: {
            registrationAllowed: () => Promise.resolve(true),
            readRegistrationPolicy: () =>
              Promise.resolve({ emailVerificationRequired: true }),
          },
          team: database.team,
        } as unknown as DatabaseRuntime,
      });
      const failedEmail = "delivery-failed@example.com";
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
        // The failed delivery is the condition under test.
      });
      try {
        const response = await failingAuth.handler(
          new Request("http://127.0.0.1:3000/api/auth/sign-up/email", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://127.0.0.1:3000",
              "x-kanvas-trusted-client-ip": "192.0.2.45",
            },
            body: JSON.stringify({
              email: failedEmail,
              name: "Delivery Failed",
              password,
              callbackURL: "http://127.0.0.1:3000/email-verification",
            }),
          }),
        );
        expect(response.ok).toBe(true);
      } finally {
        consoleError.mockRestore();
      }

      const [unverifiedRows] = await direct.query<
        (RowDataPacket & { readonly emailVerified: number })[]
      >(
        `SELECT email_verified AS emailVerified
         FROM auth_user
         WHERE email = ?`,
        [failedEmail],
      );
      expect(unverifiedRows).toEqual([{ emailVerified: 0 }]);
      const signInConsoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {
          // The automatic resend fails through the same unavailable delivery.
        });
      let signInBeforeRecovery: Response;
      try {
        signInBeforeRecovery = await failingAuth.handler(
          new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://127.0.0.1:3000",
              "x-kanvas-trusted-client-ip": "192.0.2.46",
            },
            body: JSON.stringify({ email: failedEmail, password }),
          }),
        );
      } finally {
        signInConsoleError.mockRestore();
      }
      expect(signInBeforeRecovery.status).toBe(403);

      const recoveryOutbox = join(outboxDirectory, "recovery.jsonl");
      const recoveryAuth = createAuthenticationEngine({
        config: {
          ...config,
          auth: {
            ...config.auth,
            emailVerificationDelivery: {
              kind: "development_outbox",
              file: recoveryOutbox,
              fromAddress: "kanvas@localhost.invalid",
              fromName: "Kanvas",
            },
          },
        },
        database: {
          defaultAccess: database.defaultAccess,
          authorization: database.authorization,
          db: database.db,
          instanceAccess: {
            registrationAllowed: () => Promise.resolve(true),
            readRegistrationPolicy: () =>
              Promise.resolve({ emailVerificationRequired: true }),
          },
          team: database.team,
        } as unknown as DatabaseRuntime,
      });
      const resent = await recoveryAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/send-verification-email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            email: failedEmail,
            callbackURL: "http://127.0.0.1:3000/email-verification",
          }),
        }),
      );
      expect(resent.status).toBe(200);
      const recoveryRecord = JSON.parse(
        (await readFile(recoveryOutbox, "utf8")).trim(),
      ) as { readonly verificationUrl: string };
      const recovered = await recoveryAuth.handler(
        new Request(recoveryRecord.verificationUrl),
      );
      expect(recovered.status).toBe(302);
      const [recoveredRows] = await direct.query<
        (RowDataPacket & { readonly emailVerified: number })[]
      >(
        `SELECT email_verified AS emailVerified
         FROM auth_user
         WHERE email = ?`,
        [failedEmail],
      );
      expect(recoveredRows).toEqual([{ emailVerified: 1 }]);
    });

    it("verifies an invited email before creating its session and Human Principal", async () => {
      const invitedEmail = "invited-verification@example.com";
      const callbackURL =
        "http://127.0.0.1:3000/email-verification?returnTo=%2Finvite%2Ftest-invitation";
      const gateway = createAuthenticationGateway(
        closedRegistrationAuth,
        database.instanceAccess,
      );

      await expect(
        gateway.registerInvitationEmailAccount?.({
          email: invitedEmail,
          displayName: "Invited Verification",
          password,
          verificationCallbackUrl: callbackURL,
        }),
      ).resolves.toBe("created");

      const [beforeRows] = await direct.query<
        (RowDataPacket & {
          readonly emailVerified: number;
          readonly principals: number | string;
          readonly sessions: number | string;
        })[]
      >(
        `SELECT
           user.email_verified AS emailVerified,
           (
             SELECT COUNT(*)
             FROM human_principal AS human
             WHERE human.auth_subject_id = user.id
           ) AS principals,
           (
             SELECT COUNT(*)
             FROM auth_session AS session
             WHERE session.user_id = user.id
           ) AS sessions
         FROM auth_user AS user
         WHERE user.email = ?`,
        [invitedEmail],
      );
      expect(beforeRows[0]?.emailVerified).toBe(0);
      expect(Number(beforeRows[0]?.principals ?? -1)).toBe(0);
      expect(Number(beforeRows[0]?.sessions ?? -1)).toBe(0);

      const invitationDelivery = (await readFile(outboxFile, "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              readonly recipient: string;
              readonly verificationUrl: string;
            },
        )
        .find((record) => record.recipient === invitedEmail);
      expect(invitationDelivery).toBeTruthy();
      const verified = await closedRegistrationAuth.handler(
        new Request(invitationDelivery?.verificationUrl ?? ""),
      );
      expect(verified.status).toBe(302);
      expect(verified.headers.get("location")).toBe(callbackURL);
      expect(
        verified.headers
          .getSetCookie()
          .some((candidate) => candidate.startsWith("kanvas.session_token=")),
      ).toBe(true);

      const [afterRows] = await direct.query<
        (RowDataPacket & {
          readonly emailVerified: number;
          readonly principals: number | string;
          readonly sessions: number | string;
        })[]
      >(
        `SELECT
           user.email_verified AS emailVerified,
           (
             SELECT COUNT(*)
             FROM human_principal AS human
             WHERE human.auth_subject_id = user.id
           ) AS principals,
           (
             SELECT COUNT(*)
             FROM auth_session AS session
             WHERE session.user_id = user.id
           ) AS sessions
         FROM auth_user AS user
         WHERE user.email = ?`,
        [invitedEmail],
      );
      expect(afterRows[0]?.emailVerified).toBe(1);
      expect(Number(afterRows[0]?.principals ?? -1)).toBe(1);
      expect(Number(afterRows[0]?.sessions ?? -1)).toBe(1);
      await expect(
        gateway.registerInvitationEmailAccount?.({
          email: invitedEmail,
          displayName: "Ignored",
          password: "replacement-password",
          verificationCallbackUrl: callbackURL,
        }),
      ).resolves.toBe("account_exists");
    });

    it("allows no-delivery email login only while verification is policy-exempt", async () => {
      const policyExemptEmail = "policy-exempt-registration@example.com";
      let emailVerificationRequired = false;
      const policyReader = {
        readRegistrationPolicy: () =>
          Promise.resolve({ emailVerificationRequired }),
      };
      const policyExemptAuth = createAuthenticationEngine({
        config,
        database: {
          defaultAccess: database.defaultAccess,
          authorization: database.authorization,
          db: database.db,
          instanceAccess: {
            registrationAllowed: () => Promise.resolve(true),
            ...policyReader,
          },
          team: database.team,
        } as unknown as DatabaseRuntime,
      });
      const gateway = createAuthenticationGateway(
        policyExemptAuth,
        policyReader,
      );
      const authRequest = (path: string, body: unknown) =>
        policyExemptAuth.handler(
          new Request(`http://127.0.0.1:3000/api/auth${path}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://127.0.0.1:3000",
              "x-kanvas-trusted-client-ip": "192.0.2.47",
            },
            body: JSON.stringify(body),
          }),
        );

      const signUp = await authRequest("/sign-up/email", {
        email: policyExemptEmail,
        name: "Policy Exempt Registration",
        password,
        callbackURL: "http://127.0.0.1:3000/",
      });
      expect(signUp.status).toBe(200);
      expect(signUp.headers.getSetCookie()).toHaveLength(0);

      const signIn = await authRequest("/sign-in/email", {
        email: policyExemptEmail,
        password,
      });
      expect(signIn.status).toBe(200);
      const sessionCookie = signIn.headers
        .getSetCookie()
        .find((candidate) => candidate.startsWith("kanvas.session_token="))
        ?.split(";", 1)[0];
      expect(sessionCookie).toBeTruthy();
      const headers = new Headers({ cookie: sessionCookie ?? "" });
      await expect(
        gateway.resolveBrowserSession(headers),
      ).resolves.toMatchObject({
        accountEmail: {
          email: policyExemptEmail,
          emailVerified: false,
        },
      });

      const [beforePolicyChange] = await direct.query<
        (RowDataPacket & {
          readonly emailVerified: number;
          readonly principals: number | string;
          readonly sessions: number | string;
        })[]
      >(
        `SELECT
           user.email_verified AS emailVerified,
           (
             SELECT COUNT(*) FROM human_principal AS human
             WHERE human.auth_subject_id = user.id
           ) AS principals,
           (
             SELECT COUNT(*) FROM auth_session AS session
             WHERE session.user_id = user.id
           ) AS sessions
         FROM auth_user AS user
         WHERE user.email = ?`,
        [policyExemptEmail],
      );
      expect(beforePolicyChange).toEqual([
        { emailVerified: 0, principals: 1, sessions: 1 },
      ]);

      emailVerificationRequired = true;
      await expect(gateway.resolveBrowserSession(headers)).resolves.toBeNull();
      const [afterPolicyChange] = await direct.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM auth_session AS session
         INNER JOIN auth_user AS user ON user.id = session.user_id
         WHERE user.email = ?`,
        [policyExemptEmail],
      );
      expect(Number(afterPolicyChange[0]?.count ?? -1)).toBe(0);

      const rejected = await authRequest("/sign-in/email", {
        email: policyExemptEmail,
        password,
      });
      expect(rejected.status).toBe(403);
      await expect(rejected.json()).resolves.toMatchObject({
        code: "EMAIL_NOT_VERIFIED",
      });
    });

    it("creates no session until email verification and then supports login", async () => {
      const registrationEmail = "verified-registration@example.com";
      const signUp = await registrationAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            email: registrationEmail,
            name: "Verified Registration",
            password,
            callbackURL: "http://127.0.0.1:3000/email-verification",
          }),
        }),
      );
      expect(signUp.status).toBe(200);
      expect(signUp.headers.getSetCookie()).toHaveLength(0);

      const outbox = (await readFile(outboxFile, "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              readonly recipient: string;
              readonly verificationUrl: string;
            },
        )
        .filter((record) => record.recipient === registrationEmail);
      expect(outbox).toHaveLength(1);

      const beforeVerification = await registrationAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({ email: registrationEmail, password }),
        }),
      );
      expect(beforeVerification.status).toBe(403);
      await expect(beforeVerification.json()).resolves.toMatchObject({
        code: "EMAIL_NOT_VERIFIED",
      });

      const verification = await registrationAuth.handler(
        new Request(outbox[0]?.verificationUrl ?? ""),
      );
      expect(verification.status).toBe(302);
      expect(verification.headers.get("location")).toBe(
        "http://127.0.0.1:3000/email-verification",
      );
      expect(
        verification.headers
          .getSetCookie()
          .some((candidate) => candidate.startsWith("kanvas.session_token=")),
      ).toBe(true);
      const verifiedSessionCookie = verification.headers
        .getSetCookie()
        .find((candidate) => candidate.startsWith("kanvas.session_token="))
        ?.split(";", 1)[0];
      expect(verifiedSessionCookie).toBeTruthy();

      const [verifiedRows] = await direct.query<
        (RowDataPacket & { readonly emailVerified: number })[]
      >(
        `SELECT email_verified AS emailVerified
         FROM auth_user
         WHERE email = ?`,
        [registrationEmail],
      );
      expect(verifiedRows[0]?.emailVerified).toBe(1);

      const currentHuman = await new CurrentHumanContextController(
        createAuthenticationGateway(registrationAuth, database.instanceAccess),
        database,
        new CsrfTokenService(config),
      ).get({
        id: "email-registration-current-human",
        raw: {
          headers: { cookie: verifiedSessionCookie ?? "" },
        },
      } as FastifyRequest);
      expect(currentHuman).toMatchObject({
        authenticated: true,
        human: {
          displayName: "Verified Registration",
          verifiedEmail: registrationEmail,
        },
        workspaces: [],
      });
      expect(currentHuman).not.toHaveProperty("instanceAdministrator");
      const [principalRows] = await direct.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM human_principal AS human
         INNER JOIN auth_user AS user
           ON user.id = human.auth_subject_id
         WHERE user.email = ?`,
        [registrationEmail],
      );
      expect(Number(principalRows[0]?.count ?? 0)).toBe(1);

      const signIn = await registrationAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({ email: registrationEmail, password }),
        }),
      );
      expect(signIn.status).toBe(200);
    });

    it("creates one OIDC identity, no Membership, and supports later login", async () => {
      const oidcEmail = "oidc-registration@example.com";
      stubOidcProvider(oidcEmail);
      const oidcAuth = createAuthenticationEngine({
        config: {
          ...config,
          auth: {
            ...config.auth,
            oauthProviders: [oidcProvider],
          },
        },
        database: {
          defaultAccess: database.defaultAccess,
          authorization: database.authorization,
          db: database.db,
          instanceAccess: {
            registrationAllowed: () => Promise.resolve(true),
            readRegistrationPolicy: () =>
              Promise.resolve({ emailVerificationRequired: true }),
          },
          team: database.team,
        } as unknown as DatabaseRuntime,
      });
      const start = () =>
        oidcAuth.handler(
          new Request("http://127.0.0.1:3000/api/auth/sign-in/oauth2", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://127.0.0.1:3000",
              "x-kanvas-trusted-client-ip": "192.0.2.30",
            },
            body: JSON.stringify({
              providerId: "company",
              callbackURL: "/",
              errorCallbackURL: "/login",
            }),
          }),
        );
      const complete = async (started: Response): Promise<Response> => {
        expect(started.status).toBe(200);
        const authorization = new URL(
          ((await started.json()) as { readonly url: string }).url,
        );
        expect(authorization.searchParams.get("code_challenge_method")).toBe(
          "S256",
        );
        return oidcAuth.handler(
          new Request(
            `http://127.0.0.1:3000/api/auth/oauth2/callback/company?code=integration&state=${authorization.searchParams.get("state") ?? ""}`,
            { headers: { cookie: cookies(started) } },
          ),
        );
      };

      const firstCallback = await complete(await start());
      expect(firstCallback.status).toBe(302);
      expect(firstCallback.headers.get("location")).toBe("/");
      const currentHuman = await new CurrentHumanContextController(
        createAuthenticationGateway(oidcAuth, database.instanceAccess),
        database,
        new CsrfTokenService(config),
      ).get({
        id: "oidc-registration-current-human",
        raw: { headers: { cookie: cookies(firstCallback) } },
      } as FastifyRequest);
      expect(currentHuman).toMatchObject({
        authenticated: true,
        human: {
          displayName: "OIDC Registration",
          verifiedEmail: oidcEmail,
        },
        workspaces: [],
      });

      const secondCallback = await complete(await start());
      expect(secondCallback.status).toBe(302);
      expect(secondCallback.headers.get("location")).toBe("/");
      const [identityRows] = await direct.query<
        (RowDataPacket & {
          readonly accounts: number | string;
          readonly memberships: number | string;
          readonly principals: number | string;
          readonly users: number | string;
        })[]
      >(
        `SELECT
           (SELECT COUNT(*) FROM auth_user WHERE email = ?) AS users,
           (
             SELECT COUNT(*)
             FROM auth_account AS account
             INNER JOIN auth_user AS user ON user.id = account.user_id
             WHERE user.email = ? AND account.provider_id = 'company'
           ) AS accounts,
           (
             SELECT COUNT(*)
             FROM human_principal AS human
             INNER JOIN auth_user AS user ON user.id = human.auth_subject_id
             WHERE user.email = ?
           ) AS principals,
           (
             SELECT COUNT(*)
             FROM workspace_membership AS membership
             INNER JOIN human_principal AS human
               ON human.principal_id = membership.principal_id
             INNER JOIN auth_user AS user ON user.id = human.auth_subject_id
             WHERE user.email = ?
           ) AS memberships`,
        [oidcEmail, oidcEmail, oidcEmail, oidcEmail],
      );
      expect(identityRows[0]).toMatchObject({
        users: 1,
        accounts: 1,
        principals: 1,
        memberships: 0,
      });
    });

    it("creates, resolves and revokes a database session without fingerprint metadata", async () => {
      const signIn = await auth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
            "user-agent": "must-not-be-persisted",
            "x-forwarded-for": "192.0.2.1",
            "x-kanvas-trusted-client-ip": "192.0.2.20",
          },
          body: JSON.stringify({
            email,
            password,
          }),
        }),
      );
      expect(signIn.status).toBe(200);
      const sessionCookie = signIn.headers
        .getSetCookie()
        .find((candidate) => candidate.startsWith("kanvas.session_token="))
        ?.split(";", 1)[0];
      expect(sessionCookie).toBeTruthy();

      const headers = new Headers({
        cookie: sessionCookie ?? "",
      });
      const session = await auth.api.getSession({
        headers,
        query: {
          disableCookieCache: true,
          disableRefresh: true,
        },
      });
      expect(session?.user.email).toBe(email);
      expect(session?.session.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);

      const [privacyRows] = await direct.query<SessionPrivacyRow[]>(
        `SELECT
           session.id,
           session.ip_address AS ipAddress,
           session.user_agent AS userAgent
         FROM auth_session AS session
         INNER JOIN auth_user AS user
           ON user.id = session.user_id
         WHERE user.email = ?`,
        [email],
      );
      expect(privacyRows).toHaveLength(1);
      expect(privacyRows[0]).toMatchObject({
        ipAddress: null,
        userAgent: null,
      });

      const signOut = await auth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-out", {
          method: "POST",
          headers: {
            cookie: sessionCookie ?? "",
            origin: "http://127.0.0.1:3000",
            "x-kanvas-trusted-client-ip": "192.0.2.20",
          },
        }),
      );
      expect(signOut.status).toBe(200);
      await expect(
        auth.api.getSession({
          headers,
          query: {
            disableCookieCache: true,
            disableRefresh: true,
          },
        }),
      ).resolves.toBeNull();
    });
    it("verifies email, assigns default operator access, and preserves invitations and later revocation", async () => {
      const now = new Date();
      const adminId = ulid();
      const orgId = ulid();
      const workspaceId = ulid();
      const adminUser = await (
        await auth.$context
      ).internalAdapter.createUser({
        email: "default-policy-admin@example.com",
        emailVerified: true,
        name: "Policy admin",
      });
      await database.authorization.resolveHumanPrincipal({
        principalId: adminId,
        authSubjectId: adminUser.id,
        now,
        audit: {
          auditEventId: ulid(),
          authenticationRefHash: `sha256:${"a".repeat(64)}`,
        },
      });
      await direct.execute(
        "INSERT INTO instance_administrator (principal_id,status,version,created_at,updated_at) VALUES (?,'active',1,?,?)",
        [adminId, now, now],
      );
      await direct.execute(
        "INSERT INTO organization (id,slug,name,status,version,created_at,updated_at) VALUES (?,?,'Internal','active',1,?,?)",
        [orgId, orgId.toLowerCase(), now, now],
      );
      await direct.execute(
        "INSERT INTO workspace (id,organization_id,slug,name,status,version,created_at,updated_at) VALUES (?,?,?,'Public','active',1,?,?)",
        [workspaceId, orgId, workspaceId.toLowerCase(), now, now],
      );
      await database.defaultAccess.updatePolicy(
        {
          instanceId: "auth-integration",
          principalId: adminId,
          principalType: "human",
          authenticationRefType: "session",
          authenticationRefId: "admin-session",
          authorityType: "instance_administrator",
          authorityId: adminId,
          authorityVersion: 1,
          authorizationModelVersion: 1,
          trusted: true,
        },
        {
          enabled: true,
          workspaceId,
          role: "operator",
          oidcProviderIds: ["company"],
          verifiedDomains: ["example.com"],
          version: 0,
        },
        {
          auditEventId: ulid(),
          authenticationRefHash: `sha256:${"a".repeat(64)}`,
        },
      );
      const newEmail = "default-operator@example.com";
      const signUp = await registrationAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            email: newEmail,
            name: "Default operator",
            password,
            callbackURL: "http://127.0.0.1:3000/",
          }),
        }),
      );
      expect(signUp.status).toBe(200);
      const [before] = await direct.query<RowDataPacket[]>(
        "SELECT e.source,e.state FROM default_access_enrollment e JOIN auth_user u ON u.id=e.auth_subject_id WHERE u.email=?",
        [newEmail],
      );
      expect(before[0]).toMatchObject({ source: "self", state: "pending" });
      const verify = async (address: string) => {
        const entry = (await readFile(outboxFile, "utf8"))
          .trim()
          .split("\n")
          .map(
            (line) =>
              JSON.parse(line) as {
                recipient: string;
                verificationUrl: string;
              },
          )
          .findLast((entry) => entry.recipient === address);
        expect(entry).toBeDefined();
        return registrationAuth.handler(
          new Request(entry?.verificationUrl ?? ""),
        );
      };
      const verified = await verify(newEmail);
      expect(verified.status).toBe(302);
      const gateway = createAuthenticationGateway(
        registrationAuth,
        database.instanceAccess,
      );
      const headers = new Headers({ cookie: cookies(verified) });
      const identity = await gateway.resolveBrowserSession(headers);
      expect(identity).not.toBeNull();
      const contextController = new CurrentHumanContextController(
        gateway,
        database,
        new CsrfTokenService(config),
      );
      const current = await contextController.get({
        raw: { headers: { cookie: cookies(verified) } },
        id: "default-access-current",
      } as FastifyRequest);
      expect(current.defaultAccess).toEqual({
        state: "granted",
        reason: "assigned",
      });
      expect(current.workspaces).toEqual([
        expect.objectContaining({
          id: workspaceId,
          membership: expect.objectContaining({ role: "operator" }) as unknown,
        }),
      ]);
      for (const permission of [
        "canvas.write",
        "asset.write",
        "workflow.run",
        "agent.run",
        "credential.invoke",
      ] as const) {
        expect(
          await database.authorization.resolveHumanWorkspaceScope({
            authSubjectId: identity?.authSubjectId ?? "",
            sessionId: identity?.sessionId ?? "",
            requestedWorkspaceId: workspaceId,
            requiredPermission: permission,
            now: new Date(),
          }),
        ).toMatchObject({ status: "authorized" });
      }
      expect(
        await database.authorization.resolveHumanWorkspaceScope({
          authSubjectId: identity?.authSubjectId ?? "",
          sessionId: identity?.sessionId ?? "",
          requestedWorkspaceId: workspaceId,
          requiredPermission: "membership.manage",
          now: new Date(),
        }),
      ).toMatchObject({ status: "forbidden" });
      const inviteEmail = "default-invited@example.com";
      expect(
        await gateway.registerInvitationEmailAccount?.({
          email: inviteEmail,
          displayName: "Invited",
          password,
          verificationCallbackUrl: "http://127.0.0.1:3000/",
        }),
      ).toBe("created");
      const invited = await verify(inviteEmail);
      expect(invited.status).toBe(302);
      const invitedContext = await contextController.get({
        raw: { headers: { cookie: cookies(invited) } },
        id: "default-access-invited",
      } as FastifyRequest);
      expect(invitedContext.defaultAccess?.state).toBe("excluded");
      expect(invitedContext.workspaces).toEqual([]);
      await direct.execute(
        "UPDATE workspace_membership SET status='revoked',version=version+1 WHERE principal_id=?",
        [current.human.principalId],
      );
      const again = await registrationAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({ email: newEmail, password }),
        }),
      );
      expect(again.status).toBe(200);
      expect(
        (
          await contextController.get({
            raw: { headers: { cookie: cookies(again) } },
            id: "default-access-revoked",
          } as FastifyRequest)
        ).workspaces,
      ).toEqual([]);
    });
    it("uses the trusted OIDC registration source even when its email domain differs", async () => {
      const address = "default-oidc@external.test";
      stubOidcProvider(address, "default-oidc-subject");
      const oidcAuth = createAuthenticationEngine({
        config: {
          ...config,
          auth: { ...config.auth, oauthProviders: [oidcProvider] },
        },
        database: {
          ...database,
          instanceAccess: {
            ...database.instanceAccess,
            registrationAllowed: () => Promise.resolve(true),
          },
        },
      });
      const started = await oidcAuth.handler(
        new Request("http://127.0.0.1:3000/api/auth/sign-in/oauth2", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({
            providerId: "company",
            callbackURL: "/",
            errorCallbackURL: "/login",
          }),
        }),
      );
      expect(started.status).toBe(200);
      const url = new URL(((await started.json()) as { url: string }).url);
      const completed = await oidcAuth.handler(
        new Request(
          `http://127.0.0.1:3000/api/auth/oauth2/callback/company?code=integration&state=${url.searchParams.get("state") ?? ""}`,
          { headers: { cookie: cookies(started) } },
        ),
      );
      expect(completed.status).toBe(302);
      expect(completed.headers.get("location")).toBe("/");
      const current = await new CurrentHumanContextController(
        createAuthenticationGateway(oidcAuth, database.instanceAccess),
        database,
        new CsrfTokenService(config),
      ).get({
        raw: { headers: { cookie: cookies(completed) } },
        id: "default-access-oidc",
      } as FastifyRequest);
      expect(current.defaultAccess?.state).toBe("granted");
      expect(current.workspaces[0]?.membership.role).toBe("operator");
      const [enrollment] = await direct.execute<RowDataPacket[]>(
        "SELECT e.source,e.provider_id AS providerId FROM default_access_enrollment e JOIN auth_user u ON u.id=e.auth_subject_id WHERE u.email=?",
        [address],
      );
      expect(enrollment[0]).toMatchObject({
        source: "self",
        providerId: "company",
      });
    });
  },
);
