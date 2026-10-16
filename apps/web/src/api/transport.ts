import type { ProviderResultRecoveryView } from "@kanvas/contracts/api";
import type {
  RuntimeConfigurationOverview,
  RuntimeConfigurationRevision,
  PublishRuntimeConfiguration,
  RestoreRuntimeConfiguration,
} from "@kanvas/contracts/api";
import type {
  DefaultAccessPolicy,
  UpdateDefaultAccessPolicyBody,
  DefaultAccessPreview,
  AppliedDefaultAccess,
  ApplyDefaultAccessBody,
  DefaultAccessStatus,
} from "@kanvas/contracts/api";
import type {
  TaskRecordList,
  TaskRecordQuery,
  TaskTimeline,
  AddWorkspaceMemberBody,
  ChangeInstancePrincipalStatusBody,
  ChangedInstancePrincipalStatus,
} from "@kanvas/contracts/api";
import type {
  ResourceStateList,
  ChangeResourceStateBody,
} from "@kanvas/contracts/api";
import type {
  AgentHubAgent,
  CompleteAgentCanvasExportBody,
  AgentHubAgentDetail,
  AgentHubAgents,
  AgentHubSkill,
  AgentHubSkillDetail,
  AgentHubSkills,
  AgentRunAccepted,
  AgentRunView,
  AgentRunDiagnostics,
  AgentThreadList,
  AgentThreadSummary,
  AgentThreadView,
  ResolveAgentInteractionBody,
  ResolvedAgentInteraction,
  CancelledAgentRun,
  ArchiveAgentThreadBody,
  RenameAgentThreadBody,
  AcceptWorkspaceInvitationBody,
  ActivateProviderSettingBody,
  AdoptProviderModelCatalogBody,
  AllocateCanvasExportBody,
  AllocateUserImportBody,
  CancelWorkflowRunBody,
  DecideWorkflowApprovalBody,
  BrandKitDraft,
  BrandKitList,
  BrandKitListQuery,
  BrandKitRevision,
  BrandKitRevisionList,
  BrandKitSummary,
  CommitUserImportBody,
  ChangeWorkspaceMembershipBody,
  ChangeWorkspaceMembershipsBody,
  ChangedWorkspaceMembership,
  ChangedWorkspaceMemberships,
  CanvasDraft,
  CanvasDraftList,
  CanvasDraftMutationResult,
  CanvasDraftRevision,
  CanvasDraftRevisionList,
  CanvasExportIngestion,
  CanvasExportUploadSession,
  CanvasCapabilityCatalog,
  CanvasCapabilityCatalogQuery,
  CapabilityRunAccepted,
  CapabilityRunDetails,
  CommitCanvasExportBody,
  CommittedUserImport,
  CommittedCanvasExport,
  CreateCanvasDraftBody,
  CreateCanvasCapabilityRunBody,
  CreateCapabilityRunBody,
  CreateWorkspaceAgentMessageBody,
  CreateAgentHubAgentBody,
  CreateSkillDraftBody,
  ConfirmedAgentAction,
  DeclinedAgentAction,
  CreateBrandKitBody,
  DiscoverProviderModelsBody,
  CreateWorkflowRunBody,
  CreateWorkspaceAssetFromArtifactBody,
  CreateWorkspaceInvitationBody,
  CreateProviderSettingBody,
  CurrentHumanContext,
  HealthResponse,
  GrantInstanceWorkspaceAccessBody,
  GrantedInstanceWorkspaceAccess,
  InstanceAccessOverview,
  InstanceRegistrationSettings,
  InstanceSetupAccountRegistered,
  InstanceSetupRedemptionBody,
  InstanceSetupRedemptionResponse,
  InstanceSetupSummary,
  InvitationAccountRegistered,
  InvitationSummary,
  OperationalTimeline,
  ProviderModelDiscoveryResult,
  ProviderModelCatalogAdoptionResult,
  ProviderModelCatalogReview,
  ProviderModelCatalogRefreshResult,
  ProviderSettingCreated,
  ProviderSettingMutationResult,
  ProviderSettingVersionBody,
  RenameProviderSettingBody,
  CanonicalModelMutationResult,
  CreateCanonicalModelBody,
  ImportProviderModelsBody,
  MapProviderModelBody,
  ModelReferenceSearchResult,
  ModelReferenceSyncResult,
  ProviderModelCatalog,
  ProviderModelsImported,
  PublishCanonicalModelBody,
  PublishProviderModelBody,
  SyncModelReferenceBody,
  WorkspaceModels,
  CreateResourceSourceBody,
  PublishResourceSourceBody,
  ResourceSourceCreated,
  ResourceCatalogSearchResult,
  ResourceCatalogSourceList,
  ResourceAdoptionRequest,
  ResourceAdoptionResult,
  ResourceSourceMutationResult,
  ResourceSourceTypeList,
  ResourceSourceVersionBody,
  RotateResourceSourceCredentialBody,
  ValidateResourceSourceBody,
  WorkspaceResourceSources,
  WorkspaceArtTextCatalog,
  WorkspaceFontCatalog,
  RefreshProviderModelCatalogBody,
  PublishBrandKitBody,
  ValidateProviderSettingBody,
  RegisterInstanceSetupAccountBody,
  RegisterInvitationAccountBody,
  ResendWorkspaceInvitationBody,
  RevokeWorkspaceInvitationBody,
  RestoreCanvasDraftBody,
  SetDefaultBrandKitBody,
  SetAgentHubVisibilityBody,
  ChangeSkillRuntimeStatusBody,
  SkillDraftList,
  SkillDraftDetail,
  SkillDraftSummary,
  SkillRuntimeStatus,
  RecordSkillCandidateTestBody,
  SubmitSkillCandidateBody,
  UpdateSkillDraftBody,
  UpdateAgentHubAgentBody,
  RotateProviderSettingSecretBody,
  UserImportIngestion,
  UserImportUploadSession,
  UpdateCanvasDraftBody,
  UpdateCanvasDraftBrandBody,
  UpdateBrandKitDraftBody,
  UpdateWorkspaceAgentModelSettingsBody,
  UpdateInstanceRegistrationPolicyBody,
  WorkspaceInvitationAccepted,
  WorkspaceInvitationCreated,
  WorkspaceAgentModelSettings,
  WorkspaceInvitationRevoked,
  WorkspaceAssetList,
  WorkspaceAssetAdoption,
  WorkspaceAssetDetail,
  WorkspaceAssetDetailQuery,
  WorkspaceAssetListQuery,
  WorkspaceCreationEntrypointList,
  WorkspaceProviderSettings,
  WorkspaceBudgetMutationResult,
  WorkspaceUsageSummary,
  ResolveUnknownBudgetHoldBody,
  ResolveInstanceSetupBody,
  UpdateWorkspaceBudgetBody,
  UnknownBudgetHoldResolution,
  RenameWorkspaceBody,
  WorkspaceGeneralSettings,
  CapabilityDefinitionMutationResult,
  CapabilityBindingMutationResult,
  CapabilityInstallationSummary,
  CreateCapabilityDefinitionBody,
  InstallCapabilityRecommendationBody,
  PublishCapabilityImplementationRevisionBody,
  SetCapabilityDefinitionStatusBody,
  UpdateCapabilityDefinitionBody,
  WorkspaceCapabilityDefinitions,
  ModelResourceImportIngestion,
  ModelResourceImportSummary,
  ModelResourceMutationResult,
  PublishModelResourceImportBody,
  SetModelResourceStatusBody,
  StartModelResourceImportBody,
  WorkspaceModelResources,
  MoveCapabilityBindingBody,
  SetCapabilityBindingStatusBody,
  WorkspaceTeam,
  WorkspaceTeamQuery,
  WorkflowRunAccepted,
  WorkflowRunCancellationAccepted,
  WorkflowRunDetails,
  WorkflowRunList,
  WorkflowApprovalDecisionResult,
  CreateWorkflowDraftBody,
  UpdateWorkflowDraftBody,
  WorkflowDefinitionList,
  WorkflowDraft,
  WorkflowDraftMutationResult,
  WorkflowAuthoringCapabilityList,
  PublishWorkflowCandidateBody,
  RecordWorkflowCandidateEvalBody,
  ReviewWorkflowCandidateBody,
  StartWorkflowCandidateTestBody,
  SubmitWorkflowCandidateBody,
  WorkflowCandidateList,
  WorkflowCandidateReview,
  WorkflowTemplate,
  WorkflowTemplateList,
} from "@kanvas/contracts/api";

import type {
  ValidateWorkflowTopologyResult,
  WorkflowTopology,
} from "@kanvas/contracts/workflow";

import { httpStatus } from "./http-status.js";

const sseDataPrefixLength = "data:".length;

export class ApiProblem extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

export async function fetchReadiness(
  fetcher: typeof fetch = fetch,
): Promise<HealthResponse> {
  const response = await fetcher("/health/ready", {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new ApiProblem(
      response.status,
      "server_not_ready",
      "Kanvas Server 尚未准备好。",
    );
  }
  const health = (await response.json()) as HealthResponse;
  if (health.status !== "ok") {
    throw new ApiProblem(
      response.status,
      "server_not_ready",
      "Kanvas Server 尚未准备好。",
    );
  }
  return health;
}

export async function readProblem(response: Response): Promise<ApiProblem> {
  const value = (await response.json().catch(() => undefined)) as
    | {
        readonly code?: unknown;
        readonly detail?: unknown;
        readonly message?: unknown;
      }
    | undefined;
  let detail: string | undefined;
  if (typeof value?.detail === "string") {
    detail = value.detail;
  } else if (typeof value?.message === "string") {
    detail = value.message;
  }
  return new ApiProblem(
    response.status,
    typeof value?.code === "string" ? value.code : "api_request_failed",
    detail
      ? detail
      : `Kanvas API request failed with status ${String(response.status)}.`,
  );
}

export interface WorkspaceApiContext {
  readonly csrfToken: string;
  readonly workspaceId: string;
}

function workspaceHeaders(
  context: WorkspaceApiContext,
): Record<string, string> {
  return {
    "x-kanvas-csrf": context.csrfToken,
    "x-kanvas-workspace-id": context.workspaceId,
  };
}

function idempotentWorkspaceHeaders(
  context: WorkspaceApiContext,
  idempotencyKey: string,
): Record<string, string> {
  return {
    ...workspaceHeaders(context),
    "idempotency-key": idempotencyKey,
  };
}

function devResponseLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("kanvasDevResponseLoss") ===
      "asset-after-commit"
  ) {
    return `${path}?kanvasDevDropResponse=after-commit`;
  }
  return path;
}

function devCanvasExportResponseLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("kanvasDevResponseLoss") ===
      "canvas-export-after-commit"
  ) {
    return `${path}?kanvasDevDropResponse=after-commit`;
  }
  return path;
}

function devCanvasDraftResponseLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("kanvasDevResponseLoss") ===
      "canvas-draft-after-create"
  ) {
    return `${path}?kanvasDevDropResponse=after-create`;
  }
  return path;
}

function devInstanceSetupResponseLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("kanvasDevResponseLoss") ===
      "setup-after-commit"
  ) {
    return `${path}?kanvasDevDropResponse=after-commit`;
  }
  return path;
}

function devProviderResponseLossUrl(
  path: string,
  probe: "provider-create-after-commit" | "provider-rotate-after-commit",
): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("kanvasDevResponseLoss") ===
      probe
  ) {
    return `${path}?kanvasDevDropResponse=after-commit`;
  }
  return path;
}

function devWorkspaceSettingsResponseLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("kanvasDevResponseLoss") ===
      "workspace-name-after-commit"
  ) {
    return `${path}?kanvasDevDropResponse=after-commit`;
  }
  return path;
}

function devCanvasDraftPermissionLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(
      "kanvasDevPermissionLoss",
    ) === "canvas-draft-before-create"
  ) {
    return `${path}?kanvasDevDelay=before-create`;
  }
  return path;
}

function devCanvasExportPermissionLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(
      "kanvasDevPermissionLoss",
    ) === "canvas-export-before-commit"
  ) {
    return `${path}?kanvasDevDelay=before-commit`;
  }
  return path;
}

function devWorkspaceAssetPermissionLossUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(
      "kanvasDevPermissionLoss",
    ) === "asset-before-read"
  ) {
    return `${path}${
      path.includes("?") ? "&" : "?"
    }kanvasDevDelay=asset-before-read`;
  }
  return path;
}

function devUserImportContentDelayUrl(path: string): string {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("kanvasDevUserImport") ===
      "delay-first-content"
  ) {
    return `${path}?kanvasDevDelay=first-content`;
  }
  return path;
}

export async function fetchCurrentHumanContext(
  fetcher: typeof fetch = fetch,
): Promise<CurrentHumanContext> {
  const response = await fetcher("/api/v1/auth/current-human-context", {
    credentials: "include",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CurrentHumanContext;
}

export async function fetchInstanceRegistrationSettings(
  fetcher: typeof fetch = fetch,
): Promise<InstanceRegistrationSettings> {
  const response = await fetcher("/api/v1/instance/registration-settings", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as InstanceRegistrationSettings;
}

export async function updateInstanceRegistrationPolicy(
  csrfToken: string,
  body: UpdateInstanceRegistrationPolicyBody,
  fetcher: typeof fetch = fetch,
): Promise<InstanceRegistrationSettings> {
  const response = await fetcher("/api/v1/instance/registration-settings", {
    method: "PUT",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-kanvas-csrf": csrfToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as InstanceRegistrationSettings;
}

export async function fetchInstanceAccessOverview(
  fetcher: typeof fetch = fetch,
): Promise<InstanceAccessOverview> {
  const response = await fetcher("/api/v1/instance/access-overview", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as InstanceAccessOverview;
}

export async function grantInstanceWorkspaceAccess(
  csrfToken: string,
  targetPrincipalId: string,
  body: GrantInstanceWorkspaceAccessBody,
  fetcher: typeof fetch = fetch,
): Promise<GrantedInstanceWorkspaceAccess> {
  const response = await fetcher(
    `/api/v1/instance/principals/${encodeURIComponent(targetPrincipalId)}/workspace-memberships`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as GrantedInstanceWorkspaceAccess;
}

export async function redeemInstanceSetup(
  csrfToken: string,
  body: InstanceSetupRedemptionBody,
  fetcher: typeof fetch = fetch,
): Promise<InstanceSetupRedemptionResponse> {
  const response = await fetcher(
    devInstanceSetupResponseLossUrl("/api/v1/instance/setup/redemptions"),
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as InstanceSetupRedemptionResponse;
}

export async function resolveInstanceSetup(
  body: ResolveInstanceSetupBody,
  fetcher: typeof fetch = fetch,
): Promise<InstanceSetupSummary> {
  const response = await fetcher("/api/v1/instance/setup/resolutions", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as InstanceSetupSummary;
}

export async function registerInstanceSetupAccount(
  body: RegisterInstanceSetupAccountBody,
  fetcher: typeof fetch = fetch,
): Promise<InstanceSetupAccountRegistered> {
  const response = await fetcher("/api/v1/instance/setup/registrations", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as InstanceSetupAccountRegistered;
}

export async function resolveWorkspaceInvitation(
  invitationToken: string,
  fetcher: typeof fetch = fetch,
): Promise<InvitationSummary> {
  const response = await fetcher("/api/v1/invitation-resolutions", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      invitationToken,
    }),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as InvitationSummary;
}

export async function registerInvitationAccount(
  body: RegisterInvitationAccountBody,
  fetcher: typeof fetch = fetch,
): Promise<InvitationAccountRegistered> {
  const response = await fetcher("/api/v1/invitation-registrations", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as InvitationAccountRegistered;
}

export async function fetchWorkspaceTeam(
  workspaceId: string,
  queryOrFetcher: WorkspaceTeamQuery | typeof fetch = {},
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceTeam> {
  const query = typeof queryOrFetcher === "function" ? {} : queryOrFetcher;
  const request =
    typeof queryOrFetcher === "function" ? queryOrFetcher : fetcher;
  const parameters = new URLSearchParams();
  if (query.pageKind) {
    parameters.set("pageKind", query.pageKind);
  }
  if (query.cursor) {
    parameters.set("cursor", query.cursor);
  }
  if (query.limit) {
    parameters.set("limit", query.limit);
  }
  const suffix = parameters.size > 0 ? `?${parameters}` : "";
  const response = await request(`/api/v1/workspace-team${suffix}`, {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceTeam;
}

export async function fetchWorkspaceProviderSettings(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceProviderSettings> {
  const response = await fetcher("/api/v1/provider-settings", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceProviderSettings;
}

export async function fetchWorkspaceModels(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceModels> {
  const response = await fetcher("/api/v1/models", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as WorkspaceModels;
}

export async function searchModelReference(
  workspaceId: string,
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelReferenceSearchResult> {
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set("q", query.trim());
  const response = await fetcher(
    `/api/v1/model-reference${parameters.size ? `?${parameters}` : ""}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ModelReferenceSearchResult;
}

export function syncWorkspaceModelReference(
  context: WorkspaceApiContext,
  modelId: string,
  body: SyncModelReferenceBody,
  fetcher: typeof fetch = fetch,
): Promise<ModelReferenceSyncResult> {
  return mutateModel(
    context,
    `/api/v1/models/${encodeURIComponent(modelId)}/reference-syncs`,
    "POST",
    body,
    fetcher,
  );
}

async function mutateModel<T>(
  context: WorkspaceApiContext,
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(path, {
    method,
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as T;
}

export function createWorkspaceModel(
  context: WorkspaceApiContext,
  body: CreateCanonicalModelBody,
  fetcher: typeof fetch = fetch,
): Promise<CanonicalModelMutationResult> {
  return mutateModel(context, "/api/v1/models", "POST", body, fetcher);
}

export function publishWorkspaceModel(
  context: WorkspaceApiContext,
  modelId: string,
  body: PublishCanonicalModelBody,
  fetcher: typeof fetch = fetch,
): Promise<CanonicalModelMutationResult> {
  return mutateModel(
    context,
    `/api/v1/models/${encodeURIComponent(modelId)}/publications`,
    "POST",
    body,
    fetcher,
  );
}

export async function fetchWorkspaceProviderModelCatalog(
  workspaceId: string,
  providerSettingId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelCatalog> {
  const response = await fetcher(
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/provider-models`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ProviderModelCatalog;
}

export function importWorkspaceProviderModels(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: ImportProviderModelsBody,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelsImported> {
  return mutateModel(
    context,
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/model-imports`,
    "POST",
    body,
    fetcher,
  );
}

export function mapWorkspaceProviderModel(
  context: WorkspaceApiContext,
  providerSettingId: string,
  providerModelId: string,
  body: MapProviderModelBody,
  fetcher: typeof fetch = fetch,
): Promise<CanonicalModelMutationResult> {
  return mutateModel(
    context,
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/provider-models/${encodeURIComponent(providerModelId)}`,
    "PATCH",
    body,
    fetcher,
  );
}

export function publishWorkspaceProviderModel(
  context: WorkspaceApiContext,
  providerSettingId: string,
  providerModelId: string,
  body: PublishProviderModelBody,
  fetcher: typeof fetch = fetch,
): Promise<CanonicalModelMutationResult> {
  return mutateModel(
    context,
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/provider-models/${encodeURIComponent(providerModelId)}/publications`,
    "POST",
    body,
    fetcher,
  );
}

export async function fetchWorkspaceUsageSummary(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceUsageSummary> {
  const response = await fetcher("/api/v1/usage-summary", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceUsageSummary;
}

export async function updateWorkspaceBudget(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: UpdateWorkspaceBudgetBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceBudgetMutationResult> {
  const response = await fetcher(
    `/api/v1/usage-summary/budgets/${encodeURIComponent(providerSettingId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceBudgetMutationResult;
}

export async function resolveUnknownBudgetHold(
  context: WorkspaceApiContext,
  budgetReservationId: string,
  body: ResolveUnknownBudgetHoldBody,
  fetcher: typeof fetch = fetch,
): Promise<UnknownBudgetHoldResolution> {
  const response = await fetcher(
    `/api/v1/usage-summary/unknown-holds/${encodeURIComponent(
      budgetReservationId,
    )}/resolution`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as UnknownBudgetHoldResolution;
}

export async function fetchWorkspaceGeneralSettings(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceGeneralSettings> {
  const response = await fetcher("/api/v1/workspace-settings", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceGeneralSettings;
}

export async function renameWorkspace(
  context: WorkspaceApiContext,
  body: RenameWorkspaceBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceGeneralSettings> {
  const response = await fetcher(
    devWorkspaceSettingsResponseLossUrl("/api/v1/workspace-settings/name"),
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceGeneralSettings;
}

export async function fetchWorkspaceCapabilityDefinitions(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceCapabilityDefinitions> {
  const response = await fetcher("/api/v1/capability-definitions", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceCapabilityDefinitions;
}

export async function createCapabilityDefinition(
  context: WorkspaceApiContext,
  body: CreateCapabilityDefinitionBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityDefinitionMutationResult> {
  const response = await fetcher("/api/v1/capability-definitions", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CapabilityDefinitionMutationResult;
}

export async function installCapabilityRecommendation(
  context: WorkspaceApiContext,
  catalogEntryId: string,
  body: InstallCapabilityRecommendationBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityInstallationSummary> {
  const response = await fetcher(
    `/api/v1/capability-recommendations/${encodeURIComponent(catalogEntryId)}/install`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CapabilityInstallationSummary;
}

export async function publishCapabilityDefinitionImplementation(
  context: WorkspaceApiContext,
  capabilityDefinitionId: string,
  body: PublishCapabilityImplementationRevisionBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityBindingMutationResult> {
  const response = await fetcher(
    `/api/v1/capability-definitions/${encodeURIComponent(capabilityDefinitionId)}/implementations`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CapabilityBindingMutationResult;
}

export async function fetchWorkspaceModelResources(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceModelResources> {
  const response = await fetcher("/api/v1/model-resources", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as WorkspaceModelResources;
}

export async function startModelResourceImport(
  context: WorkspaceApiContext,
  body: StartModelResourceImportBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelResourceImportSummary> {
  const response = await fetcher("/api/v1/model-resource-imports", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ModelResourceImportSummary;
}

export async function fetchModelResourceImport(
  workspaceId: string,
  modelResourceImportId: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelResourceImportSummary> {
  const response = await fetcher(
    `/api/v1/model-resource-imports/${encodeURIComponent(modelResourceImportId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ModelResourceImportSummary;
}

export async function cancelModelResourceImport(
  context: WorkspaceApiContext,
  modelResourceImportId: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelResourceImportSummary> {
  const response = await fetcher(
    `/api/v1/model-resource-imports/${encodeURIComponent(modelResourceImportId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: "{}",
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ModelResourceImportSummary;
}

export async function uploadModelResourceImport(
  context: WorkspaceApiContext,
  modelResourceImportId: string,
  file: Blob,
  fetcher: typeof fetch = fetch,
): Promise<ModelResourceImportIngestion> {
  const response = await fetcher(
    `/api/v1/model-resource-imports/${encodeURIComponent(modelResourceImportId)}/content`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/octet-stream",
        ...workspaceHeaders(context),
      },
      body: file,
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ModelResourceImportIngestion;
}

export async function publishModelResourceImport(
  context: WorkspaceApiContext,
  modelResourceImportId: string,
  body: PublishModelResourceImportBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelResourceMutationResult> {
  const response = await fetcher(
    `/api/v1/model-resource-imports/${encodeURIComponent(modelResourceImportId)}/publish`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ModelResourceMutationResult;
}

export async function setModelResourceStatus(
  context: WorkspaceApiContext,
  modelResourceId: string,
  body: SetModelResourceStatusBody,
  fetcher: typeof fetch = fetch,
): Promise<ModelResourceMutationResult> {
  const response = await fetcher(
    `/api/v1/model-resources/${encodeURIComponent(modelResourceId)}/status`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ModelResourceMutationResult;
}

export async function updateCapabilityDefinition(
  context: WorkspaceApiContext,
  capabilityDefinitionId: string,
  body: UpdateCapabilityDefinitionBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityDefinitionMutationResult> {
  const response = await fetcher(
    `/api/v1/capability-definitions/${encodeURIComponent(capabilityDefinitionId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CapabilityDefinitionMutationResult;
}

export async function setCapabilityDefinitionStatus(
  context: WorkspaceApiContext,
  capabilityDefinitionId: string,
  body: SetCapabilityDefinitionStatusBody,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityDefinitionMutationResult> {
  const response = await fetcher(
    `/api/v1/capability-definitions/${encodeURIComponent(capabilityDefinitionId)}/status`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CapabilityDefinitionMutationResult;
}

export async function setCapabilityBindingStatus(
  context: WorkspaceApiContext,
  capabilityBindingId: string,
  body: SetCapabilityBindingStatusBody,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityBindingMutationResult> {
  const response = await fetcher(
    `/api/v1/capability-bindings/${encodeURIComponent(capabilityBindingId)}/status`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CapabilityBindingMutationResult;
}

export async function moveCapabilityBinding(
  context: WorkspaceApiContext,
  capabilityBindingId: string,
  body: MoveCapabilityBindingBody,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityBindingMutationResult> {
  const response = await fetcher(
    `/api/v1/capability-bindings/${encodeURIComponent(capabilityBindingId)}/position`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CapabilityBindingMutationResult;
}

export async function fetchWorkspaceAgentModelSettings(
  context: WorkspaceApiContext,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAgentModelSettings> {
  const response = await fetcher("/api/v1/agent-model-settings", {
    credentials: "include",
    headers: {
      accept: "application/json",
      ...workspaceHeaders(context),
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as WorkspaceAgentModelSettings;
}

export async function updateWorkspaceAgentModelSettings(
  context: WorkspaceApiContext,
  body: UpdateWorkspaceAgentModelSettingsBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAgentModelSettings> {
  const response = await fetcher("/api/v1/agent-model-settings", {
    method: "PATCH",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as WorkspaceAgentModelSettings;
}

export async function createWorkspaceProviderSetting(
  context: WorkspaceApiContext,
  body: CreateProviderSettingBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderSettingCreated> {
  const response = await fetcher(
    devProviderResponseLossUrl(
      "/api/v1/provider-settings",
      "provider-create-after-commit",
    ),
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ProviderSettingCreated;
}

export async function fetchResourceSourceTypes(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceSourceTypeList> {
  const response = await fetcher("/api/v1/resource-source-types", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ResourceSourceTypeList;
}

export async function fetchWorkspaceResourceSources(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceResourceSources> {
  const response = await fetcher("/api/v1/resource-sources", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as WorkspaceResourceSources;
}

export async function fetchResourceCatalogSources(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceCatalogSourceList> {
  const response = await fetcher("/api/v1/resource-catalog/sources", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ResourceCatalogSourceList;
}

export async function fetchWorkspaceFontCatalog(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceFontCatalog> {
  const response = await fetcher("/api/v1/resource-catalog/fonts", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as WorkspaceFontCatalog;
}

export async function fetchWorkspaceArtTextCatalog(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceArtTextCatalog> {
  const response = await fetcher("/api/v1/resource-catalog/art-text", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as WorkspaceArtTextCatalog;
}

export async function searchResourceCatalog(
  workspaceId: string,
  options: {
    readonly sourceId: string;
    readonly query: string;
    readonly cursor?: string;
    readonly limit?: number;
  },
  fetcher: typeof fetch = fetch,
): Promise<ResourceCatalogSearchResult> {
  const query = new URLSearchParams({
    sourceId: options.sourceId,
    q: options.query,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.limit ? { limit: String(options.limit) } : {}),
  });
  const response = await fetcher(
    `/api/v1/resource-catalog/search?${query.toString()}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ResourceCatalogSearchResult;
}

export async function adoptResourceCatalogCandidate(
  context: WorkspaceApiContext,
  body: ResourceAdoptionRequest,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceAdoptionResult> {
  const response = await fetcher("/api/v1/resource-catalog/adoptions", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ResourceAdoptionResult;
}

export async function createWorkspaceResourceSource(
  context: WorkspaceApiContext,
  body: CreateResourceSourceBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceSourceCreated> {
  const response = await fetcher("/api/v1/resource-sources", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ResourceSourceCreated;
}

async function mutateWorkspaceResourceSource<TBody>(
  context: WorkspaceApiContext,
  resourceSourceId: string,
  action: "credential-rotations" | "disablement" | "publication" | "validation",
  body: TBody,
  idempotencyKey: string,
  fetcher: typeof fetch,
): Promise<ResourceSourceMutationResult> {
  const response = await fetcher(
    `/api/v1/resource-sources/${encodeURIComponent(resourceSourceId)}/${action}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ResourceSourceMutationResult;
}

export function validateWorkspaceResourceSource(
  context: WorkspaceApiContext,
  resourceSourceId: string,
  body: ValidateResourceSourceBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceSourceMutationResult> {
  return mutateWorkspaceResourceSource(
    context,
    resourceSourceId,
    "validation",
    body,
    idempotencyKey,
    fetcher,
  );
}

export function publishWorkspaceResourceSource(
  context: WorkspaceApiContext,
  resourceSourceId: string,
  body: PublishResourceSourceBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceSourceMutationResult> {
  return mutateWorkspaceResourceSource(
    context,
    resourceSourceId,
    "publication",
    body,
    idempotencyKey,
    fetcher,
  );
}

export function disableWorkspaceResourceSource(
  context: WorkspaceApiContext,
  resourceSourceId: string,
  body: ResourceSourceVersionBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceSourceMutationResult> {
  return mutateWorkspaceResourceSource(
    context,
    resourceSourceId,
    "disablement",
    body,
    idempotencyKey,
    fetcher,
  );
}

export function rotateWorkspaceResourceSourceCredential(
  context: WorkspaceApiContext,
  resourceSourceId: string,
  body: RotateResourceSourceCredentialBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResourceSourceMutationResult> {
  return mutateWorkspaceResourceSource(
    context,
    resourceSourceId,
    "credential-rotations",
    body,
    idempotencyKey,
    fetcher,
  );
}

export async function renameWorkspaceProviderSetting(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: RenameProviderSettingBody,
  fetcher: typeof fetch = fetch,
): Promise<ProviderSettingMutationResult> {
  const response = await fetcher(
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ProviderSettingMutationResult;
}

export async function discoverWorkspaceProviderModels(
  context: WorkspaceApiContext,
  body: DiscoverProviderModelsBody,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelDiscoveryResult> {
  const response = await fetcher("/api/v1/provider-settings/model-discovery", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ProviderModelDiscoveryResult;
}

export async function refreshWorkspaceProviderModelCatalog(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: RefreshProviderModelCatalogBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelCatalogRefreshResult> {
  const response = await fetcher(
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/model-catalog-refreshes`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ProviderModelCatalogRefreshResult;
}

export async function fetchWorkspaceProviderModelCatalogReview(
  context: WorkspaceApiContext,
  providerSettingId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelCatalogReview> {
  const response = await fetcher(
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/model-catalog-review`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        ...workspaceHeaders(context),
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ProviderModelCatalogReview;
}

export async function adoptWorkspaceProviderModelCatalog(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: AdoptProviderModelCatalogBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelCatalogAdoptionResult> {
  const response = await fetcher(
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/model-catalog-adoptions`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ProviderModelCatalogAdoptionResult;
}

async function mutateWorkspaceProviderSetting(
  context: WorkspaceApiContext,
  providerSettingId: string,
  action: "activation" | "deletion" | "disablement" | "validation",
  body: ProviderSettingVersionBody | ValidateProviderSettingBody,
  idempotencyKey: string,
  fetcher: typeof fetch,
): Promise<ProviderSettingMutationResult> {
  const response = await fetcher(
    `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/${action}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ProviderSettingMutationResult;
}

export async function validateWorkspaceProviderSetting(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: ValidateProviderSettingBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderSettingMutationResult> {
  return mutateWorkspaceProviderSetting(
    context,
    providerSettingId,
    "validation",
    body,
    idempotencyKey,
    fetcher,
  );
}

export async function activateWorkspaceProviderSetting(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: ActivateProviderSettingBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderSettingMutationResult> {
  return mutateWorkspaceProviderSetting(
    context,
    providerSettingId,
    "activation",
    body,
    idempotencyKey,
    fetcher,
  );
}

export async function disableWorkspaceProviderSetting(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: ProviderSettingVersionBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderSettingMutationResult> {
  return mutateWorkspaceProviderSetting(
    context,
    providerSettingId,
    "disablement",
    body,
    idempotencyKey,
    fetcher,
  );
}

export async function deleteWorkspaceProviderSetting(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: ProviderSettingVersionBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderSettingMutationResult> {
  return mutateWorkspaceProviderSetting(
    context,
    providerSettingId,
    "deletion",
    body,
    idempotencyKey,
    fetcher,
  );
}

export async function rotateWorkspaceProviderSettingSecret(
  context: WorkspaceApiContext,
  providerSettingId: string,
  body: RotateProviderSettingSecretBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderSettingMutationResult> {
  const response = await fetcher(
    devProviderResponseLossUrl(
      `/api/v1/provider-settings/${encodeURIComponent(providerSettingId)}/secret-rotations`,
      "provider-rotate-after-commit",
    ),
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ProviderSettingMutationResult;
}

export async function fetchBrandKits(
  workspaceId: string,
  query: BrandKitListQuery = {},
  fetcher: typeof fetch = fetch,
): Promise<BrandKitList> {
  const parameters = new URLSearchParams();
  if (query.lifecycleStatus) {
    parameters.set("lifecycleStatus", query.lifecycleStatus);
  }
  const suffix = parameters.size > 0 ? `?${parameters.toString()}` : "";
  const response = await fetcher(`/api/v1/brand-kits${suffix}`, {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitList;
}

export async function fetchBrandKitRevisions(
  workspaceId: string,
  brandKitId: string,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitRevisionList> {
  const response = await fetcher(
    `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/revisions`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitRevisionList;
}

export async function createBrandKit(
  context: WorkspaceApiContext,
  body: CreateBrandKitBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitDraft> {
  const response = await fetcher("/api/v1/brand-kits", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitDraft;
}

export async function fetchBrandKitDraft(
  workspaceId: string,
  brandKitId: string,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitDraft> {
  const response = await fetcher(
    `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/draft`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitDraft;
}

export async function updateBrandKitDraft(
  context: WorkspaceApiContext,
  brandKitId: string,
  body: UpdateBrandKitDraftBody,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitDraft> {
  const response = await fetcher(
    `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/draft`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitDraft;
}

export async function publishBrandKit(
  context: WorkspaceApiContext,
  brandKitId: string,
  body: PublishBrandKitBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitRevision> {
  const response = await fetcher(
    `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/revisions`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitRevision;
}

export async function setDefaultBrandKit(
  context: WorkspaceApiContext,
  brandKitId: string,
  body: SetDefaultBrandKitBody,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitSummary> {
  const response = await fetcher(
    `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/default`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitSummary;
}

export async function fetchDefaultBrandKitRevision(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitRevision> {
  const response = await fetcher("/api/v1/brand-kits/default/revision", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitRevision;
}

export async function fetchBrandKitRevision(
  workspaceId: string,
  brandKitId: string,
  brandKitRevisionId: string,
  fetcher: typeof fetch = fetch,
): Promise<BrandKitRevision> {
  const response = await fetcher(
    `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/revisions/${encodeURIComponent(brandKitRevisionId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as BrandKitRevision;
}

export async function fetchWorkspaceAssets(
  workspaceId: string,
  query: WorkspaceAssetListQuery = {},
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WorkspaceAssetList> {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      parameters.set(key, value);
    }
  }
  const search = parameters.toString();
  const response = await fetcher(
    `/api/v1/assets${search ? `?${search}` : ""}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceAssetList;
}

export async function fetchWorkspaceAsset(
  workspaceId: string,
  assetId: string,
  queryOrFetcher: WorkspaceAssetDetailQuery | typeof fetch = {},
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAssetDetail> {
  const query = typeof queryOrFetcher === "function" ? {} : queryOrFetcher;
  const assetFetcher =
    typeof queryOrFetcher === "function" ? queryOrFetcher : fetcher;
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      parameters.set(key, value);
    }
  }
  const search = parameters.toString();
  const response = await assetFetcher(
    devWorkspaceAssetPermissionLossUrl(
      `/api/v1/assets/${encodeURIComponent(assetId)}${
        search ? `?${search}` : ""
      }`,
    ),
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceAssetDetail;
}

export async function fetchWorkspaceCreationEntrypoints(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceCreationEntrypointList> {
  const response = await fetcher("/api/v1/creation-entrypoints", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceCreationEntrypointList;
}

export async function fetchCanvasCapabilities(
  workspaceId: string,
  query: CanvasCapabilityCatalogQuery,
  fetcher: typeof fetch = fetch,
): Promise<CanvasCapabilityCatalog> {
  const parameters = new URLSearchParams({ ...query });
  const response = await fetcher(
    `/api/v1/canvas-capabilities?${parameters.toString()}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CanvasCapabilityCatalog;
}

export async function fetchCanvasDraft(
  workspaceId: string,
  canvasDraftId: string,
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraft> {
  const response = await fetcher(
    `/api/v1/canvas-drafts/${encodeURIComponent(canvasDraftId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraft;
}

export async function fetchCanvasDrafts(
  workspaceId: string,
  limit = 12,
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraftList> {
  const response = await fetcher(
    `/api/v1/canvas-drafts?limit=${String(limit)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraftList;
}

export async function createWorkspaceAgentMessage(
  context: WorkspaceApiContext,
  body: CreateWorkspaceAgentMessageBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentRunAccepted> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agent/messages`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentRunAccepted;
}

export async function fetchAgentHubAgents(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentHubAgents> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agents`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentHubAgents;
}

export async function createAgentHubAgent(
  context: WorkspaceApiContext,
  body: CreateAgentHubAgentBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentHubAgent> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agents`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentHubAgent;
}

export async function fetchAgentHubAgent(
  workspaceId: string,
  agentDefinitionId: string,
  fetcher: typeof fetch = fetch,
  threadId?: string,
): Promise<AgentHubAgentDetail> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentDefinitionId)}${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentHubAgentDetail;
}

export async function updateAgentHubAgent(
  context: WorkspaceApiContext,
  agentDefinitionId: string,
  body: UpdateAgentHubAgentBody,
  fetcher: typeof fetch = fetch,
): Promise<AgentHubAgentDetail> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agents/${encodeURIComponent(agentDefinitionId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentHubAgentDetail;
}

export async function fetchAgentHubSkills(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentHubSkills> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/skills`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentHubSkills;
}

export async function fetchAgentHubSkill(
  workspaceId: string,
  skillDefinitionId: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentHubSkillDetail> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(skillDefinitionId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentHubSkillDetail;
}

export async function fetchSkillDrafts(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<SkillDraftList> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/skill-drafts`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillDraftList;
}

export async function createSkillDraft(
  context: WorkspaceApiContext,
  body: CreateSkillDraftBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<SkillDraftSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-drafts`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillDraftSummary;
}

export async function fetchSkillDraft(
  workspaceId: string,
  skillDraftId: string,
  fetcher: typeof fetch = fetch,
): Promise<SkillDraftDetail> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/skill-drafts/${encodeURIComponent(skillDraftId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillDraftDetail;
}

export type SkillFileSource =
  | { readonly kind: "draft"; readonly id: string; readonly version: number }
  | {
      readonly kind: "published";
      readonly id: string;
      readonly revisionId: string;
    };

export async function fetchSkillFile(
  workspaceId: string,
  source: SkillFileSource,
  path: string,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const query = new URLSearchParams({ path });
  if (source.kind === "draft")
    query.set("draftVersion", String(source.version));
  else query.set("skillRevisionId", source.revisionId);
  const collection = source.kind === "draft" ? "skill-drafts" : "skills";
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/${collection}/${encodeURIComponent(source.id)}/files?${query}`,
    {
      credentials: "include",
      headers: { accept: "*/*", "x-kanvas-workspace-id": workspaceId },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.blob();
}

export async function importSkillPackage(
  context: WorkspaceApiContext,
  file: File,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
  filenameEncoding = "auto",
): Promise<SkillDraftSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-imports`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/zip",
        "x-skill-filename-encoding": filenameEncoding,
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: file,
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillDraftSummary;
}

export async function updateSkillDraft(
  context: WorkspaceApiContext,
  skillDraftId: string,
  body: UpdateSkillDraftBody,
  fetcher: typeof fetch = fetch,
): Promise<SkillDraftSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-drafts/${encodeURIComponent(skillDraftId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillDraftSummary;
}

export async function archiveSkillDraft(
  context: WorkspaceApiContext,
  skillDraftId: string,
  expectedDraftVersion: number,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-drafts/${encodeURIComponent(skillDraftId)}/archive`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify({ expectedDraftVersion }),
    },
  );
  if (!response.ok) throw await readProblem(response);
}

export async function submitSkillCandidate(
  context: WorkspaceApiContext,
  skillDraftId: string,
  body: SubmitSkillCandidateBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<SkillDraftSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-drafts/${encodeURIComponent(skillDraftId)}/candidates`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillDraftSummary;
}

export async function publishSkillCandidate(
  context: WorkspaceApiContext,
  skillCandidateId: string,
  expectedCandidateDigest: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentHubSkill> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-candidates/${encodeURIComponent(skillCandidateId)}/publications`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify({ expectedCandidateDigest }),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentHubSkill;
}

export async function recordSkillCandidateTest(
  context: WorkspaceApiContext,
  skillCandidateId: string,
  body: RecordSkillCandidateTestBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<SkillDraftSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-candidates/${encodeURIComponent(skillCandidateId)}/tests`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillDraftSummary;
}

export async function changeSkillRuntimeStatus(
  context: WorkspaceApiContext,
  skillRevisionId: string,
  body: ChangeSkillRuntimeStatusBody,
  fetcher: typeof fetch = fetch,
): Promise<SkillRuntimeStatus> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/skill-revisions/${encodeURIComponent(skillRevisionId)}/runtime-status`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as SkillRuntimeStatus;
}

export async function downloadSkillPackage(
  workspaceId: string,
  skillDefinitionId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly blob: Blob; readonly filename: string }> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(skillDefinitionId)}/export`,
    {
      credentials: "include",
      headers: { "x-kanvas-workspace-id": workspaceId },
    },
  );
  if (!response.ok) throw await readProblem(response);
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/u.exec(disposition)?.[1] ?? "skill.zip";
  return { blob: await response.blob(), filename };
}

export async function setAgentHubVisibility(
  context: WorkspaceApiContext,
  subjectKind: "agent" | "skill",
  subjectId: string,
  body: SetAgentHubVisibilityBody,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/hub/${subjectKind}/${encodeURIComponent(subjectId)}/visibility`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
}

export async function fetchAgentThreads(
  workspaceId: string,
  options: { readonly cursor?: string; readonly limit?: number } = {},
  fetcher: typeof fetch = fetch,
): Promise<AgentThreadList> {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent/threads${suffix}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentThreadList;
}

export async function fetchAgentThread(
  workspaceId: string,
  threadId: string,
  fetcher: typeof fetch = fetch,
  locale?: string,
): Promise<AgentThreadView> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent/threads/${encodeURIComponent(threadId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(locale ? { "accept-language": locale } : {}),
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentThreadView;
}

export async function streamAgentThread(
  workspaceId: string,
  threadId: string,
  onThread: (thread: AgentThreadView) => void,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  locale?: string,
): Promise<void> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent/threads/${encodeURIComponent(threadId)}/events`,
    {
      credentials: "include",
      headers: {
        accept: "text/event-stream",
        ...(locale ? { "accept-language": locale } : {}),
        "x-kanvas-workspace-id": workspaceId,
      },
      signal,
    },
  );
  if (!response.ok) throw await readProblem(response);
  if (!response.body) throw new Error("Agent Thread stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const drain = (): void => {
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary < 0) return;
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(sseDataPrefixLength).trimStart())
        .join("\n");
      if (!payload || event.startsWith("event: error")) continue;
      onThread(JSON.parse(payload) as AgentThreadView);
    }
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder
      .decode(chunk.value, { stream: true })
      .replaceAll("\r\n", "\n");
    drain();
  }
}

export async function cancelAgentRun(
  context: WorkspaceApiContext,
  agentRunId: string,
  fetcher: typeof fetch = fetch,
): Promise<CancelledAgentRun> {
  const response = await fetcher(
    `/api/v1/agent-runs/${encodeURIComponent(agentRunId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: "{}",
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CancelledAgentRun;
}

export async function resolveAgentInteraction(
  context: WorkspaceApiContext,
  interactionId: string,
  body: ResolveAgentInteractionBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedAgentInteraction> {
  const response = await fetcher(
    `/api/v1/agent-interactions/${encodeURIComponent(interactionId)}/resolve`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ResolvedAgentInteraction;
}

export async function regenerateAgentResponse(
  context: WorkspaceApiContext,
  threadId: string,
  target:
    { readonly assistantMessageId: string } | { readonly agentRunId: string },
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentRunAccepted> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agent/threads/${encodeURIComponent(threadId)}/regenerate`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(target),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentRunAccepted;
}

export async function selectAgentResponseBranch(
  context: WorkspaceApiContext,
  threadId: string,
  assistantMessageId: string,
  expectedVersion: number,
  fetcher: typeof fetch = fetch,
): Promise<AgentThreadSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agent/threads/${encodeURIComponent(threadId)}/branches/select`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify({ assistantMessageId, expectedVersion }),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentThreadSummary;
}

export async function renameAgentThread(
  context: WorkspaceApiContext,
  threadId: string,
  body: RenameAgentThreadBody,
  fetcher: typeof fetch = fetch,
): Promise<AgentThreadSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agent/threads/${encodeURIComponent(threadId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentThreadSummary;
}

export async function archiveAgentThread(
  context: WorkspaceApiContext,
  threadId: string,
  body: ArchiveAgentThreadBody,
  fetcher: typeof fetch = fetch,
): Promise<AgentThreadSummary> {
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/agent/threads/${encodeURIComponent(threadId)}/archive`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentThreadSummary;
}

export async function fetchAgentRun(
  workspaceId: string,
  agentRunId: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentRunView> {
  const response = await fetcher(
    `/api/v1/agent-runs/${encodeURIComponent(agentRunId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentRunView;
}

export async function fetchAgentRunDiagnostics(
  workspaceId: string,
  runId: string,
  fetcher: typeof fetch = fetch,
): Promise<AgentRunDiagnostics> {
  const response = await fetcher(
    `/api/v1/agent-runs/${encodeURIComponent(runId)}/diagnostics`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as AgentRunDiagnostics;
}

export async function confirmAgentAction(
  context: WorkspaceApiContext,
  actionReceiptId: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ConfirmedAgentAction> {
  const response = await fetcher(
    `/api/v1/agent-actions/${encodeURIComponent(actionReceiptId)}/confirm`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: "{}",
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as ConfirmedAgentAction;
}

const agentCanvasExportReceiptTimeoutMs = 10_000;

export async function completeAgentCanvasExport(
  context: WorkspaceApiContext,
  actionReceiptId: string,
  body: CompleteAgentCanvasExportBody,
): Promise<void> {
  const response = await fetch(
    `/api/v1/agent-actions/${encodeURIComponent(actionReceiptId)}/canvas-export`,
    {
      method: "POST",
      signal: AbortSignal.timeout(agentCanvasExportReceiptTimeoutMs),
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(
          context,
          `canvas-export:${actionReceiptId}`,
        ),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
}

export async function declineAgentAction(
  context: WorkspaceApiContext,
  actionReceiptId: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<DeclinedAgentAction> {
  const response = await fetcher(
    `/api/v1/agent-actions/${encodeURIComponent(actionReceiptId)}/decline`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: "{}",
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as DeclinedAgentAction;
}

export async function createCanvasDraft(
  context: WorkspaceApiContext,
  body: CreateCanvasDraftBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraftMutationResult> {
  const response = await fetcher(
    devCanvasDraftResponseLossUrl(
      devCanvasDraftPermissionLossUrl("/api/v1/canvas-drafts"),
    ),
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraftMutationResult;
}

export async function updateCanvasDraft(
  context: WorkspaceApiContext,
  canvasDraftId: string,
  body: UpdateCanvasDraftBody,
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraftMutationResult> {
  const response = await fetcher(
    `/api/v1/canvas-drafts/${encodeURIComponent(canvasDraftId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraftMutationResult;
}

export async function updateCanvasDraftBrand(
  context: WorkspaceApiContext,
  canvasDraftId: string,
  body: UpdateCanvasDraftBrandBody,
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraftMutationResult> {
  const response = await fetcher(
    `/api/v1/canvas-drafts/${encodeURIComponent(canvasDraftId)}/brand`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraftMutationResult;
}

export async function fetchWorkflowDefinitions(
  workspaceId: string,
  options: {
    readonly includeArchived?: boolean;
    readonly limit?: number;
  } = {},
  fetcher: typeof fetch = fetch,
): Promise<WorkflowDefinitionList> {
  const search = new URLSearchParams();
  if (options.includeArchived) {
    search.set("includeArchived", "true");
  }
  const DEFAULT_WORKFLOW_LIST_LIMIT = 50;
  search.set("limit", String(options.limit ?? DEFAULT_WORKFLOW_LIST_LIMIT));
  const response = await fetcher(`/api/v1/workflows?${search.toString()}`, {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowDefinitionList;
}

export async function fetchWorkflowAuthoringCapabilities(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowAuthoringCapabilityList> {
  const response = await fetcher("/api/v1/workflow-authoring-capabilities", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowAuthoringCapabilityList;
}

export async function validateWorkflowTopology(
  context: WorkspaceApiContext,
  topology: WorkflowTopology,
  fetcher: typeof fetch = fetch,
): Promise<ValidateWorkflowTopologyResult> {
  const response = await fetcher("/api/v1/workflow-topologies/validate", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(topology),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ValidateWorkflowTopologyResult;
}

export async function fetchWorkflowDraft(
  workspaceId: string,
  workflowDefinitionId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowDraft> {
  const response = await fetcher(
    `/api/v1/workflows/${encodeURIComponent(workflowDefinitionId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowDraft;
}

export async function createWorkflowDraft(
  context: WorkspaceApiContext,
  body: CreateWorkflowDraftBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowDraftMutationResult> {
  const response = await fetcher("/api/v1/workflow-drafts", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowDraftMutationResult;
}

export async function updateWorkflowDraft(
  context: WorkspaceApiContext,
  workflowDefinitionId: string,
  workflowDraftId: string,
  body: UpdateWorkflowDraftBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowDraftMutationResult> {
  const response = await fetcher(
    `/api/v1/workflows/${encodeURIComponent(workflowDefinitionId)}/drafts/${encodeURIComponent(workflowDraftId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowDraftMutationResult;
}

export async function fetchWorkflowCandidates(
  workspaceId: string,
  workflowKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowCandidateList> {
  const search = new URLSearchParams();
  if (workflowKey) {
    search.set("workflowKey", workflowKey);
  }
  const response = await fetcher(
    `/api/v1/workflow-candidates?${search.toString()}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowCandidateList;
}

export async function fetchWorkflowCandidate(
  workspaceId: string,
  candidateId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowCandidateReview> {
  const response = await fetcher(
    `/api/v1/workflow-candidates/${encodeURIComponent(candidateId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowCandidateReview;
}

export async function submitWorkflowCandidate(
  context: WorkspaceApiContext,
  definitionId: string,
  draftId: string,
  body: SubmitWorkflowCandidateBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowCandidateReview> {
  const response = await fetcher(
    `/api/v1/workflows/${encodeURIComponent(definitionId)}/drafts/${encodeURIComponent(draftId)}/candidates`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowCandidateReview;
}

export async function startWorkflowCandidateTest(
  context: WorkspaceApiContext,
  candidateId: string,
  body: StartWorkflowCandidateTestBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowRunAccepted> {
  const response = await fetcher(
    `/api/v1/workflow-candidates/${encodeURIComponent(candidateId)}/test-runs`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowRunAccepted;
}

async function mutateWorkflowCandidate(
  context: WorkspaceApiContext,
  candidateId: string,
  suffix: string,
  body:
    | RecordWorkflowCandidateEvalBody
    | ReviewWorkflowCandidateBody
    | PublishWorkflowCandidateBody,
  idempotencyKey: string | undefined,
  fetcher: typeof fetch,
): Promise<WorkflowCandidateReview> {
  const response = await fetcher(
    `/api/v1/workflow-candidates/${encodeURIComponent(candidateId)}/${suffix}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(idempotencyKey
          ? idempotentWorkspaceHeaders(context, idempotencyKey)
          : workspaceHeaders(context)),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowCandidateReview;
}

export function recordWorkflowCandidateEval(
  context: WorkspaceApiContext,
  candidateId: string,
  body: RecordWorkflowCandidateEvalBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowCandidateReview> {
  return mutateWorkflowCandidate(
    context,
    candidateId,
    "eval-checks",
    body,
    undefined,
    fetcher,
  );
}

export function reviewWorkflowCandidate(
  context: WorkspaceApiContext,
  candidateId: string,
  body: ReviewWorkflowCandidateBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowCandidateReview> {
  return mutateWorkflowCandidate(
    context,
    candidateId,
    "reviews",
    body,
    undefined,
    fetcher,
  );
}

export function publishWorkflowCandidate(
  context: WorkspaceApiContext,
  candidateId: string,
  body: PublishWorkflowCandidateBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowCandidateReview> {
  return mutateWorkflowCandidate(
    context,
    candidateId,
    "publications",
    body,
    idempotencyKey,
    fetcher,
  );
}

export async function fetchWorkflowTemplates(
  workspaceId: string,
  filters: {
    readonly q?: string;
    readonly category?: string;
  } = {},
  fetcher: typeof fetch = fetch,
): Promise<WorkflowTemplateList> {
  const search = new URLSearchParams();
  if (filters.q) {
    search.set("q", filters.q);
  }
  if (filters.category) {
    search.set("category", filters.category);
  }
  const response = await fetcher(
    `/api/v1/workflow-templates?${search.toString()}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowTemplateList;
}

export async function fetchWorkflowTemplate(
  workspaceId: string,
  workflowRevisionId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowTemplate> {
  const response = await fetcher(
    `/api/v1/workflow-templates/${encodeURIComponent(workflowRevisionId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowTemplate;
}

export async function fetchCanvasDraftRevisions(
  workspaceId: string,
  canvasDraftId: string,
  query: {
    readonly beforeVersion?: number;
    readonly limit?: number;
  } = {},
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraftRevisionList> {
  const search = new URLSearchParams();
  if (query.beforeVersion !== undefined) {
    search.set("beforeVersion", String(query.beforeVersion));
  }
  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const response = await fetcher(
    `/api/v1/canvas-drafts/${encodeURIComponent(canvasDraftId)}/revisions${suffix}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraftRevisionList;
}

export async function fetchCanvasDraftRevision(
  workspaceId: string,
  canvasDraftId: string,
  version: number,
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraftRevision> {
  const response = await fetcher(
    `/api/v1/canvas-drafts/${encodeURIComponent(canvasDraftId)}/revisions/${String(version)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraftRevision;
}

export async function restoreCanvasDraft(
  context: WorkspaceApiContext,
  canvasDraftId: string,
  body: RestoreCanvasDraftBody,
  fetcher: typeof fetch = fetch,
): Promise<CanvasDraftMutationResult> {
  const response = await fetcher(
    `/api/v1/canvas-drafts/${encodeURIComponent(canvasDraftId)}/restore`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasDraftMutationResult;
}

export async function fetchOperationalTimeline(
  workspaceId: string,
  workflowRunId: string,
  fetcher: typeof fetch = fetch,
): Promise<OperationalTimeline> {
  const response = await fetcher(
    `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}/operational-timeline`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as OperationalTimeline;
}

export async function createWorkspaceInvitation(
  context: WorkspaceApiContext,
  body: CreateWorkspaceInvitationBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceInvitationCreated> {
  const response = await fetcher("/api/v1/workspace-invitations", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceInvitationCreated;
}

export async function resendWorkspaceInvitation(
  context: WorkspaceApiContext,
  invitationId: string,
  body: ResendWorkspaceInvitationBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceInvitationCreated> {
  const response = await fetcher(
    `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/resends`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceInvitationCreated;
}

export async function revokeWorkspaceInvitation(
  context: WorkspaceApiContext,
  invitationId: string,
  body: RevokeWorkspaceInvitationBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceInvitationRevoked> {
  const response = await fetcher(
    `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}/revocations`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceInvitationRevoked;
}

export async function acceptWorkspaceInvitation(
  csrfToken: string,
  body: AcceptWorkspaceInvitationBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceInvitationAccepted> {
  const response = await fetcher("/api/v1/workspace-invitation-acceptances", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-kanvas-csrf": csrfToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceInvitationAccepted;
}

export async function changeWorkspaceMembership(
  context: WorkspaceApiContext,
  targetPrincipalId: string,
  body: ChangeWorkspaceMembershipBody,
  fetcher: typeof fetch = fetch,
): Promise<ChangedWorkspaceMembership> {
  const response = await fetcher(
    `/api/v1/workspace-memberships/${encodeURIComponent(targetPrincipalId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ChangedWorkspaceMembership;
}

export async function changeWorkspaceMemberships(
  context: WorkspaceApiContext,
  body: ChangeWorkspaceMembershipsBody,
  fetcher: typeof fetch = fetch,
): Promise<ChangedWorkspaceMemberships> {
  const response = await fetcher("/api/v1/workspace-memberships", {
    method: "PATCH",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as ChangedWorkspaceMemberships;
}

export async function allocateCanvasExport(
  context: WorkspaceApiContext,
  body: AllocateCanvasExportBody,
  idempotencyKey: string,
  options: {
    readonly fetcher?: typeof fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CanvasExportUploadSession> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher("/api/v1/canvas-export-sessions", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasExportUploadSession;
}

export async function fetchCanvasExport(
  context: Pick<WorkspaceApiContext, "workspaceId">,
  exportSessionId: string,
  options: {
    readonly fetcher?: typeof fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CanvasExportUploadSession> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `/api/v1/canvas-export-sessions/${encodeURIComponent(exportSessionId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": context.workspaceId,
      },
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CanvasExportUploadSession;
}

export interface CanvasExportUploadProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

export interface CanvasExportUploadOptions {
  readonly requestFactory?: () => XMLHttpRequest;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CanvasExportUploadProgress) => void;
}

export async function uploadCanvasExport(
  context: WorkspaceApiContext,
  exportSessionId: string,
  blob: Blob,
  options: CanvasExportUploadOptions = {},
): Promise<CanvasExportIngestion> {
  if (options.signal?.aborted) {
    throw abortError();
  }
  return await new Promise<CanvasExportIngestion>((resolve, reject) => {
    const request = options.requestFactory?.() ?? new XMLHttpRequest();
    const abortRequest = () => {
      request.abort();
    };
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abortRequest);
    };
    request.onload = () => {
      cleanup();
      if (
        request.status < httpStatus.ok ||
        request.status >= httpStatus.multipleChoices
      ) {
        reject(readRequestProblem(request));
        return;
      }
      try {
        resolve(JSON.parse(request.responseText) as CanvasExportIngestion);
      } catch {
        reject(
          new ApiProblem(
            request.status,
            "invalid_api_response",
            "Kanvas API returned an invalid Canvas Export response.",
          ),
        );
      }
    };
    request.onerror = () => {
      cleanup();
      reject(
        new ApiProblem(
          0,
          "upload_transport_failed",
          "Canvas Export could not reach Kanvas Server.",
        ),
      );
    };
    request.onabort = () => {
      cleanup();
      reject(abortError());
    };
    request.upload.onprogress = (event) => {
      options.onProgress?.({
        loadedBytes: Math.min(event.loaded, blob.size),
        totalBytes: blob.size,
      });
    };
    request.open(
      "PUT",
      `/api/v1/canvas-export-sessions/${encodeURIComponent(exportSessionId)}/content`,
    );
    request.withCredentials = true;
    request.setRequestHeader("accept", "application/json");
    request.setRequestHeader(
      "content-type",
      blob.type || "application/octet-stream",
    );
    for (const [name, value] of Object.entries(workspaceHeaders(context))) {
      request.setRequestHeader(name, value);
    }
    options.signal?.addEventListener("abort", abortRequest, {
      once: true,
    });
    options.onProgress?.({
      loadedBytes: 0,
      totalBytes: blob.size,
    });
    request.send(blob);
  });
}

export async function commitCanvasExport(
  context: WorkspaceApiContext,
  exportSessionId: string,
  body: CommitCanvasExportBody,
  options: {
    readonly fetcher?: typeof fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CommittedCanvasExport> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    devCanvasExportPermissionLossUrl(
      devCanvasExportResponseLossUrl(
        `/api/v1/canvas-export-sessions/${encodeURIComponent(exportSessionId)}/commit`,
      ),
    ),
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CommittedCanvasExport;
}

export async function allocateUserImport(
  context: WorkspaceApiContext,
  body: AllocateUserImportBody,
  idempotencyKey: string,
  options: {
    readonly fetcher?: typeof fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<UserImportUploadSession> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher("/api/v1/user-import-upload-sessions", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as UserImportUploadSession;
}

export interface UserImportUploadProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

export interface UserImportUploadOptions {
  readonly requestFactory?: () => XMLHttpRequest;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: UserImportUploadProgress) => void;
}

function abortError(): DOMException {
  return new DOMException("The user import upload was aborted.", "AbortError");
}

function readRequestProblem(request: XMLHttpRequest): ApiProblem {
  let value: { readonly code?: unknown; readonly detail?: unknown } | undefined;
  try {
    value = JSON.parse(request.responseText) as typeof value;
  } catch {
    value = undefined;
  }
  return new ApiProblem(
    request.status,
    typeof value?.code === "string" ? value.code : "api_request_failed",
    typeof value?.detail === "string"
      ? value.detail
      : `Kanvas API request failed with status ${String(request.status)}.`,
  );
}

export async function uploadUserImport(
  context: WorkspaceApiContext,
  uploadSessionId: string,
  file: File,
  options: UserImportUploadOptions = {},
): Promise<UserImportIngestion> {
  if (options.signal?.aborted) {
    throw abortError();
  }

  return await new Promise<UserImportIngestion>((resolve, reject) => {
    const request = options.requestFactory?.() ?? new XMLHttpRequest();
    const abortRequest = () => {
      request.abort();
    };
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abortRequest);
    };

    request.onload = () => {
      cleanup();
      if (
        request.status < httpStatus.ok ||
        request.status >= httpStatus.multipleChoices
      ) {
        reject(readRequestProblem(request));
        return;
      }
      try {
        resolve(JSON.parse(request.responseText) as UserImportIngestion);
      } catch {
        reject(
          new ApiProblem(
            request.status,
            "invalid_api_response",
            "Kanvas API returned an invalid upload response.",
          ),
        );
      }
    };
    request.onerror = () => {
      cleanup();
      reject(
        new ApiProblem(
          0,
          "upload_transport_failed",
          "The user import upload could not reach Kanvas Server.",
        ),
      );
    };
    request.onabort = () => {
      cleanup();
      reject(abortError());
    };
    request.upload.onprogress = (event) => {
      options.onProgress?.({
        loadedBytes: Math.min(event.loaded, file.size),
        totalBytes: file.size,
      });
    };

    try {
      request.open(
        "PUT",
        devUserImportContentDelayUrl(
          `/api/v1/user-import-upload-sessions/${encodeURIComponent(uploadSessionId)}/content`,
        ),
      );
      request.withCredentials = true;
      request.setRequestHeader("accept", "application/json");
      request.setRequestHeader(
        "content-type",
        file.type || "application/octet-stream",
      );
      for (const [name, value] of Object.entries(workspaceHeaders(context))) {
        request.setRequestHeader(name, value);
      }
      options.signal?.addEventListener("abort", abortRequest, { once: true });
      options.onProgress?.({
        loadedBytes: 0,
        totalBytes: file.size,
      });
      request.send(file);
    } catch (error) {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error("The user import upload could not start.", {
              cause: error,
            }),
      );
    }
  });
}

export async function commitUserImport(
  context: WorkspaceApiContext,
  uploadSessionId: string,
  body: CommitUserImportBody,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CommittedUserImport> {
  const response = await fetcher(
    `/api/v1/user-import-upload-sessions/${encodeURIComponent(uploadSessionId)}/commit`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as CommittedUserImport;
}

export async function downloadArtifact(
  workspaceId: string,
  artifactId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetcher(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
    {
      credentials: "include",
      headers: {
        accept: "*/*",
        "x-kanvas-workspace-id": workspaceId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return response.blob();
}

export async function downloadArtifactPreview(
  workspaceId: string,
  artifactId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetcher(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/preview`,
    {
      credentials: "include",
      headers: {
        accept: "image/webp",
        "x-kanvas-workspace-id": workspaceId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return response.blob();
}

export async function createWorkspaceAssetFromArtifact(
  context: WorkspaceApiContext,
  body: CreateWorkspaceAssetFromArtifactBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceAssetAdoption> {
  const response = await fetcher(devResponseLossUrl("/api/v1/assets"), {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, body.assetId),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkspaceAssetAdoption;
}

export async function cancelWorkflowRun(
  context: WorkspaceApiContext,
  workflowRunId: string,
  body: CancelWorkflowRunBody = {},
  fetcher: typeof fetch = fetch,
): Promise<WorkflowRunCancellationAccepted> {
  const response = await fetcher(
    `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowRunCancellationAccepted;
}

export async function decideWorkflowApproval(
  context: WorkspaceApiContext,
  workflowRunId: string,
  body: DecideWorkflowApprovalBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowApprovalDecisionResult> {
  const response = await fetcher(
    `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}/approval-decisions`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowApprovalDecisionResult;
}

export async function createWorkflowRun(
  context: WorkspaceApiContext,
  body: CreateWorkflowRunBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowRunAccepted> {
  const response = await fetcher("/api/v1/workflow-runs", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowRunAccepted;
}

export async function createCanvasCapabilityRun(
  context: WorkspaceApiContext,
  body: CreateCanvasCapabilityRunBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityRunAccepted> {
  const response = await fetcher("/api/v1/canvas-capability-runs", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CapabilityRunAccepted;
}

export async function createCapabilityRun(
  context: WorkspaceApiContext,
  body: CreateCapabilityRunBody,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityRunAccepted> {
  const response = await fetcher("/api/v1/capability-runs", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...idempotentWorkspaceHeaders(context, idempotencyKey),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CapabilityRunAccepted;
}

export async function fetchCapabilityRun(
  workspaceId: string,
  capabilityRunId: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityRunDetails> {
  const response = await fetcher(
    `/api/v1/capability-runs/${encodeURIComponent(capabilityRunId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CapabilityRunDetails;
}

export async function cancelCapabilityRun(
  context: WorkspaceApiContext,
  capabilityRunId: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CapabilityRunDetails> {
  const response = await fetcher(
    `/api/v1/capability-runs/${encodeURIComponent(capabilityRunId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...idempotentWorkspaceHeaders(context, idempotencyKey),
      },
      body: "{}",
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as CapabilityRunDetails;
}

export async function fetchWorkflowRun(
  workspaceId: string,
  workflowRunId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkflowRunDetails> {
  const response = await fetcher(
    `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowRunDetails;
}

export async function fetchWorkflowRuns(
  workspaceId: string,
  options: {
    readonly workflowRevisionId?: string;
    readonly state?: "active" | "completed" | "unfinished";
    readonly cursor?: string;
    readonly limit?: number;
  } = {},
  fetcher: typeof fetch = fetch,
): Promise<WorkflowRunList> {
  const DEFAULT_RECENT_WORKFLOW_RUN_LIMIT = 6;
  const search = new URLSearchParams();
  if (options.workflowRevisionId) {
    search.set("workflowRevisionId", options.workflowRevisionId);
  }
  if (options.state) search.set("state", options.state);
  if (options.cursor) search.set("cursor", options.cursor);
  search.set(
    "limit",
    String(options.limit ?? DEFAULT_RECENT_WORKFLOW_RUN_LIMIT),
  );
  const response = await fetcher(`/api/v1/workflow-runs?${search.toString()}`, {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) {
    throw await readProblem(response);
  }
  return (await response.json()) as WorkflowRunList;
}

export async function fetchResourceStates(
  workspaceId: string,
  kind: "agent" | "skill",
): Promise<ResourceStateList> {
  const response = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/hub/${kind}/states`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<ResourceStateList>;
}
export async function changeResourceState(
  context: WorkspaceApiContext,
  kind: "agent" | "skill",
  id: string,
  body: ChangeResourceStateBody,
): Promise<void> {
  const response = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(context.workspaceId)}/hub/${kind}/${encodeURIComponent(id)}/state`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...workspaceHeaders(context),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
}

export async function addWorkspaceMember(
  context: WorkspaceApiContext,
  body: AddWorkspaceMemberBody,
  fetcher: typeof fetch = fetch,
): Promise<ChangedWorkspaceMembership> {
  const response = await fetcher("/api/v1/workspace-memberships", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...workspaceHeaders(context),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<ChangedWorkspaceMembership>;
}

export async function changeInstanceWorkspaceMembership(
  csrfToken: string,
  workspaceId: string,
  targetPrincipalId: string,
  body: ChangeWorkspaceMembershipBody,
  fetcher: typeof fetch = fetch,
): Promise<ChangedWorkspaceMembership> {
  const response = await fetcher(
    `/api/v1/instance/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(targetPrincipalId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<ChangedWorkspaceMembership>;
}

export async function changeInstancePrincipalStatus(
  csrfToken: string,
  targetPrincipalId: string,
  body: ChangeInstancePrincipalStatusBody,
  fetcher: typeof fetch = fetch,
): Promise<ChangedInstancePrincipalStatus> {
  const response = await fetcher(
    `/api/v1/instance/principals/${encodeURIComponent(targetPrincipalId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<ChangedInstancePrincipalStatus>;
}

export async function createInstanceInvitation(
  csrfToken: string,
  workspaceId: string,
  body: CreateWorkspaceInvitationBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceInvitationCreated> {
  const response = await fetcher(
    `/api/v1/instance/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<WorkspaceInvitationCreated>;
}
export async function revokeInstanceInvitation(
  csrfToken: string,
  workspaceId: string,
  invitationId: string,
  body: RevokeWorkspaceInvitationBody,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceInvitationRevoked> {
  const response = await fetcher(
    `/api/v1/instance/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}/revocations`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-kanvas-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<WorkspaceInvitationRevoked>;
}

async function defaultAccessRequest<T>(
  path: string,
  method: string,
  csrfToken?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(csrfToken ? { "x-kanvas-csrf": csrfToken } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as T;
}
export const fetchDefaultAccessPolicy = (): Promise<DefaultAccessPolicy> =>
  defaultAccessRequest("/api/v1/instance/default-access", "GET");
export const updateDefaultAccessPolicy = (
  csrf: string,
  body: UpdateDefaultAccessPolicyBody,
): Promise<DefaultAccessPolicy> =>
  defaultAccessRequest("/api/v1/instance/default-access", "PUT", csrf, body);
export const previewDefaultAccess = (): Promise<DefaultAccessPreview> =>
  defaultAccessRequest("/api/v1/instance/default-access/preview", "GET");
export const applyDefaultAccess = (
  csrf: string,
  body: ApplyDefaultAccessBody,
): Promise<AppliedDefaultAccess> =>
  defaultAccessRequest(
    "/api/v1/instance/default-access/apply",
    "POST",
    csrf,
    body,
  );
export const retryDefaultAccess = (
  csrf: string,
): Promise<DefaultAccessStatus> =>
  defaultAccessRequest("/api/v1/default-access/retry", "POST", csrf);
export async function fetchTaskRecords(
  workspaceId: string,
  query: TaskRecordQuery,
  fetcher: typeof fetch = fetch,
): Promise<TaskRecordList> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) search.set(key, String(value));
  const response = await fetcher(`/api/v1/task-records?${search}`, {
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as TaskRecordList;
}
export async function fetchTaskTimeline(
  workspaceId: string,
  kind: "workflow" | "capability",
  taskRunId: string,
  fetcher: typeof fetch = fetch,
): Promise<TaskTimeline> {
  const response = await fetcher(
    `/api/v1/task-records/${kind}/${encodeURIComponent(taskRunId)}/timeline`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return (await response.json()) as TaskTimeline;
}

export const fetchRuntimeConfiguration =
  (): Promise<RuntimeConfigurationOverview> =>
    defaultAccessRequest("/api/v1/instance/runtime-configuration", "GET");
export const fetchRuntimeConfigurationHistory = (): Promise<{
  items: RuntimeConfigurationRevision[];
  truncated: boolean;
}> =>
  defaultAccessRequest("/api/v1/instance/runtime-configuration/history", "GET");
export const publishRuntimeConfiguration = (
  csrf: string,
  body: PublishRuntimeConfiguration,
): Promise<RuntimeConfigurationRevision> =>
  defaultAccessRequest(
    "/api/v1/instance/runtime-configuration",
    "PUT",
    csrf,
    body,
  );
export const restoreRuntimeConfiguration = (
  csrf: string,
  body: RestoreRuntimeConfiguration,
): Promise<RuntimeConfigurationRevision> =>
  defaultAccessRequest(
    "/api/v1/instance/runtime-configuration/restore",
    "POST",
    csrf,
    body,
  );

export async function fetchProviderResultRecovery(
  workspaceId: string,
  runId: string,
): Promise<ProviderResultRecoveryView> {
  const response = await fetch(
    `/api/v1/capability-runs/${encodeURIComponent(runId)}/result-recovery`,
    {
      credentials: "include",
      headers: {
        "x-kanvas-workspace-id": workspaceId,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<ProviderResultRecoveryView>;
}
export async function requestProviderResultRecovery(
  workspaceId: string,
  runId: string,
  csrf: string,
  requestKey: string,
): Promise<ProviderResultRecoveryView> {
  const response = await fetch(
    `/api/v1/capability-runs/${encodeURIComponent(runId)}/result-recovery`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "x-kanvas-workspace-id": workspaceId,
        "x-kanvas-csrf": csrf,
        "idempotency-key": requestKey,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) throw await readProblem(response);
  return response.json() as Promise<ProviderResultRecoveryView>;
}
