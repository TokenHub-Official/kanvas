import { ProviderResultRecoveryLoop } from "./provider/provider-result-recovery-loop.js";
import { RuntimeConfigurationObserver } from "./provider/runtime-configuration-observer.js";
import type { ProviderInvocationClaim } from "@kanvas/database/runtime";
import "reflect-metadata";

import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";

import { createApplicationRuntime, systemClock } from "@kanvas/application";
import { createDatabaseRuntime } from "@kanvas/database";
import { NestFactory } from "@nestjs/core";
import { Queue, Worker as BullWorker } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import { ulid } from "ulid";
import {
  createServerStreamUploadCoordinator,
  createStorageGarbageCollectionCoordinator,
  createTrustedImageStorageRuntime,
  verifyOpaqueModelResource,
  type TrustedImageStorageRuntime,
} from "@kanvas/storage";

import {
  loadWorkerConfig,
  providerTextHttpAdapterKeys,
  providerImageHttpAdapterKeys,
  requiresTrustedImageStorageRuntime,
  type ProviderTextHttpAdapterKey,
} from "./config.js";
import { startHealthServer } from "./health-server.js";
import { createLogger, startTelemetry } from "./observability.js";
import {
  ATTEMPT_DISPATCH_JOB,
  CONTENT_EVENT_JOB,
  OutboxRelay,
  PROVIDER_ATTEMPT_DISPATCH_JOB,
  WORKFLOW_CANCELLATION_JOB,
  WORKFLOW_WAKEUP_JOB,
} from "./outbox/outbox-relay.js";
import { ContentEventProcessor } from "./queue/content-event.processor.js";
import { WorkerProcessLifecycle } from "./process-lifecycle.js";
import { ProviderBudgetSettlementReconciler } from "./reconciler/provider-budget-settlement-reconciler.js";
import { ProviderInvocationReconciler } from "./reconciler/provider-invocation-reconciler.js";
import { WorkflowReconciler } from "./reconciler/workflow-reconciler.js";
import {
  ORCHESTRATION_QUEUE,
  WORKFLOW_TOPOLOGY_VALIDATION_JOB,
  WorkflowTopologyQueueAdapter,
} from "./queue/workflow-topology.queue-adapter.js";
import {
  AttemptDispatchProcessor,
  EXECUTION_QUEUE,
  PROVIDER_EXECUTION_QUEUE,
  WorkflowCancellationProcessor,
  WorkflowWakeupProcessor,
} from "./queue/workflow-execution.processors.js";
import { INBOX_CONSUMER_NAMES } from "./queue/inbox-delivery.js";
import { createProviderAdapterRegistry } from "./provider/provider-adapter.js";
import { ProviderAttemptProcessor } from "./provider/provider-attempt-processor.js";
import { FakeAsyncProviderAdapter } from "./provider/fake-async-provider.js";
import { createOpenAiCompatibleProviderAdapters } from "./provider/openai-compatible-provider.js";
import { OpenAiImageEditProviderAdapter } from "./provider/openai-image-provider.js";
import { OpenAiCanvasExpandProviderAdapter } from "./provider/openai-image-expand-provider.js";
import { OpenAiReconstructiveUpscaleProviderAdapter } from "./provider/openai-image-upscale-provider.js";
import { GenerationTasksReconstructiveUpscaleProviderAdapter } from "./provider/generation-tasks-image-upscale-provider.js";
import { GenerationTasksCanvasExpandProviderAdapter } from "./provider/generation-tasks-image-expand-provider.js";
import { OpenAiObjectRemoveProviderAdapter } from "./provider/openai-image-object-remove-provider.js";
import { GenerationTasksObjectRemoveProviderAdapter } from "./provider/generation-tasks-image-object-remove-provider.js";
import { GenerationTasksImageGenerateProviderAdapter } from "./provider/generation-tasks-image-generate-provider.js";
import { GenerationTasksImageEditProviderAdapter } from "./provider/generation-tasks-image-edit-provider.js";
import { OpenAiCompatibleImageGenerateProviderAdapter } from "./provider/openai-compatible-image-generate-provider.js";
import { GeminiImageProviderAdapter } from "./provider/gemini-image-provider.js";
import { XaiImageEditProviderAdapter } from "./provider/xai-image-edit-provider.js";
import { createProviderHttpTransport } from "./provider/provider-http-transport.js";
import { createProviderSecretMaterialResolver } from "./provider/provider-secret-resolver.js";
import { createWorkflowJsonSchemaValidationPort } from "./queue/workflow-json-schema-validator.js";
import {
  createUnsupportedQueueJobError,
  runQueueJobSafely,
} from "./queue/queue-job-safety.js";
import { WorkerModule } from "./worker.module.js";
import { StorageGarbageCollectionLoop } from "./storage/storage-garbage-collection-loop.js";
import { ArtifactPreviewCleanupLoop } from "./storage/artifact-preview-cleanup-loop.js";
import { createArtifactPreviewMaterializer } from "./storage/artifact-preview-materializer.js";
import { createWorkerAttemptOutputMaterializer } from "./storage/worker-attempt-output-materializer.js";
import { createWorkerInputArtifactResolver } from "./storage/worker-input-artifact-resolver.js";
import { createWorkerModelResourceResolver } from "./storage/worker-model-resource-resolver.js";
import { createWorkerRuntimeAdapterRegistry } from "./adapter/worker-runtime-adapters.js";
import { AgentRunLoop } from "./agent/agent-run-loop.js";
import { AgentRunProcessor } from "./agent/agent-run-processor.js";
import { createAgentSkillInstructionLoader } from "./agent/agent-skill-instruction-loader.js";
import { createAgentTextModelTransport } from "./agent/agent-text-model-transport.js";
import { ModelResourceImportLoop } from "./model-resource/model-resource-import-loop.js";

function capabilityInstallationLeaseTokenHash(): string {
  return createHash("sha256")
    .update("kanvas:capability-installation-continuation:v1\0")
    .update(randomBytes(32))
    .digest("hex");
}

const ORCHESTRATION_ROUTER_CONSUMER = "orchestration-router.v1";
const EXECUTION_ROUTER_CONSUMER = "execution-router.v1";

const config = loadWorkerConfig(process.env, process.argv.slice(2));
const logger = createLogger(config);
const telemetry = startTelemetry(config, logger);

if (config.checkConfigOnly) {
  logger.info("Worker deployment configuration is valid.");
  await telemetry.shutdown();
} else {
  const database = createDatabaseRuntime({
    connection: config.database,
    resultDownloadDeployment: {
      enabled: config.provider.resultDownloadsEnabled,
      allowedOrigins: config.provider.resultAllowedOrigins
        ? [...config.provider.resultAllowedOrigins]
        : null,
    },
    instanceId: config.instanceId,
    enabledExecutionTargets: config.enabledExecutionTargets,
    ...(config.providerDeploymentHardBounds
      ? { providerDeploymentHardBounds: config.providerDeploymentHardBounds }
      : {}),
    ...(config.agentDevelopmentSkillFiles
      ? { agentDevelopmentSkillFiles: config.agentDevelopmentSkillFiles }
      : {}),
    boundedWorkflowOrchestrator: {
      ids: {
        next: () => ulid(),
      },
      schemaValidation: createWorkflowJsonSchemaValidationPort(),
    },
  });
  const boundedWorkflowOrchestrator = database.boundedWorkflowOrchestrator;
  if (!boundedWorkflowOrchestrator) {
    throw new Error("Bounded Workflow orchestrator was not configured.");
  }
  const redis = new Redis({
    ...config.redis,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  const bullWorkers: BullWorker[] = [];
  const queues: Queue[] = [];
  const registerBullWorker = (worker: BullWorker): void => {
    worker.on("error", (error: Error) => {
      logger.error(
        {
          errorType: error.name,
          errorMessage: error.message,
        },
        "BullMQ worker runtime error.",
      );
    });
    bullWorkers.push(worker);
  };
  let outboxRelay: OutboxRelay | undefined;
  let workflowReconciler: WorkflowReconciler | undefined;
  let providerInvocationReconciler: ProviderInvocationReconciler | undefined;
  let providerBudgetSettlementReconciler:
    ProviderBudgetSettlementReconciler | undefined;
  let storageGarbageCollection: StorageGarbageCollectionLoop | undefined;
  let modelResourceImports: ModelResourceImportLoop | undefined;
  let artifactPreviewCleanup: ArtifactPreviewCleanupLoop | undefined;
  let agentRunLoop: AgentRunLoop | undefined;
  let configurationObserver: RuntimeConfigurationObserver | undefined;
  let resultRecovery: ProviderResultRecoveryLoop | undefined;
  let storageRuntime: TrustedImageStorageRuntime | undefined;
  let healthServer: Server | undefined;
  let applicationContext:
    | Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
    | undefined;
  const lifecycle = new WorkerProcessLifecycle({
    stopClaiming: async () => {
      await resultRecovery?.stop();
      await configurationObserver?.stop();
      await workflowReconciler?.stop();
      await providerInvocationReconciler?.stop();
      await providerBudgetSettlementReconciler?.stop();
      await storageGarbageCollection?.stop();
      await modelResourceImports?.stop();
      await artifactPreviewCleanup?.stop();
      await agentRunLoop?.stop();
      await outboxRelay?.stop();
      for (const worker of bullWorkers) {
        await worker.close(false);
      }
      for (const queue of queues) {
        await queue.close();
      }
    },
    stopHealth: async () => {
      if (healthServer) {
        await new Promise<void>((resolve, reject) => {
          healthServer?.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }
    },
    closeApplication: async () => {
      if (applicationContext) {
        await applicationContext.close();
      }
      await storageRuntime?.close();
    },
    closeRedis: () => {
      redis.disconnect(false);
    },
    closeDatabase: () => database.close(),
    shutdownTelemetry: () => telemetry.shutdown(),
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (lifecycle.isShuttingDown) {
      return;
    }
    logger.info({ signal }, "Kanvas worker is draining.");
    await lifecycle.shutdown();
  };

  try {
    await database.verifyConnection();
    await redis.connect();
    await redis.ping();
    const runtime = createApplicationRuntime({
      clock: systemClock,
      runtimeStateReader: database.runtimeStateReader,
    });
    if (
      config.storage &&
      (requiresTrustedImageStorageRuntime(config.roles) ||
        config.artifactPreview.mode === "async_persisted")
    ) {
      storageRuntime = await createTrustedImageStorageRuntime({
        config: config.storage,
        store: database.storageUploads,
        adapterVersion: config.serviceVersion,
      });
    }
    const artifactPreviewMaterializer =
      storageRuntime && config.artifactPreview.mode === "async_persisted"
        ? createArtifactPreviewMaterializer({
            config: config.artifactPreview,
            runtime: storageRuntime,
            store: database.artifactRepresentations,
            nextId: ulid,
          })
        : undefined;
    if (
      storageRuntime &&
      config.artifactPreview.mode === "async_persisted" &&
      config.roles.includes("maintenance")
    ) {
      artifactPreviewCleanup = new ArtifactPreviewCleanupLoop({
        runtime: storageRuntime,
        store: database.artifactRepresentations,
        logger,
        pollIntervalMs: config.artifactPreview.cleanupPollIntervalMs,
        retryMs: config.artifactPreview.cleanupRetryMs,
      });
      artifactPreviewCleanup.start();
    }
    if (
      config.roles.includes("maintenance") &&
      config.storage &&
      storageRuntime
    ) {
      const modelImportLeaseDurationMs =
        config.storage.modelImport.leaseDurationMs;
      storageGarbageCollection = new StorageGarbageCollectionLoop({
        ...(storageRuntime.reconcileCleanup
          ? { reconcileProviderCleanup: storageRuntime.reconcileCleanup }
          : {}),
        runtime,
        runtimeStateReader: database.runtimeStateReader,
        coordinator: createStorageGarbageCollectionCoordinator({
          store: database.storageUploads,
          profiles: storageRuntime.profiles,
          claimLeaseMilliseconds: config.storage.garbageCollection.claimLeaseMs,
          baseRetryMilliseconds: config.storage.garbageCollection.baseRetryMs,
          maximumRetryMilliseconds:
            config.storage.garbageCollection.maximumRetryMs,
        }),
        logger,
        pollIntervalMs: config.storage.garbageCollection.pollIntervalMs,
      });
      storageGarbageCollection.start();
      modelResourceImports = new ModelResourceImportLoop({
        runtime,
        runtimeStateReader: database.runtimeStateReader,
        store: database.modelResourceImports,
        profiles: storageRuntime.profiles,
        uploads: createServerStreamUploadCoordinator({
          store: database.storageUploads,
          profiles: storageRuntime.profiles,
          verificationLimits: {
            ...config.storage.verificationLimits,
            maximumInputBytes: config.storage.modelResourceMaximumInputBytes,
          },
          verificationLeaseMilliseconds:
            config.storage.verificationLeaseMilliseconds,
          mediaVerifier: verifyOpaqueModelResource,
        }),
        maximumBytes: config.storage.modelResourceMaximumInputBytes,
        pollIntervalMs: config.storage.modelImport.pollIntervalMs,
        leaseDurationMs: config.storage.modelImport.leaseDurationMs,
        downloadTimeoutMs: config.storage.modelImport.downloadTimeoutMs,
        ...(config.storage.modelImport.proxyUrl
          ? { proxyUrl: config.storage.modelImport.proxyUrl }
          : {}),
        logger,
        nextId: ulid,
        continueCatalogInstallations: () => {
          const continuationNow = new Date();
          return database.capabilityInstallations.continueNextCatalogModelInstallation(
            {
              now: continuationNow,
              nextId: ulid,
              leaseTokenHash: capabilityInstallationLeaseTokenHash(),
              leaseExpiresAt: new Date(
                continuationNow.getTime() + modelImportLeaseDurationMs,
              ),
            },
          );
        },
      });
      modelResourceImports.start();
    }
    applicationContext = await NestFactory.createApplicationContext(
      WorkerModule.register(runtime),
      {
        logger: false,
      },
    );
    healthServer = await startHealthServer(config, {
      isReady: async () => {
        if (lifecycle.isShuttingDown || redis.status !== "ready") {
          return false;
        }
        try {
          const snapshot = await database.runtimeStateReader.read();
          return snapshot.state === "ACTIVE";
        } catch {
          return false;
        }
      },
    });
    const adapter = applicationContext.get(WorkflowTopologyQueueAdapter);
    const workflowWakeup = new WorkflowWakeupProcessor({
      runtime,
      engine: database.workflowEngine,
      boundedOrchestrator: boundedWorkflowOrchestrator,
      orchestrationRouting: database.workflowOrchestrationRouting,
      nextId: ulid,
    });
    const workerAdapters = createWorkerRuntimeAdapterRegistry({
      deterministicImageAdapterEnabled:
        config.workerAdapters.deterministicImageEnabled,
    });
    const imageInputArtifactResolver = storageRuntime
      ? createWorkerInputArtifactResolver({
          runtime: storageRuntime,
          store: database.storageUploads,
          authorizeConsumerArtifact: (request) =>
            database.libraryConsumerAccess.authorizeArtifact({
              ...request,
              now: new Date(),
            }),
          allowedDataClassifications: [
            "internal",
            "confidential",
            "restricted",
          ],
        })
      : undefined;
    const imageOutputMaterializer = storageRuntime
      ? createWorkerAttemptOutputMaterializer({
          runtime: storageRuntime,
          store: database.storageUploads,
          nextId: ulid,
        })
      : undefined;
    const modelResourceResolver = storageRuntime
      ? createWorkerModelResourceResolver({ runtime: storageRuntime })
      : undefined;
    const attemptDispatch = new AttemptDispatchProcessor({
      runtime,
      engine: database.workflowEngine,
      completions: database.atomicAttemptCompletions,
      failures: database.attemptFailures,
      nextId: ulid,
      executeAdapter: workerAdapters.execute,
      ...(modelResourceResolver ? { modelResourceResolver } : {}),
      ...(imageInputArtifactResolver && imageOutputMaterializer
        ? {
            inputArtifactResolver: imageInputArtifactResolver,
            outputMaterializer: imageOutputMaterializer,
          }
        : {}),
      leaseDurationMs: config.execution.leaseDurationMs,
      heartbeatIntervalMs: config.execution.heartbeatIntervalMs,
      attemptTimeoutMs: config.execution.attemptTimeoutMs,
    });
    const workflowCancellation = new WorkflowCancellationProcessor({
      runtime,
      engine: database.workflowEngine,
      nextId: ulid,
    });
    const contentEvent = new ContentEventProcessor({
      store: database.contentTransfers,
      ...(artifactPreviewMaterializer
        ? { previewMaterializer: artifactPreviewMaterializer }
        : {}),
    });
    const providerSecretResolver =
      config.provider.adapterKeys.length > 0
        ? createProviderSecretMaterialResolver({
            deploymentSecretFiles: config.provider.deploymentSecretFiles,
            kekFiles: config.provider.kekFiles,
            ...(config.provider.kekValues
              ? { kekValues: config.provider.kekValues }
              : {}),
          })
        : undefined;
    configurationObserver = new RuntimeConfigurationObserver(
      database.runtimeConfiguration,
      `worker:${ulid()}`,
      {
        downloadsEnabled: config.provider.resultDownloadsEnabled,
        allowedOrigins: config.provider.resultAllowedOrigins
          ? [...config.provider.resultAllowedOrigins]
          : null,
        serviceVersion: config.serviceVersion,
      },
      () =>
        logger.warn(
          { event: "runtime_configuration.observation_failed" },
          "Runtime configuration observation unavailable.",
        ),
    );
    await configurationObserver.start();
    const providerTransport =
      config.provider.adapterKeys.length > 0
        ? createProviderHttpTransport({
            recordResultPolicyDecision: async (decision) => {
              if (decision.context.invocationId)
                await database.runtimeConfiguration.recordResultDecision({
                  workspaceId: decision.context.workspaceId,
                  invocationId: decision.context.invocationId,
                  version: decision.version,
                  origin: decision.origin,
                  source: decision.source,
                  outcome: decision.outcome,
                });
            },
            ...(config.provider.allowedOrigins !== undefined
              ? { allowedOrigins: config.provider.allowedOrigins }
              : {}),
            resultDownloadsEnabled: config.provider.resultDownloadsEnabled,
            resultTimeouts: config.provider.resultTimeouts,
            resolveResultPolicy: async (context) => {
              const snapshot =
                await database.runtimeConfiguration.readEffective();
              const setting = snapshot.resultDownloads(context, {
                enabled: config.provider.resultDownloadsEnabled,
                allowedOrigins: config.provider.resultAllowedOrigins
                  ? [...config.provider.resultAllowedOrigins]
                  : null,
              });
              return {
                ...setting.value,
                version: setting.version,
                source: snapshot.downloadSource,
              };
            },
            ...(config.provider.proxyUrl
              ? { proxyUrl: config.provider.proxyUrl }
              : {}),
            allowPrivateNetworks: config.provider.allowPrivateNetworks,
            allowHttp: config.provider.allowHttp,
            maximumRequestBytes: config.provider.maximumRequestBytes,
            maximumResponseBytes: config.provider.maximumResponseBytes,
          })
        : undefined;
    const textProviderAdapterKeys = config.provider.adapterKeys.filter(
      (adapterKey): adapterKey is ProviderTextHttpAdapterKey =>
        providerTextHttpAdapterKeys.includes(
          adapterKey as ProviderTextHttpAdapterKey,
        ),
    );
    const realProviderAdapters = providerTransport
      ? [
          ...createOpenAiCompatibleProviderAdapters(
            textProviderAdapterKeys,
            providerTransport,
          ),
          ...(config.provider.adapterKeys.includes(
            "openai-compatible.images.generations.v1",
          )
            ? [
                new OpenAiCompatibleImageGenerateProviderAdapter(
                  providerTransport,
                ),
              ]
            : []),
          ...(config.provider.adapterKeys.includes(
            "gemini.generate-content.image.v1",
          )
            ? [new GeminiImageProviderAdapter(providerTransport)]
            : []),
          ...(config.provider.adapterKeys.includes("xai.images.edits.v1")
            ? [new XaiImageEditProviderAdapter(providerTransport)]
            : []),
          ...(config.provider.adapterKeys.includes("openai.images.edits.v1")
            ? [new OpenAiImageEditProviderAdapter(providerTransport)]
            : []),
          ...(config.provider.adapterKeys.includes(
            "openai.image.upscale.reconstructive.v1",
          )
            ? [
                new OpenAiReconstructiveUpscaleProviderAdapter(
                  providerTransport,
                ),
              ]
            : []),
          ...(config.provider.adapterKeys.includes(
            "openai.image.canvas-expand.v1",
          )
            ? [new OpenAiCanvasExpandProviderAdapter(providerTransport)]
            : []),
          ...(config.provider.adapterKeys.includes(
            "openai.image.object-remove.v1",
          )
            ? [new OpenAiObjectRemoveProviderAdapter(providerTransport)]
            : []),
          ...(config.provider.adapterKeys.includes(
            "generation-tasks.image.upscale.reconstructive.v1",
          )
            ? [
                new GenerationTasksReconstructiveUpscaleProviderAdapter(
                  providerTransport,
                ),
              ]
            : []),
          ...(config.provider.adapterKeys.includes(
            "generation-tasks.image.canvas-expand.v1",
          )
            ? [
                new GenerationTasksCanvasExpandProviderAdapter(
                  providerTransport,
                ),
              ]
            : []),
          ...(config.provider.adapterKeys.includes(
            "generation-tasks.image.object-remove.v1",
          )
            ? [
                new GenerationTasksObjectRemoveProviderAdapter(
                  providerTransport,
                ),
              ]
            : []),
          ...(config.provider.adapterKeys.includes(
            "generation-tasks.image.generate.v1",
          )
            ? [
                new GenerationTasksImageGenerateProviderAdapter(
                  providerTransport,
                ),
              ]
            : []),
          ...(config.provider.adapterKeys.includes(
            "generation-tasks.image.edit.v1",
          )
            ? [new GenerationTasksImageEditProviderAdapter(providerTransport)]
            : []),
        ]
      : [];
    const providerAdapters = createProviderAdapterRegistry([
      ...(config.provider.fakeAdapterEnabled
        ? [new FakeAsyncProviderAdapter()]
        : []),
      ...realProviderAdapters,
    ]);
    const preflightProviderStorage = async (
      claim: ProviderInvocationClaim,
    ): Promise<void> => {
      if (!providerImageHttpAdapterKeys.some((key) => key === claim.adapterKey))
        return;
      if (!storageRuntime) throw new Error("Image storage is unavailable.");
      await storageRuntime.ensureCompatibilityProbe(
        claim.workspaceId,
        ulid(),
        new Date(),
      );
    };
    const providerAttempt = new ProviderAttemptProcessor({
      runtime,
      store: database.providerInvocations,
      preflight: preflightProviderStorage,
      executionContexts: database.providerExecutionContexts,
      budgets: database.budgetReservations,
      attemptFailures: database.attemptFailures,
      ...(providerSecretResolver
        ? { secretResolver: providerSecretResolver }
        : {}),
      ...(imageInputArtifactResolver
        ? { inputArtifactResolver: imageInputArtifactResolver }
        : {}),
      ...(imageOutputMaterializer
        ? { outputMaterializer: imageOutputMaterializer }
        : {}),
      adapters: providerAdapters,
      nextId: ulid,
      leaseDurationMs: config.execution.leaseDurationMs,
    });

    if (config.roles.includes("agent")) {
      if (
        !providerTransport ||
        !providerSecretResolver ||
        !storageRuntime ||
        !imageInputArtifactResolver
      ) {
        throw new Error(
          "Agent Worker role requires Provider transport, secret resolution, and trusted Storage.",
        );
      }
      const agentProcessor = new AgentRunProcessor({
        workerId: `${config.instanceId}:agent`,
        logger,
        dispatch: database.agentRunDispatch,
        foundations: database.agentFoundation,
        facts: database.agentRuntime,
        bindings: database.agentModelBindings,
        budgets: database.budgetReservations,
        canvasDrafts: database.canvasDrafts,
        capabilities: database.capabilityDefinitions,
        workflowCatalog: database.workflowCatalog,
        workflowRuns: database.workflowRunQueries,
        capabilityRuns: database.capabilityRuns,
        workspaceBrand: database.workspaceBrand,
        agentLibraries: database.agentLibraries,
        libraryStorageProfiles: storageRuntime.profiles,
        skillLibrary: database.skillLibrary,
        content: database.workspaceContentQueries,
        inputArtifactResolver: imageInputArtifactResolver,
        transport: createAgentTextModelTransport({
          http: providerTransport,
          secrets: providerSecretResolver,
        }),
        instructions: createAgentSkillInstructionLoader({
          profiles: storageRuntime.profiles,
        }),
        nextId: ulid,
        leaseDurationMs: config.execution.leaseDurationMs,
        heartbeatIntervalMs: config.execution.heartbeatIntervalMs,
      });
      agentRunLoop = new AgentRunLoop({
        processor: agentProcessor,
        logger,
        pollIntervalMs: config.reconciler.pollIntervalMs,
        concurrency: config.agent.runConcurrency,
        canClaim: async () => {
          if (lifecycle.isShuttingDown) return false;
          const snapshot = await database.runtimeStateReader.read();
          return snapshot.state === "ACTIVE";
        },
      });
      agentRunLoop.start();
    }

    if (config.roles.includes("orchestration")) {
      registerBullWorker(
        new BullWorker(
          ORCHESTRATION_QUEUE,
          async (job) => {
            if (job.name === WORKFLOW_TOPOLOGY_VALIDATION_JOB) {
              return adapter.handle(job.data);
            }
            let consumerName = ORCHESTRATION_ROUTER_CONSUMER;
            if (job.name === WORKFLOW_WAKEUP_JOB) {
              consumerName = INBOX_CONSUMER_NAMES.workflowOrchestration;
            } else if (job.name === CONTENT_EVENT_JOB) {
              consumerName = INBOX_CONSUMER_NAMES.contentEvent;
            }
            return runQueueJobSafely({
              queueName: ORCHESTRATION_QUEUE,
              consumerName,
              ...(job.id ? { jobId: job.id } : {}),
              data: job.data,
              handler: () => {
                if (job.name === WORKFLOW_WAKEUP_JOB) {
                  return workflowWakeup.handle(job.data);
                }
                if (job.name === CONTENT_EVENT_JOB) {
                  return contentEvent.handle(job.data);
                }
                return Promise.reject(createUnsupportedQueueJobError());
              },
              failureStore: database.queueDeliveryFailures,
              logger,
              now: () => new Date(),
            });
          },
          {
            connection: redis,
            concurrency: 4,
          },
        ),
      );
    }

    if (config.roles.includes("execution")) {
      registerBullWorker(
        new BullWorker(
          EXECUTION_QUEUE,
          async (job) => {
            let consumerName = EXECUTION_ROUTER_CONSUMER;
            if (job.name === ATTEMPT_DISPATCH_JOB) {
              consumerName = INBOX_CONSUMER_NAMES.attemptDispatch;
            } else if (job.name === WORKFLOW_CANCELLATION_JOB) {
              consumerName = INBOX_CONSUMER_NAMES.workflowCancellation;
            }
            return runQueueJobSafely({
              queueName: EXECUTION_QUEUE,
              consumerName,
              ...(job.id ? { jobId: job.id } : {}),
              data: job.data,
              handler: () => {
                if (job.name === ATTEMPT_DISPATCH_JOB) {
                  return attemptDispatch.handle(job.data);
                }
                if (job.name === WORKFLOW_CANCELLATION_JOB) {
                  return workflowCancellation.handle(job.data);
                }
                return Promise.reject(createUnsupportedQueueJobError());
              },
              failureStore: database.queueDeliveryFailures,
              logger,
              now: () => new Date(),
            });
          },
          {
            connection: redis,
            concurrency: 4,
          },
        ),
      );
    }

    if (
      config.roles.includes("provider-execution") &&
      providerTransport &&
      storageRuntime
    ) {
      resultRecovery = new ProviderResultRecoveryLoop({
        store: database.providerResultRecovery,
        uploads: database.storageUploads,
        content: database.contentTransfers,
        storage: storageRuntime,
        transport: providerTransport,
        onError: () =>
          logger.warn(
            { event: "result_recovery.poll_failed" },
            "Result recovery is temporarily unavailable.",
          ),
      });
      resultRecovery.start();
    }
    if (config.roles.includes("provider-execution")) {
      registerBullWorker(
        new BullWorker(
          PROVIDER_EXECUTION_QUEUE,
          async (job) =>
            runQueueJobSafely({
              queueName: PROVIDER_EXECUTION_QUEUE,
              consumerName:
                job.name === PROVIDER_ATTEMPT_DISPATCH_JOB
                  ? INBOX_CONSUMER_NAMES.providerAttemptDispatch
                  : "provider-execution-router.v1",
              ...(job.id ? { jobId: job.id } : {}),
              data: job.data,
              handler: () =>
                job.name === PROVIDER_ATTEMPT_DISPATCH_JOB
                  ? providerAttempt.handle(job.data)
                  : Promise.reject(createUnsupportedQueueJobError()),
              failureStore: database.queueDeliveryFailures,
              logger,
              now: () => new Date(),
            }),
          {
            connection: redis,
            concurrency: 4,
          },
        ),
      );
    }

    if (config.roles.includes("outbox-relay")) {
      const orchestrationQueue = new Queue(ORCHESTRATION_QUEUE, {
        connection: redis,
      });
      const executionQueue = new Queue(EXECUTION_QUEUE, {
        connection: redis,
      });
      const providerExecutionQueue = new Queue(PROVIDER_EXECUTION_QUEUE, {
        connection: redis,
      });
      queues.push(orchestrationQueue, executionQueue, providerExecutionQueue);
      outboxRelay = new OutboxRelay({
        store: database.outboxRelay,
        queues: {
          orchestration: orchestrationQueue,
          execution: executionQueue,
          providerExecution: providerExecutionQueue,
        },
        logger,
        assertRelayAllowed: async (expectedGeneration, messageType) => {
          await runtime.runtimeFence.assertAllowed({
            action:
              messageType === "workflow.cancel.requested" ||
              messageType === "capability.run.cancelled"
                ? "cancel"
                : "relay",
            expectedGeneration,
          });
        },
        contentEventAttempts: config.artifactPreview.generationAttempts,
        contentEventBackoffMs: config.artifactPreview.generationRetryMs,
      });
      outboxRelay.start();
    }

    if (config.roles.includes("reconciler")) {
      workflowReconciler = new WorkflowReconciler({
        runtime,
        runtimeStateReader: database.runtimeStateReader,
        store: database.workflowReconciler,
        logger,
        nextId: ulid,
        pollIntervalMs: config.reconciler.pollIntervalMs,
        staleAfterMs: config.reconciler.staleAfterMs,
        batchSize: config.reconciler.batchSize,
      });
      workflowReconciler.start();
      if (config.enabledExecutionTargets.includes("provider")) {
        providerInvocationReconciler = new ProviderInvocationReconciler({
          runtime,
          runtimeStateReader: database.runtimeStateReader,
          store: database.providerInvocations,
          preflight: preflightProviderStorage,
          executionContexts: database.providerExecutionContexts,
          budgets: database.budgetReservations,
          ...(providerSecretResolver
            ? { secretResolver: providerSecretResolver }
            : {}),
          ...(imageInputArtifactResolver
            ? {
                inputArtifactResolver: imageInputArtifactResolver,
              }
            : {}),
          ...(imageOutputMaterializer
            ? {
                outputMaterializer: imageOutputMaterializer,
              }
            : {}),
          adapters: providerAdapters,
          logger,
          nextId: ulid,
          pollIntervalMs: config.reconciler.pollIntervalMs,
          batchSize: config.reconciler.batchSize,
          leaseDurationMs: config.execution.leaseDurationMs,
        });
        providerInvocationReconciler.start();
      }
      providerBudgetSettlementReconciler =
        new ProviderBudgetSettlementReconciler({
          runtime,
          runtimeStateReader: database.runtimeStateReader,
          settlements: database.providerBudgetSettlements,
          budgets: database.budgetReservations,
          logger,
          nextId: ulid,
          pollIntervalMs: config.reconciler.pollIntervalMs,
          batchSize: config.reconciler.batchSize,
        });
      providerBudgetSettlementReconciler.start();
    }

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void shutdown(signal).catch((error: unknown) => {
          logShutdownFailure(logger, error);
          process.exitCode = 1;
        });
      });
    }

    logger.info(
      {
        roles: config.roles,
        enabledExecutionTargets: config.enabledExecutionTargets,
        healthHost: config.healthHost,
        healthPort: config.healthPort,
        agentRunConcurrency: config.agent.runConcurrency,
      },
      "Kanvas worker is ready to claim.",
    );
  } catch (error) {
    logger.error(
      {
        errorType: error instanceof Error ? error.name : "unknown",
        errorMessage:
          error instanceof Error ? error.message : "Unknown startup failure.",
      },
      "Kanvas worker startup failed.",
    );
    await shutdown("startup-failure");
    process.exitCode = 1;
  }
}

function logShutdownFailure(logger: Logger, error: unknown): void {
  logger.error(
    {
      errorType: error instanceof Error ? error.name : "unknown",
    },
    "Kanvas worker shutdown failed.",
  );
}
