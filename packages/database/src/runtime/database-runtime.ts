import {
  createLibraryConsumerAccessStore,
  type LibraryConsumerAccessStore,
} from "./library-consumer-access.js";
import {
  createAgentLibraryStore,
  type AgentLibraryStore,
} from "./agent-library-store.js";
import type { ResourceLibraryRepository } from "@kanvas/application";
import { createResourceLibraryStore } from "./resource-library-store.js";
import type { ResultDownloadRule } from "@kanvas/contracts/api";
import {
  createProviderResultRecoveryStore,
  type ProviderResultRecoveryStore,
} from "./provider-result-recovery-store.js";
import {
  createRuntimeConfigurationStore,
  type RuntimeConfigurationStore,
} from "./runtime-configuration-store.js";
import {
  createDefaultAccessStore,
  type DefaultAccessStore,
} from "./default-access-store.js";
import {
  createSiteCoverStore,
  type SiteCoverStore,
} from "./site-cover-store.js";
import {
  createToolSessionStore,
  type ToolSessionStore,
} from "./tool-session-store.js";
import {
  createSiteToolImageStore,
  type SiteToolImageStore,
} from "./site-tool-image-store.js";
import { createSiteToolStore, type SiteToolStore } from "./site-tool-store.js";
import type {
  RuntimeStateReader,
  RuntimeStateSnapshot,
} from "@kanvas/application";
import { defaultAgentWorkspaceProfileV1 } from "@kanvas/application";
import { eq } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createAgentHubStore, type AgentHubStore } from "./agent-hub-store.js";
import {
  createArtifactRepresentationStore,
  type ArtifactRepresentationStore,
} from "./artifact-representation-store.js";
import {
  createContentTransferStore,
  type ContentTransferStore,
} from "./content-transfer-store.js";
import {
  createCanvasDraftStore,
  type CanvasDraftStore,
} from "./canvas-draft-store.js";
import {
  createCanvasExportStore,
  type CanvasExportStore,
} from "./canvas-export-store.js";
import {
  createOperationalTimelineStore,
  type OperationalTimelineStore,
} from "./operational-timeline-store.js";
import { createPool, type Pool } from "mysql2/promise";

import type { DatabaseConnectionConfig } from "../configuration/database-config.js";
import { prepareCatalogPackageV1 } from "../cli/catalog-package-installer.js";
import type { LoadedCatalogPackageV1 } from "../cli/catalog-package-loader.js";
import { instanceRuntimeStateTable } from "../schema/index.js";
import {
  createAtomicAttemptCompletionStore,
  type AtomicAttemptCompletionStore,
} from "./attempt-completion-store.js";
import {
  createAttemptFailureStore,
  type AttemptFailureStore,
} from "./attempt-failure-store.js";
import {
  createBrowserControlPlaneStore,
  type BrowserControlPlaneStore,
} from "./browser-control-plane-store.js";
import {
  createAuthorizationStore,
  type AuthorizationStore,
} from "./authorization-store.js";
import {
  createBoundedWorkflowOrchestratorStore,
  type BoundedWorkflowOrchestratorStore,
  type CreateBoundedWorkflowOrchestratorStoreOptions,
} from "./bounded-workflow-orchestrator-store.js";
import {
  createContentDomainStore,
  type ContentDomainStore,
} from "./content-domain-store.js";
import {
  createExecutionTargetGate,
  type ExecutionTarget,
} from "./execution-target.js";
import {
  createWorkflowExecutionPersistence,
  type WorkflowExecutionPersistence,
} from "./workflow-execution-persistence.js";
import {
  createOutboxRelayStore,
  type OutboxRelayStore,
} from "./outbox-relay-store.js";
import {
  createQueueDeliveryFailureStore,
  type QueueDeliveryFailureStore,
} from "./queue-delivery-failure-store.js";
import {
  createStorageUploadStore,
  type StorageUploadStore,
} from "./storage-upload-store.js";
import {
  createInstanceBootstrapStore,
  type InstanceBootstrapStore,
} from "./instance-bootstrap-store.js";
import {
  createInstanceAccessStore,
  type InstanceAccessStore,
} from "./instance-access-store.js";
import { createTeamStore, type TeamStore } from "./team-store.js";
import {
  createProviderInvocationStore,
  type ProviderInvocationStore,
} from "./provider-invocation-store.js";
import {
  createProviderBudgetSettlementStore,
  type ProviderBudgetSettlementStore,
} from "./provider-budget-settlement-store.js";
import {
  createProviderExecutionContextStore,
  type ProviderExecutionContextStore,
} from "./provider-execution-context-store.js";
import {
  createProviderSettingsStore,
  type ProviderSettingsStore,
} from "./provider-settings-store.js";
import {
  createModelReferenceStore,
  type ModelReferenceStore,
} from "./model-reference-store.js";
import {
  createModelControlPlaneStore,
  type ModelControlPlaneStore,
} from "./model-control-plane-store.js";
import {
  createModelResourceAdminStore,
  type ModelResourceAdminStore,
} from "./model-resource-admin-store.js";
import {
  createModelResourceImportStore,
  type ModelResourceImportStore,
} from "./model-resource-import-store.js";
import {
  createWorkspaceUsageSummaryStore,
  type WorkspaceUsageSummaryStore,
} from "./workspace-usage-summary-store.js";
import {
  createWorkspaceSettingsStore,
  type WorkspaceSettingsStore,
} from "./workspace-settings-store.js";
import {
  createResourceSourceStore,
  type ResourceSourceStore,
} from "./resource-source-store.js";
import {
  createSecretVersionStore,
  type SecretVersionStore,
} from "./secret-version-store.js";
import { createWorkspaceBrandStore } from "./workspace-brand-store.js";
import {
  createWorkspaceDefaultAgentStore,
  type WorkspaceDefaultAgentStore,
} from "./workspace-default-agent-store.js";
import { createAgentRuntimeStore } from "./agent-runtime-store.js";
import { createAgentRunDispatchStore } from "./agent-run-dispatch-store.js";
import { createAgentFoundationStore } from "./agent-foundation-store.js";
import {
  createAgentProfilePublicationStore,
  type AgentProfilePublicationStore,
} from "./agent-profile-publication-store.js";
import {
  createAgentModelBindingStore,
  type AgentModelBindingStore,
} from "./agent-model-binding-store.js";
import type {
  AgentFoundationRepository,
  AgentRunDispatchRepository,
  AgentRuntimeRepository,
} from "@kanvas/application";
import type { WorkspaceBrandRepository } from "@kanvas/application";
import {
  createCapabilityBindingAdminStore,
  type CapabilityBindingAdminStore,
} from "./capability-binding-admin-store.js";
import {
  createCapabilityImplementationAdminStore,
  type CapabilityImplementationAdminStore,
} from "./capability-implementation-admin-store.js";
import {
  createCapabilityDefinitionAdminStore,
  type CapabilityDefinitionAdminStore,
} from "./capability-definition-admin-store.js";
import {
  createCapabilityInstallationStore,
  type CapabilityInstallationStore,
} from "./capability-installation-store.js";
import {
  createCapabilityRunStore,
  type CapabilityRunStore,
} from "./capability-run-store.js";
import {
  createBudgetReservationStore,
  type BudgetReservationStore,
} from "./budget-reservation-store.js";
import {
  createPublicationGovernanceStore,
  type PublicationGovernanceStore,
} from "./publication-governance-store.js";
import { createDefaultPublicationValidationPort } from "./publication-validation.js";
import {
  createSkillPackageImportStore,
  type SkillPackageImportStore,
} from "./skill-package-import-store.js";
import {
  createSkillLibraryStore,
  type SkillLibraryStore,
} from "./skill-library-store.js";
import {
  createWorkflowEngineStore,
  type WorkflowEngineStore,
} from "./workflow-engine-store.js";
import { createWorkflowRunQueryStore } from "./workflow-run-query-store.js";
import {
  createWorkflowOrchestrationRoutingStore,
  type WorkflowOrchestrationRoutingStore,
} from "./workflow-orchestration-routing-store.js";
import {
  createWorkflowReconcilerStore,
  type WorkflowReconcilerStore,
} from "./workflow-reconciler-store.js";
import { createWorkflowAuthoringStore } from "./workflow-authoring-store.js";
import { createWorkflowCatalogStore } from "./workflow-catalog-store.js";
import { createEffectiveInvocationSchemaProjector } from "./effective-invocation-schema-store.js";
import type { WorkflowAuthoringRepository } from "@kanvas/application";
import type { WorkflowCatalogRepository } from "@kanvas/application";
import {
  createWorkspaceContentQueryStore,
  type WorkspaceContentQueryStore,
} from "./workspace-content-query-store.js";
import type {
  WorkflowApprovalQueryRepository,
  WorkflowRunQueryRepository,
} from "@kanvas/application";
import { createMysqlTransactionRuntime } from "./mysql-transaction-runtime.js";

export interface DatabaseRuntime {
  readonly db: MySql2Database;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly workflowExecution: WorkflowExecutionPersistence;
  readonly outboxRelay: OutboxRelayStore;
  readonly queueDeliveryFailures: QueueDeliveryFailureStore;
  readonly storageUploads: StorageUploadStore;
  readonly contentTransfers: ContentTransferStore;
  readonly artifactRepresentations: ArtifactRepresentationStore;
  readonly canvasDrafts: CanvasDraftStore;
  readonly canvasExports: CanvasExportStore;
  readonly operationalTimeline: OperationalTimelineStore;
  readonly atomicAttemptCompletions: AtomicAttemptCompletionStore;
  readonly attemptFailures: AttemptFailureStore;
  readonly providerInvocations: ProviderInvocationStore;
  readonly providerExecutionContexts: ProviderExecutionContextStore;
  readonly providerSettings: ProviderSettingsStore;
  readonly modelReferences: ModelReferenceStore;
  readonly modelControlPlane: ModelControlPlaneStore;
  readonly modelResources: ModelResourceAdminStore;
  readonly modelResourceImports: ModelResourceImportStore;
  readonly workspaceUsageSummary: WorkspaceUsageSummaryStore;
  readonly workspaceSettings: WorkspaceSettingsStore;
  readonly resourceSources: ResourceSourceStore;
  readonly secretVersions: SecretVersionStore;
  readonly workspaceBrand: WorkspaceBrandRepository;
  readonly resourceLibraries: ResourceLibraryRepository;
  readonly workspaceDefaultAgent: WorkspaceDefaultAgentStore;
  readonly agentHub: AgentHubStore;
  readonly agentRuntime: AgentRuntimeRepository;
  readonly agentLibraries: AgentLibraryStore;
  readonly libraryConsumerAccess: LibraryConsumerAccessStore;
  readonly agentRunDispatch: AgentRunDispatchRepository;
  readonly agentFoundation: AgentFoundationRepository;
  readonly agentProfilePublications: AgentProfilePublicationStore;
  readonly agentModelBindings: AgentModelBindingStore;
  readonly capabilityDefinitions: CapabilityDefinitionAdminStore;
  readonly capabilityBindingAdmin: CapabilityBindingAdminStore;
  readonly capabilityImplementations: CapabilityImplementationAdminStore;
  readonly capabilityInstallations: CapabilityInstallationStore;
  readonly capabilityRuns: CapabilityRunStore;
  readonly providerBudgetSettlements: ProviderBudgetSettlementStore;
  readonly budgetReservations: BudgetReservationStore;
  readonly publicationGovernance: PublicationGovernanceStore;
  readonly workflowAuthoring: WorkflowAuthoringRepository;
  readonly workflowCatalog: WorkflowCatalogRepository;
  readonly skillPackageImports: SkillPackageImportStore;
  readonly skillLibrary: SkillLibraryStore;
  readonly browserControlPlane: BrowserControlPlaneStore;
  readonly authorization: AuthorizationStore;
  readonly instanceAccess: InstanceAccessStore;
  readonly defaultAccess: DefaultAccessStore;
  readonly runtimeConfiguration: RuntimeConfigurationStore;
  readonly providerResultRecovery: ProviderResultRecoveryStore;
  readonly siteTools: SiteToolStore;
  readonly siteToolImages: SiteToolImageStore;
  readonly siteCovers: SiteCoverStore;
  readonly toolSessions: ToolSessionStore;
  readonly instanceBootstrap: InstanceBootstrapStore;
  readonly team: TeamStore;
  readonly workspaceContentQueries: WorkspaceContentQueryStore;
  readonly content: ContentDomainStore;
  readonly boundedWorkflowOrchestrator?: BoundedWorkflowOrchestratorStore;
  readonly workflowEngine: WorkflowEngineStore;
  readonly workflowRunQueries: WorkflowRunQueryRepository &
    WorkflowApprovalQueryRepository;
  readonly workflowOrchestrationRouting: WorkflowOrchestrationRoutingStore;
  readonly workflowReconciler: WorkflowReconcilerStore;
  verifyConnection(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDatabaseRuntimeOptions {
  readonly resultDownloadDeployment?: ResultDownloadRule;
  readonly connection: DatabaseConnectionConfig;
  readonly instanceId: string;
  readonly initialCatalog?: LoadedCatalogPackageV1;
  readonly enabledExecutionTargets?: readonly ExecutionTarget[];
  readonly providerDeploymentHardBounds?: unknown;
  readonly agentDevelopmentSkillFiles?: Readonly<Record<string, string>>;
  readonly boundedWorkflowOrchestrator?: Omit<
    CreateBoundedWorkflowOrchestratorStoreOptions,
    "enabledExecutionTargets"
  >;
}

function createRuntimeStateReader(
  db: MySql2Database,
  instanceId: string,
): RuntimeStateReader {
  return Object.freeze({
    async read(): Promise<RuntimeStateSnapshot> {
      const rows = await db
        .select()
        .from(instanceRuntimeStateTable)
        .where(eq(instanceRuntimeStateTable.instanceId, instanceId))
        .limit(1);
      const row = rows[0];

      if (!row) {
        throw new Error(
          `Instance runtime state is missing for configured instance ${instanceId}.`,
        );
      }

      return {
        state: row.state,
        executionGeneration: row.executionGeneration,
        stateVersion: row.stateVersion,
        ...(row.deadline ? { deadline: row.deadline } : {}),
      };
    },
  });
}

export function createDatabaseRuntime(
  options: CreateDatabaseRuntimeOptions,
): DatabaseRuntime {
  const initialCatalog = options.initialCatalog
    ? prepareCatalogPackageV1(options.initialCatalog)
    : undefined;
  const pool: Pool = createPool({
    host: options.connection.host,
    port: options.connection.port,
    database: options.connection.database,
    user: options.connection.user,
    password: options.connection.password,
    ...(options.connection.ssl ? { ssl: options.connection.ssl } : {}),
    connectionLimit: options.connection.connectionLimit,
    timezone: "Z",
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    enableKeepAlive: true,
  });
  const db = drizzle({ client: pool });
  const transactions = createMysqlTransactionRuntime(pool);
  const workflowExecution = createWorkflowExecutionPersistence(
    pool,
    transactions,
    {
      ...(options.providerDeploymentHardBounds !== undefined
        ? {
            providerDeploymentHardBounds: options.providerDeploymentHardBounds,
          }
        : {}),
    },
  );
  const outboxRelay = createOutboxRelayStore(pool);
  const queueDeliveryFailures = createQueueDeliveryFailureStore(pool);
  const storageUploads = createStorageUploadStore(pool);
  const contentTransfers = createContentTransferStore(pool, {
    instanceId: options.instanceId,
  });
  const artifactRepresentations = createArtifactRepresentationStore(pool);
  const canvasDrafts = createCanvasDraftStore(pool);
  const canvasExports = createCanvasExportStore(pool, {
    instanceId: options.instanceId,
  });
  const operationalTimeline = createOperationalTimelineStore(pool);
  const executionTargetGate = createExecutionTargetGate(
    options.enabledExecutionTargets,
  );
  const atomicAttemptCompletions = createAtomicAttemptCompletionStore(pool, {
    instanceId: options.instanceId,
  });
  const attemptFailures = createAttemptFailureStore(pool, {
    instanceId: options.instanceId,
    enabledExecutionTargets: executionTargetGate.enabledExecutionTargets,
  });
  const providerInvocations = createProviderInvocationStore(pool, {
    instanceId: options.instanceId,
    claimingEnabled: executionTargetGate.allows("provider"),
    enabledExecutionTargets: executionTargetGate.enabledExecutionTargets,
  });
  const providerExecutionContexts = createProviderExecutionContextStore(pool);
  const providerSettings = createProviderSettingsStore(pool);
  const modelReferences = createModelReferenceStore(pool);
  const modelControlPlane = createModelControlPlaneStore(pool);
  const modelResources = createModelResourceAdminStore(pool);
  const modelResourceImports = createModelResourceImportStore(pool);
  const workspaceUsageSummary = createWorkspaceUsageSummaryStore(pool);
  const workspaceSettings = createWorkspaceSettingsStore(pool);
  const resourceSources = createResourceSourceStore(pool);
  const secretVersions = createSecretVersionStore(pool);
  const workspaceBrand = createWorkspaceBrandStore(pool);
  const resourceLibraries = createResourceLibraryStore(pool);
  const agentLibraries = createAgentLibraryStore(pool);
  const workspaceDefaultAgent = createWorkspaceDefaultAgentStore(pool);
  const agentHub = createAgentHubStore(pool);
  const agentRuntime = createAgentRuntimeStore(pool, {
    instanceId: options.instanceId,
  });
  const agentRunDispatch = createAgentRunDispatchStore(pool, agentRuntime);
  const effectiveInvocationSchemas = createEffectiveInvocationSchemaProjector({
    ...(options.providerDeploymentHardBounds !== undefined
      ? {
          providerDeploymentHardBounds: options.providerDeploymentHardBounds,
        }
      : {}),
  });
  const agentFoundation = createAgentFoundationStore(pool, {
    effectiveInvocationSchemas,
    ...(options.agentDevelopmentSkillFiles
      ? { developmentSkillFiles: options.agentDevelopmentSkillFiles }
      : {}),
  });
  const agentProfilePublications = createAgentProfilePublicationStore(pool);
  const agentModelBindings = createAgentModelBindingStore(pool);
  const capabilityDefinitions = createCapabilityDefinitionAdminStore(pool, {
    providerDeploymentHardBounds: options.providerDeploymentHardBounds,
  });
  const capabilityBindingAdmin = createCapabilityBindingAdminStore(pool);
  const capabilityImplementations =
    createCapabilityImplementationAdminStore(pool);
  const capabilityInstallations = createCapabilityInstallationStore(pool);
  const capabilityRuns = createCapabilityRunStore(pool, {
    ...(options.resultDownloadDeployment
      ? { resultDownloadDeployment: options.resultDownloadDeployment }
      : {}),
    instanceId: options.instanceId,
    enabledExecutionTargets: executionTargetGate.enabledExecutionTargets,
    ...(options.providerDeploymentHardBounds !== undefined
      ? { providerDeploymentHardBounds: options.providerDeploymentHardBounds }
      : {}),
  });
  const providerBudgetSettlements = createProviderBudgetSettlementStore(pool);
  const budgetReservations = createBudgetReservationStore(pool);
  const publicationGovernance = createPublicationGovernanceStore(
    pool,
    createDefaultPublicationValidationPort(),
  );
  const workflowAuthoring = createWorkflowAuthoringStore(pool);
  const workflowCatalog = createWorkflowCatalogStore(pool, {
    effectiveInvocationSchemas,
  });
  const skillPackageImports = createSkillPackageImportStore(pool);
  const skillLibrary = createSkillLibraryStore(pool);
  const browserControlPlane = createBrowserControlPlaneStore(pool, {
    claimingEnabled: executionTargetGate.allows("browser"),
    instanceId: options.instanceId,
  });
  const authorization = createAuthorizationStore(pool, {
    instanceId: options.instanceId,
  });
  const toolSessions = createToolSessionStore(pool, options.instanceId);
  const siteCovers = createSiteCoverStore(pool, options.instanceId);
  const siteToolImages = createSiteToolImageStore(pool, options.instanceId);
  const siteTools = createSiteToolStore(pool, {
    instanceId: options.instanceId,
  });
  const instanceAccess = createInstanceAccessStore(pool, {
    instanceId: options.instanceId,
  });
  const instanceBootstrap = createInstanceBootstrapStore(pool, {
    instanceId: options.instanceId,
    initialAgentProfiles: [defaultAgentWorkspaceProfileV1],
    ...(initialCatalog ? { initialCatalog } : {}),
  });
  const team = createTeamStore(pool, { instanceId: options.instanceId });
  const workspaceContentQueries = createWorkspaceContentQueryStore(pool, {
    effectiveInvocationSchemas,
  });
  const content = createContentDomainStore(pool);
  const boundedWorkflowOrchestrator = options.boundedWorkflowOrchestrator
    ? createBoundedWorkflowOrchestratorStore(pool, {
        ...options.boundedWorkflowOrchestrator,
        enabledExecutionTargets: executionTargetGate.enabledExecutionTargets,
      })
    : undefined;
  const workflowEngine = createWorkflowEngineStore(pool, {
    enabledExecutionTargets: executionTargetGate.enabledExecutionTargets,
  });
  const workflowRunQueries = createWorkflowRunQueryStore(pool);
  const workflowOrchestrationRouting =
    createWorkflowOrchestrationRoutingStore(pool);
  const workflowReconciler = createWorkflowReconcilerStore(pool, {
    instanceId: options.instanceId,
    enabledExecutionTargets: executionTargetGate.enabledExecutionTargets,
  });

  return Object.freeze({
    db,
    runtimeStateReader: createRuntimeStateReader(db, options.instanceId),
    workflowExecution,
    outboxRelay,
    queueDeliveryFailures,
    storageUploads,
    contentTransfers,
    artifactRepresentations,
    canvasDrafts,
    canvasExports,
    operationalTimeline,
    atomicAttemptCompletions,
    attemptFailures,
    providerInvocations,
    providerExecutionContexts,
    providerSettings,
    modelReferences,
    modelControlPlane,
    modelResources,
    modelResourceImports,
    workspaceUsageSummary,
    workspaceSettings,
    resourceSources,
    secretVersions,
    workspaceBrand,
    resourceLibraries,
    agentLibraries,
    libraryConsumerAccess: createLibraryConsumerAccessStore(pool),
    workspaceDefaultAgent,
    agentHub,
    agentRuntime,
    agentRunDispatch,
    agentFoundation,
    agentProfilePublications,
    agentModelBindings,
    capabilityDefinitions,
    capabilityBindingAdmin,
    capabilityImplementations,
    capabilityInstallations,
    capabilityRuns,
    providerBudgetSettlements,
    budgetReservations,
    publicationGovernance,
    workflowAuthoring,
    workflowCatalog,
    skillPackageImports,
    skillLibrary,
    browserControlPlane,
    authorization,
    instanceAccess,
    providerResultRecovery: createProviderResultRecoveryStore(
      pool,
      options.instanceId,
    ),
    defaultAccess: createDefaultAccessStore(pool, options.instanceId),
    runtimeConfiguration: createRuntimeConfigurationStore(
      pool,
      options.instanceId,
    ),
    siteTools,
    siteToolImages,
    siteCovers,
    toolSessions,
    instanceBootstrap,
    team,
    workspaceContentQueries,
    content,
    ...(boundedWorkflowOrchestrator ? { boundedWorkflowOrchestrator } : {}),
    workflowEngine,
    workflowRunQueries,
    workflowOrchestrationRouting,
    workflowReconciler,
    async verifyConnection(): Promise<void> {
      await pool.query("SELECT 1");
    },
    async close(): Promise<void> {
      await pool.end();
    },
  });
}
