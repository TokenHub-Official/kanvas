import {
  createApplicationRuntime,
  type ApplicationRuntime,
  type RuntimeStateReader,
} from "@kanvas/application";
import type { AuthorizationStore } from "@kanvas/database";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule, type ServerDatabaseRuntime } from "../src/app.module.js";
import type { ServerConfig } from "../src/config.js";
import type { AuthenticationGateway } from "../src/auth/authentication-gateway.js";

const activeStateReader: RuntimeStateReader = {
  read: () =>
    Promise.resolve({
      state: "ACTIVE",
      executionGeneration: 1,
      stateVersion: 1,
    }),
};

const config: ServerConfig = {
  environment: "test",
  instanceId: "server-integration-test",
  host: "127.0.0.1",
  port: 3000,
  trustedProxyHops: 0,
  trustedProxyCidrs: ["127.0.0.1/32", "::1/128"],
  serviceVersion: "0.0.0-test",
  cancellationGraceMs: 30_000,
  demo: {
    enabled: true,
    workspaceId: "01K00000000000000000000000",
    actorId: "01K00000000000000000000001",
  },
  database: {
    host: "127.0.0.1",
    port: 3306,
    database: "kanvas",
    user: "kanvas",
    password: "test-only",
    connectionLimit: 1,
  },
  enabledExecutionTargets: ["worker"],
  providerSecrets: {
    deploymentSecretFiles: {},
    kekFiles: {},
  },
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
  browserExecutor: {
    enabled: false,
    controlPlaneVersion: 1,
    sessionTtlSeconds: 3_600,
    attemptLeaseDurationMs: 30_000,
    candidateLimit: 20,
  },
  checkConfigOnly: false,
};

const authenticationGateway: AuthenticationGateway = {
  resolveBrowserSession: () => Promise.resolve(null),
  revokeSession: () => Promise.resolve(false),
  revokeAllHumanSessions: () => Promise.resolve(),
  getVerifiedContact: () => Promise.resolve(null),
};

const unusedAuthorization = {
  resolveHumanPrincipal: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
  resolveHumanWorkspaceScope: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
  resolveServiceWorkspaceScope: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
  listHumanWorkspaceContexts: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
  changeWorkspaceMembership: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
  changeWorkspaceMemberships: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
  addExistingWorkspaceMember: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
  changeOrganizationMembership: () =>
    Promise.reject(new Error("Authorization must not run in demo mode.")),
} satisfies AuthorizationStore;

describe("AppModule route and lifecycle composition", () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("registers Contract routes, returns 200 and owns shutdown resources", async () => {
    let databaseClosed = false;
    let telemetryClosed = false;
    const database: ServerDatabaseRuntime = {
      authorization: unusedAuthorization,
      instanceAccess: {} as ServerDatabaseRuntime["instanceAccess"],
      defaultAccess: {} as ServerDatabaseRuntime["defaultAccess"],
      runtimeConfiguration: {} as ServerDatabaseRuntime["runtimeConfiguration"],
      providerResultRecovery:
        {} as ServerDatabaseRuntime["providerResultRecovery"],
      siteTools: {} as ServerDatabaseRuntime["siteTools"],
      siteToolImages: {} as ServerDatabaseRuntime["siteToolImages"],
      siteCovers: {} as ServerDatabaseRuntime["siteCovers"],
      toolSessions: {} as ServerDatabaseRuntime["toolSessions"],
      agentHub: {} as ServerDatabaseRuntime["agentHub"],
      agentFoundation: {} as ServerDatabaseRuntime["agentFoundation"],
      agentProfilePublications:
        {} as ServerDatabaseRuntime["agentProfilePublications"],
      agentRuntime: {} as ServerDatabaseRuntime["agentRuntime"],
      publicationGovernance:
        {} as ServerDatabaseRuntime["publicationGovernance"],
      skillLibrary: {} as ServerDatabaseRuntime["skillLibrary"],
      skillPackageImports: {} as ServerDatabaseRuntime["skillPackageImports"],
      resourceSources: {} as ServerDatabaseRuntime["resourceSources"],
      modelResources: {} as ServerDatabaseRuntime["modelResources"],
      modelResourceImports: {} as ServerDatabaseRuntime["modelResourceImports"],
      secretVersions: {} as ServerDatabaseRuntime["secretVersions"],
      workspaceBrand: {} as ServerDatabaseRuntime["workspaceBrand"],
      resourceLibraries: {} as ServerDatabaseRuntime["resourceLibraries"],
      content: {} as ServerDatabaseRuntime["content"],
      atomicAttemptCompletions: {
        complete: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
      },
      browserControlPlane: {
        mapAttemptOutput: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
        registerExecutorSession: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
        claimNextAttempt: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
        heartbeatAttempt: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
        authorizeAttemptOutput: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
        acknowledgeAttemptCancellation: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
        drainSession: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
        revokeSession: () =>
          Promise.reject(new Error("Browser execution is not enabled.")),
      },
      storageUploads: {
        recordCompatibilityProbe: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        allocateUploadSession: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        beginUpload: () => Promise.reject(new Error("Storage is not enabled.")),
        beginSeal: () => Promise.reject(new Error("Storage is not enabled.")),
        recordSeal: () => Promise.reject(new Error("Storage is not enabled.")),
        claimVerification: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        recordVerified: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        recordRejected: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        claimNextCleanup: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        finalizeCleanupSuccess: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        finalizeCleanupFailure: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        readAttemptOutputUploadSession: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        readUserImportUploadSession: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        readCanvasExportUploadSession: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        readModelResourceUploadSession: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        readServerPackageUploadSession: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        readAuthorizedCommittedObject: () =>
          Promise.reject(new Error("Storage is not enabled.")),
      },
      contentTransfers: {
        commitRecoveredProviderResult: () =>
          Promise.reject(new Error("Recovery storage is not enabled.")),
        commitUserImport: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        authorizeArtifactDownload: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        revalidateArtifactDownload: () =>
          Promise.reject(new Error("Storage is not enabled.")),
        consumeArtifactContentEvent: () =>
          Promise.reject(new Error("Storage is not enabled.")),
      },
      canvasDrafts: {
        list: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        get: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        getRevision: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        recoverMutation: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        listRevisions: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        create: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        restore: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        update: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
        updateBrand: () =>
          Promise.reject(
            new Error("Canvas Drafts are not expected in this test."),
          ),
      },
      canvasExports: {
        get: () =>
          Promise.reject(
            new Error("Canvas Exports are not expected in this test."),
          ),
        commit: () =>
          Promise.reject(
            new Error("Canvas Exports are not expected in this test."),
          ),
      },
      operationalTimeline: {
        list: () => Promise.resolve({ items: [] }),
        get: () =>
          Promise.reject(
            new Error("Operational Timeline is not expected in this test."),
          ),
      },
      providerSettings: {
        rename: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        createAgentTextModel: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        list: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        resolveSecretWriteIdentity: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        resolveValidationIdentity: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        resolveModelCatalogRefreshIdentity: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        getModelCatalogReview: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        resolveModelCatalogAdoptionIdentity: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        create: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        validate: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        activate: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        rotateSecret: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        refreshModelCatalog: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        adoptModelCatalog: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        disable: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
        delete: () =>
          Promise.reject(
            new Error("Provider settings are not expected in this test."),
          ),
      },
      modelReferences: {} as ServerDatabaseRuntime["modelReferences"],
      modelControlPlane: {} as ServerDatabaseRuntime["modelControlPlane"],
      workspaceUsageSummary: {
        get: () =>
          Promise.reject(
            new Error("Workspace usage is not expected in this test."),
          ),
        updateBudgetLimit: () =>
          Promise.reject(
            new Error(
              "Workspace budget updates are not expected in this test.",
            ),
          ),
      },
      budgetReservations: {} as ServerDatabaseRuntime["budgetReservations"],
      workspaceSettings: {
        get: () =>
          Promise.reject(
            new Error("Workspace settings are not expected in this test."),
          ),
        rename: () =>
          Promise.reject(
            new Error("Workspace settings are not expected in this test."),
          ),
      },
      capabilityDefinitions:
        {} as ServerDatabaseRuntime["capabilityDefinitions"],
      capabilityImplementations:
        {} as ServerDatabaseRuntime["capabilityImplementations"],
      capabilityInstallations:
        {} as ServerDatabaseRuntime["capabilityInstallations"],
      capabilityRuns: {} as ServerDatabaseRuntime["capabilityRuns"],
      capabilityBindingAdmin: {
        list: () =>
          Promise.reject(
            new Error(
              "Capability Binding administration is not expected in this test.",
            ),
          ),
        listProviderRoutes: () =>
          Promise.reject(
            new Error(
              "Capability Binding administration is not expected in this test.",
            ),
          ),
        setStatus: () =>
          Promise.reject(
            new Error(
              "Capability Binding administration is not expected in this test.",
            ),
          ),
        move: () =>
          Promise.reject(
            new Error(
              "Capability Binding administration is not expected in this test.",
            ),
          ),
      },
      instanceBootstrap: {
        inspectSetupToken: () =>
          Promise.reject(
            new Error("Instance setup is not expected in this test."),
          ),
        issueSetupToken: () =>
          Promise.reject(
            new Error("Instance setup is not expected in this test."),
          ),
        redeemSetupToken: () =>
          Promise.reject(
            new Error("Instance setup is not expected in this test."),
          ),
      },
      team: {
        listWorkspaceTeam: () =>
          Promise.reject(
            new Error("Workspace Team is not expected in this test."),
          ),
        resolveInvitation: () =>
          Promise.reject(
            new Error("Workspace Team is not expected in this test."),
          ),
        createWorkspaceInvitation: () =>
          Promise.reject(
            new Error("Workspace Team is not expected in this test."),
          ),
        resendWorkspaceInvitation: () =>
          Promise.reject(
            new Error("Workspace Team is not expected in this test."),
          ),
        revokeWorkspaceInvitation: () =>
          Promise.reject(
            new Error("Workspace Team is not expected in this test."),
          ),
        acceptWorkspaceInvitation: () =>
          Promise.reject(
            new Error("Workspace Team is not expected in this test."),
          ),
      },
      workspaceContentQueries: {
        getAgentAttachmentArtifact: () =>
          Promise.reject(
            new Error("Workspace content query is not expected in this test."),
          ),
        listAssets: () =>
          Promise.reject(
            new Error("Workspace content query is not expected in this test."),
          ),
        getAsset: () =>
          Promise.reject(
            new Error("Workspace content query is not expected in this test."),
          ),
        listCreationEntrypoints: () =>
          Promise.reject(
            new Error("Workspace content query is not expected in this test."),
          ),
        listWorkflowRunArtifacts: () =>
          Promise.reject(
            new Error("Workspace content query is not expected in this test."),
          ),
        listCapabilityRunArtifacts: () =>
          Promise.reject(
            new Error("Workspace content query is not expected in this test."),
          ),
      },
      runtimeStateReader: activeStateReader,
      verifyConnection: () => Promise.resolve(),
      close: () => {
        databaseClosed = true;
        return Promise.resolve();
      },
    };
    const baseRuntime = createApplicationRuntime({
      clock: {
        now: () => new Date("2026-07-27T12:00:00.000Z"),
      },
      runtimeStateReader: activeStateReader,
    });
    const runtime = {
      ...baseRuntime,
      workflow: {
        ...baseRuntime.workflow,
        cancelRun: () =>
          Promise.resolve({
            run: {
              id: "01K00000000000000000000003",
              workspaceId: config.demo.workspaceId,
              lifecycleStatus: "cancelling" as const,
              version: 2,
              cancelRequestedAt: new Date("2026-07-27T12:00:00.000Z"),
              cancelRequestedBy: config.demo.actorId,
              cancelReasonCode: "user_requested" as const,
              cancelDeadlineAt: new Date("2026-07-27T12:00:30.000Z"),
            },
            replayed: false,
          }),
      },
    } satisfies ApplicationRuntime;
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({
        config,
        database,
        authenticationGateway,
        runtime,
        providerSecretDatabaseWriter: {
          readiness: () => ({
            ready: true,
            mode: "plaintext_database",
          }),
          prepare: () =>
            Promise.reject(
              new Error(
                "Provider secret persistence is not expected in this test.",
              ),
            ),
        },
        providerSecretMaterialResolver: {
          withResolvedMaterial: () =>
            Promise.reject(
              new Error(
                "Provider secret resolution is not expected in this test.",
              ),
            ),
        },
        telemetry: {
          shutdown: () => {
            telemetryClosed = true;
            return Promise.resolve();
          },
        },
      }),
      new FastifyAdapter(),
      {
        logger: false,
      },
    );
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();
    for (const [method, url] of [
      ["GET", "/api/v1/instance/default-access"],
      ["GET", "/api/v1/instance/default-access/preview"],
      ["POST", "/api/v1/default-access/retry"],
    ] as const) {
      expect(fastify.hasRoute({ method, url })).toBe(true);
      const rejected = await fastify.inject({ method, url });
      expect(rejected.statusCode).toBe(401);
    }

    expect(
      fastify.hasRoute({ method: "GET", url: "/api/v1/task-records" }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "GET",
        url: "/api/v1/task-records/:kind/:taskRunId/timeline",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "GET",
        url: "/health/live",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "GET",
        url: "/api/v1/workflow-runs/:workflowRunId/operational-timeline",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "POST",
        url: "/api/v1/workflow-topologies/validate",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "GET",
        url: "/api/v1/auth/session-context",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "POST",
        url: "/api/v1/instance/setup/redemptions",
      }),
    ).toBe(true);
    for (const route of [
      "/api/v1/browser-executor-sessions",
      "/api/v1/browser-executor-sessions/:browserExecutorSessionId/claim",
      "/api/v1/browser-executor-sessions/:browserExecutorSessionId/drain",
      "/api/v1/browser-executor-sessions/:browserExecutorSessionId/revoke",
      "/api/v1/browser-executor-sessions/:browserExecutorSessionId/assignments/:browserAssignmentId/heartbeat",
      "/api/v1/browser-executor-sessions/:browserExecutorSessionId/assignments/:browserAssignmentId/output-upload-sessions",
      "/api/v1/browser-executor-sessions/:browserExecutorSessionId/assignments/:browserAssignmentId/complete",
      "/api/v1/browser-executor-sessions/:browserExecutorSessionId/assignments/:browserAssignmentId/cancellation-acknowledgement",
    ]) {
      expect(
        fastify.hasRoute({
          method: "POST",
          url: route,
        }),
      ).toBe(true);
    }
    expect(
      fastify.hasRoute({
        method: "PUT",
        url: "/api/v1/browser-executor-sessions/:browserExecutorSessionId/assignments/:browserAssignmentId/output-upload-sessions/:uploadSessionId/content",
      }),
    ).toBe(true);
    for (const route of [
      "/api/v1/user-import-upload-sessions",
      "/api/v1/user-import-upload-sessions/:uploadSessionId/commit",
    ]) {
      expect(
        fastify.hasRoute({
          method: "POST",
          url: route,
        }),
      ).toBe(true);
    }
    expect(
      fastify.hasRoute({
        method: "PUT",
        url: "/api/v1/user-import-upload-sessions/:uploadSessionId/content",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "GET",
        url: "/api/v1/artifacts/:artifactId/content",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "POST",
        url: "/api/v1/workflow-runs",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "GET",
        url: "/api/v1/workflow-runs/:workflowRunId",
      }),
    ).toBe(true);
    expect(
      fastify.hasRoute({
        method: "POST",
        url: "/api/v1/workflow-runs/:workflowRunId/cancel",
      }),
    ).toBe(true);

    const taskRecordsResponse = await fastify.inject({
      method: "GET",
      url: "/api/v1/task-records?limit=50&status=failed",
    });
    expect(taskRecordsResponse.statusCode).toBe(200);
    expect(taskRecordsResponse.json()).toEqual({ items: [] });
    const invalidTaskQuery = await fastify.inject({
      method: "GET",
      url: "/api/v1/task-records?limit=101",
    });
    expect(invalidTaskQuery.statusCode).toBe(400);
    const liveResponse = await fastify.inject({
      method: "GET",
      url: "/health/live",
    });
    expect(liveResponse.statusCode).toBe(200);
    expect(liveResponse.json()).toEqual({
      status: "ok",
      serviceVersion: "0.0.0-test",
      processRole: "server",
    });

    const sessionContextResponse = await fastify.inject({
      method: "GET",
      url: "/api/v1/auth/session-context",
    });
    expect(sessionContextResponse.statusCode).toBe(401);

    const response = await fastify.inject({
      method: "POST",
      url: "/api/v1/workflow-topologies/validate",
      payload: {
        schemaVersion: 1,
        key: "foundation_probe",
        entryNodeKey: "validate",
        limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
        nodes: [
          {
            key: "validate",
            kind: "invoke",
            capability: {
              contractId: "foundation.validate",
              revision: 1,
              canonicalDigest: `sha256:${"a".repeat(64)}`,
            },
            input: {},
            next: [],
          },
        ],
        outputs: {},
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      valid: true,
      diagnostics: [],
    });

    const cancelResponse = await fastify.inject({
      method: "POST",
      url: "/api/v1/workflow-runs/01K00000000000000000000003/cancel",
      payload: {
        reasonCode: "user_requested",
      },
    });
    expect(cancelResponse.statusCode).toBe(202);
    expect(cancelResponse.json()).toEqual({
      id: "01K00000000000000000000003",
      lifecycleStatus: "cancelling",
      version: 2,
      cancelRequestedAt: "2026-07-27T12:00:00.000Z",
      cancelReasonCode: "user_requested",
      cancelDeadlineAt: "2026-07-27T12:00:30.000Z",
      replayed: false,
    });

    await app.close();
    app = undefined;
    expect(databaseClosed).toBe(true);
    expect(telemetryClosed).toBe(true);
  });
});
