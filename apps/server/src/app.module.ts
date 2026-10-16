import { ResourceLibraryController } from "./http/resource-library.controller.js";
import { ResourceLibraryService } from "./resource-libraries/resource-library.service.js";
import { RuntimeConfigurationController } from "./http/runtime-configuration.controller.js";
import { SiteCoverController } from "./http/site-cover.controller.js";
import { SiteCoverService } from "./storage/site-cover.service.js";
import {
  ToolRuntimeController,
  ToolPreviewRuntimeController,
} from "./http/tool-runtime.controller.js";
import { ToolRuntimeWorkspaceGuard } from "./http/tool-runtime.guard.js";
import {
  ToolSessionController,
  ToolPreviewController,
} from "./http/tool-session.controller.js";
import { ToolCatalogueController } from "./http/tool-catalogue.controller.js";
import { SiteToolsController } from "./http/site-tools.controller.js";
import {
  DefaultAccessController,
  DefaultAccessRecoveryController,
} from "./http/default-access.controller.js";
import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { ApplicationRuntime } from "@kanvas/application";
import type { DatabaseRuntime } from "@kanvas/database";
import type {
  ProviderSecretDatabaseWriter,
  ProviderSecretMaterialResolver,
} from "@kanvas/secrets";

import type { ServerConfig } from "./config.js";
import type { AuthenticationGateway } from "./auth/authentication-gateway.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { WorkflowTopologyController } from "./http/workflow-topology.controller.js";
import { WorkflowRunController } from "./http/workflow-run.controller.js";
import { DomainErrorFilter } from "./http/domain-error.filter.js";
import { BrowserSessionContextController } from "./http/browser-session-context.controller.js";
import { CurrentHumanContextController } from "./http/current-human-context.controller.js";
import { WorkspaceTeamController } from "./http/workspace-team.controller.js";
import { WorkspaceContentController } from "./http/workspace-content.controller.js";
import { CanvasDraftController } from "./http/canvas-draft.controller.js";
import { InstanceSetupController } from "./http/instance-setup.controller.js";
import { InstanceRegistrationController } from "./http/instance-registration.controller.js";
import { InstanceAccessController } from "./http/instance-access.controller.js";
import { InstanceAdministratorContextStore } from "./http/instance-administrator-context.js";
import { InstanceAdministratorGuard } from "./http/instance-administrator.guard.js";
import { BrowserExecutorController } from "./browser-executor/browser-executor.controller.js";
import { BrowserExecutorControlPlaneService } from "./browser-executor/browser-executor-control-plane.service.js";
import { RequestAuthorizationContextStore } from "./http/request-authorization-context.js";
import { WorkspaceAuthorizationGuard } from "./http/workspace-authorization.guard.js";
import { CsrfTokenService } from "./security/csrf-token-service.js";
import {
  APPLICATION_RUNTIME,
  AUTHENTICATION_GATEWAY,
  DATABASE_RUNTIME,
  PROVIDER_SECRET_DATABASE_WRITER,
  PROVIDER_SECRET_MATERIAL_RESOLVER,
  SERVER_CONFIG,
  SERVER_STORAGE_RUNTIME,
  TELEMETRY_LIFECYCLE,
} from "./tokens.js";
import type { TelemetryLifecycle } from "./observability.js";
import type { ServerStorageRuntime } from "./storage/server-storage-runtime.js";
import { ContentTransferController } from "./storage/content-transfer.controller.js";
import { ContentTransferService } from "./storage/content-transfer.service.js";
import { OperationalTimelineController } from "./operations/operational-timeline.controller.js";
import { WorkspaceProviderSettingsController } from "./http/workspace-provider-settings.controller.js";
import { WorkspaceUsageController } from "./http/workspace-usage.controller.js";
import { WorkspaceCapabilityBindingsController } from "./http/workspace-capability-bindings.controller.js";
import { WorkspaceCapabilityDefinitionsController } from "./http/workspace-capability-definitions.controller.js";
import { WorkspaceSettingsController } from "./http/workspace-settings.controller.js";
import { WorkspaceBrandController } from "./http/workspace-brand.controller.js";
import { WorkflowAuthoringController } from "./http/workflow-authoring.controller.js";
import { WorkflowCandidateController } from "./http/workflow-candidate.controller.js";
import { WorkflowTemplateController } from "./http/workflow-template.controller.js";
import { WorkspaceAgentController } from "./http/workspace-agent.controller.js";
import { AgentHubController } from "./http/agent-hub.controller.js";
import { SkillLibraryController } from "./http/skill-library.controller.js";
import { WorkspaceAgentModelSettingsController } from "./http/workspace-agent-model-settings.controller.js";
import { WorkspaceAgentService } from "./agent/workspace-agent.service.js";
import { AgentHubService } from "./agent/agent-hub.service.js";
import { SkillLibraryService } from "./skills/skill-library.service.js";
import { WorkspaceResourceSourcesController } from "./http/workspace-resource-sources.controller.js";
import { WorkspaceModelsController } from "./http/workspace-models.controller.js";
import { WorkspaceModelResourcesController } from "./http/workspace-model-resources.controller.js";
import { ModelResourceImportService } from "./model-resources/model-resource-import.service.js";
import { CapabilityImplementationService } from "./capabilities/capability-implementation.service.js";
import { CapabilityInstallationService } from "./capabilities/capability-installation.service.js";
import { CapabilityRunService } from "./capabilities/capability-run.service.js";
import { CapabilityRunController } from "./http/capability-run.controller.js";

export type ServerDatabaseRuntime = Pick<
  DatabaseRuntime,
  | "authorization"
  | "agentHub"
  | "agentFoundation"
  | "agentProfilePublications"
  | "agentRuntime"
  | "publicationGovernance"
  | "skillLibrary"
  | "skillPackageImports"
  | "atomicAttemptCompletions"
  | "browserControlPlane"
  | "canvasExports"
  | "contentTransfers"
  | "canvasDrafts"
  | "content"
  | "instanceBootstrap"
  | "instanceAccess"
  | "defaultAccess"
  | "runtimeConfiguration"
  | "providerResultRecovery"
  | "siteTools"
  | "siteToolImages"
  | "siteCovers"
  | "toolSessions"
  | "team"
  | "workspaceContentQueries"
  | "operationalTimeline"
  | "providerSettings"
  | "budgetReservations"
  | "workspaceUsageSummary"
  | "workspaceSettings"
  | "resourceSources"
  | "modelControlPlane"
  | "modelResources"
  | "modelResourceImports"
  | "modelReferences"
  | "secretVersions"
  | "workspaceBrand"
  | "resourceLibraries"
  | "capabilityDefinitions"
  | "capabilityBindingAdmin"
  | "capabilityImplementations"
  | "capabilityInstallations"
  | "capabilityRuns"
  | "storageUploads"
  | "close"
  | "runtimeStateReader"
  | "verifyConnection"
> & {
  readonly artifactRepresentations?: DatabaseRuntime["artifactRepresentations"];
};

class ProcessLifecycle implements OnApplicationShutdown {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    @Inject(TELEMETRY_LIFECYCLE)
    private readonly telemetry: TelemetryLifecycle,
    @Inject(SERVER_STORAGE_RUNTIME)
    private readonly storage: ServerStorageRuntime | undefined,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.storage?.close();
    await this.database.close();
    await this.telemetry.shutdown();
  }
}

export interface AppModuleOptions {
  readonly config: ServerConfig;
  readonly database: ServerDatabaseRuntime;
  readonly authenticationGateway: AuthenticationGateway;
  readonly runtime: ApplicationRuntime;
  readonly providerSecretDatabaseWriter: ProviderSecretDatabaseWriter;
  readonly providerSecretMaterialResolver: ProviderSecretMaterialResolver;
  readonly storage?: ServerStorageRuntime;
  readonly telemetry: TelemetryLifecycle;
}

@Module({})
export class AppModule {
  public static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        BrowserSessionContextController,
        CurrentHumanContextController,
        WorkspaceTeamController,
        WorkspaceContentController,
        CanvasDraftController,
        InstanceSetupController,
        InstanceRegistrationController,
        DefaultAccessController,
        RuntimeConfigurationController,
        DefaultAccessRecoveryController,
        SiteToolsController,
        SiteCoverController,
        ToolSessionController,
        ToolRuntimeController,
        ToolPreviewRuntimeController,
        ToolPreviewController,
        ToolCatalogueController,
        InstanceAccessController,
        BrowserExecutorController,
        ContentTransferController,
        OperationalTimelineController,
        WorkflowTopologyController,
        WorkflowAuthoringController,
        WorkflowCandidateController,
        WorkflowTemplateController,
        WorkflowRunController,
        WorkspaceProviderSettingsController,
        WorkspaceResourceSourcesController,
        WorkspaceModelsController,
        WorkspaceModelResourcesController,
        WorkspaceUsageController,
        WorkspaceCapabilityDefinitionsController,
        CapabilityRunController,
        WorkspaceCapabilityBindingsController,
        WorkspaceSettingsController,
        WorkspaceBrandController,
        ResourceLibraryController,
        WorkspaceAgentController,
        AgentHubController,
        SkillLibraryController,
        WorkspaceAgentModelSettingsController,
      ],
      providers: [
        {
          provide: SERVER_CONFIG,
          useValue: options.config,
        },
        {
          provide: DATABASE_RUNTIME,
          useValue: options.database,
        },
        {
          provide: AUTHENTICATION_GATEWAY,
          useValue: options.authenticationGateway,
        },
        {
          provide: APPLICATION_RUNTIME,
          useValue: options.runtime,
        },
        {
          provide: PROVIDER_SECRET_DATABASE_WRITER,
          useValue: options.providerSecretDatabaseWriter,
        },
        {
          provide: PROVIDER_SECRET_MATERIAL_RESOLVER,
          useValue: options.providerSecretMaterialResolver,
        },
        {
          provide: SERVER_STORAGE_RUNTIME,
          useValue: options.storage,
        },
        {
          provide: TELEMETRY_LIFECYCLE,
          useValue: options.telemetry,
        },
        ProcessLifecycle,
        SiteCoverService,
        CsrfTokenService,
        RequestAuthorizationContextStore,
        InstanceAdministratorContextStore,
        WorkspaceAuthorizationGuard,
        ToolRuntimeWorkspaceGuard,
        InstanceAdministratorGuard,
        BrowserExecutorControlPlaneService,
        ContentTransferService,
        ResourceLibraryService,
        ModelResourceImportService,
        CapabilityImplementationService,
        CapabilityInstallationService,
        CapabilityRunService,
        WorkspaceAgentService,
        AgentHubService,
        SkillLibraryService,
        HealthService,
        {
          provide: APP_FILTER,
          useClass: DomainErrorFilter,
        },
      ],
    };
  }
}
