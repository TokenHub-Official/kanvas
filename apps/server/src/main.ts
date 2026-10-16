import { createTrustedProxyPolicy } from "./trusted-proxy.js";
import "reflect-metadata";

import { systemClock, createApplicationRuntime } from "@kanvas/application";
import {
  createDatabaseRuntime,
  loadDefaultCatalogPackageV1,
} from "@kanvas/database";
import { NestFactory } from "@nestjs/core";
import { ulid } from "ulid";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  createProviderSecretDatabaseWriter,
  createProviderSecretMaterialResolver,
} from "@kanvas/secrets";

import { AppModule } from "./app.module.js";
import {
  createWorkflowExecutionDependencies,
  createJsonSchemaInputValidator,
  createWorkflowApprovalDecisionPort,
  createWorkflowPublicationPort,
} from "./application-adapters.js";
import { createAuthenticationEngine } from "./auth/authentication-engine.js";
import { createAuthenticationGateway } from "./auth/authentication-gateway.js";
import { registerAuthenticationHttpBridge } from "./auth/authentication-http-bridge.js";
import { verifyOidcDeploymentProviders } from "./auth/oidc-deployment-check.js";
import { loadServerConfig } from "./config.js";
import { createLogger, startTelemetry } from "./observability.js";
import { registerSiteToolUploadLimit } from "./http/site-tool-upload-limit.js";
import { registerRawUploadContentParser } from "./http/raw-upload-content-parser.js";
import { createServerStorageRuntime } from "./storage/server-storage-runtime.js";

const config = loadServerConfig(process.env, process.argv.slice(2));
const logger = createLogger(config);
const telemetry = startTelemetry(config, logger);

if (config.checkConfigOnly) {
  // Keep provider network validation explicit; normal startup remains available
  // during a temporary identity-provider outage.
  await verifyOidcDeploymentProviders(config.auth.oauthProviders);
  logger.info("Server deployment configuration is valid.");
  await telemetry.shutdown();
} else {
  const initialCatalog = await loadDefaultCatalogPackageV1();
  const database = createDatabaseRuntime({
    connection: config.database,
    ...(config.resultDownloadDeployment
      ? { resultDownloadDeployment: config.resultDownloadDeployment }
      : {}),
    instanceId: config.instanceId,
    initialCatalog,
    enabledExecutionTargets: config.enabledExecutionTargets,
    boundedWorkflowOrchestrator: {
      ids: { next: () => ulid() },
      schemaValidation: createJsonSchemaInputValidator(),
    },
    ...(config.agentDevelopmentSkillFiles
      ? { agentDevelopmentSkillFiles: config.agentDevelopmentSkillFiles }
      : {}),
    ...(config.providerDeploymentHardBounds
      ? {
          providerDeploymentHardBounds: config.providerDeploymentHardBounds,
        }
      : {}),
  });

  try {
    await database.verifyConnection();
    const authentication = createAuthenticationEngine({
      config,
      database,
    });
    const authenticationGateway = createAuthenticationGateway(
      authentication,
      database.instanceAccess,
    );
    const workflowExecution = createWorkflowExecutionDependencies(
      database.workflowExecution,
      config.cancellationGraceMs,
    );
    if (!database.boundedWorkflowOrchestrator) {
      throw new Error("Workflow approval decision runtime is unavailable.");
    }
    const runtime = createApplicationRuntime({
      clock: systemClock,
      runtimeStateReader: database.runtimeStateReader,
      workflowExecution,
      workflowRunQueries: database.workflowRunQueries,
      workflowApprovals: {
        queries: database.workflowRunQueries,
        decisions: createWorkflowApprovalDecisionPort(
          database.boundedWorkflowOrchestrator,
        ),
      },
      workflowAuthoring: {
        repository: database.workflowAuthoring,
        nextId: () => workflowExecution.ids.next(),
      },
      workflowPublication: {
        port: createWorkflowPublicationPort(database.publicationGovernance),
        nextId: () => workflowExecution.ids.next(),
      },
      workflowCatalog: database.workflowCatalog,
      workspaceBrand: {
        repository: database.workspaceBrand,
        nextId: () => workflowExecution.ids.next(),
      },
    });
    const providerSecretDatabaseWriter = createProviderSecretDatabaseWriter({
      ...(config.providerSecrets.activeKekVersion
        ? {
            activeKekVersion: config.providerSecrets.activeKekVersion,
          }
        : {}),
      kekFiles: config.providerSecrets.kekFiles,
      ...(config.providerSecrets.kekValues
        ? { kekValues: config.providerSecrets.kekValues }
        : {}),
    });
    const providerSecretMaterialResolver = createProviderSecretMaterialResolver(
      {
        deploymentSecretFiles: config.providerSecrets.deploymentSecretFiles,
        kekFiles: config.providerSecrets.kekFiles,
        ...(config.providerSecrets.kekValues
          ? { kekValues: config.providerSecrets.kekValues }
          : {}),
      },
    );
    const fastifyAdapter = new FastifyAdapter({
      routerOptions: {
        ignoreTrailingSlash: true,
      },
      trustProxy: createTrustedProxyPolicy(
        config.trustedProxyHops,
        config.trustedProxyCidrs,
      ),
    });
    registerRawUploadContentParser(fastifyAdapter.getInstance());
    registerSiteToolUploadLimit(fastifyAdapter.getInstance());
    const storage = config.storage
      ? await createServerStorageRuntime({
          config: config.storage,
          store: database.storageUploads,
          adapterVersion: config.serviceVersion,
        })
      : undefined;
    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({
        config,
        database,
        authenticationGateway,
        runtime,
        providerSecretDatabaseWriter,
        providerSecretMaterialResolver,
        ...(storage ? { storage } : {}),
        telemetry,
      }),
      fastifyAdapter,
      {
        logger: false,
      },
    );
    registerAuthenticationHttpBridge(
      fastifyAdapter.getInstance(),
      authentication,
      {
        baseUrl: config.auth.baseUrl,
        basePath: config.auth.basePath,
        loginConfiguration: config.auth,
        readRegistrationPolicy: () =>
          database.instanceAccess.readRegistrationPolicy(),
      },
    );
    app.enableShutdownHooks();
    await app.listen(config.port, config.host);
    logger.info(
      {
        host: config.host,
        port: config.port,
      },
      "Kanvas server is listening.",
    );
  } catch (error) {
    logger.error(
      {
        errorType: error instanceof Error ? error.name : "unknown",
      },
      "Kanvas server startup failed.",
    );
    await database.close();
    await telemetry.shutdown();
    process.exitCode = 1;
  }
}
