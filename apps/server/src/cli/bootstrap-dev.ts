#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";

import {
  createDatabaseRuntime,
  loadDefaultCatalogPackageV1,
  type DatabaseConnectionConfig,
} from "@kanvas/database";
import { defaultAgentWorkspaceProfileV1 } from "@kanvas/application";
import { digestProviderValue } from "@kanvas/database/runtime";
import {
  digestInstanceSetupBinding,
  digestInstanceSetupToken,
  InstanceBootstrapStoreError,
  instanceSetupTokenPrefix,
} from "@kanvas/database/runtime";
import { createPool, type RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";

import { createAuthenticationEngine } from "../auth/authentication-engine.js";
import { loadServerConfig } from "../config.js";
import { loadDevelopmentBootstrapConfig } from "./dev-bootstrap-config.js";

interface ActiveAdministratorRow extends RowDataPacket {
  readonly authSubjectId: string;
  readonly email: string | null;
  readonly workspaceMemberships: number | string;
}

interface ActiveAdministrator {
  readonly authSubjectId: string;
  readonly email: string | null;
  readonly hasDevelopmentWorkspace: boolean;
}

async function readActiveAdministrator(
  connection: DatabaseConnectionConfig,
  workspaceId: string,
): Promise<ActiveAdministrator | undefined> {
  const pool = createPool({
    ...connection,
    connectionLimit: 1,
    timezone: "Z",
    decimalNumbers: false,
  });
  try {
    const [rows] = await pool.execute<ActiveAdministratorRow[]>(
      `SELECT
         human.auth_subject_id AS authSubjectId,
         auth.email AS email,
         (
           SELECT COUNT(*)
           FROM workspace_membership AS membership
           WHERE membership.principal_id = administrator.principal_id
             AND membership.workspace_id = ?
             AND membership.status = 'active'
         ) AS workspaceMemberships
       FROM instance_administrator AS administrator
       INNER JOIN human_principal AS human
         ON human.principal_id = administrator.principal_id
       LEFT JOIN auth_user AS auth
         ON auth.id = human.auth_subject_id
       WHERE administrator.status = 'active'
       ORDER BY administrator.principal_id
       LIMIT 1`,
      [workspaceId],
    );
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return Object.freeze({
      authSubjectId: row.authSubjectId,
      email: row.email,
      hasDevelopmentWorkspace: Number(row.workspaceMemberships) > 0,
    });
  } finally {
    await pool.end();
  }
}

function authenticationReferenceHash(sessionId: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:authentication-ref:v1\0")
    .update(sessionId)
    .digest("hex")}`;
}

function setupToken(): string {
  return `knv_setup_v1_${randomBytes(32).toString("base64url")}`;
}

const server = loadServerConfig(process.env, []);
const bootstrap = loadDevelopmentBootstrapConfig(process.env, server);
const existingAdministrator = await readActiveAdministrator(
  server.database,
  server.demo.workspaceId,
);

if (
  existingAdministrator &&
  existingAdministrator.email?.toLocaleLowerCase("en-US") !== bootstrap.email
) {
  throw new Error(
    "The development instance is already initialized by a different authentication identity.",
  );
}
if (existingAdministrator && !existingAdministrator.hasDevelopmentWorkspace) {
  throw new Error(
    "The existing development administrator is missing the configured development Workspace membership.",
  );
}

const initialCatalog = await loadDefaultCatalogPackageV1();
const database = createDatabaseRuntime({
  connection: server.database,
  instanceId: server.instanceId,
  initialCatalog,
  enabledExecutionTargets: server.enabledExecutionTargets,
  ...(server.providerDeploymentHardBounds
    ? {
        providerDeploymentHardBounds: server.providerDeploymentHardBounds,
      }
    : {}),
});

try {
  const auth = createAuthenticationEngine({
    config: server,
    database,
  });
  const context = await auth.$context;
  const existingUser = await context.internalAdapter.findUserByEmail(
    bootstrap.email,
    {
      includeAccounts: true,
    },
  );
  const passwordHash = await context.password.hash(bootstrap.password);
  const user = existingUser
    ? await context.internalAdapter.updateUser(existingUser.user.id, {
        name: bootstrap.displayName,
        emailVerified: true,
      })
    : await context.internalAdapter.createUser({
        email: bootstrap.email,
        emailVerified: true,
        name: bootstrap.displayName,
      });
  if (
    existingAdministrator &&
    existingAdministrator.authSubjectId !== user.id
  ) {
    throw new Error(
      "The configured development administrator email resolves to an unexpected authentication identity.",
    );
  }
  const credentialAccount = existingUser?.accounts.find(
    (account) => account.providerId === "credential",
  );
  if (credentialAccount) {
    await context.internalAdapter.updatePassword(user.id, passwordHash);
  } else {
    await context.internalAdapter.createAccount({
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: passwordHash,
    });
  }
  await context.internalAdapter.deleteUserSessions(user.id);

  let initialized = false;
  if (!existingAdministrator) {
    const signIn = await auth.handler(
      new Request(
        new URL(`${server.auth.basePath}/sign-in/email`, server.auth.baseUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: new URL(server.auth.baseUrl).origin,
            "x-forwarded-for": "127.0.0.1",
          },
          body: JSON.stringify({
            email: bootstrap.email,
            password: bootstrap.password,
          }),
        },
      ),
    );
    if (!signIn.ok) {
      throw new Error(
        `Development administrator sign-in verification failed with HTTP ${String(signIn.status)}.`,
      );
    }
    const sessionCookie = signIn.headers
      .getSetCookie()
      .find((candidate) => candidate.startsWith("kanvas.session_token="))
      ?.split(";", 1)[0];
    if (!sessionCookie) {
      throw new Error(
        "Development administrator sign-in did not create a session cookie.",
      );
    }
    const session = await auth.api.getSession({
      headers: new Headers({
        cookie: sessionCookie,
      }),
      query: {
        disableCookieCache: true,
        disableRefresh: true,
      },
    });
    if (!session || session.user.id !== user.id) {
      throw new Error(
        "Development administrator sign-in did not resolve the expected user.",
      );
    }

    const rawSetupToken = setupToken();
    const now = new Date();
    try {
      await database.instanceBootstrap.issueSetupToken({
        setupTokenId: ulid(),
        tokenPrefix: instanceSetupTokenPrefix(rawSetupToken),
        tokenHash: digestInstanceSetupToken(rawSetupToken),
        hashVersion: 1,
        bindingMode: "auth_subject",
        bindingHash: digestInstanceSetupBinding("auth_subject", user.id),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        now,
        auditEventId: ulid(),
      });
      await database.instanceBootstrap.redeemSetupToken({
        tokenHash: digestInstanceSetupToken(rawSetupToken),
        authSubjectId: user.id,
        verifiedEmail: bootstrap.email,
        principalId: ulid(),
        organizationId: server.demo.workspaceId,
        organizationMembershipId: ulid(),
        organizationSlug: bootstrap.organizationSlug,
        organizationName: bootstrap.organizationName,
        workspaceId: server.demo.workspaceId,
        workspaceMembershipId: ulid(),
        workspaceSlug: bootstrap.workspaceSlug,
        workspaceName: bootstrap.workspaceName,
        now: new Date(),
        authenticationRefHash: authenticationReferenceHash(session.session.id),
        requestId: "development-bootstrap",
        auditEventId: ulid(),
      });
      initialized = true;
    } finally {
      await context.internalAdapter.deleteSession(session.session.token);
    }
  }

  const profileNow = new Date();
  const profileResolution =
    await database.authorization.resolveHumanWorkspaceScope({
      authSubjectId: user.id,
      sessionId: "development-bootstrap-agent-profile",
      requestedWorkspaceId: server.demo.workspaceId,
      requiredPermission: "workspace.manage",
      now: profileNow,
    });
  if (profileResolution.status !== "authorized") {
    throw new Error(
      "Development Agent Profile initialization is not authorized.",
    );
  }
  const agentProfile = await database.agentProfilePublications.publish({
    authority: profileResolution.scope,
    agentDefinitionId: ulid(),
    profileRevisionId: ulid(),
    managementKind: "system",
    profile: defaultAgentWorkspaceProfileV1,
    now: profileNow,
    audit: {
      auditEventId: ulid(),
      actorPrincipalId: profileResolution.scope.principalId,
      actorType: profileResolution.scope.principalType,
      authenticationRefType: profileResolution.scope.authenticationRefType,
      authenticationRefHash: digestProviderValue({
        bootstrap: "development-agent-profile",
      }),
      authorityType: profileResolution.scope.authorityType,
      authorityId: profileResolution.scope.authorityId,
      authorityVersion: profileResolution.scope.authorityVersion,
      requestId: "development-bootstrap-agent-profile",
    },
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        environment: server.environment,
        administrator: {
          email: bootstrap.email,
          userCreated: existingUser === null,
          credentialsUpdated: existingUser !== null,
        },
        instanceInitialized: initialized,
        organization: {
          id: server.demo.workspaceId,
          slug: bootstrap.organizationSlug,
          name: bootstrap.organizationName,
        },
        workspace: {
          id: server.demo.workspaceId,
          slug: bootstrap.workspaceSlug,
          name: bootstrap.workspaceName,
        },
        agentProfile: {
          key: agentProfile.profileKey,
          revision: agentProfile.revision,
        },
        passwordSource: "KANVAS_DEV_ADMIN_PASSWORD",
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  if (
    error instanceof InstanceBootstrapStoreError &&
    error.code === "instance_bootstrap.already_initialized"
  ) {
    throw new Error(
      "The development instance was initialized concurrently. Re-run bootstrap:dev to verify the configured administrator.",
      {
        cause: error,
      },
    );
  }
  throw error;
} finally {
  await database.close();
}
