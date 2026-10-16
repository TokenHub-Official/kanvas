import { resourceLibraryRoutes } from "./resource-library.js";
import { providerResultRecoveryRoutes } from "./provider-result-recovery.js";
import { runtimeConfigurationRoutes } from "./runtime-configuration-routes.js";
import { siteCoverRoutes } from "./site-cover-routes.js";
import { listToolIntegrationsRoute } from "./site-tool-routes.js";
import { toolRuntimeRoutes } from "./tool-runtime-routes.js";
import { toolSessionRoutes } from "./tool-session-routes.js";
import {
  uploadSiteToolImageRoute,
  getSiteToolImageRoute,
  getToolImageRoute,
} from "./site-tool-routes.js";
import {
  siteToolRoutes,
  listToolsRoute,
  getToolUsageRoute,
} from "./site-tool-routes.js";
import {
  TaskRecordQuerySchema,
  TaskRecordListSchema,
  TaskTimelinePathSchema,
  TaskTimelineSchema,
} from "./schemas.js";
import {
  DefaultAccessPolicySchema,
  UpdateDefaultAccessPolicyBodySchema,
  DefaultAccessStatusSchema,
  DefaultAccessPreviewSchema,
  ApplyDefaultAccessBodySchema,
  AppliedDefaultAccessSchema,
} from "./schemas.js";
import {
  InstanceWorkspacePathSchema,
  InstanceInvitationPathSchema,
} from "./schemas.js";
import {
  AddWorkspaceMemberBodySchema,
  InstanceWorkspaceMemberPathSchema,
  ChangeInstancePrincipalStatusBodySchema,
  ChangedInstancePrincipalStatusSchema,
} from "./schemas.js";
import {
  AgentHubAgentReadQuerySchema,
  ResourceStateListSchema,
  ResourceStateListPathSchema,
  ChangeResourceStateBodySchema,
} from "./schemas.js";
import { Type } from "@sinclair/typebox";

import { defineRoute, type RouteContract } from "./route.js";
import {
  CreateResourceSourceBodySchema,
  PublishResourceSourceBodySchema,
  ResourceAdoptionRequestSchema,
  ResourceAdoptionResultSchema,
  ResourceCatalogSearchQuerySchema,
  ResourceCatalogSearchResultSchema,
  ResourceCatalogSourceListSchema,
  ResourceSourceCreatedSchema,
  ResourceSourceMutationResultSchema,
  ResourceSourcePathSchema,
  ResourceSourceTypeListSchema,
  ResourceSourceVersionBodySchema,
  RotateResourceSourceCredentialBodySchema,
  ValidateResourceSourceBodySchema,
  WorkspaceResourceSourcesSchema,
  WorkspaceArtTextCatalogSchema,
  WorkspaceFontCatalogSchema,
} from "../resource-source/index.js";
import {
  SkillFileQuerySchema,
  SkillDraftFileQuerySchema,
  AgentHubAgentSchema,
  AgentHubAgentDetailSchema,
  AgentHubAgentPathSchema,
  AgentHubAgentsSchema,
  AgentHubSkillDetailSchema,
  AgentHubSkillSchema,
  AgentHubSkillsSchema,
  AgentHubSubjectPathSchema,
  ArchiveSkillDraftBodySchema,
  AgentRunAcceptedSchema,
  ActivateProviderSettingBodySchema,
  CancelAgentRunBodySchema,
  CancelledAgentRunSchema,
  AgentActionPathSchema,
  AgentInteractionPathSchema,
  ResolveAgentInteractionBodySchema,
  ResolvedAgentInteractionSchema,
  AgentRunPathSchema,
  AgentRunDiagnosticsSchema,
  AgentRunViewSchema,
  AgentThreadListQuerySchema,
  AgentThreadListSchema,
  AgentThreadPathSchema,
  AgentThreadSummarySchema,
  AgentThreadEventStreamSchema,
  AgentThreadViewSchema,
  WorkspaceAgentModelSettingsSchema,
  UpdateWorkspaceAgentModelSettingsBodySchema,
  ArchiveAgentThreadBodySchema,
  AcknowledgeBrowserAttemptCancellationBodySchema,
  AllocateCanvasExportBodySchema,
  AllocateUserImportBodySchema,
  AllocateBrowserAttemptOutputBodySchema,
  ArtifactBinaryContentSchema,
  ArtifactContentPathSchema,
  ArtifactDownloadHeadersSchema,
  BrowserAssignmentPathSchema,
  BrowserAttemptCancellationAcknowledgementSchema,
  BrowserAttemptCompletionResponseSchema,
  BrowserAttemptGrantHeadersSchema,
  BrowserAttemptOutputAllocationHeadersSchema,
  BrowserAttemptOutputIngestionSchema,
  BrowserAttemptOutputUploadHeadersSchema,
  BrowserAttemptOutputUploadSessionPathSchema,
  BrowserAttemptOutputUploadSessionSchema,
  BrowserAttemptHeartbeatResponseSchema,
  BrowserExecutorSessionPathSchema,
  BrowserExecutorSessionTransitionSchema,
  CanvasExportIngestionSchema,
  CanvasExportUploadSessionPathSchema,
  CanvasExportUploadSessionSchema,
  CommitCanvasExportBodySchema,
  CommittedCanvasExportSchema,
  CommitUserImportBodySchema,
  ConfirmAgentActionBodySchema,
  ConfirmedAgentActionSchema,
  DeclineAgentActionBodySchema,
  CompleteAgentCanvasExportBodySchema,
  DeclinedAgentActionSchema,
  CommittedUserImportSchema,
  CreateProviderSettingBodySchema,
  CreateCanonicalModelBodySchema,
  PublishCanonicalModelBodySchema,
  ImportProviderModelsBodySchema,
  MapProviderModelBodySchema,
  PublishProviderModelBodySchema,
  CanonicalModelPathSchema,
  ProviderModelPathSchema,
  WorkspaceModelsSchema,
  CanonicalModelMutationResultSchema,
  ProviderModelsImportedSchema,
  ProviderModelCatalogSchema,
  ModelReferenceSearchQuerySchema,
  ModelReferenceSearchResultSchema,
  SyncModelReferenceBodySchema,
  ModelReferenceSyncResultSchema,
  CreateWorkspaceAgentMessageBodySchema,
  CreateAgentHubAgentBodySchema,
  CreateSkillDraftBodySchema,
  DiscoverProviderModelsBodySchema,
  RefreshProviderModelCatalogBodySchema,
  ProviderModelCatalogRefreshResultSchema,
  ProviderModelCatalogReviewSchema,
  AdoptProviderModelCatalogBodySchema,
  ProviderModelCatalogAdoptionResultSchema,
  ProviderModelDiscoveryResultSchema,
  ProviderSettingCreatedSchema,
  ProviderSettingMutationResultSchema,
  ProviderSettingPathSchema,
  ProviderSettingVersionBodySchema,
  RenameProviderSettingBodySchema,
  RotateProviderSettingSecretBodySchema,
  ValidateProviderSettingBodySchema,
  WorkspaceProviderSettingsSchema,
  WorkspaceBudgetMutationResultSchema,
  WorkspaceBudgetPathSchema,
  WorkspaceUsageSummarySchema,
  ResolveUnknownBudgetHoldBodySchema,
  UpdateWorkspaceBudgetBodySchema,
  UnknownBudgetHoldPathSchema,
  UnknownBudgetHoldResolutionSchema,
  RenameWorkspaceBodySchema,
  RenameAgentThreadBodySchema,
  RegenerateAgentResponseBodySchema,
  SelectAgentResponseBranchBodySchema,
  SetAgentHubVisibilityBodySchema,
  ChangeSkillRuntimeStatusBodySchema,
  PublishSkillCandidateBodySchema,
  RecordSkillCandidateTestBodySchema,
  SkillCandidatePathSchema,
  SkillDefinitionPathSchema,
  SkillDraftListSchema,
  SkillDraftDetailSchema,
  SkillDraftPathSchema,
  SkillDraftSummarySchema,
  SkillRevisionPathSchema,
  SkillRuntimeStatusSchema,
  SubmitSkillCandidateBodySchema,
  UpdateSkillDraftBodySchema,
  UpdateAgentHubAgentBodySchema,
  WorkspaceGeneralSettingsSchema,
  CapabilityBindingPathSchema,
  CapabilityBindingMutationResultSchema,
  MoveCapabilityBindingBodySchema,
  SetCapabilityBindingStatusBodySchema,
  WorkspaceAgentPathSchema,
  CurrentHumanContextSchema,
  CancelWorkflowRunBodySchema,
  AcceptWorkspaceInvitationBodySchema,
  BrowserSessionContextSchema,
  BrandKitDraftSchema,
  BrandKitListQuerySchema,
  BrandKitListSchema,
  BrandKitPathSchema,
  BrandKitRevisionPathSchema,
  BrandKitRevisionListSchema,
  BrandKitRevisionSchema,
  BrandKitSummarySchema,
  BrowserMutationHeadersSchema,
  CanvasDraftListQuerySchema,
  CanvasDraftListSchema,
  CanvasDraftMutationResultSchema,
  CanvasDraftPathSchema,
  CanvasDraftRevisionListQuerySchema,
  CanvasDraftRevisionListSchema,
  CanvasDraftRevisionPathSchema,
  CanvasDraftRevisionSchema,
  CanvasDraftSchema,
  ChangeWorkspaceMembershipBodySchema,
  ChangeWorkspaceMembershipsBodySchema,
  ChangedWorkspaceMembershipSchema,
  ChangedWorkspaceMembershipsSchema,
  ClaimBrowserAttemptBodySchema,
  ClaimBrowserAttemptResponseSchema,
  CompleteBrowserAttemptBodySchema,
  CreateBrandKitBodySchema,
  CreateCanvasDraftBodySchema,
  CreateWorkflowRunBodySchema,
  CreateWorkspaceAssetFromArtifactBodySchema,
  CreateWorkspaceInvitationBodySchema,
  HealthResponseSchema,
  HeartbeatBrowserAttemptBodySchema,
  GrantInstanceWorkspaceAccessBodySchema,
  GrantedInstanceWorkspaceAccessSchema,
  InstanceAccessOverviewSchema,
  InstanceSetupAccountRegisteredSchema,
  InstanceSetupRedemptionBodySchema,
  InstanceSetupRedemptionResponseSchema,
  InstanceSetupSummarySchema,
  InstanceRegistrationSettingsSchema,
  InvitationAccountRegisteredSchema,
  InvitationPathSchema,
  InvitationSummarySchema,
  IdempotencyHeadersSchema,
  OperationalTimelineSchema,
  ProblemDetailsSchema,
  PublishBrandKitBodySchema,
  RegisteredBrowserExecutorSchema,
  RegisterBrowserExecutorBodySchema,
  RegisterInstanceSetupAccountBodySchema,
  RegisterInvitationAccountBodySchema,
  ValidateWorkflowTopologyBodySchema,
  ValidateWorkflowTopologyResponseSchema,
  UserImportIngestionSchema,
  UserImportUploadSessionPathSchema,
  UserImportUploadSessionSchema,
  WorkflowRunAcceptedSchema,
  WorkflowRunCancellationAcceptedSchema,
  WorkflowRunDetailsSchema,
  DecideWorkflowApprovalBodySchema,
  WorkflowApprovalDecisionResultSchema,
  WorkflowRunListQuerySchema,
  WorkflowRunListSchema,
  WorkflowRunPathSchema,
  ResendWorkspaceInvitationBodySchema,
  RestoreCanvasDraftBodySchema,
  ResolveInstanceSetupBodySchema,
  ResolveInvitationBodySchema,
  RevokeWorkspaceInvitationBodySchema,
  SetDefaultBrandKitBodySchema,
  TargetPrincipalPathSchema,
  UpdateCanvasDraftBodySchema,
  UpdateCanvasDraftBrandBodySchema,
  UpdateBrandKitDraftBodySchema,
  UpdateInstanceRegistrationPolicyBodySchema,
  WorkspaceMutationHeadersSchema,
  WorkspaceAssetListSchema,
  WorkspaceAssetListQuerySchema,
  WorkspaceAssetDetailQuerySchema,
  WorkspaceAssetAdoptionSchema,
  WorkspaceAssetDetailSchema,
  WorkspaceAssetPathSchema,
  WorkspaceCreationEntrypointListSchema,
  WorkspaceInvitationAcceptedSchema,
  WorkspaceInvitationCreatedSchema,
  WorkspaceInvitationRevokedSchema,
  WorkspaceScopeHeadersSchema,
  WorkspaceTeamQuerySchema,
  WorkspaceTeamSchema,
  ArchiveWorkflowDraftBodySchema,
  CreateWorkflowDraftBodySchema,
  UpdateWorkflowDraftBodySchema,
  WorkflowDefinitionListQuerySchema,
  WorkflowDefinitionListSchema,
  WorkflowDefinitionPathSchema,
  WorkflowDraftMutationResultSchema,
  WorkflowDraftPathSchema,
  WorkflowDraftSchema,
  WorkflowAuthoringCapabilityListSchema,
  PublishWorkflowCandidateBodySchema,
  RecordWorkflowCandidateEvalBodySchema,
  ReviewWorkflowCandidateBodySchema,
  StartWorkflowCandidateTestBodySchema,
  SubmitWorkflowCandidateBodySchema,
  WorkflowCandidateListQuerySchema,
  WorkflowCandidateListSchema,
  WorkflowCandidatePathSchema,
  WorkflowCandidateReviewSchema,
  WorkflowTemplateListQuerySchema,
  WorkflowTemplateListSchema,
  WorkflowTemplatePathSchema,
  WorkflowTemplateSchema,
} from "./schemas.js";
import {
  CancelCapabilityRunBodySchema,
  CanvasCapabilityCatalogQuerySchema,
  CanvasCapabilityCatalogSchema,
  UserCapabilityCatalogSchema,
  CapabilityRunAcceptedSchema,
  CapabilityRunDetailsSchema,
  CapabilityRunPathSchema,
  CapabilityCatalogEntryPathSchema,
  CapabilityDefinitionMutationResultSchema,
  CapabilityDefinitionPathSchema,
  CreateCapabilityDefinitionBodySchema,
  CapabilityInstallationSummarySchema,
  CreateCanvasCapabilityRunBodySchema,
  CreateCapabilityRunBodySchema,
  InstallCapabilityRecommendationBodySchema,
  PublishCapabilityImplementationRevisionBodySchema,
  SetCapabilityDefinitionStatusBodySchema,
  UpdateCapabilityDefinitionBodySchema,
  WorkspaceCapabilityDefinitionsSchema,
} from "./capability-control-plane.js";
import {
  BrowserRuntimeManifestSchema,
  CancelModelResourceImportBodySchema,
  ModelResourceImportBinaryContentSchema,
  ModelResourceImportIngestionSchema,
  ModelResourceImportPathSchema,
  ModelResourceImportSummarySchema,
  ModelResourceMutationResultSchema,
  ModelResourceBinaryContentSchema,
  ModelResourcePathSchema,
  ModelResourceRevisionPathSchema,
  PublishModelResourceImportBodySchema,
  SetModelResourceStatusBodySchema,
  StartModelResourceImportBodySchema,
  WorkspaceModelResourcesSchema,
} from "./model-resource-control-plane.js";

export const liveHealthRoute = defineRoute({
  operationId: "health.live",
  method: "GET",
  path: "/health/live",
  summary: "Process liveness",
  responses: {
    200: HealthResponseSchema,
  },
  security: ["public"],
  idempotency: "none",
} satisfies RouteContract);

export const startupHealthRoute = defineRoute({
  operationId: "health.startup",
  method: "GET",
  path: "/health/startup",
  summary: "Process startup state",
  responses: {
    200: HealthResponseSchema,
    503: HealthResponseSchema,
  },
  security: ["public"],
  idempotency: "none",
} satisfies RouteContract);

export const readyHealthRoute = defineRoute({
  operationId: "health.ready",
  method: "GET",
  path: "/health/ready",
  summary: "Role readiness",
  responses: {
    200: HealthResponseSchema,
    503: HealthResponseSchema,
  },
  security: ["public"],
  idempotency: "none",
} satisfies RouteContract);

export const getBrowserSessionContextRoute = defineRoute({
  operationId: "authentication.getBrowserSessionContext",
  method: "GET",
  path: "/api/v1/auth/session-context",
  summary: "Resolve the authoritative browser session and mint its CSRF token",
  responses: {
    200: BrowserSessionContextSchema,
    401: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const getCurrentHumanContextRoute = defineRoute({
  operationId: "authentication.getCurrentHumanContext",
  method: "GET",
  path: "/api/v1/auth/current-human-context",
  summary:
    "Resolve the current Human Principal, accessible Workspaces, permission projections, and session-bound CSRF token",
  responses: {
    200: CurrentHumanContextSchema,
    401: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const resolveInvitationRoute = defineRoute({
  operationId: "workspaceInvitations.resolve",
  method: "POST",
  path: "/api/v1/invitation-resolutions",
  summary:
    "Resolve a bounded public invitation summary without exposing its target identity",
  request: {
    body: ResolveInvitationBodySchema,
  },
  responses: {
    200: InvitationSummarySchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["public"],
  idempotency: "none",
} satisfies RouteContract);

export const registerInvitationAccountRoute = defineRoute({
  operationId: "workspaceInvitations.registerAccount",
  method: "POST",
  path: "/api/v1/invitation-registrations",
  summary:
    "Create an unverified account and request email verification for a valid invitation",
  request: {
    body: RegisterInvitationAccountBodySchema,
  },
  responses: {
    201: InvitationAccountRegisteredSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["public"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceTeamRoute = defineRoute({
  operationId: "workspaceTeam.get",
  method: "GET",
  path: "/api/v1/workspace-team",
  summary: "Get the authorized Workspace member and invitation projection",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: WorkspaceTeamQuerySchema,
  },
  responses: {
    200: WorkspaceTeamSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceProviderSettingsRoute = defineRoute({
  operationId: "workspaceProviderSettings.get",
  method: "GET",
  path: "/api/v1/provider-settings",
  summary: "Get the redacted authorized Workspace Provider settings projection",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceProviderSettingsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const renameWorkspaceProviderSettingRoute = defineRoute({
  operationId: "workspaceProviderSettings.rename",
  method: "PATCH",
  path: "/api/v1/provider-settings/{providerSettingId}",
  summary:
    "Rename a Provider connection without changing its execution identity",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: ProviderSettingPathSchema,
    body: RenameProviderSettingBodySchema,
  },
  responses: {
    200: ProviderSettingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceModelsRoute = defineRoute({
  operationId: "workspaceModels.get",
  method: "GET",
  path: "/api/v1/models",
  summary: "List canonical Workspace models and their mapped Providers",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceModelsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceProviderModelCatalogRoute = defineRoute({
  operationId: "workspaceProviderSettings.getModelCatalog",
  method: "GET",
  path: "/api/v1/provider-settings/{providerSettingId}/provider-models",
  summary: "List importable models from the current Provider catalog",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: ProviderSettingPathSchema,
  },
  responses: {
    200: ProviderModelCatalogSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const searchModelReferenceRoute = defineRoute({
  operationId: "workspaceModels.searchReference",
  method: "GET",
  path: "/api/v1/model-reference",
  summary: "Search the internally synchronized models.dev reference",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: ModelReferenceSearchQuerySchema,
  },
  responses: {
    200: ModelReferenceSearchResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const syncWorkspaceModelReferenceRoute = defineRoute({
  operationId: "workspaceModels.syncReference",
  method: "POST",
  path: "/api/v1/models/{modelId}/reference-syncs",
  summary: "Resolve current defaults from the latest models.dev reference",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CanonicalModelPathSchema,
    body: SyncModelReferenceBodySchema,
  },
  responses: {
    200: ModelReferenceSyncResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceUsageSummaryRoute = defineRoute({
  operationId: "workspaceUsage.getSummary",
  method: "GET",
  path: "/api/v1/usage-summary",
  summary: "Get the authorized Workspace usage and quota summary",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceUsageSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const updateWorkspaceBudgetRoute = defineRoute({
  operationId: "workspaceUsage.updateBudget",
  method: "PATCH",
  path: "/api/v1/usage-summary/budgets/{providerSettingId}",
  summary: "Update one authorized Workspace Provider spending limit",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: WorkspaceBudgetPathSchema,
    body: UpdateWorkspaceBudgetBodySchema,
  },
  responses: {
    200: WorkspaceBudgetMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const resolveUnknownBudgetHoldRoute = defineRoute({
  operationId: "workspaceUsage.resolveUnknownHold",
  method: "POST",
  path: "/api/v1/usage-summary/unknown-holds/{budgetReservationId}/resolution",
  summary: "Resolve one externally verified unknown Provider charge",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: UnknownBudgetHoldPathSchema,
    body: ResolveUnknownBudgetHoldBodySchema,
  },
  responses: {
    200: UnknownBudgetHoldResolutionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "optional",
} satisfies RouteContract);

export const getWorkspaceGeneralSettingsRoute = defineRoute({
  operationId: "workspaceSettings.get",
  method: "GET",
  path: "/api/v1/workspace-settings",
  summary: "Get the authorized Workspace general settings projection",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceGeneralSettingsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const renameWorkspaceRoute = defineRoute({
  operationId: "workspaceSettings.rename",
  method: "PATCH",
  path: "/api/v1/workspace-settings/name",
  summary: "Rename one authorized Workspace using optimistic concurrency",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: RenameWorkspaceBodySchema,
  },
  responses: {
    200: WorkspaceGeneralSettingsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listBrandKitsRoute = defineRoute({
  operationId: "brandKits.list",
  method: "GET",
  path: "/api/v1/brand-kits",
  summary: "List bounded Brand Kits visible in the authorized Workspace",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: BrandKitListQuerySchema,
  },
  responses: {
    200: BrandKitListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createBrandKitRoute = defineRoute({
  operationId: "brandKits.create",
  method: "POST",
  path: "/api/v1/brand-kits",
  summary: "Create one Brand Kit draft in the authorized Workspace",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateBrandKitBodySchema,
  },
  responses: {
    201: BrandKitDraftSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getBrandKitDraftRoute = defineRoute({
  operationId: "brandKits.getDraft",
  method: "GET",
  path: "/api/v1/brand-kits/{brandKitId}/draft",
  summary: "Get one editable Brand Kit draft for an authorized manager",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: BrandKitPathSchema,
  },
  responses: {
    200: BrandKitDraftSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const updateBrandKitDraftRoute = defineRoute({
  operationId: "brandKits.updateDraft",
  method: "PATCH",
  path: "/api/v1/brand-kits/{brandKitId}/draft",
  summary: "Update one Brand Kit draft using optimistic concurrency",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: BrandKitPathSchema,
    body: UpdateBrandKitDraftBodySchema,
  },
  responses: {
    200: BrandKitDraftSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const publishBrandKitRoute = defineRoute({
  operationId: "brandKits.publish",
  method: "POST",
  path: "/api/v1/brand-kits/{brandKitId}/revisions",
  summary: "Publish one immutable Brand Kit Revision from a fixed draft",
  request: {
    headers: IdempotencyHeadersSchema,
    path: BrandKitPathSchema,
    body: PublishBrandKitBodySchema,
  },
  responses: {
    201: BrandKitRevisionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listBrandKitRevisionsRoute = defineRoute({
  operationId: "brandKits.listRevisions",
  method: "GET",
  path: "/api/v1/brand-kits/{brandKitId}/revisions",
  summary: "List bounded immutable revisions for one authorized Brand Kit",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: BrandKitPathSchema,
  },
  responses: {
    200: BrandKitRevisionListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const setDefaultBrandKitRoute = defineRoute({
  operationId: "brandKits.setDefault",
  method: "PUT",
  path: "/api/v1/brand-kits/{brandKitId}/default",
  summary: "Set one published Brand Kit as the Workspace default",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: BrandKitPathSchema,
    body: SetDefaultBrandKitBodySchema,
  },
  responses: {
    200: BrandKitSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getDefaultBrandKitRevisionRoute = defineRoute({
  operationId: "brandKits.getDefaultRevision",
  method: "GET",
  path: "/api/v1/brand-kits/default/revision",
  summary: "Get the current default published Brand Kit Revision",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: BrandKitRevisionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getBrandKitRevisionRoute = defineRoute({
  operationId: "brandKits.getRevision",
  method: "GET",
  path: "/api/v1/brand-kits/{brandKitId}/revisions/{brandKitRevisionId}",
  summary: "Get one immutable Brand Kit Revision",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: BrandKitRevisionPathSchema,
  },
  responses: {
    200: BrandKitRevisionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listWorkspaceCapabilityDefinitionsRoute = defineRoute({
  operationId: "workspaceCapabilityDefinitions.list",
  method: "GET",
  path: "/api/v1/capability-definitions",
  summary:
    "List the authorized Workspace Capability definitions and current run methods",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceCapabilityDefinitionsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listUserCapabilitiesRoute = defineRoute({
  operationId: "userCapabilities.list",
  method: "GET",
  path: "/api/v1/user-capabilities",
  summary: "List published capabilities available for direct user invocation",
  request: { headers: WorkspaceScopeHeadersSchema },
  responses: {
    200: UserCapabilityCatalogSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listCanvasCapabilitiesRoute = defineRoute({
  operationId: "canvasCapabilities.list",
  method: "GET",
  path: "/api/v1/canvas-capabilities",
  summary:
    "List enabled and available Capabilities eligible for the selected Canvas context",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: CanvasCapabilityCatalogQuerySchema,
  },
  responses: {
    200: CanvasCapabilityCatalogSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createCanvasCapabilityRunRoute = defineRoute({
  operationId: "canvasCapabilityRuns.create",
  method: "POST",
  path: "/api/v1/canvas-capability-runs",
  summary: "Start one governed Canvas Capability Run",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateCanvasCapabilityRunBodySchema,
  },
  responses: {
    201: CapabilityRunAcceptedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const createCapabilityRunRoute = defineRoute({
  operationId: "capabilityRuns.create",
  method: "POST",
  path: "/api/v1/capability-runs",
  summary: "Start one governed user Capability Run",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateCapabilityRunBodySchema,
  },
  responses: {
    201: CapabilityRunAcceptedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getCapabilityRunRoute = defineRoute({
  operationId: "capabilityRuns.get",
  method: "GET",
  path: "/api/v1/capability-runs/{capabilityRunId}",
  summary: "Get one governed Capability Run",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: CapabilityRunPathSchema,
  },
  responses: {
    200: CapabilityRunDetailsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const cancelCapabilityRunRoute = defineRoute({
  operationId: "capabilityRuns.cancel",
  method: "POST",
  path: "/api/v1/capability-runs/{capabilityRunId}/cancel",
  summary: "Request cancellation of one governed direct Capability Run",
  request: {
    headers: IdempotencyHeadersSchema,
    path: CapabilityRunPathSchema,
    body: CancelCapabilityRunBodySchema,
  },
  responses: {
    200: CapabilityRunDetailsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkspaceModelResourcesRoute = defineRoute({
  operationId: "workspaceModelResources.list",
  method: "GET",
  path: "/api/v1/model-resources",
  summary: "List Browser and Worker model resources for one Workspace",
  request: { headers: WorkspaceScopeHeadersSchema },
  responses: {
    200: WorkspaceModelResourcesSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const startWorkspaceModelResourceImportRoute = defineRoute({
  operationId: "workspaceModelResourceImports.start",
  method: "POST",
  path: "/api/v1/model-resource-imports",
  summary: "Start a URL or local-file model resource import",
  request: {
    headers: IdempotencyHeadersSchema,
    body: StartModelResourceImportBodySchema,
  },
  responses: {
    201: ModelResourceImportSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getWorkspaceModelResourceImportRoute = defineRoute({
  operationId: "workspaceModelResourceImports.get",
  method: "GET",
  path: "/api/v1/model-resource-imports/{modelResourceImportId}",
  summary: "Read automatic model resource import analysis",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: ModelResourceImportPathSchema,
  },
  responses: {
    200: ModelResourceImportSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const cancelWorkspaceModelResourceImportRoute = defineRoute({
  operationId: "workspaceModelResourceImports.cancel",
  method: "POST",
  path: "/api/v1/model-resource-imports/{modelResourceImportId}/cancel",
  summary: "Request cancellation of one model resource download",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ModelResourceImportPathSchema,
    body: CancelModelResourceImportBodySchema,
  },
  responses: {
    200: ModelResourceImportSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const uploadWorkspaceModelResourceImportRoute = defineRoute({
  operationId: "workspaceModelResourceImports.upload",
  method: "PUT",
  path: "/api/v1/model-resource-imports/{modelResourceImportId}/content",
  summary: "Stream local model bytes into the allocated immutable object",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: ModelResourceImportPathSchema,
    body: ModelResourceImportBinaryContentSchema,
  },
  responses: {
    200: ModelResourceImportIngestionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    415: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const publishWorkspaceModelResourceImportRoute = defineRoute({
  operationId: "workspaceModelResourceImports.publish",
  method: "POST",
  path: "/api/v1/model-resource-imports/{modelResourceImportId}/publish",
  summary: "Publish analyzed bytes as an immutable model resource revision",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ModelResourceImportPathSchema,
    body: PublishModelResourceImportBodySchema,
  },
  responses: {
    200: ModelResourceMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getBrowserRuntimeManifestRoute = defineRoute({
  operationId: "browserRuntime.getManifest",
  method: "GET",
  path: "/api/v1/browser-runtime-manifest",
  summary:
    "Resolve Browser runtime implementations and their pinned model release",
  request: { headers: WorkspaceScopeHeadersSchema },
  responses: {
    200: BrowserRuntimeManifestSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const downloadBrowserModelResourceRoute = defineRoute({
  operationId: "browserRuntime.downloadModelResource",
  method: "GET",
  path: "/api/v1/model-resource-revisions/{modelResourceRevisionId}/content",
  summary:
    "Reauthorize and stream one immutable Browser model resource revision",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: ModelResourceRevisionPathSchema,
  },
  responses: {
    200: ModelResourceBinaryContentSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const setWorkspaceModelResourceStatusRoute = defineRoute({
  operationId: "workspaceModelResources.setStatus",
  method: "PATCH",
  path: "/api/v1/model-resources/{modelResourceId}/status",
  summary: "Archive or restore one model resource without deleting revisions",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: ModelResourcePathSchema,
    body: SetModelResourceStatusBodySchema,
  },
  responses: {
    200: ModelResourceMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkspaceCapabilityDefinitionRoute = defineRoute({
  operationId: "workspaceCapabilityDefinitions.create",
  method: "POST",
  path: "/api/v1/capability-definitions",
  summary:
    "Create one disabled Capability and atomically publish its first Contract, Declaration, Implementation, and Binding",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateCapabilityDefinitionBodySchema,
  },
  responses: {
    201: CapabilityDefinitionMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const installCapabilityRecommendationRoute = defineRoute({
  operationId: "workspaceCapabilityDefinitions.installRecommendation",
  method: "POST",
  path: "/api/v1/capability-recommendations/{catalogEntryId}/install",
  summary:
    "Install and enable one recommended Capability after its confirmed default-route dependencies are ready",
  request: {
    headers: IdempotencyHeadersSchema,
    path: CapabilityCatalogEntryPathSchema,
    body: InstallCapabilityRecommendationBodySchema,
  },
  responses: {
    201: CapabilityInstallationSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const publishCapabilityDefinitionImplementationRoute = defineRoute({
  operationId: "workspaceCapabilityDefinitions.publishImplementation",
  method: "POST",
  path: "/api/v1/capability-definitions/{capabilityDefinitionId}/implementations",
  summary:
    "Compile, test, and publish one immutable Capability implementation and binding",
  request: {
    headers: IdempotencyHeadersSchema,
    path: CapabilityDefinitionPathSchema,
    body: PublishCapabilityImplementationRevisionBodySchema,
  },
  responses: {
    201: CapabilityBindingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const updateWorkspaceCapabilityDefinitionRoute = defineRoute({
  operationId: "workspaceCapabilityDefinitions.update",
  method: "PUT",
  path: "/api/v1/capability-definitions/{capabilityDefinitionId}",
  summary:
    "Publish the next immutable discovery-metadata Declaration without changing the public Contract",
  request: {
    headers: IdempotencyHeadersSchema,
    path: CapabilityDefinitionPathSchema,
    body: UpdateCapabilityDefinitionBodySchema,
  },
  responses: {
    200: CapabilityDefinitionMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const setWorkspaceCapabilityDefinitionStatusRoute = defineRoute({
  operationId: "workspaceCapabilityDefinitions.setStatus",
  method: "PATCH",
  path: "/api/v1/capability-definitions/{capabilityDefinitionId}/status",
  summary:
    "Archive or restore one Capability definition without deleting immutable history",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CapabilityDefinitionPathSchema,
    body: SetCapabilityDefinitionStatusBodySchema,
  },
  responses: {
    200: CapabilityDefinitionMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const setCapabilityBindingStatusRoute = defineRoute({
  operationId: "workspaceCapabilityBindings.setStatus",
  method: "PATCH",
  path: "/api/v1/capability-bindings/{capabilityBindingId}/status",
  summary:
    "Pause or resume one authorized Workspace capability execution candidate",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CapabilityBindingPathSchema,
    body: SetCapabilityBindingStatusBodySchema,
  },
  responses: {
    200: CapabilityBindingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const moveCapabilityBindingRoute = defineRoute({
  operationId: "workspaceCapabilityBindings.move",
  method: "PATCH",
  path: "/api/v1/capability-bindings/{capabilityBindingId}/position",
  summary:
    "Move one authorized Workspace capability execution candidate relative to its current neighbor",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CapabilityBindingPathSchema,
    body: MoveCapabilityBindingBodySchema,
  },
  responses: {
    200: CapabilityBindingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkspaceProviderSettingRoute = defineRoute({
  operationId: "workspaceProviderSettings.create",
  method: "POST",
  path: "/api/v1/provider-settings",
  summary:
    "Validate, save, and enable one Workspace Provider setting without returning secret material",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateProviderSettingBodySchema,
  },
  responses: {
    201: ProviderSettingCreatedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const createWorkspaceModelRoute = defineRoute({
  operationId: "workspaceModels.create",
  method: "POST",
  path: "/api/v1/models",
  summary: "Create one canonical Workspace model identity",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: CreateCanonicalModelBodySchema,
  },
  responses: {
    201: CanonicalModelMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const publishWorkspaceModelRoute = defineRoute({
  operationId: "workspaceModels.publish",
  method: "POST",
  path: "/api/v1/models/{modelId}/publications",
  summary: "Publish the editable metadata for one canonical Workspace model",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CanonicalModelPathSchema,
    body: PublishCanonicalModelBodySchema,
  },
  responses: {
    200: CanonicalModelMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const importWorkspaceProviderModelsRoute = defineRoute({
  operationId: "workspaceProviderSettings.importModels",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/model-imports",
  summary: "Import selected models from the current Provider catalog",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: ProviderSettingPathSchema,
    body: ImportProviderModelsBodySchema,
  },
  responses: {
    200: ProviderModelsImportedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const mapWorkspaceProviderModelRoute = defineRoute({
  operationId: "workspaceProviderSettings.mapModel",
  method: "PATCH",
  path: "/api/v1/provider-settings/{providerSettingId}/provider-models/{providerModelId}",
  summary: "Map one Provider model ID to a canonical Workspace model",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: ProviderModelPathSchema,
    body: MapProviderModelBodySchema,
  },
  responses: {
    200: CanonicalModelMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const publishWorkspaceProviderModelRoute = defineRoute({
  operationId: "workspaceProviderSettings.publishModel",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/provider-models/{providerModelId}/publications",
  summary: "Publish one mapped Provider model with verified pricing",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: ProviderModelPathSchema,
    body: PublishProviderModelBodySchema,
  },
  responses: {
    200: CanonicalModelMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const discoverWorkspaceProviderModelsRoute = defineRoute({
  operationId: "workspaceProviderSettings.discoverModels",
  method: "POST",
  path: "/api/v1/provider-settings/model-discovery",
  summary:
    "Discover the image models and evidenced capabilities available to one Provider credential",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: DiscoverProviderModelsBodySchema,
  },
  responses: {
    200: ProviderModelDiscoveryResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const refreshWorkspaceProviderModelCatalogRoute = defineRoute({
  operationId: "workspaceProviderSettings.refreshModelCatalog",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/model-catalog-refreshes",
  summary:
    "Discover, probe, and append an immutable model catalog snapshot using the stored active or verified staged credential",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ProviderSettingPathSchema,
    body: RefreshProviderModelCatalogBodySchema,
  },
  responses: {
    200: ProviderModelCatalogRefreshResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const reviewWorkspaceProviderModelCatalogRoute = defineRoute({
  operationId: "workspaceProviderSettings.reviewModelCatalog",
  method: "GET",
  path: "/api/v1/provider-settings/{providerSettingId}/model-catalog-review",
  summary:
    "Compare the current and activated immutable model catalog snapshots without contacting the Provider",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: ProviderSettingPathSchema,
  },
  responses: {
    200: ProviderModelCatalogReviewSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const adoptWorkspaceProviderModelCatalogRoute = defineRoute({
  operationId: "workspaceProviderSettings.adoptModelCatalog",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/model-catalog-adoptions",
  summary:
    "Re-discover and probe the stored Provider credential before atomically adopting the reviewed catalog revision",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ProviderSettingPathSchema,
    body: AdoptProviderModelCatalogBodySchema,
  },
  responses: {
    200: ProviderModelCatalogAdoptionResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const validateWorkspaceProviderSettingRoute = defineRoute({
  operationId: "workspaceProviderSettings.validate",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/validation",
  summary:
    "Verify the stored credential and configured models through read-only upstream Provider APIs",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ProviderSettingPathSchema,
    body: ValidateProviderSettingBodySchema,
  },
  responses: {
    200: ProviderSettingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const activateWorkspaceProviderSettingRoute = defineRoute({
  operationId: "workspaceProviderSettings.activate",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/activation",
  summary:
    "Compile and atomically activate one validated Workspace Provider setting",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ProviderSettingPathSchema,
    body: ActivateProviderSettingBodySchema,
  },
  responses: {
    200: ProviderSettingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const rotateWorkspaceProviderSettingSecretRoute = defineRoute({
  operationId: "workspaceProviderSettings.rotateSecret",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/secret-rotations",
  summary:
    "Encrypt, verify, and rotate one Workspace Provider credential secret",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ProviderSettingPathSchema,
    body: RotateProviderSettingSecretBodySchema,
  },
  responses: {
    200: ProviderSettingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const disableWorkspaceProviderSettingRoute = defineRoute({
  operationId: "workspaceProviderSettings.disable",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/disablement",
  summary: "Disable one Workspace Provider setting for new route selection",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ProviderSettingPathSchema,
    body: ProviderSettingVersionBodySchema,
  },
  responses: {
    200: ProviderSettingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const deleteWorkspaceProviderSettingRoute = defineRoute({
  operationId: "workspaceProviderSettings.delete",
  method: "POST",
  path: "/api/v1/provider-settings/{providerSettingId}/deletion",
  summary: "Remove one Workspace Provider setting from active configuration",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ProviderSettingPathSchema,
    body: ProviderSettingVersionBodySchema,
  },
  responses: {
    200: ProviderSettingMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkspaceResourceSourcesRoute = defineRoute({
  operationId: "workspaceResourceSources.list",
  method: "GET",
  path: "/api/v1/resource-sources",
  summary: "List configured external resource sources for one Workspace",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceResourceSourcesSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listResourceSourceTypesRoute = defineRoute({
  operationId: "resourceSourceTypes.list",
  method: "GET",
  path: "/api/v1/resource-source-types",
  summary: "List trusted configurable external resource source Adapter types",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: ResourceSourceTypeListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listResourceCatalogSourcesRoute = defineRoute({
  operationId: "resourceCatalog.listSources",
  method: "GET",
  path: "/api/v1/resource-catalog/sources",
  summary:
    "List published external resource sources available to the Workspace",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: ResourceCatalogSourceListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const searchResourceCatalogRoute = defineRoute({
  operationId: "resourceCatalog.search",
  method: "GET",
  path: "/api/v1/resource-catalog/search",
  summary: "Search one pinned published external resource source",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: ResourceCatalogSearchQuerySchema,
  },
  responses: {
    200: ResourceCatalogSearchResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const adoptResourceCatalogCandidateRoute = defineRoute({
  operationId: "resourceCatalog.adopt",
  method: "POST",
  path: "/api/v1/resource-catalog/adoptions",
  summary: "Resolve, verify, and adopt one external resource into Kanvas",
  request: {
    headers: IdempotencyHeadersSchema,
    body: ResourceAdoptionRequestSchema,
  },
  responses: {
    201: ResourceAdoptionResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkspaceFontCatalogRoute = defineRoute({
  operationId: "resourceCatalog.listFonts",
  method: "GET",
  path: "/api/v1/resource-catalog/fonts",
  summary: "List internally adopted immutable Workspace font revisions",
  request: { headers: WorkspaceScopeHeadersSchema },
  responses: {
    200: WorkspaceFontCatalogSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listWorkspaceArtTextCatalogRoute = defineRoute({
  operationId: "resourceCatalog.listArtText",
  method: "GET",
  path: "/api/v1/resource-catalog/art-text",
  summary: "List internally adopted editable Workspace Art Text revisions",
  request: { headers: WorkspaceScopeHeadersSchema },
  responses: {
    200: WorkspaceArtTextCatalogSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkspaceResourceSourceRoute = defineRoute({
  operationId: "workspaceResourceSources.create",
  method: "POST",
  path: "/api/v1/resource-sources",
  summary:
    "Create one external resource source and securely stage optional credential material",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateResourceSourceBodySchema,
  },
  responses: {
    201: ResourceSourceCreatedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const validateWorkspaceResourceSourceRoute = defineRoute({
  operationId: "workspaceResourceSources.validate",
  method: "POST",
  path: "/api/v1/resource-sources/{resourceSourceId}/validation",
  summary: "Validate one configured external resource source",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ResourceSourcePathSchema,
    body: ValidateResourceSourceBodySchema,
  },
  responses: {
    200: ResourceSourceMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const publishWorkspaceResourceSourceRoute = defineRoute({
  operationId: "workspaceResourceSources.publish",
  method: "POST",
  path: "/api/v1/resource-sources/{resourceSourceId}/publication",
  summary: "Publish one validated immutable external resource source revision",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ResourceSourcePathSchema,
    body: PublishResourceSourceBodySchema,
  },
  responses: {
    200: ResourceSourceMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const disableWorkspaceResourceSourceRoute = defineRoute({
  operationId: "workspaceResourceSources.disable",
  method: "POST",
  path: "/api/v1/resource-sources/{resourceSourceId}/disablement",
  summary: "Disable one external resource source while retaining its history",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ResourceSourcePathSchema,
    body: ResourceSourceVersionBodySchema,
  },
  responses: {
    200: ResourceSourceMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const rotateWorkspaceResourceSourceCredentialRoute = defineRoute({
  operationId: "workspaceResourceSources.rotateCredential",
  method: "POST",
  path: "/api/v1/resource-sources/{resourceSourceId}/credential-rotations",
  summary:
    "Securely rotate one authenticated external resource source credential",
  request: {
    headers: IdempotencyHeadersSchema,
    path: ResourceSourcePathSchema,
    body: RotateResourceSourceCredentialBodySchema,
  },
  responses: {
    200: ResourceSourceMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkspaceAssetsRoute = defineRoute({
  operationId: "workspaceAssets.list",
  method: "GET",
  path: "/api/v1/assets",
  summary: "List a bounded authorized projection of Workspace Assets",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: WorkspaceAssetListQuerySchema,
  },
  responses: {
    200: WorkspaceAssetListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceAssetRoute = defineRoute({
  operationId: "workspaceAssets.get",
  method: "GET",
  path: "/api/v1/assets/{assetId}",
  summary:
    "Get one authorized Workspace Asset with current Artifact, bounded history, and lineage",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkspaceAssetPathSchema,
    query: WorkspaceAssetDetailQuerySchema,
  },
  responses: {
    200: WorkspaceAssetDetailSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkspaceAssetFromArtifactRoute = defineRoute({
  operationId: "workspaceAssets.createFromArtifact",
  method: "POST",
  path: "/api/v1/assets",
  summary:
    "Create a Workspace Asset by adopting one authorized immutable Artifact",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateWorkspaceAssetFromArtifactBodySchema,
  },
  responses: {
    201: WorkspaceAssetAdoptionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const createCanvasDraftRoute = defineRoute({
  operationId: "canvasDrafts.create",
  method: "POST",
  path: "/api/v1/canvas-drafts",
  summary:
    "Create an authorized, recoverable Canvas Draft from an Editor Document",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateCanvasDraftBodySchema,
  },
  responses: {
    201: CanvasDraftMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listCanvasDraftsRoute = defineRoute({
  operationId: "canvasDrafts.list",
  method: "GET",
  path: "/api/v1/canvas-drafts",
  summary:
    "List the most recently updated Canvas Drafts in one authorized Workspace",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: CanvasDraftListQuerySchema,
  },
  responses: {
    200: CanvasDraftListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getCanvasDraftRoute = defineRoute({
  operationId: "canvasDrafts.get",
  method: "GET",
  path: "/api/v1/canvas-drafts/{canvasDraftId}",
  summary: "Get one authorized Canvas Draft and its current optimistic version",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: CanvasDraftPathSchema,
  },
  responses: {
    200: CanvasDraftSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const updateCanvasDraftRoute = defineRoute({
  operationId: "canvasDrafts.update",
  method: "PUT",
  path: "/api/v1/canvas-drafts/{canvasDraftId}",
  summary: "Replace one Canvas Draft under optimistic concurrency control",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CanvasDraftPathSchema,
    body: UpdateCanvasDraftBodySchema,
  },
  responses: {
    200: CanvasDraftMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const updateCanvasDraftBrandRoute = defineRoute({
  operationId: "canvasDrafts.updateBrand",
  method: "PATCH",
  path: "/api/v1/canvas-drafts/{canvasDraftId}/brand",
  summary: "Adopt one published Brand Revision on a Canvas Draft",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CanvasDraftPathSchema,
    body: UpdateCanvasDraftBrandBodySchema,
  },
  responses: {
    200: CanvasDraftMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listCanvasDraftRevisionsRoute = defineRoute({
  operationId: "canvasDrafts.listRevisions",
  method: "GET",
  path: "/api/v1/canvas-drafts/{canvasDraftId}/revisions",
  summary: "List the bounded recent revision history of one Canvas Draft",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: CanvasDraftPathSchema,
    query: CanvasDraftRevisionListQuerySchema,
  },
  responses: {
    200: CanvasDraftRevisionListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getCanvasDraftRevisionRoute = defineRoute({
  operationId: "canvasDrafts.getRevision",
  method: "GET",
  path: "/api/v1/canvas-drafts/{canvasDraftId}/revisions/{version}",
  summary: "Get one retained immutable Canvas Draft revision",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: CanvasDraftRevisionPathSchema,
  },
  responses: {
    200: CanvasDraftRevisionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const restoreCanvasDraftRoute = defineRoute({
  operationId: "canvasDrafts.restore",
  method: "POST",
  path: "/api/v1/canvas-drafts/{canvasDraftId}/restore",
  summary: "Restore one retained revision as a new Canvas Draft version",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CanvasDraftPathSchema,
    body: RestoreCanvasDraftBodySchema,
  },
  responses: {
    200: CanvasDraftMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listWorkspaceCreationEntrypointsRoute = defineRoute({
  operationId: "workspaceCreationEntrypoints.list",
  method: "GET",
  path: "/api/v1/creation-entrypoints",
  summary:
    "List published and enabled creation entrypoints available in the current Workspace",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceCreationEntrypointListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkspaceInvitationRoute = defineRoute({
  operationId: "workspaceInvitations.create",
  method: "POST",
  path: "/api/v1/workspace-invitations",
  summary:
    "Create a one-time Workspace invitation and return its raw token once",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: CreateWorkspaceInvitationBodySchema,
  },
  responses: {
    201: WorkspaceInvitationCreatedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const resendWorkspaceInvitationRoute = defineRoute({
  operationId: "workspaceInvitations.resend",
  method: "POST",
  path: "/api/v1/workspace-invitations/{invitationId}/resends",
  summary: "Revoke one pending invitation and return a replacement token once",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: InvitationPathSchema,
    body: ResendWorkspaceInvitationBodySchema,
  },
  responses: {
    201: WorkspaceInvitationCreatedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const revokeWorkspaceInvitationRoute = defineRoute({
  operationId: "workspaceInvitations.revoke",
  method: "POST",
  path: "/api/v1/workspace-invitations/{invitationId}/revocations",
  summary: "Revoke one pending Workspace invitation",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: InvitationPathSchema,
    body: RevokeWorkspaceInvitationBodySchema,
  },
  responses: {
    200: WorkspaceInvitationRevokedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const acceptWorkspaceInvitationRoute = defineRoute({
  operationId: "workspaceInvitations.accept",
  method: "POST",
  path: "/api/v1/workspace-invitation-acceptances",
  summary: "Accept one invitation with the current verified Human session",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: AcceptWorkspaceInvitationBodySchema,
  },
  responses: {
    200: WorkspaceInvitationAcceptedSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const addWorkspaceMemberRoute = defineRoute({
  operationId: "workspaceMemberships.add",
  method: "POST",
  path: "/api/v1/workspace-memberships",
  summary: "Add an existing verified account to the current Workspace",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: AddWorkspaceMemberBodySchema,
  },
  responses: {
    200: ChangedWorkspaceMembershipSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const changeInstanceWorkspaceMembershipRoute = defineRoute({
  operationId: "instanceAccess.changeMembership",
  method: "PATCH",
  path: "/api/v1/instance/workspaces/{workspaceId}/members/{targetPrincipalId}",
  summary:
    "Manage a Workspace member using audited site administrator authority",
  request: {
    headers: BrowserMutationHeadersSchema,
    path: InstanceWorkspaceMemberPathSchema,
    body: ChangeWorkspaceMembershipBodySchema,
  },
  responses: {
    200: ChangedWorkspaceMembershipSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const createInstanceInvitationRoute = defineRoute({
  operationId: "instanceAccess.invite",
  method: "POST",
  path: "/api/v1/instance/workspaces/{workspaceId}/invitations",
  summary: "Invite a member using site administrator authority",
  request: {
    headers: BrowserMutationHeadersSchema,
    path: InstanceWorkspacePathSchema,
    body: CreateWorkspaceInvitationBodySchema,
  },
  responses: {
    200: WorkspaceInvitationCreatedSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const revokeInstanceInvitationRoute = defineRoute({
  operationId: "instanceAccess.revokeInvitation",
  method: "POST",
  path: "/api/v1/instance/workspaces/{workspaceId}/invitations/{invitationId}/revocations",
  summary: "Revoke an invitation using site administrator authority",
  request: {
    headers: BrowserMutationHeadersSchema,
    path: InstanceInvitationPathSchema,
    body: RevokeWorkspaceInvitationBodySchema,
  },
  responses: {
    200: WorkspaceInvitationRevokedSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const changeInstancePrincipalStatusRoute = defineRoute({
  operationId: "instanceAccess.changePrincipalStatus",
  method: "PATCH",
  path: "/api/v1/instance/principals/{targetPrincipalId}",
  summary:
    "Suspend or reactivate a site account with administrator and owner protections",
  request: {
    headers: BrowserMutationHeadersSchema,
    path: TargetPrincipalPathSchema,
    body: ChangeInstancePrincipalStatusBodySchema,
  },
  responses: {
    200: ChangedInstancePrincipalStatusSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const changeWorkspaceMembershipRoute = defineRoute({
  operationId: "workspaceMemberships.change",
  method: "PATCH",
  path: "/api/v1/workspace-memberships/{targetPrincipalId}",
  summary: "Change one Workspace membership with Last Owner protection",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: TargetPrincipalPathSchema,
    body: ChangeWorkspaceMembershipBodySchema,
  },
  responses: {
    200: ChangedWorkspaceMembershipSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const changeWorkspaceMembershipsRoute = defineRoute({
  operationId: "workspaceMemberships.changeBatch",
  method: "PATCH",
  path: "/api/v1/workspace-memberships",
  summary:
    "Atomically change up to 100 Workspace memberships with Last Owner protection",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: ChangeWorkspaceMembershipsBodySchema,
  },
  responses: {
    200: ChangedWorkspaceMembershipsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getDefaultAccessPolicyRoute = defineRoute({
  operationId: "defaultAccess.getPolicy",
  method: "GET",
  path: "/api/v1/instance/default-access",
  summary: "getPolicy default Workspace access",
  request: {},
  responses: {
    200: DefaultAccessPolicySchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const updateDefaultAccessPolicyRoute = defineRoute({
  operationId: "defaultAccess.updatePolicy",
  method: "PUT",
  path: "/api/v1/instance/default-access",
  summary: "updatePolicy default Workspace access",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: UpdateDefaultAccessPolicyBodySchema,
  },
  responses: {
    200: DefaultAccessPolicySchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const previewDefaultAccessRoute = defineRoute({
  operationId: "defaultAccess.preview",
  method: "GET",
  path: "/api/v1/instance/default-access/preview",
  summary: "preview default Workspace access",
  request: {},
  responses: {
    200: DefaultAccessPreviewSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const applyDefaultAccessRoute = defineRoute({
  operationId: "defaultAccess.apply",
  method: "POST",
  path: "/api/v1/instance/default-access/apply",
  summary: "apply default Workspace access",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: ApplyDefaultAccessBodySchema,
  },
  responses: {
    200: AppliedDefaultAccessSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const retryDefaultAccessRoute = defineRoute({
  operationId: "defaultAccess.retry",
  method: "POST",
  path: "/api/v1/default-access/retry",
  summary: "retry default Workspace access",
  request: { headers: BrowserMutationHeadersSchema },
  responses: {
    200: DefaultAccessStatusSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const getInstanceRegistrationSettingsRoute = defineRoute({
  operationId: "instanceRegistration.getSettings",
  method: "GET",
  path: "/api/v1/instance/registration-settings",
  summary:
    "Read the current account registration policy and deployment capabilities",
  request: {},
  responses: {
    200: InstanceRegistrationSettingsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const updateInstanceRegistrationPolicyRoute = defineRoute({
  operationId: "instanceRegistration.updatePolicy",
  method: "PUT",
  path: "/api/v1/instance/registration-settings",
  summary: "Update the audited Instance account registration policy",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: UpdateInstanceRegistrationPolicyBodySchema,
  },
  responses: {
    200: InstanceRegistrationSettingsSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const getInstanceAccessOverviewRoute = defineRoute({
  operationId: "instanceAccess.getOverview",
  method: "GET",
  path: "/api/v1/instance/access-overview",
  summary: "List site accounts and their Workspace memberships",
  request: {},
  responses: {
    200: InstanceAccessOverviewSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const grantInstanceWorkspaceAccessRoute = defineRoute({
  operationId: "instanceAccess.grantWorkspaceAccess",
  method: "POST",
  path: "/api/v1/instance/principals/{targetPrincipalId}/workspace-memberships",
  summary:
    "Grant one active Human Principal roles in one or more active Workspaces",
  request: {
    headers: BrowserMutationHeadersSchema,
    path: TargetPrincipalPathSchema,
    body: GrantInstanceWorkspaceAccessBodySchema,
  },
  responses: {
    200: GrantedInstanceWorkspaceAccessSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const resolveInstanceSetupRoute = defineRoute({
  operationId: "instanceSetup.resolve",
  method: "POST",
  path: "/api/v1/instance/setup/resolutions",
  summary: "Resolve a bounded public summary for a CLI-issued setup grant",
  request: {
    body: ResolveInstanceSetupBodySchema,
  },
  responses: {
    200: InstanceSetupSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["public"],
  idempotency: "none",
} satisfies RouteContract);

export const registerInstanceSetupAccountRoute = defineRoute({
  operationId: "instanceSetup.registerAccount",
  method: "POST",
  path: "/api/v1/instance/setup/registrations",
  summary:
    "Create one email-verified Human account bound to a valid setup grant",
  request: {
    body: RegisterInstanceSetupAccountBodySchema,
  },
  responses: {
    201: InstanceSetupAccountRegisteredSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["public"],
  idempotency: "none",
} satisfies RouteContract);

export const redeemInstanceSetupRoute = defineRoute({
  operationId: "instanceSetup.redeem",
  method: "POST",
  path: "/api/v1/instance/setup/redemptions",
  summary:
    "Redeem a CLI-issued one-time setup grant with the current Human session",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: InstanceSetupRedemptionBodySchema,
  },
  responses: {
    201: InstanceSetupRedemptionResponseSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const registerBrowserExecutorRoute = defineRoute({
  operationId: "browserExecutors.register",
  method: "POST",
  path: "/api/v1/browser-executor-sessions",
  summary:
    "Register a short-lived browser executor against the pinned runtime release",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: RegisterBrowserExecutorBodySchema,
  },
  responses: {
    201: RegisteredBrowserExecutorSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const claimBrowserAttemptRoute = defineRoute({
  operationId: "browserExecutors.claim",
  method: "POST",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/claim",
  summary: "Claim at most one browser attempt and return its opaque grant once",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: BrowserExecutorSessionPathSchema,
    body: ClaimBrowserAttemptBodySchema,
  },
  responses: {
    200: ClaimBrowserAttemptResponseSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const heartbeatBrowserAttemptRoute = defineRoute({
  operationId: "browserExecutors.heartbeatAttempt",
  method: "POST",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/assignments/{browserAssignmentId}/heartbeat",
  summary: "Renew one browser assignment using only its bounded attempt grant",
  request: {
    headers: BrowserAttemptGrantHeadersSchema,
    path: BrowserAssignmentPathSchema,
    body: HeartbeatBrowserAttemptBodySchema,
  },
  responses: {
    200: BrowserAttemptHeartbeatResponseSchema,
    400: ProblemDetailsSchema,
  },
  security: ["browserAttemptGrant"],
  idempotency: "none",
} satisfies RouteContract);

export const allocateBrowserAttemptOutputRoute = defineRoute({
  operationId: "browserExecutors.allocateAttemptOutput",
  method: "POST",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/assignments/{browserAssignmentId}/output-upload-sessions",
  summary:
    "Allocate one immutable server-owned output object for the current browser attempt",
  request: {
    headers: BrowserAttemptOutputAllocationHeadersSchema,
    path: BrowserAssignmentPathSchema,
    body: AllocateBrowserAttemptOutputBodySchema,
  },
  responses: {
    201: BrowserAttemptOutputUploadSessionSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["browserAttemptGrant"],
  idempotency: "required",
} satisfies RouteContract);

export const uploadBrowserAttemptOutputRoute = defineRoute({
  operationId: "browserExecutors.uploadAttemptOutput",
  method: "PUT",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/assignments/{browserAssignmentId}/output-upload-sessions/{uploadSessionId}/content",
  summary: "Stream, seal, and verify one allocated browser attempt output",
  request: {
    headers: BrowserAttemptOutputUploadHeadersSchema,
    path: BrowserAttemptOutputUploadSessionPathSchema,
    rawBody: {
      contentTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
      ],
      maximumBytes: 536_870_912,
    },
  },
  responses: {
    200: BrowserAttemptOutputIngestionSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    415: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["browserAttemptGrant"],
  idempotency: "optional",
} satisfies RouteContract);

export const allocateUserImportRoute = defineRoute({
  operationId: "userImports.allocate",
  method: "POST",
  path: "/api/v1/user-import-upload-sessions",
  summary:
    "Allocate one authenticated immutable server-owned User Import object",
  request: {
    headers: IdempotencyHeadersSchema,
    body: AllocateUserImportBodySchema,
  },
  responses: {
    201: UserImportUploadSessionSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const allocateCanvasExportRoute = defineRoute({
  operationId: "canvasExports.allocate",
  method: "POST",
  path: "/api/v1/canvas-export-sessions",
  summary: "Allocate one authenticated immutable Canvas Export object",
  request: {
    headers: IdempotencyHeadersSchema,
    body: AllocateCanvasExportBodySchema,
  },
  responses: {
    201: CanvasExportUploadSessionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getCanvasExportRoute = defineRoute({
  operationId: "canvasExports.get",
  method: "GET",
  path: "/api/v1/canvas-export-sessions/{exportSessionId}",
  summary: "Read the durable state and committed result of one Canvas Export",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: CanvasExportUploadSessionPathSchema,
  },
  responses: {
    200: CanvasExportUploadSessionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const uploadCanvasExportRoute = defineRoute({
  operationId: "canvasExports.upload",
  method: "PUT",
  path: "/api/v1/canvas-export-sessions/{exportSessionId}/content",
  summary: "Stream, seal, and verify one authenticated Canvas Export object",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CanvasExportUploadSessionPathSchema,
    rawBody: {
      contentTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
      ],
      maximumBytes: 536_870_912,
    },
  },
  responses: {
    200: CanvasExportIngestionSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    415: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "optional",
} satisfies RouteContract);

export const commitCanvasExportRoute = defineRoute({
  operationId: "canvasExports.commit",
  method: "POST",
  path: "/api/v1/canvas-export-sessions/{exportSessionId}/commit",
  summary:
    "Atomically commit a verified Canvas Export and its explicit Asset selection",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: CanvasExportUploadSessionPathSchema,
    body: CommitCanvasExportBodySchema,
  },
  responses: {
    200: CommittedCanvasExportSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "optional",
} satisfies RouteContract);

export const uploadUserImportRoute = defineRoute({
  operationId: "userImports.upload",
  method: "PUT",
  path: "/api/v1/user-import-upload-sessions/{uploadSessionId}/content",
  summary: "Stream, seal, and verify one authenticated User Import object",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: UserImportUploadSessionPathSchema,
    rawBody: {
      contentTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
      ],
      maximumBytes: 536_870_912,
    },
  },
  responses: {
    200: UserImportIngestionSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    415: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "optional",
} satisfies RouteContract);

export const commitUserImportRoute = defineRoute({
  operationId: "userImports.commit",
  method: "POST",
  path: "/api/v1/user-import-upload-sessions/{uploadSessionId}/commit",
  summary:
    "Atomically commit a verified User Import as StoredObject and Artifact",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: UserImportUploadSessionPathSchema,
    body: CommitUserImportBodySchema,
  },
  responses: {
    200: CommittedUserImportSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "optional",
} satisfies RouteContract);

export const downloadArtifactContentRoute = defineRoute({
  operationId: "artifacts.downloadContent",
  method: "GET",
  path: "/api/v1/artifacts/{artifactId}/content",
  summary:
    "Reauthorize and proxy one immutable Artifact byte stream with Range support",
  request: {
    headers: ArtifactDownloadHeadersSchema,
    path: ArtifactContentPathSchema,
  },
  responses: {
    200: ArtifactBinaryContentSchema,
    206: ArtifactBinaryContentSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    416: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getArtifactPreviewRoute = defineRoute({
  operationId: "artifacts.getPreview",
  method: "GET",
  path: "/api/v1/artifacts/{artifactId}/preview",
  summary: "Reauthorize and return one bounded immutable image preview",
  request: {
    headers: ArtifactDownloadHeadersSchema,
    path: ArtifactContentPathSchema,
  },
  responses: {
    200: ArtifactBinaryContentSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    415: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listTaskRecordsRoute = defineRoute({
  operationId: "operations.listTaskRecords",
  method: "GET",
  path: "/api/v1/task-records",
  summary: "List Workspace task records for authorized support operators",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: TaskRecordQuerySchema,
  },
  responses: {
    200: TaskRecordListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);
export const getTaskTimelineRoute = defineRoute({
  operationId: "operations.getTaskTimeline",
  method: "GET",
  path: "/api/v1/task-records/{kind}/{taskRunId}/timeline",
  summary: "Read safe execution facts for a Workspace task",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: TaskTimelinePathSchema,
  },
  responses: {
    200: TaskTimelineSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getOperationalTimelineRoute = defineRoute({
  operationId: "operations.getWorkflowTimeline",
  method: "GET",
  path: "/api/v1/workflow-runs/{workflowRunId}/operational-timeline",
  summary:
    "Project a bounded administrator timeline from authoritative Workflow facts",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkflowRunPathSchema,
  },
  responses: {
    200: OperationalTimelineSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const completeBrowserAttemptRoute = defineRoute({
  operationId: "browserExecutors.completeAttempt",
  method: "POST",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/assignments/{browserAssignmentId}/complete",
  summary:
    "Atomically adopt verified browser outputs and complete the current attempt",
  request: {
    headers: BrowserAttemptGrantHeadersSchema,
    path: BrowserAssignmentPathSchema,
    body: CompleteBrowserAttemptBodySchema,
  },
  responses: {
    200: BrowserAttemptCompletionResponseSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["browserAttemptGrant"],
  idempotency: "none",
} satisfies RouteContract);

export const acknowledgeBrowserAttemptCancellationRoute = defineRoute({
  operationId: "browserExecutors.acknowledgeAttemptCancellation",
  method: "POST",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/assignments/{browserAssignmentId}/cancellation-acknowledgement",
  summary:
    "Atomically acknowledge a signalled browser cancellation and settle its capability",
  request: {
    headers: BrowserAttemptGrantHeadersSchema,
    path: BrowserAssignmentPathSchema,
    body: AcknowledgeBrowserAttemptCancellationBodySchema,
  },
  responses: {
    200: BrowserAttemptCancellationAcknowledgementSchema,
    400: ProblemDetailsSchema,
    401: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["browserAttemptGrant"],
  idempotency: "none",
} satisfies RouteContract);

export const drainBrowserExecutorRoute = defineRoute({
  operationId: "browserExecutors.drain",
  method: "POST",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/drain",
  summary:
    "Stop a browser executor from claiming work while existing work converges",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: BrowserExecutorSessionPathSchema,
  },
  responses: {
    200: BrowserExecutorSessionTransitionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "optional",
} satisfies RouteContract);

export const revokeBrowserExecutorRoute = defineRoute({
  operationId: "browserExecutors.revoke",
  method: "POST",
  path: "/api/v1/browser-executor-sessions/{browserExecutorSessionId}/revoke",
  summary: "Fence a browser executor and prevent its assignments from renewing",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: BrowserExecutorSessionPathSchema,
  },
  responses: {
    200: BrowserExecutorSessionTransitionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["browserSession"],
  idempotency: "optional",
} satisfies RouteContract);

export const validateWorkflowTopologyRoute = defineRoute({
  operationId: "workflowTopologies.validate",
  method: "POST",
  path: "/api/v1/workflow-topologies/validate",
  summary: "Validate workflow topology without creating state",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: ValidateWorkflowTopologyBodySchema,
  },
  responses: {
    200: ValidateWorkflowTopologyResponseSchema,
    400: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkflowRunRoute = defineRoute({
  operationId: "workflowRuns.create",
  method: "POST",
  path: "/api/v1/workflow-runs",
  summary: "Create a workflow run pinned to a published revision",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateWorkflowRunBodySchema,
  },
  responses: {
    202: WorkflowRunAcceptedSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkflowRunsRoute = defineRoute({
  operationId: "workflowRuns.list",
  method: "GET",
  path: "/api/v1/workflow-runs",
  summary: "List the current principal's recent published workflow runs",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: WorkflowRunListQuerySchema,
  },
  responses: {
    200: WorkflowRunListSchema,
    400: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkflowRunRoute = defineRoute({
  operationId: "workflowRuns.get",
  method: "GET",
  path: "/api/v1/workflow-runs/{workflowRunId}",
  summary: "Get the current durable workflow run facts",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkflowRunPathSchema,
  },
  responses: {
    200: WorkflowRunDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const cancelWorkflowRunRoute = defineRoute({
  operationId: "workflowRuns.cancel",
  method: "POST",
  path: "/api/v1/workflow-runs/{workflowRunId}/cancel",
  summary: "Request monotonic cancellation of a workflow run",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: WorkflowRunPathSchema,
    body: CancelWorkflowRunBodySchema,
  },
  responses: {
    202: WorkflowRunCancellationAcceptedSchema,
    400: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "optional",
} satisfies RouteContract);

export const decideWorkflowApprovalRoute = defineRoute({
  operationId: "workflowRuns.decideApproval",
  method: "POST",
  path: "/api/v1/workflow-runs/{workflowRunId}/approval-decisions",
  summary: "Record an authorized decision for a pending workflow approval",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: WorkflowRunPathSchema,
    body: DecideWorkflowApprovalBodySchema,
  },
  responses: {
    200: WorkflowApprovalDecisionResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkflowDefinitionsRoute = defineRoute({
  operationId: "workflowDefinitions.list",
  method: "GET",
  path: "/api/v1/workflows",
  summary:
    "List independently authored Workflow Definitions in the current Workspace",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: WorkflowDefinitionListQuerySchema,
  },
  responses: {
    200: WorkflowDefinitionListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listWorkflowAuthoringCapabilitiesRoute = defineRoute({
  operationId: "workflowAuthoringCapabilities.list",
  method: "GET",
  path: "/api/v1/workflow-authoring-capabilities",
  summary:
    "List immutable Capability Contract revisions available to the Workflow author",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkflowAuthoringCapabilityListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkflowDraftRoute = defineRoute({
  operationId: "workflowDrafts.create",
  method: "POST",
  path: "/api/v1/workflow-drafts",
  summary:
    "Create an independent Workflow Definition and its first authoring Draft",
  request: {
    headers: IdempotencyHeadersSchema,
    body: CreateWorkflowDraftBodySchema,
  },
  responses: {
    201: WorkflowDraftMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getWorkflowDraftRoute = defineRoute({
  operationId: "workflowDrafts.get",
  method: "GET",
  path: "/api/v1/workflows/{workflowDefinitionId}",
  summary: "Get one Workflow Definition and its current Draft",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkflowDefinitionPathSchema,
  },
  responses: {
    200: WorkflowDraftSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const updateWorkflowDraftRoute = defineRoute({
  operationId: "workflowDrafts.update",
  method: "PUT",
  path: "/api/v1/workflows/{workflowDefinitionId}/drafts/{workflowDraftId}",
  summary:
    "Replace Workflow metadata and Draft content under optimistic concurrency control",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: WorkflowDraftPathSchema,
    body: UpdateWorkflowDraftBodySchema,
  },
  responses: {
    200: WorkflowDraftMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const archiveWorkflowDraftRoute = defineRoute({
  operationId: "workflowDrafts.archive",
  method: "POST",
  path: "/api/v1/workflows/{workflowDefinitionId}/drafts/{workflowDraftId}/archive",
  summary: "Archive one Workflow Definition and its current Draft",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: WorkflowDraftPathSchema,
    body: ArchiveWorkflowDraftBodySchema,
  },
  responses: {
    200: WorkflowDraftMutationResultSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listWorkflowCandidatesRoute = defineRoute({
  operationId: "workflowCandidates.list",
  method: "GET",
  path: "/api/v1/workflow-candidates",
  summary: "List immutable Workflow Publication Candidates",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: WorkflowCandidateListQuerySchema,
  },
  responses: {
    200: WorkflowCandidateListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const submitWorkflowCandidateRoute = defineRoute({
  operationId: "workflowCandidates.submit",
  method: "POST",
  path: "/api/v1/workflows/{workflowDefinitionId}/drafts/{workflowDraftId}/candidates",
  summary:
    "Freeze one Workflow Draft version as a Publication Candidate and run trusted checks",
  request: {
    headers: IdempotencyHeadersSchema,
    path: WorkflowDraftPathSchema,
    body: SubmitWorkflowCandidateBodySchema,
  },
  responses: {
    201: WorkflowCandidateReviewSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getWorkflowCandidateRoute = defineRoute({
  operationId: "workflowCandidates.get",
  method: "GET",
  path: "/api/v1/workflow-candidates/{workflowCandidateId}",
  summary: "Get one immutable Candidate with checks and review",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkflowCandidatePathSchema,
  },
  responses: {
    200: WorkflowCandidateReviewSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const startWorkflowCandidateTestRoute = defineRoute({
  operationId: "workflowCandidates.startTest",
  method: "POST",
  path: "/api/v1/workflow-candidates/{workflowCandidateId}/test-runs",
  summary:
    "Start a non-production WorkflowRun pinned to one immutable Candidate",
  request: {
    headers: IdempotencyHeadersSchema,
    path: WorkflowCandidatePathSchema,
    body: StartWorkflowCandidateTestBodySchema,
  },
  responses: {
    202: WorkflowRunAcceptedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const recordWorkflowCandidateEvalRoute = defineRoute({
  operationId: "workflowCandidates.recordEval",
  method: "POST",
  path: "/api/v1/workflow-candidates/{workflowCandidateId}/eval-checks",
  summary: "Derive the Candidate Eval check from a terminal Candidate Test Run",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: WorkflowCandidatePathSchema,
    body: RecordWorkflowCandidateEvalBodySchema,
  },
  responses: {
    200: WorkflowCandidateReviewSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const reviewWorkflowCandidateRoute = defineRoute({
  operationId: "workflowCandidates.review",
  method: "POST",
  path: "/api/v1/workflow-candidates/{workflowCandidateId}/reviews",
  summary: "Approve or reject one immutable Workflow Candidate",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: WorkflowCandidatePathSchema,
    body: ReviewWorkflowCandidateBodySchema,
  },
  responses: {
    200: WorkflowCandidateReviewSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const publishWorkflowCandidateRoute = defineRoute({
  operationId: "workflowCandidates.publish",
  method: "POST",
  path: "/api/v1/workflow-candidates/{workflowCandidateId}/publications",
  summary: "Publish an approved Candidate as one immutable Workflow Revision",
  request: {
    headers: IdempotencyHeadersSchema,
    path: WorkflowCandidatePathSchema,
    body: PublishWorkflowCandidateBodySchema,
  },
  responses: {
    200: WorkflowCandidateReviewSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkflowTemplatesRoute = defineRoute({
  operationId: "workflowTemplates.list",
  method: "GET",
  path: "/api/v1/workflow-templates",
  summary: "List published Workflow Revisions projected as reusable templates",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    query: WorkflowTemplateListQuerySchema,
  },
  responses: {
    200: WorkflowTemplateListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkflowTemplateRoute = defineRoute({
  operationId: "workflowTemplates.get",
  method: "GET",
  path: "/api/v1/workflow-templates/{workflowRevisionId}",
  summary: "Get one published Workflow Revision as a template detail",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkflowTemplatePathSchema,
  },
  responses: {
    200: WorkflowTemplateSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listResourceStatesRoute = defineRoute({
  operationId: "resourceStates.list",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/hub/{subjectKind}/states",
  summary: "List managed resources and recoverable deleted resources",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: ResourceStateListPathSchema,
  },
  responses: {
    200: ResourceStateListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);
export const changeResourceStateRoute = defineRoute({
  operationId: "resourceStates.change",
  method: "PATCH",
  path: "/api/v1/workspaces/{workspaceId}/hub/{subjectKind}/{subjectId}/state",
  summary: "Enable, disable, soft delete or restore a resource",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: AgentHubSubjectPathSchema,
    body: ChangeResourceStateBodySchema,
  },
  responses: {
    204: Type.Null(),
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);
export const listAgentHubAgentsRoute = defineRoute({
  operationId: "agentHubAgents.list",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/agents",
  summary: "List Agents visible to the current workspace member",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkspaceAgentPathSchema,
  },
  responses: {
    200: AgentHubAgentsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createAgentHubAgentRoute = defineRoute({
  operationId: "agentHubAgents.create",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/agents",
  summary: "Create and publish one Agent",
  request: {
    headers: IdempotencyHeadersSchema,
    path: WorkspaceAgentPathSchema,
    body: CreateAgentHubAgentBodySchema,
  },
  responses: {
    201: AgentHubAgentSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getAgentHubAgentRoute = defineRoute({
  operationId: "agentHubAgents.get",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/agents/{agentDefinitionId}",
  summary: "Get one Agent configuration and its bound resources",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: AgentHubAgentPathSchema,
    query: AgentHubAgentReadQuerySchema,
  },
  responses: {
    200: AgentHubAgentDetailSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const updateAgentHubAgentRoute = defineRoute({
  operationId: "agentHubAgents.update",
  method: "PATCH",
  path: "/api/v1/workspaces/{workspaceId}/agents/{agentDefinitionId}",
  summary: "Publish a new configuration revision for one Agent",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: AgentHubAgentPathSchema,
    body: UpdateAgentHubAgentBodySchema,
  },
  responses: {
    200: AgentHubAgentDetailSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listAgentHubSkillsRoute = defineRoute({
  operationId: "agentHubSkills.list",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/skills",
  summary: "List published Skills visible to the current workspace member",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkspaceAgentPathSchema,
  },
  responses: {
    200: AgentHubSkillsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getAgentHubSkillRoute = defineRoute({
  operationId: "agentHubSkills.get",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/skills/{skillDefinitionId}",
  summary: "Get one published Skill and its readable instructions",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: SkillDefinitionPathSchema,
  },
  responses: {
    200: AgentHubSkillDetailSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getSkillFileRoute = defineRoute({
  operationId: "skillFiles.getPublished",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/skills/{skillDefinitionId}/files",
  summary: "Read an authorized published Skill file",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: SkillDefinitionPathSchema,
    query: SkillFileQuerySchema,
  },
  responses: {
    200: ArtifactBinaryContentSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);
export const getSkillDraftFileRoute = defineRoute({
  operationId: "skillFiles.getDraft",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/skill-drafts/{skillDraftId}/files",
  summary: "Read an authorized Skill Draft file at the expected version",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: SkillDraftPathSchema,
    query: SkillDraftFileQuerySchema,
  },
  responses: {
    200: ArtifactBinaryContentSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const listSkillDraftsRoute = defineRoute({
  operationId: "skillDrafts.list",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/skill-drafts",
  summary: "List the current member's editable Skill Drafts",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkspaceAgentPathSchema,
  },
  responses: {
    200: SkillDraftListSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createSkillDraftRoute = defineRoute({
  operationId: "skillDrafts.create",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/skill-drafts",
  summary: "Create one Skill Draft backed by a standard SKILL.md",
  request: {
    headers: IdempotencyHeadersSchema,
    path: WorkspaceAgentPathSchema,
    body: CreateSkillDraftBodySchema,
  },
  responses: {
    201: SkillDraftSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const getSkillDraftRoute = defineRoute({
  operationId: "skillDrafts.get",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/skill-drafts/{skillDraftId}",
  summary: "Read one editable Skill Draft",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: SkillDraftPathSchema,
  },
  responses: {
    200: SkillDraftDetailSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const importSkillPackageRoute = defineRoute({
  operationId: "skillDrafts.importPackage",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/skill-imports",
  summary: "Quarantine and import one standard Skill ZIP as a Draft",
  request: {
    headers: IdempotencyHeadersSchema,
    path: WorkspaceAgentPathSchema,
    body: ArtifactBinaryContentSchema,
  },
  responses: {
    201: SkillDraftSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    413: ProblemDetailsSchema,
    415: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const updateSkillDraftRoute = defineRoute({
  operationId: "skillDrafts.update",
  method: "PATCH",
  path: "/api/v1/workspaces/{workspaceId}/skill-drafts/{skillDraftId}",
  summary: "Update one Skill Draft and its presentation",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: SkillDraftPathSchema,
    body: UpdateSkillDraftBodySchema,
  },
  responses: {
    200: SkillDraftSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const archiveSkillDraftRoute = defineRoute({
  operationId: "skillDrafts.archive",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/skill-drafts/{skillDraftId}/archive",
  summary: "Archive one editable Skill Draft",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: SkillDraftPathSchema,
    body: ArchiveSkillDraftBodySchema,
  },
  responses: {
    204: Type.Null(),
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const submitSkillCandidateRoute = defineRoute({
  operationId: "skillCandidates.submit",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/skill-drafts/{skillDraftId}/candidates",
  summary: "Freeze one Skill Draft and run trusted static checks",
  request: {
    headers: IdempotencyHeadersSchema,
    path: SkillDraftPathSchema,
    body: SubmitSkillCandidateBodySchema,
  },
  responses: {
    200: SkillDraftSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const recordSkillCandidateTestRoute = defineRoute({
  operationId: "skillCandidates.recordTest",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/skill-candidates/{skillCandidateId}/tests",
  summary: "Record one terminal Agent Run as Candidate Test evidence",
  request: {
    headers: IdempotencyHeadersSchema,
    path: SkillCandidatePathSchema,
    body: RecordSkillCandidateTestBodySchema,
  },
  responses: {
    200: SkillDraftSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const publishSkillCandidateRoute = defineRoute({
  operationId: "skillCandidates.publish",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/skill-candidates/{skillCandidateId}/publications",
  summary: "Publish one checked Skill Candidate without mandatory review",
  request: {
    headers: IdempotencyHeadersSchema,
    path: SkillCandidatePathSchema,
    body: PublishSkillCandidateBodySchema,
  },
  responses: {
    200: AgentHubSkillSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const changeSkillRuntimeStatusRoute = defineRoute({
  operationId: "skillRevisions.changeRuntimeStatus",
  method: "PATCH",
  path: "/api/v1/workspaces/{workspaceId}/skill-revisions/{skillRevisionId}/runtime-status",
  summary: "Enable, disable, or irrevocably revoke one Skill Revision",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: SkillRevisionPathSchema,
    body: ChangeSkillRuntimeStatusBodySchema,
  },
  responses: {
    200: SkillRuntimeStatusSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const exportSkillPackageRoute = defineRoute({
  operationId: "skillRevisions.exportPackage",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/skills/{skillDefinitionId}/export",
  summary: "Export a published Skill as a standard ZIP package",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: SkillDefinitionPathSchema,
  },
  responses: {
    200: ArtifactBinaryContentSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const setAgentHubVisibilityRoute = defineRoute({
  operationId: "agentHubVisibility.set",
  method: "PATCH",
  path: "/api/v1/workspaces/{workspaceId}/hub/{subjectKind}/{subjectId}/visibility",
  summary: "Change Agent or Skill visibility",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: AgentHubSubjectPathSchema,
    body: SetAgentHubVisibilityBodySchema,
  },
  responses: {
    204: Type.Null(),
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceAgentModelSettingsRoute = defineRoute({
  operationId: "workspaceAgentModelSettings.get",
  method: "GET",
  path: "/api/v1/agent-model-settings",
  summary: "List the current and available governed Workspace Agent models",
  request: {
    headers: WorkspaceScopeHeadersSchema,
  },
  responses: {
    200: WorkspaceAgentModelSettingsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const updateWorkspaceAgentModelSettingsRoute = defineRoute({
  operationId: "workspaceAgentModelSettings.update",
  method: "PATCH",
  path: "/api/v1/agent-model-settings",
  summary:
    "Publish a new Agent Profile revision with a selected governed default model",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    body: UpdateWorkspaceAgentModelSettingsBodySchema,
  },
  responses: {
    200: WorkspaceAgentModelSettingsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const createWorkspaceAgentMessageRoute = defineRoute({
  operationId: "workspaceAgentMessages.create",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/agent/messages",
  summary: "Append one message and enqueue a governed Workspace Agent Run",
  request: {
    headers: IdempotencyHeadersSchema,
    path: WorkspaceAgentPathSchema,
    body: CreateWorkspaceAgentMessageBodySchema,
  },
  responses: {
    202: AgentRunAcceptedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const listWorkspaceAgentThreadsRoute = defineRoute({
  operationId: "workspaceAgentThreads.list",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/agent/threads",
  summary: "List the current principal's Workspace Agent Threads",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: WorkspaceAgentPathSchema,
    query: AgentThreadListQuerySchema,
  },
  responses: {
    200: AgentThreadListSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getWorkspaceAgentThreadRoute = defineRoute({
  operationId: "workspaceAgentThreads.get",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/agent/threads/{threadId}",
  summary: "Get one user-visible Workspace Agent Thread",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: AgentThreadPathSchema,
  },
  responses: {
    200: AgentThreadViewSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const streamWorkspaceAgentThreadRoute = defineRoute({
  operationId: "workspaceAgentThreads.stream",
  method: "GET",
  path: "/api/v1/workspaces/{workspaceId}/agent/threads/{threadId}/events",
  summary: "Stream bounded user-visible Agent Thread updates",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: AgentThreadPathSchema,
  },
  responses: {
    200: AgentThreadEventStreamSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const regenerateWorkspaceAgentResponseRoute = defineRoute({
  operationId: "workspaceAgentThreads.regenerate",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/agent/threads/{threadId}/regenerate",
  summary: "Create an immutable alternative Agent response branch",
  request: {
    headers: IdempotencyHeadersSchema,
    path: AgentThreadPathSchema,
    body: RegenerateAgentResponseBodySchema,
  },
  responses: {
    202: AgentRunAcceptedSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const selectWorkspaceAgentResponseBranchRoute = defineRoute({
  operationId: "workspaceAgentThreads.selectBranch",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/agent/threads/{threadId}/branches/select",
  summary: "Select one existing immutable Agent response branch",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: AgentThreadPathSchema,
    body: SelectAgentResponseBranchBodySchema,
  },
  responses: {
    200: AgentThreadSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const renameWorkspaceAgentThreadRoute = defineRoute({
  operationId: "workspaceAgentThreads.rename",
  method: "PATCH",
  path: "/api/v1/workspaces/{workspaceId}/agent/threads/{threadId}",
  summary: "Rename one owned Workspace Agent Thread",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: AgentThreadPathSchema,
    body: RenameAgentThreadBodySchema,
  },
  responses: {
    200: AgentThreadSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const archiveWorkspaceAgentThreadRoute = defineRoute({
  operationId: "workspaceAgentThreads.archive",
  method: "POST",
  path: "/api/v1/workspaces/{workspaceId}/agent/threads/{threadId}/archive",
  summary: "Archive one owned inactive Workspace Agent Thread",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: AgentThreadPathSchema,
    body: ArchiveAgentThreadBodySchema,
  },
  responses: {
    200: AgentThreadSummarySchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getAgentRunRoute = defineRoute({
  operationId: "agentRuns.get",
  method: "GET",
  path: "/api/v1/agent-runs/{agentRunId}",
  summary: "Get one user-visible Agent Run and bounded Thread transcript",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: AgentRunPathSchema,
  },
  responses: {
    200: AgentRunViewSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const getAgentRunDiagnosticsRoute = defineRoute({
  operationId: "agentRuns.diagnostics",
  method: "GET",
  path: "/api/v1/agent-runs/{agentRunId}/diagnostics",
  summary: "Read bounded Agent Run diagnostics with audit permission",
  request: { headers: WorkspaceScopeHeadersSchema, path: AgentRunPathSchema },
  responses: {
    200: AgentRunDiagnosticsSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const cancelAgentRunRoute = defineRoute({
  operationId: "agentRuns.cancel",
  method: "POST",
  path: "/api/v1/agent-runs/{agentRunId}/cancel",
  summary: "Cancel one queued, running, or user-input-waiting Agent Run",
  request: {
    headers: WorkspaceMutationHeadersSchema,
    path: AgentRunPathSchema,
    body: CancelAgentRunBodySchema,
  },
  responses: {
    200: CancelledAgentRunSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "none",
} satisfies RouteContract);

export const resolveAgentInteractionRoute = defineRoute({
  operationId: "agentInteractions.resolve",
  method: "POST",
  path: "/api/v1/agent-interactions/{interactionId}/resolve",
  summary: "Resolve one pending Agent question and continue or cancel its Run",
  request: {
    headers: IdempotencyHeadersSchema,
    path: AgentInteractionPathSchema,
    body: ResolveAgentInteractionBodySchema,
  },
  responses: {
    200: ResolvedAgentInteractionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const confirmAgentActionRoute = defineRoute({
  operationId: "agentActions.confirm",
  method: "POST",
  path: "/api/v1/agent-actions/{actionReceiptId}/confirm",
  summary: "Confirm and commit one prepared Agent action",
  request: {
    headers: IdempotencyHeadersSchema,
    path: AgentActionPathSchema,
    body: ConfirmAgentActionBodySchema,
  },
  responses: {
    200: ConfirmedAgentActionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const declineAgentActionRoute = defineRoute({
  operationId: "agentActions.decline",
  method: "POST",
  path: "/api/v1/agent-actions/{actionReceiptId}/decline",
  summary: "Decline one pending Agent action without committing it",
  request: {
    headers: IdempotencyHeadersSchema,
    path: AgentActionPathSchema,
    body: DeclineAgentActionBodySchema,
  },
  responses: {
    200: DeclinedAgentActionSchema,
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const completeAgentCanvasExportRoute = defineRoute({
  operationId: "agentActions.completeCanvasExport",
  method: "POST",
  path: "/api/v1/agent-actions/{actionReceiptId}/canvas-export",
  summary: "Report a browser Canvas export for server-side verification",
  request: {
    headers: IdempotencyHeadersSchema,
    path: AgentActionPathSchema,
    body: CompleteAgentCanvasExportBodySchema,
  },
  responses: {
    200: Type.Object(
      { accepted: Type.Literal(true) },
      { additionalProperties: false },
    ),
    400: ProblemDetailsSchema,
    403: ProblemDetailsSchema,
    404: ProblemDetailsSchema,
    409: ProblemDetailsSchema,
  },
  security: ["sessionOrServiceToken"],
  idempotency: "required",
} satisfies RouteContract);

export const routeRegistry: readonly RouteContract[] = Object.freeze<
  RouteContract[]
>([
  liveHealthRoute,
  startupHealthRoute,
  readyHealthRoute,
  getBrowserSessionContextRoute,
  getCurrentHumanContextRoute,
  listResourceStatesRoute,
  changeResourceStateRoute,
  listAgentHubAgentsRoute,
  createAgentHubAgentRoute,
  getAgentHubAgentRoute,
  updateAgentHubAgentRoute,
  listAgentHubSkillsRoute,
  getAgentHubSkillRoute,
  listSkillDraftsRoute,
  createSkillDraftRoute,
  getSkillDraftRoute,
  importSkillPackageRoute,
  updateSkillDraftRoute,
  archiveSkillDraftRoute,
  submitSkillCandidateRoute,
  recordSkillCandidateTestRoute,
  publishSkillCandidateRoute,
  changeSkillRuntimeStatusRoute,
  exportSkillPackageRoute,
  getSkillFileRoute,
  getSkillDraftFileRoute,
  setAgentHubVisibilityRoute,
  getWorkspaceAgentModelSettingsRoute,
  updateWorkspaceAgentModelSettingsRoute,
  createWorkspaceAgentMessageRoute,
  listWorkspaceAgentThreadsRoute,
  getWorkspaceAgentThreadRoute,
  streamWorkspaceAgentThreadRoute,
  regenerateWorkspaceAgentResponseRoute,
  selectWorkspaceAgentResponseBranchRoute,
  renameWorkspaceAgentThreadRoute,
  archiveWorkspaceAgentThreadRoute,
  getAgentRunRoute,
  getAgentRunDiagnosticsRoute,
  cancelAgentRunRoute,
  resolveAgentInteractionRoute,
  confirmAgentActionRoute,
  declineAgentActionRoute,
  completeAgentCanvasExportRoute,
  resolveInvitationRoute,
  registerInvitationAccountRoute,
  getWorkspaceTeamRoute,
  getWorkspaceProviderSettingsRoute,
  getWorkspaceModelsRoute,
  getWorkspaceProviderModelCatalogRoute,
  searchModelReferenceRoute,
  syncWorkspaceModelReferenceRoute,
  getWorkspaceUsageSummaryRoute,
  updateWorkspaceBudgetRoute,
  resolveUnknownBudgetHoldRoute,
  getWorkspaceGeneralSettingsRoute,
  renameWorkspaceRoute,
  listBrandKitsRoute,
  createBrandKitRoute,
  getBrandKitDraftRoute,
  updateBrandKitDraftRoute,
  publishBrandKitRoute,
  listBrandKitRevisionsRoute,
  setDefaultBrandKitRoute,
  getDefaultBrandKitRevisionRoute,
  getBrandKitRevisionRoute,
  listWorkspaceModelResourcesRoute,
  startWorkspaceModelResourceImportRoute,
  getWorkspaceModelResourceImportRoute,
  cancelWorkspaceModelResourceImportRoute,
  uploadWorkspaceModelResourceImportRoute,
  publishWorkspaceModelResourceImportRoute,
  getBrowserRuntimeManifestRoute,
  downloadBrowserModelResourceRoute,
  setWorkspaceModelResourceStatusRoute,
  listWorkspaceCapabilityDefinitionsRoute,
  listCanvasCapabilitiesRoute,
  listUserCapabilitiesRoute,
  createCanvasCapabilityRunRoute,
  createCapabilityRunRoute,
  getCapabilityRunRoute,
  cancelCapabilityRunRoute,
  createWorkspaceCapabilityDefinitionRoute,
  installCapabilityRecommendationRoute,
  publishCapabilityDefinitionImplementationRoute,
  updateWorkspaceCapabilityDefinitionRoute,
  setWorkspaceCapabilityDefinitionStatusRoute,
  setCapabilityBindingStatusRoute,
  moveCapabilityBindingRoute,
  discoverWorkspaceProviderModelsRoute,
  refreshWorkspaceProviderModelCatalogRoute,
  reviewWorkspaceProviderModelCatalogRoute,
  adoptWorkspaceProviderModelCatalogRoute,
  createWorkspaceProviderSettingRoute,
  renameWorkspaceProviderSettingRoute,
  createWorkspaceModelRoute,
  publishWorkspaceModelRoute,
  importWorkspaceProviderModelsRoute,
  mapWorkspaceProviderModelRoute,
  publishWorkspaceProviderModelRoute,
  validateWorkspaceProviderSettingRoute,
  activateWorkspaceProviderSettingRoute,
  rotateWorkspaceProviderSettingSecretRoute,
  disableWorkspaceProviderSettingRoute,
  deleteWorkspaceProviderSettingRoute,
  listWorkspaceResourceSourcesRoute,
  listResourceSourceTypesRoute,
  listResourceCatalogSourcesRoute,
  searchResourceCatalogRoute,
  adoptResourceCatalogCandidateRoute,
  listWorkspaceFontCatalogRoute,
  listWorkspaceArtTextCatalogRoute,
  createWorkspaceResourceSourceRoute,
  validateWorkspaceResourceSourceRoute,
  publishWorkspaceResourceSourceRoute,
  disableWorkspaceResourceSourceRoute,
  rotateWorkspaceResourceSourceCredentialRoute,
  listWorkspaceAssetsRoute,
  getWorkspaceAssetRoute,
  createWorkspaceAssetFromArtifactRoute,
  createCanvasDraftRoute,
  listCanvasDraftsRoute,
  getCanvasDraftRoute,
  listCanvasDraftRevisionsRoute,
  getCanvasDraftRevisionRoute,
  restoreCanvasDraftRoute,
  updateCanvasDraftRoute,
  updateCanvasDraftBrandRoute,
  listWorkspaceCreationEntrypointsRoute,
  createWorkspaceInvitationRoute,
  resendWorkspaceInvitationRoute,
  revokeWorkspaceInvitationRoute,
  acceptWorkspaceInvitationRoute,
  addWorkspaceMemberRoute,
  changeInstanceWorkspaceMembershipRoute,
  createInstanceInvitationRoute,
  revokeInstanceInvitationRoute,
  changeInstancePrincipalStatusRoute,
  changeWorkspaceMembershipRoute,
  changeWorkspaceMembershipsRoute,
  getDefaultAccessPolicyRoute,
  updateDefaultAccessPolicyRoute,
  previewDefaultAccessRoute,
  applyDefaultAccessRoute,
  retryDefaultAccessRoute,
  getInstanceRegistrationSettingsRoute,
  updateInstanceRegistrationPolicyRoute,
  getInstanceAccessOverviewRoute,
  ...siteToolRoutes,
  ...siteCoverRoutes,
  ...resourceLibraryRoutes,
  ...runtimeConfigurationRoutes,
  ...providerResultRecoveryRoutes,
  listToolIntegrationsRoute,
  ...toolSessionRoutes,
  ...toolRuntimeRoutes,
  uploadSiteToolImageRoute,
  getSiteToolImageRoute,
  getToolImageRoute,
  listToolsRoute,
  getToolUsageRoute,
  grantInstanceWorkspaceAccessRoute,
  resolveInstanceSetupRoute,
  registerInstanceSetupAccountRoute,
  redeemInstanceSetupRoute,
  acknowledgeBrowserAttemptCancellationRoute,
  registerBrowserExecutorRoute,
  claimBrowserAttemptRoute,
  allocateBrowserAttemptOutputRoute,
  uploadBrowserAttemptOutputRoute,
  allocateCanvasExportRoute,
  getCanvasExportRoute,
  uploadCanvasExportRoute,
  commitCanvasExportRoute,
  allocateUserImportRoute,
  uploadUserImportRoute,
  commitUserImportRoute,
  downloadArtifactContentRoute,
  getArtifactPreviewRoute,
  getOperationalTimelineRoute,
  listTaskRecordsRoute,
  getTaskTimelineRoute,
  heartbeatBrowserAttemptRoute,
  completeBrowserAttemptRoute,
  drainBrowserExecutorRoute,
  revokeBrowserExecutorRoute,
  validateWorkflowTopologyRoute,
  createWorkflowRunRoute,
  listWorkflowRunsRoute,
  getWorkflowRunRoute,
  cancelWorkflowRunRoute,
  decideWorkflowApprovalRoute,
  listWorkflowDefinitionsRoute,
  listWorkflowAuthoringCapabilitiesRoute,
  createWorkflowDraftRoute,
  getWorkflowDraftRoute,
  updateWorkflowDraftRoute,
  archiveWorkflowDraftRoute,
  listWorkflowCandidatesRoute,
  submitWorkflowCandidateRoute,
  getWorkflowCandidateRoute,
  startWorkflowCandidateTestRoute,
  recordWorkflowCandidateEvalRoute,
  reviewWorkflowCandidateRoute,
  publishWorkflowCandidateRoute,
  listWorkflowTemplatesRoute,
  getWorkflowTemplateRoute,
]);
