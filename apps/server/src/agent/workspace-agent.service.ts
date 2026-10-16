import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  agentBuiltinToolViewDigest,
  AgentToolViewError,
  assertAgentQuestionResponse,
  createBrandCommandToolProjection,
  createBrandResourceToolProjection,
  createLibraryResourceToolProjection,
  createWorkflowResourceToolProjection,
  mergeAgentToolFamilyProjections,
  createCapabilityCatalogToolProjection,
  createCanvasCommandToolProjection,
  createDynamicAgentToolView,
  createSkillCommandToolProjection,
  createThreadWorkQueryToolProjection,
  parseSkillDraftProposalInput,
  parseSkillDraftFilesProposalInput,
  parseBrandPublishProposalToolInput,
  stableAgentRuntimeId,
} from "@kanvas/agent-runtime";
import {
  agentRunFoundationContext,
  workspaceDefaultAgentProfileKeyV1,
  DomainError,
  projectAgentBrandContext,
  projectAgentSurfaceContext,
  type AgentActionReceiptRecord,
  type AgentCanvasExportRequest,
  type AgentCanvasExportCompletion,
  type AgentInteractionRecord,
  type AgentMessageRecord,
  type AgentRunRecord,
  type AgentSurfaceView,
  type AgentThreadListCursor,
  type ApplicationRuntime,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  AgentRunAccepted,
  AgentInteractionView,
  ResolveAgentInteractionBody,
  ResolvedAgentInteraction,
  CompleteAgentCanvasExportBody,
  AgentRunView,
  AgentRunDiagnostics,
  CancelledAgentRun,
  AgentThreadSummary,
  AgentThreadView,
  ConfirmedAgentAction,
  CreateWorkspaceAgentMessageBody,
  DeclinedAgentAction,
  RegenerateAgentResponseBody,
  SelectAgentResponseBranchBody,
} from "@kanvas/contracts/api";
import {
  AgentRuntimeStoreError,
  AgentRunDispatchStoreError,
  CanvasDraftStoreError,
  digestProviderValue,
  WorkspaceContentQueryStoreError,
  type CanvasDraftRecord,
  type DatabaseRuntime,
} from "@kanvas/database/runtime";

import { APPLICATION_RUNTIME, DATABASE_RUNTIME } from "../tokens.js";
import { CapabilityRunService } from "../capabilities/capability-run.service.js";
import { SkillLibraryService } from "../skills/skill-library.service.js";

function canvasExportContent(
  action: AgentActionReceiptRecord,
): AgentThreadView["relatedContent"][number] | undefined {
  if (action.toolKey !== "canvas.export-png") return undefined;
  const raw = action.proposalDocument?.completion;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  return value.status === "succeeded" &&
    typeof value.artifactId === "string" &&
    typeof value.filename === "string"
    ? {
        kind: "artifact",
        resourceId: value.artifactId,
        artifactId: value.artifactId,
        title: value.filename,
        state: "available",
      }
    : undefined;
}

function canvasExportRequest(
  action: AgentActionReceiptRecord,
): AgentCanvasExportRequest | undefined {
  const payload = action.proposalDocument;
  const request = payload?.request;
  if (
    action.toolKey !== "canvas.export-png" ||
    payload?.kind !== "canvas_export" ||
    !request ||
    typeof request !== "object" ||
    Array.isArray(request)
  )
    return undefined;
  const value = request as Record<string, unknown>;
  if (
    typeof value.canvasDraftId !== "string" ||
    typeof value.documentVersion !== "number" ||
    !Number.isSafeInteger(value.documentVersion) ||
    value.documentVersion < 1 ||
    typeof value.pageId !== "string"
  )
    return undefined;
  return {
    canvasDraftId: value.canvasDraftId,
    documentVersion: value.documentVersion,
    pageId: value.pageId,
  };
}

const initialThreadTitleMaximumCharacters = 48;
const agentResourceIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function workflowOutputArtifacts<T extends { readonly id: string }>(
  output: unknown,
  artifacts: readonly T[],
): readonly T[] {
  const availableIds = new Set(artifacts.map((artifact) => artifact.id));
  const selectedIds = new Set<string>();
  const visited = new Set<object>();
  const pending: unknown[] = [output];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (agentResourceIdPattern.test(value) && availableIds.has(value)) {
        selectedIds.add(value);
      }
      continue;
    }
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    const nestedValues: readonly unknown[] = Array.isArray(value)
      ? value
      : Object.values(value as Readonly<Record<string, unknown>>);
    pending.push(...nestedValues);
  }
  return artifacts.filter((artifact) => selectedIds.has(artifact.id));
}

function agentRunSurfaceView(
  view: AgentSurfaceView,
  requestedSkillRevisionId?: string,
): AgentSurfaceView {
  const ordered = requestedSkillRevisionId
    ? [
        ...view.skills.filter(
          (skill) => skill.skillRevisionId === requestedSkillRevisionId,
        ),
        ...view.skills.filter(
          (skill) => skill.skillRevisionId !== requestedSkillRevisionId,
        ),
      ]
    : view.skills;
  const skills = Object.freeze(ordered);
  if (
    skills.length === view.skills.length &&
    skills.every(
      (skill, index) =>
        skill.skillRevisionId === view.skills[index]?.skillRevisionId,
    )
  ) {
    return view;
  }
  return Object.freeze({
    ...view,
    skills,
    skillViewDigest: digestProviderValue({
      profileRevisionId: view.profile.id,
      surfaceKind: "agent_workspace",
      skills,
    }),
  });
}

export function agentRunFailureKind(
  terminalReasonCode: string | undefined,
):
  | "model_setup"
  | "budget"
  | "access_changed"
  | "tools_changed"
  | "limit"
  | "runtime"
  | undefined {
  if (!terminalReasonCode) return undefined;
  if (terminalReasonCode === "agent.tool_view_changed") return "tools_changed";
  if (
    terminalReasonCode === "agent.limit_exceeded" ||
    terminalReasonCode === "agent.output_limit_exceeded"
  )
    return "limit";
  if (terminalReasonCode === "agent.model_binding_preparation_conflict")
    return "runtime";
  if (terminalReasonCode.includes("authorization")) return "access_changed";
  if (
    terminalReasonCode.includes("model_binding") ||
    terminalReasonCode.includes("model_web_search_unsupported") ||
    terminalReasonCode.includes("model_tool_calling_unsupported") ||
    terminalReasonCode.includes("model_structured_output_unsupported") ||
    terminalReasonCode.includes("budget_settlement") ||
    terminalReasonCode.includes("charge_unknown")
  ) {
    return "model_setup";
  }
  if (terminalReasonCode.includes("budget")) return "budget";
  return "runtime";
}

export function agentThreadInitialTitle(message: string): string {
  const normalized = message.replace(/\s+/gu, " ").trim();
  const sentence = normalized.split(/[。！？!?\r\n]/u, 1)[0]!;
  const clauses = sentence
    .split(/[，,；;]/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const title = (
    clauses.find(
      (value) =>
        /(?:做|制作|创建|生成|策划|海报|画板|图片|视觉)/u.test(value) &&
        !/^(?:不要|无需|不需要|禁止|别)/u.test(value) &&
        !/^(?:就)?用这个.*品牌$/u.test(value),
    ) ??
    clauses[0] ??
    sentence
  )
    .replace(/^(?:就)?用这个.*?品牌/u, "")
    .replace(
      /^(?:请|麻烦)?(?:帮我)?(?:做|制作|创建|生成|策划)(?:一[张个份套]|张)?/u,
      "",
    )
    .replace(
      /^(?:请(?:帮我)?|麻烦(?:帮我)?|帮我|我(?:想要|需要|想|要))(?:一[张个份套])?/u,
      "",
    )
    .replace(/^为(.{1,24}?)(?:策划|创建|制作)(?:一[张个份套])?/u, "$1")
    .replace(/^(?:please\s+|i\s+(?:need|want|would like)\s+)/iu, "")
    .replace(/[，,]\s*(?:请)?(?:给我|生成|提供|推荐).{0,16}$/u, "")
    .replace(/[。！？!?.,，；;:：]+$/u, "")
    .trim();
  const maximumCharacters = /\p{Script=Han}/u.test(title)
    ? 32
    : initialThreadTitleMaximumCharacters;
  return [...(title || normalized)].slice(0, maximumCharacters).join("");
}

function threadSummary(
  thread: Awaited<
    ReturnType<DatabaseRuntime["agentRuntime"]["listThreads"]>
  >["items"][number],
): AgentThreadSummary {
  return {
    id: thread.id,
    ...(thread.title ? { title: thread.title } : {}),
    lifecycleStatus: thread.lifecycleStatus,
    version: thread.version,
    ...(thread.latestRun
      ? {
          latestRun: Object.freeze({
            id: thread.latestRun.id,
            lifecycleStatus: thread.latestRun.lifecycleStatus,
            ...(thread.latestRun.lifecycleStatus === "failed"
              ? {
                  failureKind:
                    agentRunFailureKind(thread.latestRun.terminalReasonCode) ??
                    "runtime",
                }
              : {}),
            updatedAt: thread.latestRun.updatedAt.toISOString(),
          }),
        }
      : {}),
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

function interactionView(
  interaction: AgentInteractionRecord,
): AgentInteractionView {
  const response = interaction.response;
  let visibleResponse: AgentInteractionView["response"];
  if (response?.outcome === "submitted") {
    visibleResponse = {
      outcome: "submitted",
      answers: response.answers.map((answer) => ({
        ...answer,
        optionKeys: [...answer.optionKeys],
      })),
      ...(response.supplement ? { supplement: response.supplement } : {}),
    };
  } else if (response) {
    visibleResponse = { outcome: response.outcome };
  }
  return {
    id: interaction.id,
    kind: "question",
    lifecycleStatus: interaction.lifecycleStatus,
    version: interaction.version,
    questions: interaction.request.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
    })),
    ...(visibleResponse ? { response: visibleResponse } : {}),
    createdAt: interaction.createdAt.toISOString(),
    updatedAt: interaction.updatedAt.toISOString(),
  };
}

function messagePartsForView(
  message: AgentMessageRecord,
): AgentThreadView["messages"][number]["parts"] {
  return message.message.parts
    .filter(
      (part) => part.type !== "tool-call" || part.toolName !== "ask_question",
    )
    .map((part) => ({ ...part }));
}

function workflowProposal(action: AgentActionReceiptRecord):
  | {
      readonly workflowRevisionId: string;
      readonly title: string;
      readonly description?: string;
      readonly input?: Readonly<Record<string, unknown>>;
    }
  | undefined {
  const proposal = action.proposalDocument;
  if (
    !proposal ||
    typeof proposal.workflowRevisionId !== "string" ||
    typeof proposal.title !== "string"
  ) {
    return undefined;
  }
  return Object.freeze({
    workflowRevisionId: proposal.workflowRevisionId,
    title: proposal.title,
    ...(typeof proposal.description === "string"
      ? { description: proposal.description }
      : {}),
    ...(proposal.input &&
    typeof proposal.input === "object" &&
    !Array.isArray(proposal.input)
      ? { input: proposal.input as Readonly<Record<string, unknown>> }
      : {}),
  });
}

function capabilityProposal(action: AgentActionReceiptRecord):
  | {
      readonly contractRevisionId: string;
      readonly title: string;
      readonly description?: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | undefined {
  const proposal = action.proposalDocument;
  if (
    proposal?.schemaVersion !== 1 ||
    typeof proposal.contractRevisionId !== "string" ||
    typeof proposal.title !== "string" ||
    !proposal.input ||
    typeof proposal.input !== "object" ||
    Array.isArray(proposal.input)
  ) {
    return undefined;
  }
  return Object.freeze({
    contractRevisionId: proposal.contractRevisionId,
    title: proposal.title,
    ...(typeof proposal.description === "string"
      ? { description: proposal.description }
      : {}),
    input: proposal.input as Readonly<Record<string, unknown>>,
  });
}

type AgentCapabilityPresentation = Readonly<{
  title: string;
  description?: string;
}>;

async function currentCapabilityPresentations(
  database: DatabaseRuntime,
  authority: TrustedWorkspaceScope,
  actions: readonly AgentActionReceiptRecord[],
  locale: "zh-CN" | "en-US",
  now: Date,
): Promise<ReadonlyMap<string, AgentCapabilityPresentation>> {
  const contractRevisionIds = new Set(
    actions.flatMap((action) => {
      const proposal = capabilityProposal(action);
      return proposal ? [proposal.contractRevisionId] : [];
    }),
  );
  if (
    contractRevisionIds.size === 0 ||
    !authority.effectivePermissions.includes("capability.run")
  ) {
    return new Map();
  }
  try {
    const catalog =
      await database.capabilityDefinitions.resolveAgentCatalogPresentations(
        authority,
        [...contractRevisionIds],
        now,
      );
    return new Map(
      catalog.flatMap((capability) =>
        contractRevisionIds.has(capability.contractRevisionId)
          ? [
              [
                capability.contractRevisionId,
                Object.freeze({
                  title: capability.declaration.catalog.title[locale],
                  ...(capability.declaration.catalog.description?.[locale]
                    ? {
                        description:
                          capability.declaration.catalog.description[locale],
                      }
                    : {}),
                }),
              ] as const,
            ]
          : [],
      ),
    );
  } catch {
    // A stored proposal remains the immutable display fallback when the current
    // catalog is unavailable, archived, or no longer visible to this principal.
    return new Map();
  }
}

type AgentTaskPresentation = NonNullable<
  AgentThreadView["tasks"][number]["presentation"]
>;

function proposalPresentation(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function presentationResourceName(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length >= 1 &&
    value.length <= 240
    ? value
    : undefined;
}

function skillDraftProposal(action: AgentActionReceiptRecord):
  | {
      readonly kind: "create";
      readonly input: ReturnType<typeof parseSkillDraftProposalInput>;
      readonly presentation: Extract<
        AgentTaskPresentation,
        { readonly kind: "skill_create" }
      >;
    }
  | {
      readonly kind: "files";
      readonly input: ReturnType<typeof parseSkillDraftFilesProposalInput>;
      readonly presentation: Extract<
        AgentTaskPresentation,
        { readonly kind: "skill_images_update" }
      >;
    }
  | undefined {
  const proposal = action.proposalDocument;
  if (
    proposal?.schemaVersion !== 1 ||
    !["skill-draft-create", "skill-draft-files"].includes(
      String(proposal.actionRef),
    )
  ) {
    return undefined;
  }
  try {
    const presentation = proposalPresentation(proposal.presentation);
    if (proposal.actionRef === "skill-draft-files") {
      const input = parseSkillDraftFilesProposalInput(proposal.input);
      const resourceName = presentationResourceName(presentation?.resourceName);
      if (
        presentation?.kind !== "skill_images_update" ||
        presentation.imageCount !== input.files.length ||
        (presentation.resourceName !== undefined && !resourceName)
      ) {
        return undefined;
      }
      return {
        kind: "files",
        input,
        presentation: {
          kind: "skill_images_update",
          imageCount: input.files.length,
          ...(resourceName ? { resourceName } : {}),
        },
      };
    }
    const input = parseSkillDraftProposalInput(proposal.input);
    if (
      presentation?.kind !== "skill_create" ||
      presentation.resourceName !== input.displayName ||
      presentation.imageCount !== (input.files?.length ?? 0)
    ) {
      return undefined;
    }
    return {
      kind: "create" as const,
      input,
      presentation: {
        kind: "skill_create",
        resourceName: input.displayName,
        imageCount: input.files?.length ?? 0,
      },
    };
  } catch {
    return undefined;
  }
}

function brandPublishProposal(action: AgentActionReceiptRecord):
  | {
      readonly input: ReturnType<typeof parseBrandPublishProposalToolInput>;
      readonly presentation: Extract<
        AgentTaskPresentation,
        { readonly kind: "brand_publish" }
      >;
    }
  | undefined {
  const proposal = action.proposalDocument;
  if (proposal?.schemaVersion !== 1 || proposal.actionRef !== "brand-publish") {
    return undefined;
  }
  try {
    const presentation = proposalPresentation(proposal.presentation);
    const resourceName = presentationResourceName(presentation?.resourceName);
    if (presentation?.kind !== "brand_publish" || !resourceName) {
      return undefined;
    }
    return {
      input: parseBrandPublishProposalToolInput(proposal.input),
      presentation: { kind: "brand_publish", resourceName },
    };
  } catch {
    return undefined;
  }
}

function actionFailureReason(base: string, error: DomainError): string {
  const detail = /^[a-z0-9._-]+$/u.test(error.code) ? error.code : "unknown";
  return `${base}.${detail}`.slice(0, 120);
}

const inertCanvasExecutors = {
  exportPng: () =>
    Promise.reject(new Error("Canvas execution is Worker-owned.")),
  create: () => Promise.reject(new Error("Canvas execution is Worker-owned.")),
  inspect: () => Promise.reject(new Error("Canvas execution is Worker-owned.")),
  editText: () =>
    Promise.reject(new Error("Canvas execution is Worker-owned.")),
  addResultImage: () =>
    Promise.reject(new Error("Canvas execution is Worker-owned.")),
};

const inertCapabilityCatalogProjection = createCapabilityCatalogToolProjection({
  search: () =>
    Promise.reject(new Error("Capability catalog execution is Worker-owned.")),
  invoke: () =>
    Promise.reject(new Error("Capability invocation is Worker-owned.")),
});

const inertSkillCommandProjection = createSkillCommandToolProjection({
  listDrafts: () => Promise.reject(new Error("Planning only")),
  proposeFiles: () => Promise.reject(new Error("Planning only")),
  proposeCreate: () =>
    Promise.reject(new Error("Skill creation is Worker-owned.")),
});

const inertBrandCommandProjection = createBrandCommandToolProjection({
  list: () => Promise.reject(new Error("Brand execution is Worker-owned.")),
  inspectDraft: () =>
    Promise.reject(new Error("Brand execution is Worker-owned.")),
  createDraft: () =>
    Promise.reject(new Error("Brand execution is Worker-owned.")),
  updateDraft: () =>
    Promise.reject(new Error("Brand execution is Worker-owned.")),
  proposePublish: () =>
    Promise.reject(new Error("Brand execution is Worker-owned.")),
});

const inertBrandResourceProjection = createBrandResourceToolProjection({
  search: () =>
    Promise.reject(new Error("Published Brand reads are Worker-owned.")),
  inspectPublished: () =>
    Promise.reject(new Error("Published Brand reads are Worker-owned.")),
});

function inertThreadQueryProjection(options: {
  readonly includeLibraries: boolean;
  readonly includeInspect: boolean;
  readonly includeArtifacts: boolean;
}) {
  const unavailable = () =>
    Promise.reject(new Error("Query execution is Worker-owned."));
  const projection = createThreadWorkQueryToolProjection(
    {
      ...(options.includeInspect ? { inspect: unavailable } : {}),
      search: unavailable,
    },
    { includeArtifacts: options.includeArtifacts },
  );
  if (!options.includeLibraries) return projection;
  return mergeAgentToolFamilyProjections([
    projection,
    createLibraryResourceToolProjection({
      searchContent: unavailable,
      search: unavailable,
      inspect: unavailable,
      read: unavailable,
    }),
  ]);
}

async function resolveAgentAttachments(options: {
  readonly database: DatabaseRuntime;
  readonly authority: TrustedWorkspaceScope;
  readonly threadId?: string;
  readonly attachments: CreateWorkspaceAgentMessageBody["attachments"];
}): Promise<{
  readonly artifactIds: readonly string[];
  readonly resources: readonly {
    readonly kind: "asset" | "artifact";
    readonly resourceId: string;
    readonly version?: number;
    readonly artifactId: string;
    readonly displayName?: string;
  }[];
}> {
  if (!options.attachments?.length) {
    return { artifactIds: [], resources: [] };
  }
  const resolved = await Promise.all(
    options.attachments.map(async (attachment) => {
      try {
        if (attachment.assetId) {
          if (!options.authority.effectivePermissions.includes("asset.read")) {
            return undefined;
          }
          const asset = await options.database.workspaceContentQueries.getAsset(
            options.authority,
            attachment.assetId,
          );
          return { kind: "asset" as const, asset };
        }
        const artifact =
          await options.database.workspaceContentQueries.getAgentAttachmentArtifact(
            options.authority,
            attachment.artifactId,
            options.threadId,
          );
        return { kind: "artifact" as const, artifact };
      } catch (error) {
        if (error instanceof WorkspaceContentQueryStoreError) return undefined;
        throw error;
      }
    }),
  );
  const artifactIds = new Set<string>();
  const resources = resolved.map((item, index) => {
    const attachment = options.attachments?.[index];
    if (!attachment || !item || artifactIds.has(attachment.artifactId)) {
      throw new DomainError(
        "agent.attachment_unavailable",
        "One Agent attachment is unavailable or no longer current.",
      );
    }
    if (item.kind === "asset") {
      const { asset } = item;
      if (
        asset.lifecycleStatus !== "active" ||
        asset.currentArtifact?.id !== attachment.artifactId ||
        asset.currentArtifact.availabilityStatus !== "available" ||
        !asset.currentArtifact.mediaType?.startsWith("image/")
      ) {
        throw new DomainError(
          "agent.attachment_unavailable",
          "One Agent attachment is unavailable or no longer current.",
        );
      }
      artifactIds.add(attachment.artifactId);
      return Object.freeze({
        kind: "asset" as const,
        resourceId: asset.id,
        version: asset.version,
        artifactId: attachment.artifactId,
        displayName: asset.name,
      });
    }
    const { artifact } = item;
    if (
      artifact.id !== attachment.artifactId ||
      artifact.availabilityStatus !== "available" ||
      !artifact.mediaType?.startsWith("image/")
    ) {
      throw new DomainError(
        "agent.attachment_unavailable",
        "One Agent attachment is unavailable.",
      );
    }
    artifactIds.add(attachment.artifactId);
    return Object.freeze({
      kind: "artifact" as const,
      resourceId: artifact.id,
      artifactId: attachment.artifactId,
      ...(artifact.displayFilename
        ? { displayName: artifact.displayFilename }
        : {}),
    });
  });
  return Object.freeze({
    artifactIds: Object.freeze([...artifactIds]),
    resources: Object.freeze(resources),
  });
}

async function resolveAgentReferences(options: {
  readonly database: DatabaseRuntime;
  readonly runtime: ApplicationRuntime;
  readonly authority: TrustedWorkspaceScope;
  readonly references: CreateWorkspaceAgentMessageBody["references"];
}) {
  return Promise.all(
    (options.references ?? []).map(async (reference) => {
      if (reference.kind === "canvas") {
        let draft: CanvasDraftRecord | undefined;
        try {
          draft = await options.database.canvasDrafts.get(
            options.authority,
            reference.resourceId,
          );
        } catch (error) {
          if (!(error instanceof CanvasDraftStoreError)) throw error;
        }
        if (!draft || draft.version !== reference.version) {
          throw new DomainError(
            "agent.reference_unavailable",
            "A selected Canvas reference is unavailable or has changed.",
          );
        }
        return Object.freeze({
          kind: "canvas_draft" as const,
          resourceId: draft.id,
          version: draft.version,
        });
      }
      const workflow = await options.runtime.workflowCatalog.get(
        options.authority,
        reference.resourceId,
      );
      return Object.freeze({
        kind: "workflow_definition" as const,
        resourceId: workflow.workflowRevisionId,
        version: workflow.revision,
      });
    }),
  );
}

function referencedCanvasIds(
  actions: readonly AgentActionReceiptRecord[],
  messages: readonly AgentMessageRecord[],
): readonly string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const reference of message.message.referencedResources ?? []) {
      if (reference.kind === "canvas_draft") ids.add(reference.resourceId);
    }
  }
  for (const action of actions) {
    if (action.outcomeReference?.kind === "canvas_command") {
      ids.add(action.outcomeReference.canvasDraftId);
    }
  }
  return [...ids];
}

function referencedAssetIds(
  messages: readonly AgentMessageRecord[],
): readonly string[] {
  return [
    ...new Set(
      messages.flatMap((message) =>
        (message.message.referencedResources ?? []).flatMap((reference) =>
          reference.kind === "asset" ? [reference.resourceId] : [],
        ),
      ),
    ),
  ];
}

function referencedIds(
  messages: readonly AgentMessageRecord[],
  kind: "artifact" | "brand_kit_draft" | "workflow_definition",
): readonly string[] {
  return [
    ...new Set(
      messages.flatMap((message) =>
        (message.message.referencedResources ?? []).flatMap((reference) =>
          reference.kind === kind ? [reference.resourceId] : [],
        ),
      ),
    ),
  ];
}

async function visibleThreadContent(
  database: DatabaseRuntime,
  runtime: ApplicationRuntime,
  authority: TrustedWorkspaceScope,
  actions: readonly AgentActionReceiptRecord[],
  messages: readonly AgentMessageRecord[],
  latestRun:
    | Awaited<ReturnType<DatabaseRuntime["agentRuntime"]["getLatestThreadRun"]>>
    | undefined,
  capabilityPresentations: ReadonlyMap<string, AgentCapabilityPresentation>,
  now: Date,
): Promise<AgentThreadView["relatedContent"]> {
  const related = new Map<string, AgentThreadView["relatedContent"][number]>();
  for (const action of actions) {
    const capability = capabilityProposal(action);
    if (capability) {
      const presentation = capabilityPresentations.get(
        capability.contractRevisionId,
      );
      const description = presentation
        ? presentation.description
        : capability.description;
      related.set(
        `capability:${capability.contractRevisionId}`,
        Object.freeze({
          kind: "capability" as const,
          resourceId: capability.contractRevisionId,
          title: presentation?.title ?? capability.title,
          ...(description ? { description } : {}),
          state: "available" as const,
        }),
      );
      continue;
    }
    const proposal = workflowProposal(action);
    if (!proposal) continue;
    related.set(
      `workflow:${proposal.workflowRevisionId}`,
      Object.freeze({
        kind: "workflow" as const,
        resourceId: proposal.workflowRevisionId,
        title: proposal.title,
        ...(proposal.description ? { description: proposal.description } : {}),
        state: "available" as const,
      }),
    );
  }
  for (const canvasDraftId of referencedCanvasIds(actions, messages)) {
    let draft: CanvasDraftRecord | undefined;
    if (authority.effectivePermissions.includes("canvas.read")) {
      try {
        draft = await database.canvasDrafts.get(authority, canvasDraftId);
      } catch (error) {
        if (!(error instanceof CanvasDraftStoreError)) throw error;
      }
    }
    related.set(
      `canvas:${canvasDraftId}`,
      draft
        ? Object.freeze({
            kind: "canvas" as const,
            resourceId: draft.id,
            title: draft.document.title,
            state: "available" as const,
            pageCount: draft.document.pages.length,
            version: draft.version,
          })
        : Object.freeze({
            kind: "canvas" as const,
            resourceId: canvasDraftId,
            state: "unavailable" as const,
          }),
    );
  }
  for (const assetId of referencedAssetIds(messages)) {
    let asset:
      | Awaited<
          ReturnType<DatabaseRuntime["workspaceContentQueries"]["getAsset"]>
        >
      | undefined;
    if (authority.effectivePermissions.includes("asset.read")) {
      try {
        asset = await database.workspaceContentQueries.getAsset(
          authority,
          assetId,
        );
      } catch (error) {
        if (!(error instanceof WorkspaceContentQueryStoreError)) throw error;
      }
    }
    related.set(
      `asset:${assetId}`,
      asset
        ? Object.freeze({
            kind: "asset" as const,
            resourceId: asset.id,
            title: asset.name,
            ...(asset.currentArtifact?.displayFilename
              ? { description: asset.currentArtifact.displayFilename }
              : {}),
            state: "available" as const,
            version: asset.version,
            ...(asset.currentArtifact
              ? { artifactId: asset.currentArtifact.id }
              : {}),
          })
        : Object.freeze({
            kind: "asset" as const,
            resourceId: assetId,
            state: "unavailable" as const,
          }),
    );
  }
  for (const artifactId of referencedIds(messages, "artifact")) {
    const reference = messages
      .flatMap((message) => message.message.referencedResources ?? [])
      .find(
        (candidate) =>
          candidate.kind === "artifact" && candidate.resourceId === artifactId,
      );
    let artifact:
      | Awaited<
          ReturnType<
            DatabaseRuntime["workspaceContentQueries"]["getAgentAttachmentArtifact"]
          >
        >
      | undefined;
    if (authority.effectivePermissions.includes("artifact.download")) {
      try {
        artifact =
          await database.workspaceContentQueries.getAgentAttachmentArtifact(
            authority,
            artifactId,
          );
      } catch (error) {
        if (!(error instanceof WorkspaceContentQueryStoreError)) throw error;
      }
    }
    related.set(
      `artifact:${artifactId}`,
      artifact
        ? Object.freeze({
            kind: "artifact" as const,
            resourceId: artifact.id,
            artifactId: artifact.id,
            ...(artifact.assetId ? { assetId: artifact.assetId } : {}),
            title:
              reference?.displayName ??
              artifact.displayFilename ??
              "Attachment",
            state: "available" as const,
          })
        : Object.freeze({
            kind: "artifact" as const,
            resourceId: artifactId,
            artifactId,
            ...(reference?.displayName ? { title: reference.displayName } : {}),
            state: "unavailable" as const,
          }),
    );
  }
  const referencedBrandKitIds = referencedIds(messages, "brand_kit_draft");
  const canReadBrand = authority.effectivePermissions.includes("brand.read");
  let readableBrands:
    Awaited<ReturnType<DatabaseRuntime["workspaceBrand"]["list"]>> | undefined;
  for (const brandKitId of referencedBrandKitIds) {
    const pinnedRevisionId = latestRun?.contextSnapshot.brandKitRevisionId;
    let revision =
      canReadBrand && pinnedRevisionId
        ? await database.workspaceBrand.getRevision(
            authority,
            brandKitId,
            pinnedRevisionId,
            now,
          )
        : undefined;
    let fallbackTitle: string | undefined;
    let fallbackDescription: string | undefined;
    if (canReadBrand && !revision) {
      readableBrands ??= await database.workspaceBrand.list(authority, {
        lifecycleStatus: "active",
        now,
      });
      const brand = readableBrands.find((item) => item.id === brandKitId);
      fallbackTitle = brand?.name;
      fallbackDescription = brand?.description;
      const latestPublishedRevisionId = brand?.latestPublishedRevision?.id;
      if (
        latestPublishedRevisionId &&
        latestPublishedRevisionId !== pinnedRevisionId
      ) {
        revision = await database.workspaceBrand.getRevision(
          authority,
          brandKitId,
          latestPublishedRevisionId,
          now,
        );
      }
    }
    const document = revision?.document;
    const title = document?.name ?? fallbackTitle;
    const description = document?.description ?? fallbackDescription;
    related.set(
      `brand:${brandKitId}`,
      title
        ? Object.freeze({
            kind: "brand" as const,
            resourceId: brandKitId,
            title,
            ...(description ? { description } : {}),
            state: "available" as const,
            ...(revision ? { brandKitRevisionId: revision.id } : {}),
          })
        : Object.freeze({
            kind: "brand" as const,
            resourceId: brandKitId,
            state: "unavailable" as const,
          }),
    );
  }
  for (const workflowRevisionId of referencedIds(
    messages,
    "workflow_definition",
  )) {
    try {
      const workflow = await runtime.workflowCatalog.get(
        authority,
        workflowRevisionId,
      );
      related.set(
        `workflow:${workflowRevisionId}`,
        Object.freeze({
          kind: "workflow" as const,
          resourceId: workflowRevisionId,
          title: workflow.presentation?.title ?? workflow.displayName,
          ...((workflow.presentation?.description ?? workflow.description)
            ? {
                description:
                  workflow.presentation?.description ?? workflow.description,
              }
            : {}),
          state: "available" as const,
          version: workflow.revision,
        }),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      related.set(
        `workflow:${workflowRevisionId}`,
        Object.freeze({
          kind: "workflow" as const,
          resourceId: workflowRevisionId,
          state: "unavailable" as const,
        }),
      );
    }
  }
  return [...related.values()];
}

function messageRelatedContent(
  message: AgentMessageRecord,
  actions: readonly AgentActionReceiptRecord[],
  contentById: ReadonlyMap<string, AgentThreadView["relatedContent"][number]>,
  visibleCanvasReferences: Set<string>,
): AgentThreadView["messages"][number]["relatedContent"] {
  const versions = new Map(
    (message.message.referencedResources ?? []).flatMap((reference) =>
      reference.kind === "canvas_draft"
        ? [[reference.resourceId, reference.version] as const]
        : [],
    ),
  );
  if (message.message.role === "assistant") {
    for (const action of actions) {
      if (
        action.agentRunId === message.agentRunId &&
        action.outcomeReference?.kind === "canvas_command"
      ) {
        versions.set(
          action.outcomeReference.canvasDraftId,
          action.outcomeReference.afterVersion,
        );
      }
    }
  }
  const related = [...versions].flatMap(([id, version]) => {
    const content = contentById.get(`canvas:${id}`);
    return content
      ? [Object.freeze({ ...content, ...(version ? { version } : {}) })]
      : [];
  });
  if (message.message.role === "assistant") {
    for (const action of actions.filter(
      (action) => action.agentRunId === message.agentRunId,
    )) {
      const exported = canvasExportContent(action);
      const visible =
        exported && contentById.get(`artifact:${exported.resourceId}`);
      if (visible) related.push(visible);
    }
  }
  for (const reference of message.message.referencedResources ?? []) {
    let key: string | undefined;
    if (reference.kind === "asset") key = `asset:${reference.resourceId}`;
    if (reference.kind === "artifact") {
      key = `artifact:${reference.resourceId}`;
    }
    if (reference.kind === "brand_kit_draft") {
      key = `brand:${reference.resourceId}`;
    }
    if (reference.kind === "workflow_definition") {
      key = `workflow:${reference.resourceId}`;
    }
    if (!key) continue;
    const content = contentById.get(key);
    if (content) related.push(content);
  }
  return related.filter((content) => {
    if (content.kind !== "canvas") return true;
    const referenceKey = content.resourceId;
    const repeated = visibleCanvasReferences.has(referenceKey);
    visibleCanvasReferences.add(referenceKey);
    return message.message.role === "assistant" || !repeated;
  });
}

async function exactMessageContent(
  database: DatabaseRuntime,
  authority: TrustedWorkspaceScope,
  message: AgentMessageRecord,
  contents: AgentThreadView["relatedContent"],
  cache: Map<string, Promise<AgentThreadView["relatedContent"][number]>>,
  now: Date,
): Promise<AgentThreadView["relatedContent"]> {
  const exact = new Map(
    contents.map((item) => [`${item.kind}:${item.resourceId}`, item]),
  );
  for (const reference of message.message.referencedResources ?? []) {
    if (reference.kind !== "asset" && reference.kind !== "brand_kit_draft")
      continue;
    const kind = reference.kind === "asset" ? "asset" : "brand";
    const revision = reference.artifactId ?? reference.brandKitRevisionId;
    const key = `${kind}:${reference.resourceId}`;
    const cacheKey = `${key}:${revision ?? "unavailable"}`;
    let pending = cache.get(cacheKey);
    if (!pending) {
      pending = (async (): Promise<
        AgentThreadView["relatedContent"][number]
      > => {
        const unavailable: AgentThreadView["relatedContent"][number] = {
          kind,
          resourceId: reference.resourceId,
          state: "unavailable" as const,
          ...(reference.displayName ? { title: reference.displayName } : {}),
          ...(reference.artifactId ? { artifactId: reference.artifactId } : {}),
          ...(reference.brandKitRevisionId
            ? { brandKitRevisionId: reference.brandKitRevisionId }
            : {}),
        };
        if (!revision) return unavailable;
        try {
          if (
            kind === "asset" &&
            authority.effectivePermissions.includes("asset.read")
          ) {
            const asset = await database.workspaceContentQueries.getAsset(
              authority,
              reference.resourceId,
              { artifactId: revision },
            );
            const artifact = asset.artifacts.find(
              (item) => item.id === revision,
            );
            return artifact
              ? {
                  ...unavailable,
                  title: reference.displayName ?? asset.name,
                  state:
                    artifact.availabilityStatus === "available"
                      ? "available"
                      : "unavailable",
                  ...(reference.version ? { version: reference.version } : {}),
                }
              : unavailable;
          }
          if (
            kind === "brand" &&
            authority.effectivePermissions.includes("brand.read")
          ) {
            const brand = await database.workspaceBrand.getRevision(
              authority,
              reference.resourceId,
              revision,
              now,
            );
            return brand
              ? {
                  ...unavailable,
                  state: "available",
                  title: reference.displayName ?? brand.document.name,
                }
              : unavailable;
          }
        } catch (error) {
          if (
            !(error instanceof DomainError) &&
            !(error instanceof WorkspaceContentQueryStoreError)
          )
            throw error;
        }
        return unavailable;
      })();
      cache.set(cacheKey, pending);
    }
    const content = await pending;
    exact.set(key, {
      ...content,
      ...(reference.displayName ? { title: reference.displayName } : {}),
      ...(reference.version ? { version: reference.version } : {}),
    });
  }
  return [...exact.values()];
}

function messageSelectedSkill(
  message: AgentMessageRecord,
): Pick<AgentThreadView["messages"][number], "selectedSkill"> {
  const skill = message.message.referencedResources?.find(
    (reference) => reference.kind === "skill_revision",
  );
  return skill?.displayName
    ? {
        selectedSkill: {
          revisionId: skill.resourceId,
          name: skill.displayName,
        },
      }
    : {};
}

function safeCanvasReturnTo(
  value: string | undefined,
  workspaceId: string,
  canvasDraftId: string,
): void {
  if (!value) return;
  try {
    const url = new URL(value, "https://kanvas.invalid");
    if (
      url.origin !== "https://kanvas.invalid" ||
      url.pathname !== `/w/${workspaceId}/boards/${canvasDraftId}`
    ) {
      throw new Error("unsafe");
    }
  } catch {
    throw new DomainError(
      "agent.entry_context_invalid",
      "The Agent entry context is invalid.",
    );
  }
}

function canvasElementKeys(
  draft: CanvasDraftRecord,
  pageKey?: string,
): Set<string> {
  const page = pageKey
    ? draft.document.pages.find((candidate) => candidate.id === pageKey)
    : draft.document.pages[0];
  if (!page) {
    throw new DomainError(
      "agent.canvas_context_changed",
      "The selected Canvas page is no longer available.",
    );
  }
  const keys = new Set<string>();
  type CanvasNodeReference = {
    readonly id: string;
    readonly kind: string;
    readonly children?: readonly CanvasNodeReference[];
  };
  const visit = (nodes: readonly CanvasNodeReference[]) => {
    for (const node of nodes) {
      keys.add(node.id);
      if (node.kind === "group" && node.children) {
        visit(node.children);
      }
    }
  };
  visit(page.nodes);
  return keys;
}

interface ResolvedAgentCanvasContext {
  readonly draft: CanvasDraftRecord;
  readonly originSurface: "agent" | "canvas";
  readonly pageKey?: string;
  readonly selectedElementKeys: readonly string[];
}

async function resolveAgentCanvasContext(options: {
  readonly database: DatabaseRuntime;
  readonly authority: TrustedWorkspaceScope;
  readonly body: CreateWorkspaceAgentMessageBody;
  readonly now: Date;
}): Promise<ResolvedAgentCanvasContext | undefined> {
  const entry = options.body.entryContext;
  let canvasDraftId = entry?.canvasDraftId;
  const originSurface: ResolvedAgentCanvasContext["originSurface"] = entry
    ? "canvas"
    : "agent";
  if (!canvasDraftId && options.body.threadId) {
    const [messages, actions] = await Promise.all([
      options.database.agentRuntime.listThreadMessages(
        options.authority,
        options.body.threadId,
        200,
        options.now,
      ),
      options.database.agentRuntime.listThreadActions(
        options.authority,
        options.body.threadId,
        200,
        options.now,
      ),
    ]);
    const ids = referencedCanvasIds(actions, messages);
    canvasDraftId = ids.at(-1);
  }
  if (!canvasDraftId) return undefined;
  if (!options.authority.effectivePermissions.includes("canvas.read")) {
    if (entry) {
      throw new DomainError(
        "agent.canvas_context_unavailable",
        "The selected Canvas is unavailable.",
      );
    }
    return undefined;
  }
  let draft: CanvasDraftRecord | undefined;
  try {
    draft = await options.database.canvasDrafts.get(
      options.authority,
      canvasDraftId,
    );
  } catch (error) {
    if (!(error instanceof CanvasDraftStoreError)) throw error;
  }
  if (!draft) {
    if (entry) {
      throw new DomainError(
        "agent.canvas_context_unavailable",
        "The selected Canvas is unavailable.",
      );
    }
    return undefined;
  }
  if (entry && draft.version !== entry.canvasDraftVersion) {
    throw new DomainError(
      "agent.canvas_context_changed",
      "The selected Canvas has newer changes.",
    );
  }
  if (entry) {
    safeCanvasReturnTo(entry.returnTo, options.authority.workspaceId, draft.id);
    const visibleElementKeys = canvasElementKeys(draft, entry.pageKey);
    if (entry.selectedElementKeys.some((key) => !visibleElementKeys.has(key))) {
      throw new DomainError(
        "agent.canvas_context_changed",
        "The selected Canvas elements have changed.",
      );
    }
  }
  return Object.freeze({
    draft,
    originSurface,
    ...(entry?.pageKey ? { pageKey: entry.pageKey } : {}),
    selectedElementKeys: Object.freeze(entry?.selectedElementKeys ?? []),
  });
}

function workflowTaskStatus(
  lifecycleStatus:
    | "queued"
    | "running"
    | "waiting"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled",
): AgentThreadView["tasks"][number]["lifecycleStatus"] {
  if (lifecycleStatus === "completed") return "succeeded";
  if (lifecycleStatus === "failed") return "failed";
  if (lifecycleStatus === "cancelled") return "cancelled";
  return "running";
}

async function visibleThreadTasks(
  database: DatabaseRuntime,
  runtime: ApplicationRuntime,
  authority: TrustedWorkspaceScope,
  actions: readonly AgentActionReceiptRecord[],
  messages: readonly AgentMessageRecord[],
  capabilityPresentations: ReadonlyMap<string, AgentCapabilityPresentation>,
  now: Date,
  latestRun?: AgentRunRecord,
): Promise<AgentThreadView["tasks"]> {
  const assistantMessageByRun = new Map(
    messages.flatMap((message) =>
      message.message.role === "assistant"
        ? [[message.agentRunId, message.id] as const]
        : [],
    ),
  );
  for (const message of messages) {
    if (!assistantMessageByRun.has(message.agentRunId))
      assistantMessageByRun.set(message.agentRunId, message.id);
  }
  if (latestRun?.triggerMessageId && !assistantMessageByRun.has(latestRun.id))
    assistantMessageByRun.set(latestRun.id, latestRun.triggerMessageId);
  return (
    await Promise.all(
      actions.map(async (action) => {
        const capability = capabilityProposal(action);
        const workflow = workflowProposal(action);
        const skill = skillDraftProposal(action);
        const brand = brandPublishProposal(action);
        if (!capability && !workflow && !skill && !brand) return undefined;
        let lifecycleStatus: AgentThreadView["tasks"][number]["lifecycleStatus"] =
          action.outcomeReference?.kind === "workflow_run" ||
          action.outcomeReference?.kind === "capability_run"
            ? "unavailable"
            : action.lifecycleStatus;
        let capabilityRunStatus: AgentThreadView["tasks"][number]["capabilityRunStatus"];
        let resultArtifacts:
          AgentThreadView["tasks"][number]["resultArtifacts"] | undefined;
        let browserExecution: AgentThreadView["tasks"][number]["browserExecution"];
        if (
          action.outcomeReference?.kind === "workflow_run" &&
          authority.effectivePermissions.includes("workflow.read")
        ) {
          try {
            const workflow = await runtime.workflow.getRun({
              workspaceId: authority.workspaceId,
              workflowRunId: action.outcomeReference.workflowRunId,
            });
            lifecycleStatus = workflowTaskStatus(workflow.lifecycleStatus);
            browserExecution = workflow.browserExecution
              ? {
                  requiredCapabilityKeys: [
                    ...workflow.browserExecution.requiredCapabilityKeys,
                  ],
                }
              : undefined;
            if (authority.effectivePermissions.includes("asset.read")) {
              const runArtifacts =
                await database.workspaceContentQueries.listWorkflowRunArtifacts(
                  authority,
                  action.outcomeReference.workflowRunId,
                );
              const artifacts = workflowOutputArtifacts(
                workflow.output,
                runArtifacts,
              );
              resultArtifacts = artifacts.map((artifact) => ({
                resourceId: artifact.id,
                ...(artifact.assetId ? { assetId: artifact.assetId } : {}),
                kind: artifact.mediaType?.startsWith("image/")
                  ? ("image" as const)
                  : ("other" as const),
                ...(artifact.displayFilename
                  ? { title: artifact.displayFilename }
                  : {}),
                state:
                  artifact.availabilityStatus === "available"
                    ? ("available" as const)
                    : ("unavailable" as const),
              }));
            }
          } catch {
            lifecycleStatus = "unavailable";
          }
        }
        if (
          action.outcomeReference?.kind === "capability_run" &&
          authority.effectivePermissions.includes("capability.run")
        ) {
          try {
            const run = await database.capabilityRuns.get(
              authority,
              action.outcomeReference.capabilityRunId,
              now,
            );
            lifecycleStatus = workflowTaskStatus(run.lifecycleStatus);
            capabilityRunStatus = run.lifecycleStatus;
            browserExecution = run.browserExecution
              ? {
                  requiredCapabilityKeys: [
                    ...run.browserExecution.requiredCapabilityKeys,
                  ],
                }
              : undefined;
            if (authority.effectivePermissions.includes("asset.read")) {
              const artifacts =
                await database.workspaceContentQueries.listCapabilityRunArtifacts(
                  authority,
                  action.outcomeReference.capabilityRunId,
                );
              resultArtifacts = artifacts.map((artifact) => ({
                resourceId: artifact.id,
                ...(artifact.assetId ? { assetId: artifact.assetId } : {}),
                kind: artifact.mediaType?.startsWith("image/")
                  ? ("image" as const)
                  : ("other" as const),
                ...(artifact.displayFilename
                  ? { title: artifact.displayFilename }
                  : {}),
                state:
                  artifact.availabilityStatus === "available"
                    ? ("available" as const)
                    : ("unavailable" as const),
              }));
            }
          } catch {
            lifecycleStatus = "unavailable";
          }
        }
        const proposal = skill ?? brand ?? capability ?? workflow!;
        const originMessage = messages.find(
          (message) =>
            message.message.role === "user" &&
            (message.agentRunId === action.agentRunId ||
              (action.agentRunId === latestRun?.id &&
                message.id === latestRun.triggerMessageId)),
        );
        const originBrand = originMessage?.message.referencedResources?.find(
          (reference) => reference.kind === "brand_kit_draft",
        );
        let kind: "skill" | "brand" | "capability" | "workflow";
        let executionReference:
          | { readonly workflowRevisionId: string }
          | { readonly capabilityContractRevisionId: string }
          | Record<string, never>;
        if (skill || brand) {
          kind = skill ? "skill" : "brand";
          executionReference = {};
        } else if (capability) {
          kind = "capability";
          executionReference = {
            capabilityContractRevisionId: capability.contractRevisionId,
          };
        } else {
          kind = "workflow";
          executionReference = {
            workflowRevisionId: workflow!.workflowRevisionId,
          };
        }
        const presentation = skill?.presentation ?? brand?.presentation;
        const capabilityPresentation = capability
          ? capabilityPresentations.get(capability.contractRevisionId)
          : undefined;
        let taskTitle: string;
        if (skill) taskTitle = presentation?.resourceName ?? "Skill";
        else if (brand) taskTitle = brand.presentation.resourceName;
        else {
          taskTitle =
            capabilityPresentation?.title ?? (capability ?? workflow!).title;
        }
        let taskDescription: string | undefined;
        if (capability) {
          taskDescription = capabilityPresentation
            ? capabilityPresentation.description
            : capability.description;
        } else {
          taskDescription = workflow?.description;
        }
        return {
          id: action.id,
          agentRunId: action.agentRunId,
          ...(originBrand?.brandKitRevisionId && originBrand.displayName
            ? {
                brandContext: {
                  brandKitId: originBrand.resourceId,
                  brandKitRevisionId: originBrand.brandKitRevisionId,
                  name: originBrand.displayName,
                },
              }
            : {}),
          kind,
          lifecycleStatus,
          title: taskTitle,
          ...(presentation ? { presentation } : {}),
          ...executionReference,
          ...(!skill && proposal.input
            ? {
                input: proposal.input as Readonly<Record<string, unknown>>,
              }
            : {}),
          ...(taskDescription ? { description: taskDescription } : {}),
          ...(assistantMessageByRun.get(action.agentRunId)
            ? { messageId: assistantMessageByRun.get(action.agentRunId)! }
            : {}),
          ...(action.outcomeReference?.kind === "workflow_run"
            ? { workflowRunId: action.outcomeReference.workflowRunId }
            : {}),
          ...(action.outcomeReference?.kind === "capability_run"
            ? {
                capabilityRunId: action.outcomeReference.capabilityRunId,
                ...(capabilityRunStatus ? { capabilityRunStatus } : {}),
              }
            : {}),
          ...(action.outcomeReference?.kind === "skill_draft"
            ? { skillDraftId: action.outcomeReference.skillDraftId }
            : {}),
          ...(brand ? { brandKitId: brand.input.brandKitId } : {}),
          ...(action.outcomeReference?.kind === "brand_revision"
            ? { brandKitRevisionId: action.outcomeReference.brandKitRevisionId }
            : {}),
          ...(resultArtifacts?.length ? { resultArtifacts } : {}),
          ...(browserExecution ? { browserExecution } : {}),
        };
      }),
    )
  ).filter((task): task is NonNullable<typeof task> => task !== undefined);
}

@Injectable()
export class WorkspaceAgentService {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(APPLICATION_RUNTIME) private readonly runtime: ApplicationRuntime,
    private readonly capabilityRuns: CapabilityRunService,
    @Optional() private readonly skillLibrary?: SkillLibraryService,
  ) {}

  public async completeCanvasExport(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly actionReceiptId: string;
    readonly body: CompleteAgentCanvasExportBody;
    readonly now: Date;
  }): Promise<{ accepted: true }> {
    const action = await this.database.agentRuntime.getAction(
      options.authority,
      options.actionReceiptId,
      options.now,
    );
    const request = action && canvasExportRequest(action);
    if (!action || !request)
      throw new DomainError(
        "agent.action_not_found",
        "Canvas export request is unavailable.",
      );
    let completion: AgentCanvasExportCompletion;
    if ("exportSessionId" in options.body) {
      const session = await this.database.canvasExports.get(
        options.authority,
        options.body.exportSessionId,
        options.now,
      );
      const source = session.sourceRequest;
      if (
        session.state !== "committed" ||
        !session.result ||
        !source ||
        source.format !== "png" ||
        source.canvasDraftId !== request.canvasDraftId ||
        source.documentVersion !== request.documentVersion ||
        source.pageId !== request.pageId
      ) {
        throw new DomainError(
          "agent.canvas_export_mismatch",
          "The export does not match the requested Canvas snapshot.",
        );
      }
      completion = {
        status: "succeeded",
        exportSessionId: session.exportSessionId,
        artifactId: session.result.artifactId,
        filename: source.displayFilename,
      };
    } else {
      completion = {
        status: "failed",
        code: options.body.error.code,
        message: options.body.error.message,
      };
    }
    await this.database.agentRuntime.recordCanvasExport({
      authority: options.authority,
      agentRunId: action.agentRunId,
      actionReceiptId: action.id,
      expectedVersion: action.version,
      request,
      completion,
      now: options.now,
    });
    return { accepted: true };
  }

  public async create(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly body: CreateWorkspaceAgentMessageBody;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<AgentRunAccepted> {
    const existingThread = options.body.threadId
      ? await this.database.agentRuntime.getThread(
          options.authority,
          options.body.threadId,
          options.now,
        )
      : undefined;
    if (options.body.threadId && !existingThread) {
      throw new DomainError(
        "agent.thread_unavailable",
        "This conversation is unavailable.",
      );
    }
    if (
      existingThread &&
      options.body.agentDefinitionId &&
      existingThread.agentDefinitionId !== options.body.agentDefinitionId
    ) {
      throw new DomainError(
        "agent.thread_agent_conflict",
        "Start a new conversation to use another Agent.",
      );
    }
    if (existingThread && options.body.skillCandidateId) {
      throw new DomainError(
        "agent.skill_candidate_requires_new_thread",
        "Start a new conversation to test this Skill Candidate.",
      );
    }
    if (
      [options.body.skillCandidateId, options.body.skillRevisionId].filter(
        Boolean,
      ).length > 1
    ) {
      throw new DomainError(
        "agent.skill_context_conflict",
        "Select one Skill for this conversation.",
      );
    }
    const profileSelector = existingThread
      ? { profileRevisionId: existingThread.agentProfileRevisionId }
      : {};
    const agentSelector =
      !existingThread && options.body.agentDefinitionId
        ? { agentDefinitionId: options.body.agentDefinitionId }
        : {};
    const baseSurfaceView =
      await this.database.agentFoundation.resolveSurfaceView({
        authority: options.authority,
        surfaceKind: "agent_workspace",
        ...profileSelector,
        ...agentSelector,
        now: options.now,
      });
    if (!baseSurfaceView) {
      const requestedAgentId =
        existingThread?.agentDefinitionId ?? options.body.agentDefinitionId;
      if (requestedAgentId) {
        const resource = (
          await this.database.agentHub.listResourceStates(
            options.authority,
            "agent",
            options.now,
          )
        ).find((item) => item.id === requestedAgentId);
        if (resource && resource.state !== "enabled") {
          throw new DomainError(
            "resource_lifecycle.unavailable",
            "The Agent is disabled or deleted.",
          );
        }
      }
      throw new DomainError(
        "agent.profile_unavailable",
        "The Workspace Agent is not configured for this surface.",
      );
    }
    if (
      baseSurfaceView.profile.profileKey === workspaceDefaultAgentProfileKeyV1
    ) {
      const modelSettings =
        await this.database.agentProfilePublications.getModelSettings(
          options.authority,
          options.now,
        );
      const defaultModelReady = modelSettings.options.some(
        (model) =>
          model.id === modelSettings.currentDefaultModelId && model.ready,
      );
      if (!defaultModelReady) {
        throw new DomainError(
          "agent.model_not_configured",
          "Configure an available workspace Agent model before starting a conversation.",
        );
      }
    }
    const candidateView = options.body.skillCandidateId
      ? await this.database.agentFoundation.resolveSurfaceView({
          authority: options.authority,
          surfaceKind: "agent_workspace",
          profileRevisionId: baseSurfaceView.profile.id,
          skillRevisionIds: [options.body.skillCandidateId],
          now: options.now,
        })
      : undefined;
    const candidateSkill = candidateView?.skills.find(
      (skill) =>
        skill.candidate === true &&
        skill.skillRevisionId === options.body.skillCandidateId,
    );
    if (options.body.skillCandidateId && !candidateSkill) {
      throw new DomainError(
        "agent.skill_candidate_unavailable",
        "This Skill Candidate is unavailable or has changed.",
      );
    }
    const requestedLibrarySkill = options.body.skillRevisionId
      ? baseSurfaceView.skills.find(
          (skill) =>
            !skill.candidate &&
            skill.skillRevisionId === options.body.skillRevisionId,
        )
      : undefined;
    if (options.body.skillRevisionId && !requestedLibrarySkill) {
      throw new DomainError(
        "agent.skill_unavailable",
        "The selected Skill is unavailable.",
      );
    }
    const surfaceView: AgentSurfaceView = candidateSkill
      ? Object.freeze({
          ...baseSurfaceView,
          skills: Object.freeze([
            candidateSkill,
            ...baseSurfaceView.skills.filter(
              (skill) =>
                skill.skillDefinitionId !== candidateSkill.skillDefinitionId,
            ),
          ]),
          skillViewDigest: digestProviderValue({
            profileRevisionId: baseSurfaceView.profile.id,
            surfaceKind: "agent_workspace",
            skills: [candidateSkill, ...baseSurfaceView.skills],
          }),
        })
      : baseSurfaceView;
    const canvas = await resolveAgentCanvasContext({
      database: this.database,
      authority: options.authority,
      body: options.body,
      now: options.now,
    });
    let brand: ReturnType<typeof projectAgentBrandContext> | undefined;
    let appliedBrandKitId: string | undefined;
    if (options.body.brandContext) {
      if (
        canvas?.draft.brand &&
        canvas.draft.brand.brandKitRevisionId !==
          options.body.brandContext.brandKitRevisionId
      ) {
        throw new DomainError(
          "agent.brand_context_conflict",
          "The selected Brand does not match this Canvas.",
        );
      }
      const revision = await this.database.workspaceBrand.getRevision(
        options.authority,
        options.body.brandContext.brandKitId,
        options.body.brandContext.brandKitRevisionId,
        options.now,
      );
      if (!revision) {
        throw new DomainError(
          "agent.brand_context_unavailable",
          "The selected Brand context is unavailable.",
        );
      }
      brand = projectAgentBrandContext(revision);
      appliedBrandKitId = revision.brandKitId;
    } else if (
      options.body.brandContext !== null &&
      canvas?.draft.brand &&
      options.authority.effectivePermissions.includes("brand.read")
    ) {
      const revision = await this.database.workspaceBrand.getRevision(
        options.authority,
        canvas.draft.brand.brandKitId,
        canvas.draft.brand.brandKitRevisionId,
        options.now,
      );
      if (revision) {
        brand = projectAgentBrandContext(revision);
        appliedBrandKitId = revision.brandKitId;
      }
    } else if (
      options.body.brandContext !== null &&
      !canvas &&
      existingThread
    ) {
      const previous = await this.database.agentRuntime.getLatestThreadRun(
        options.authority,
        existingThread.id,
        options.now,
      );
      const revisionId = previous?.contextSnapshot.brandKitRevisionId;
      if (revisionId) {
        const revision = await this.database.workspaceBrand.getRevision(
          options.authority,
          undefined,
          revisionId,
          options.now,
        );
        if (!revision) {
          throw new DomainError(
            "agent.brand_context_unavailable",
            "The selected Brand context is unavailable.",
          );
        }
        brand = projectAgentBrandContext(revision);
        appliedBrandKitId = revision.brandKitId;
      }
    }
    const attachments = await resolveAgentAttachments({
      database: this.database,
      authority: options.authority,
      ...(options.body.threadId ? { threadId: options.body.threadId } : {}),
      attachments: options.body.attachments,
    });
    const references = await resolveAgentReferences({
      database: this.database,
      runtime: this.runtime,
      authority: options.authority,
      references: options.body.references,
    });
    const visualArtifactIds = [
      ...new Set([
        ...attachments.artifactIds,
        ...(brand?.referenceImages.map((reference) => reference.artifactId) ??
          []),
      ]),
    ];
    const runSurfaceView = agentRunSurfaceView(
      surfaceView,
      candidateSkill?.skillRevisionId ?? requestedLibrarySkill?.skillRevisionId,
    );
    const canReadBrand =
      options.authority.effectivePermissions.includes("brand.read");
    const canManageBrand =
      options.authority.effectivePermissions.includes("brand.manage");
    let brandProjection;
    if (canReadBrand && canManageBrand) {
      brandProjection = mergeAgentToolFamilyProjections([
        inertBrandResourceProjection,
        inertBrandCommandProjection,
      ]);
    } else if (canReadBrand) {
      brandProjection = inertBrandResourceProjection;
    } else if (canManageBrand) {
      brandProjection = inertBrandCommandProjection;
    }
    const inertCanvasProjection = createCanvasCommandToolProjection(
      inertCanvasExecutors,
      {
        includeLibraryInputs:
          runSurfaceView.profile.manifest.allowedToolFamilies.includes(
            "query",
          ) && options.authority.effectivePermissions.includes("library.read"),
      },
    );
    let toolView: ReturnType<typeof createDynamicAgentToolView>;
    try {
      toolView = createDynamicAgentToolView({
        surfaceView: runSurfaceView,
        projections: [
          {
            ...inertCanvasProjection,
            descriptors: inertCanvasProjection.descriptors.filter(
              (tool) =>
                tool.key !== "canvas.export-png" ||
                options.body.browserCanvasExport === true,
            ),
          },
          ...(runSurfaceView.profile.manifest.allowedToolFamilies.includes(
            "query",
          )
            ? [
                inertThreadQueryProjection({
                  includeLibraries:
                    options.authority.effectivePermissions.includes(
                      "library.read",
                    ),
                  includeInspect:
                    options.authority.effectivePermissions.includes(
                      "workflow.read",
                    ),
                  includeArtifacts:
                    options.authority.effectivePermissions.includes(
                      "workflow.read",
                    ) &&
                    options.authority.effectivePermissions.includes(
                      "asset.read",
                    ),
                }),
              ]
            : []),
          ...(runSurfaceView.profile.manifest.allowedToolFamilies.includes(
            "capability",
          ) && options.authority.effectivePermissions.includes("capability.run")
            ? [inertCapabilityCatalogProjection]
            : []),
          ...(options.authority.effectivePermissions.includes("skill.manage")
            ? [inertSkillCommandProjection]
            : []),
          ...(brandProjection ? [brandProjection] : []),
          ...(options.authority.effectivePermissions.includes("workflow.read")
            ? [
                createWorkflowResourceToolProjection({
                  surfaceView: runSurfaceView,
                  eligibleWorkflowRevisionIds: new Set(
                    runSurfaceView.skills.flatMap((skill) =>
                      skill.entrypoints.map(
                        (entrypoint) => entrypoint.workflowRevisionId,
                      ),
                    ),
                  ),
                  executor: {
                    search: () =>
                      Promise.reject(
                        new Error("Workflow execution is Worker-owned."),
                      ),
                    inspect: () =>
                      Promise.reject(
                        new Error("Workflow execution is Worker-owned."),
                      ),
                    ...(options.authority.effectivePermissions.includes(
                      "workflow.run",
                    )
                      ? {
                          propose: () =>
                            Promise.reject(
                              new Error("Workflow execution is Worker-owned."),
                            ),
                        }
                      : {}),
                  },
                }),
              ]
            : []),
        ],
        digest: digestProviderValue,
      });
    } catch (error) {
      if (error instanceof AgentToolViewError) {
        throw new DomainError(
          "agent.profile_unavailable",
          "The Workspace Agent is not ready for this surface.",
        );
      }
      throw error;
    }
    const identity = `${options.authority.workspaceId}:${options.authority.principalId}:${options.idempotencyKey}`;
    let threadId = options.body.threadId;
    if (!threadId) {
      const created = await this.database.agentRuntime.createThread({
        authority: options.authority,
        threadId: stableAgentRuntimeId("thread", identity, 1),
        agentDefinitionId: surfaceView.profile.agentDefinitionId,
        agentProfileRevisionId: surfaceView.profile.id,
        title: agentThreadInitialTitle(options.body.message),
        idempotencyKey: `thread:${options.idempotencyKey}`,
        now: options.now,
      });
      threadId = created.id;
    }
    const runId = stableAgentRuntimeId("run", identity, 1);
    const messageReferences = [
      ...(options.body.entryContext && canvas
        ? [
            {
              kind: "canvas_draft" as const,
              resourceId: canvas.draft.id,
              version: canvas.draft.version,
            },
          ]
        : []),
      ...attachments.resources,
      ...references,
      ...(brand && appliedBrandKitId
        ? [
            {
              kind: "brand_kit_draft" as const,
              resourceId: appliedBrandKitId,
              brandKitRevisionId: brand.revisionId,
              displayName: brand.name,
            },
          ]
        : []),
      ...((candidateSkill ?? requestedLibrarySkill)?.skillRevisionId
        ? [
            {
              kind: "skill_revision" as const,
              resourceId: (candidateSkill ?? requestedLibrarySkill)!
                .skillRevisionId,
              displayName: (candidateSkill ?? requestedLibrarySkill)!
                .displayName,
            },
          ]
        : []),
    ].filter(
      (reference, index, items) =>
        items.findIndex(
          (candidate) =>
            candidate.kind === reference.kind &&
            candidate.resourceId === reference.resourceId,
        ) === index,
    );
    let requestedSkill:
      | {
          readonly skillRevisionId: string;
          readonly displayName: string;
          readonly source: "candidate" | "published";
        }
      | undefined;
    if (candidateSkill) {
      requestedSkill = {
        skillRevisionId: candidateSkill.skillRevisionId,
        displayName: candidateSkill.displayName,
        source: "candidate",
      };
    } else if (requestedLibrarySkill) {
      requestedSkill = {
        skillRevisionId: requestedLibrarySkill.skillRevisionId,
        displayName: requestedLibrarySkill.displayName,
        source: "published",
      };
    }
    await this.database.agentRuntime.startRun({
      authority: options.authority,
      runId,
      threadId,
      userMessageId: stableAgentRuntimeId("user-message", identity, 1),
      userMessage: {
        schemaVersion: 1,
        role: "user",
        parts: [{ type: "text", text: options.body.message }],
        ...(messageReferences.length > 0
          ? { referencedResources: messageReferences }
          : {}),
      },
      contextSnapshot: projectAgentSurfaceContext({
        ...(options.body.browserCanvasExport
          ? { browserCanvasExport: true }
          : {}),
        surfaceKind: "agent_workspace",
        originSurface: canvas?.originSurface ?? "workspace_home",
        attachedResourceIds: [
          ...new Set(
            messageReferences.map((reference) => reference.resourceId),
          ),
        ],
        ...(canvas
          ? {
              canvasDraftId: canvas.draft.id,
              canvasDraftVersion: canvas.draft.version,
              ...(canvas.pageKey ? { pageKey: canvas.pageKey } : {}),
              selectedElementKeys: canvas.selectedElementKeys,
              selectedArtifactIds: visualArtifactIds,
              canUndo: canvas.draft.version > 1,
            }
          : {
              selectedElementKeys: [],
              selectedArtifactIds: visualArtifactIds,
              canUndo: false,
            }),
        canRedo: false,
        ...(brand
          ? {
              brandKitRevisionId: brand.revisionId,
              brand,
            }
          : {}),
        libraryTools:
          runSurfaceView.profile.manifest.allowedToolFamilies.includes(
            "query",
          ) && options.authority.effectivePermissions.includes("library.read"),
        ...(options.body.libraryIds
          ? { selectedLibraryIds: options.body.libraryIds }
          : {}),
        ...(requestedSkill ? { requestedSkill } : {}),
      }),
      toolViewDigest: agentBuiltinToolViewDigest(
        digestProviderValue,
        toolView.toolViewDigest,
      ),
      promptRevision: `profile-r${String(surfaceView.profile.revision)}`,
      maximumModelCalls:
        surfaceView.profile.manifest.runLimits.maximumModelCalls,
      maximumToolCalls: surfaceView.profile.manifest.runLimits.maximumToolCalls,
      foundationContext: agentRunFoundationContext(runSurfaceView),
      executionDeadlineAt: new Date(
        options.now.getTime() +
          surfaceView.profile.manifest.runLimits.timeoutSeconds * 1_000,
      ),
      idempotencyKey: options.idempotencyKey,
      now: options.now,
    });
    return { threadId, runId, lifecycleStatus: "queued" };
  }

  public async regenerate(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId: string;
    readonly body: RegenerateAgentResponseBody;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<AgentRunAccepted> {
    const identity = `${options.authority.workspaceId}:${options.authority.principalId}:${options.idempotencyKey}`;
    const run = await this.database.agentRuntime.regenerateRun({
      authority: options.authority,
      runId: stableAgentRuntimeId("run-branch", identity, 1),
      threadId: options.threadId,
      ...("assistantMessageId" in options.body
        ? { sourceAssistantMessageId: options.body.assistantMessageId }
        : { sourceRunId: options.body.agentRunId }),
      idempotencyKey: options.idempotencyKey,
      now: options.now,
    });
    return {
      threadId: run.threadId,
      runId: run.id,
      lifecycleStatus: "queued",
    };
  }

  public async selectBranch(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId: string;
    readonly body: SelectAgentResponseBranchBody;
    readonly now: Date;
  }): Promise<AgentThreadSummary> {
    return threadSummary(
      await this.database.agentRuntime.selectThreadBranch({
        authority: options.authority,
        threadId: options.threadId,
        assistantMessageId: options.body.assistantMessageId,
        expectedVersion: options.body.expectedVersion,
        now: options.now,
      }),
    );
  }

  public async listThreads(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly cursor?: AgentThreadListCursor;
    readonly limit: number;
    readonly now: Date;
  }): Promise<{
    readonly items: AgentThreadSummary[];
    readonly nextCursor?: AgentThreadListCursor;
  }> {
    const result = await this.database.agentRuntime.listThreads(options);
    return {
      items: result.items.map(threadSummary),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  }

  public async renameThread(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId: string;
    readonly expectedVersion: number;
    readonly title: string;
    readonly now: Date;
  }): Promise<AgentThreadSummary> {
    return threadSummary(
      await this.database.agentRuntime.renameThread(options),
    );
  }

  public async archiveThread(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly threadId: string;
    readonly expectedVersion: number;
    readonly now: Date;
  }): Promise<AgentThreadSummary> {
    return threadSummary(
      await this.database.agentRuntime.archiveThread(options),
    );
  }

  public async getThread(
    options: {
      readonly authority: TrustedWorkspaceScope;
      readonly threadId: string;
      readonly locale?: "zh-CN" | "en-US";
      readonly now: Date;
    },
    snapshotAttempt = 0,
  ): Promise<AgentThreadView> {
    const thread = await this.database.agentRuntime.getThread(
      options.authority,
      options.threadId,
      options.now,
    );
    if (!thread) {
      throw new DomainError(
        "agent.thread_not_found",
        "Agent Thread was not found.",
      );
    }
    const [
      messages,
      latestRun,
      allActions,
      allInteractions,
      modelSettings,
      surfaceView,
    ] = await Promise.all([
      this.database.agentRuntime.listThreadMessages(
        options.authority,
        thread.id,
        200,
        options.now,
      ),
      this.database.agentRuntime.getLatestThreadRun(
        options.authority,
        thread.id,
        options.now,
      ),
      this.database.agentRuntime.listThreadActions(
        options.authority,
        thread.id,
        200,
        options.now,
      ),
      this.database.agentRuntime.listThreadInteractions(
        options.authority,
        thread.id,
        200,
        options.now,
      ),
      this.database.agentProfilePublications.getModelSettings(
        options.authority,
        options.now,
      ),
      this.database.agentFoundation.resolveSurfaceView({
        authority: options.authority,
        surfaceKind: "agent_workspace",
        profileRevisionId: thread.agentProfileRevisionId,
        now: options.now,
      }),
    ]);
    const visibleRunIds = new Set(
      messages
        .filter((message) => message.message.role === "assistant")
        .map((message) => message.agentRunId),
    );
    if (latestRun) visibleRunIds.add(latestRun.id);
    const libraryUses =
      options.authority.effectivePermissions.includes("library.read") &&
      this.database.agentLibraries
        ? await this.database.agentLibraries.listUses({
            authority: options.authority,
            threadId: thread.id,
            runIds: [...visibleRunIds],
            now: options.now,
          })
        : [];
    const actions = allActions.filter((action) =>
      visibleRunIds.has(action.agentRunId),
    );
    const messageIds = new Set(messages.map((message) => message.id));
    const interactions = allInteractions.filter((interaction) =>
      messageIds.has(interaction.assistantMessageId),
    );
    const retainedAgent =
      !surfaceView &&
      options.authority.effectivePermissions.includes("agent.read")
        ? (
            await this.database.agentHub.listResourceStates(
              options.authority,
              "agent",
              options.now,
            )
          ).find((item) => item.id === thread.agentDefinitionId)
        : undefined;
    const capabilityPresentations = await currentCapabilityPresentations(
      this.database,
      options.authority,
      actions,
      options.locale ?? "zh-CN",
      options.now,
    );
    const relatedContent = await visibleThreadContent(
      this.database,
      this.runtime,
      options.authority,
      actions,
      messages,
      latestRun,
      capabilityPresentations,
      options.now,
    );
    const relatedContentKeys = new Set(
      relatedContent.map((content) => `${content.kind}:${content.resourceId}`),
    );
    if (options.authority.effectivePermissions.includes("asset.read")) {
      for (const action of actions) {
        const exported = canvasExportContent(action);
        const key = exported
          ? `${exported.kind}:${exported.resourceId}`
          : undefined;
        if (
          exported &&
          key &&
          !relatedContentKeys.has(key) &&
          relatedContent.length < 100
        ) {
          relatedContent.push(exported);
          relatedContentKeys.add(key);
        }
      }
    }
    const contentById = new Map(
      relatedContent.map((content) => [
        `${content.kind}:${content.resourceId}`,
        content,
      ]),
    );
    const visibleCanvasReferences = new Set<string>();
    const exactContentCache = new Map<
      string,
      Promise<AgentThreadView["relatedContent"][number]>
    >();
    const currentBrand = relatedContent.find(
      (content) =>
        content.kind === "brand" &&
        content.brandKitRevisionId ===
          latestRun?.contextSnapshot.brandKitRevisionId,
    );
    const interactionsByMessage = new Map<string, AgentInteractionView[]>();
    for (const interaction of interactions) {
      const visible = interactionView(interaction);
      interactionsByMessage.set(interaction.assistantMessageId, [
        ...(interactionsByMessage.get(interaction.assistantMessageId) ?? []),
        visible,
      ]);
    }
    const latestAssistantMessage = messages.find(
      (message) =>
        message.message.role === "assistant" &&
        message.agentRunId === latestRun?.id,
    );
    const replacedAssistantMessage = latestRun?.parentRunId
      ? messages.find(
          (message) =>
            message.message.role === "assistant" &&
            message.agentRunId === latestRun.parentRunId,
        )
      : undefined;
    const view: AgentThreadView = {
      id: thread.id,
      ...(thread.viewRevision !== undefined
        ? { viewRevision: thread.viewRevision }
        : {}),
      ...(thread.title ? { title: thread.title } : {}),
      lifecycleStatus: thread.lifecycleStatus,
      version: thread.version,
      actionConfirmationRequired: modelSettings.actionConfirmationRequired,
      brandContext:
        currentBrand?.brandKitRevisionId && currentBrand.title
          ? {
              brandKitId: currentBrand.resourceId,
              brandKitRevisionId: currentBrand.brandKitRevisionId,
              name: currentBrand.title,
            }
          : null,
      agent: {
        id: thread.agentDefinitionId,
        displayName:
          surfaceView?.profile.manifest.displayName ??
          retainedAgent?.displayName ??
          "Agent",
      },
      ...(latestRun
        ? {
            latestRun: Object.freeze({
              id: latestRun.id,
              ...(latestAssistantMessage
                ? { assistantMessageId: latestAssistantMessage.id }
                : {}),
              ...(replacedAssistantMessage
                ? { replacesMessageId: replacedAssistantMessage.id }
                : {}),
              lifecycleStatus: latestRun.lifecycleStatus,
              ...(latestRun.lifecycleStatus === "failed"
                ? {
                    failureKind:
                      agentRunFailureKind(latestRun.terminalReasonCode) ??
                      "runtime",
                  }
                : {}),
              updatedAt: latestRun.updatedAt.toISOString(),
            }),
          }
        : {}),
      messages: await Promise.all(
        messages.map(async (message) => ({
          id: message.id,
          role: message.message.role,
          parts: messagePartsForView(message),
          ...(message.message.role === "assistant"
            ? {
                libraryUses: libraryUses
                  .filter((use) => use.runId === message.agentRunId)
                  .map(({ runId: _runId, locations, ...use }) => {
                    void _runId;
                    return {
                      ...use,
                      ...(locations ? { locations: [...locations] } : {}),
                    };
                  }),
              }
            : {}),
          relatedContent: await exactMessageContent(
            this.database,
            options.authority,
            message,
            messageRelatedContent(
              message,
              actions,
              contentById,
              visibleCanvasReferences,
            ),
            exactContentCache,
            options.now,
          ),
          ...messageSelectedSkill(message),
          ...(interactionsByMessage.get(message.id)?.length
            ? { interactions: interactionsByMessage.get(message.id)! }
            : {}),
          ...(message.alternativeIndex && message.alternativeCount
            ? {
                branch: {
                  index: message.alternativeIndex,
                  count: message.alternativeCount,
                  ...(message.previousAlternativeMessageId
                    ? {
                        previousMessageId: message.previousAlternativeMessageId,
                      }
                    : {}),
                  ...(message.nextAlternativeMessageId
                    ? { nextMessageId: message.nextAlternativeMessageId }
                    : {}),
                },
              }
            : {}),
          createdAt: message.createdAt.toISOString(),
        })),
      ),
      relatedContent,
      pendingCanvasExports: actions
        .flatMap((action) => {
          const request = canvasExportRequest(action);
          return request &&
            action.lifecycleStatus === "running" &&
            !action.proposalDocument?.completion
            ? [{ actionReceiptId: action.id, ...request }]
            : [];
        })
        .slice(0, 40),
      tasks: await visibleThreadTasks(
        this.database,
        this.runtime,
        options.authority,
        actions,
        messages,
        capabilityPresentations,
        options.now,
        latestRun,
      ),
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
    if (thread.viewRevision !== undefined) {
      const current = await this.database.agentRuntime.getThread(
        options.authority,
        thread.id,
        options.now,
      );
      if (
        !current ||
        current.viewRevision !== thread.viewRevision ||
        current.activeRunId !== thread.activeRunId
      ) {
        if (snapshotAttempt < 2)
          return this.getThread(options, snapshotAttempt + 1);
        throw new DomainError(
          "agent.snapshot_changed",
          "Conversation changed while loading. Retry the snapshot.",
        );
      }
    }
    return view;
  }

  public async get(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly agentRunId: string;
    readonly now: Date;
  }): Promise<AgentRunView> {
    const run = await this.database.agentRuntime.getRun(
      options.authority,
      options.agentRunId,
      options.now,
    );
    if (!run) {
      throw new DomainError("agent.run_not_found", "Agent Run was not found.");
    }
    const [messages, actions, interactions] = await Promise.all([
      this.database.agentRuntime.listThreadMessages(
        options.authority,
        run.threadId,
        200,
        options.now,
      ),
      this.database.agentRuntime.listRunActions(
        options.authority,
        run.id,
        options.now,
      ),
      this.database.agentRuntime.listRunInteractions(
        options.authority,
        run.id,
        options.now,
      ),
    ]);
    const interactionsByMessage = new Map<string, AgentInteractionView[]>();
    for (const interaction of interactions) {
      const visible = interactionView(interaction);
      interactionsByMessage.set(interaction.assistantMessageId, [
        ...(interactionsByMessage.get(interaction.assistantMessageId) ?? []),
        visible,
      ]);
    }
    return {
      threadId: run.threadId,
      runId: run.id,
      lifecycleStatus: run.lifecycleStatus,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.message.role,
        parts: messagePartsForView(message),
        relatedContent: [],
        ...(interactionsByMessage.get(message.id)?.length
          ? { interactions: interactionsByMessage.get(message.id)! }
          : {}),
        createdAt: message.createdAt.toISOString(),
      })),
      actions: actions.flatMap((action) => {
        const proposal = action.proposalDocument;
        return proposal &&
          typeof proposal.title === "string" &&
          typeof proposal.description === "string" &&
          ["waiting_approval", "succeeded", "failed", "cancelled"].includes(
            action.lifecycleStatus,
          )
          ? [
              {
                id: action.id,
                lifecycleStatus: action.lifecycleStatus as
                  "waiting_approval" | "succeeded" | "failed" | "cancelled",
                title: proposal.title,
                description: proposal.description,
              },
            ]
          : [];
      }),
    };
  }

  public async getDiagnostics(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly agentRunId: string;
    readonly now: Date;
  }): Promise<AgentRunDiagnostics> {
    const record = await this.database.agentRuntime.getRunDiagnostics(
      options.authority,
      options.agentRunId,
      options.now,
    );
    if (!record)
      throw new DomainError("agent.run_not_found", "Agent Run was not found.");
    return {
      ...record,
      discoveries: [...(record.discoveries ?? [])],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      actions: (record.actions ?? []).map((action) => ({
        ...action,
        createdAt: action.createdAt.toISOString(),
        updatedAt: action.updatedAt.toISOString(),
      })),
      calls: record.calls.map((call) => ({
        ...call,
        createdAt: call.createdAt.toISOString(),
        updatedAt: call.updatedAt.toISOString(),
      })),
    };
  }

  public async cancelRun(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly agentRunId: string;
    readonly now: Date;
  }): Promise<CancelledAgentRun> {
    try {
      const run = await this.database.agentRunDispatch.cancel(options);
      return { runId: run.id, lifecycleStatus: "cancelled" };
    } catch (error) {
      if (error instanceof AgentRunDispatchStoreError) {
        throw new DomainError(error.code, error.message);
      }
      throw error;
    }
  }

  public async resolveInteraction(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly interactionId: string;
    readonly body: ResolveAgentInteractionBody;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<ResolvedAgentInteraction> {
    if (!options.idempotencyKey.trim()) {
      throw new DomainError(
        "agent.interaction_invalid",
        "The response could not be submitted.",
      );
    }
    const interaction = await this.database.agentRuntime.getInteraction(
      options.authority,
      options.interactionId,
      options.now,
    );
    if (!interaction) {
      throw new DomainError(
        "agent.interaction_not_found",
        "This question is no longer available.",
      );
    }
    const { expectedVersion, ...answer } = options.body;
    const response = {
      schemaVersion: 1 as const,
      ...answer,
    };
    try {
      assertAgentQuestionResponse(interaction.request, response);
    } catch {
      throw new DomainError(
        "agent.interaction_invalid",
        "Answer each question before continuing.",
      );
    }
    try {
      const resolved = await this.database.agentRuntime.resolveInteraction({
        authority: options.authority,
        interactionId: options.interactionId,
        expectedVersion,
        resolutionRequestKey: options.idempotencyKey,
        response,
        now: options.now,
      });
      if (
        resolved.interaction.lifecycleStatus === "pending" ||
        (resolved.run.lifecycleStatus !== "queued" &&
          resolved.run.lifecycleStatus !== "cancelled")
      ) {
        throw new DomainError(
          "agent.integrity_violation",
          "The question response has an inconsistent result.",
        );
      }
      return {
        interactionId: resolved.interaction.id,
        lifecycleStatus: resolved.interaction.lifecycleStatus,
        runId: resolved.run.id,
        runLifecycleStatus: resolved.run.lifecycleStatus,
      };
    } catch (error) {
      if (error instanceof AgentRuntimeStoreError) {
        throw new DomainError(error.code, error.message);
      }
      throw error;
    }
  }

  public async confirm(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly actionReceiptId: string;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<ConfirmedAgentAction> {
    if (!options.idempotencyKey.trim()) {
      throw new DomainError(
        "agent.action_invalid",
        "Agent action confirmation is invalid.",
      );
    }
    const action = await this.database.agentRuntime.getAction(
      options.authority,
      options.actionReceiptId,
      options.now,
    );
    if (!action?.proposalDocument) {
      throw new DomainError(
        "agent.action_not_found",
        "Prepared Agent action was not found.",
      );
    }
    const capability = capabilityProposal(action);
    const workflow = workflowProposal(action);
    const skill = skillDraftProposal(action);
    const brand = brandPublishProposal(action);
    if (!capability && !workflow && !skill && !brand) {
      throw new DomainError(
        "agent.action_invalid",
        "Prepared Agent action is invalid.",
      );
    }
    const run = await this.database.agentRuntime.getRun(
      options.authority,
      action.agentRunId,
      options.now,
    );
    if (!run) {
      throw new DomainError("agent.run_not_found", "Agent Run was not found.");
    }
    const completeRun = async (): Promise<void> => {
      await this.database.agentRuntime.settleRun({
        authority: options.authority,
        runId: run.id,
        now: options.now,
      });
    };
    if (
      action.lifecycleStatus === "succeeded" &&
      action.outcomeReference?.kind === "workflow_run"
    ) {
      await completeRun();
      return {
        actionReceiptId: action.id,
        outcomeKind: "workflow_run",
        workflowRunId: action.outcomeReference.workflowRunId,
        lifecycleStatus: "succeeded",
      };
    }
    if (
      action.lifecycleStatus === "succeeded" &&
      action.outcomeReference?.kind === "capability_run"
    ) {
      await completeRun();
      return {
        actionReceiptId: action.id,
        outcomeKind: "capability_run",
        capabilityRunId: action.outcomeReference.capabilityRunId,
        lifecycleStatus: "succeeded",
      };
    }
    if (
      action.lifecycleStatus === "succeeded" &&
      action.outcomeReference?.kind === "skill_draft"
    ) {
      await completeRun();
      return {
        actionReceiptId: action.id,
        outcomeKind: "skill_draft",
        skillDraftId: action.outcomeReference.skillDraftId,
        lifecycleStatus: "succeeded",
      };
    }
    if (
      action.lifecycleStatus === "succeeded" &&
      action.outcomeReference?.kind === "brand_revision"
    ) {
      await completeRun();
      return {
        actionReceiptId: action.id,
        outcomeKind: "brand_revision",
        brandKitId: action.outcomeReference.brandKitId,
        brandKitRevisionId: action.outcomeReference.brandKitRevisionId,
        lifecycleStatus: "succeeded",
      };
    }
    let failureReason = "agent.workflow_start_failed";
    if (skill) failureReason = "agent.skill_draft_create_failed";
    else if (brand) failureReason = "agent.brand_publish_failed";
    else if (capability) failureReason = "agent.capability_start_failed";
    if (
      action.lifecycleStatus === "failed" &&
      action.terminalReasonCode?.startsWith(failureReason)
    ) {
      await completeRun();
      throw new DomainError(
        "agent.action_state_conflict",
        "Prepared Agent action has already failed.",
      );
    }
    if (workflow && !workflow.input) {
      throw new DomainError(
        "agent.action_invalid",
        "Prepared Agent action is invalid.",
      );
    }
    if (
      !["waiting_approval", "running"].includes(action.lifecycleStatus) ||
      !["waiting_approval", "running", "succeeded"].includes(
        run.lifecycleStatus,
      )
    ) {
      throw new DomainError(
        "agent.action_state_conflict",
        "Prepared Agent action is not waiting for confirmation.",
      );
    }
    if (action.lifecycleStatus !== "running") {
      await this.database.agentRuntime.transitionAction({
        authority: options.authority,
        agentRunId: run.id,
        actionReceiptId: action.id,
        expectedVersion: action.version,
        toStatus: "running",
        now: options.now,
      });
    }
    let outcomeReference:
      | { readonly kind: "capability_run"; readonly capabilityRunId: string }
      | { readonly kind: "workflow_run"; readonly workflowRunId: string }
      | { readonly kind: "skill_draft"; readonly skillDraftId: string }
      | {
          readonly kind: "brand_revision";
          readonly brandKitId: string;
          readonly brandKitRevisionId: string;
        };
    try {
      if (brand) {
        const result = await this.runtime.workspaceBrand.publish({
          authority: options.authority,
          brandKitId: brand.input.brandKitId,
          expectedDraftVersion: brand.input.expectedDraftVersion,
          idempotencyKey: `agent-brand-publish:${action.id}`,
          audit: {
            auditEventId: stableAgentRuntimeId(
              "brand-publish-audit",
              action.id,
              1,
            ),
            authenticationRefHash: digestProviderValue(
              options.authority.authenticationRefId,
            ),
            requestId: `agent-action:${action.id}`,
          },
        });
        outcomeReference = {
          kind: "brand_revision",
          brandKitId: result.value.brandKitId,
          brandKitRevisionId: result.value.id,
        };
      } else if (skill) {
        if (!this.skillLibrary) {
          throw new DomainError(
            "skill_library.unavailable",
            "Skill creation is temporarily unavailable.",
          );
        }
        if (skill.kind === "files") {
          const draft = await this.skillLibrary.getDraft({
            authority: options.authority,
            draftId: skill.input.draftId,
            now: options.now,
          });
          const updated = await this.skillLibrary.updateDraft({
            authority: options.authority,
            draftId: draft.id,
            now: options.now,
            body: {
              expectedDefinitionVersion: draft.definitionVersion,
              expectedPresentationVersion: draft.presentationVersion,
              expectedDraftVersion: skill.input.expectedDraftVersion,
              ...(draft.coverAssetId
                ? { coverAssetId: draft.coverAssetId }
                : {}),
              displayName: draft.displayName,
              description: draft.description,
              summary: draft.summary,
              instructions: draft.instructions,
              visibility: draft.visibility,
              tags: [...draft.tags],
              exampleRequests: [...draft.exampleRequests],
              ...(draft.category ? { category: draft.category } : {}),
            },
            agentAttachments: { runId: run.id, files: skill.input.files },
          });
          outcomeReference = { kind: "skill_draft", skillDraftId: updated.id };
        } else {
          const source = skill.input.sourceArtifactId
            ? await this.skillLibrary.resolveDerivationSource({
                authority: options.authority,
                threadId: run.threadId,
                artifactId: skill.input.sourceArtifactId,
                now: options.now,
              })
            : undefined;
          const created = await this.skillLibrary.createDraft({
            authority: options.authority,
            body: {
              name: skill.input.name,
              displayName: skill.input.displayName,
              description: skill.input.description,
              summary: skill.input.summary,
              instructions: skill.input.instructions,
              visibility: skill.input.visibility,
              ...(skill.input.category
                ? { category: skill.input.category }
                : {}),
              tags: [...skill.input.tags],
              exampleRequests: [...skill.input.exampleRequests],
            },
            idempotencyKey: `agent-skill:${action.id}`,
            now: options.now,
            agentAttachments: { runId: run.id, files: skill.input.files ?? [] },
            ...(source
              ? {
                  derivation: {
                    sourceThreadId: run.threadId,
                    sourceRunId: source.sourceRunId,
                    sourceArtifactId: skill.input.sourceArtifactId!,
                    sourceDigest: digestProviderValue({
                      threadId: run.threadId,
                      sourceRunId: source.sourceRunId,
                      sourceArtifactId: skill.input.sourceArtifactId,
                      candidate: skill.input,
                    }),
                  },
                }
              : {}),
          });
          outcomeReference = {
            kind: "skill_draft",
            skillDraftId: created.id,
          };
        }
      } else if (capability) {
        const result = await this.capabilityRuns.start({
          authority: options.authority,
          invocationKind: "agent",
          invocationReferenceId: action.id,
          contractRevisionId: capability.contractRevisionId,
          idempotencyKey: `agent-capability:${action.id}`,
          input: capability.input,
          requestId: `agent-action:${action.id}`,
          now: options.now,
        });
        outcomeReference = {
          kind: "capability_run",
          capabilityRunId: result.run.id,
        };
      } else {
        if (!options.authority.effectivePermissions.includes("workflow.run")) {
          throw new DomainError(
            "authorization.permission_denied",
            "Workflow execution permission is required.",
          );
        }
        const result = await this.runtime.workflow.createRun({
          workspaceId: options.authority.workspaceId,
          actorId: options.authority.principalId,
          workflowRevisionId: workflow!.workflowRevisionId,
          brandKitRevisionId: run.contextSnapshot.brandKitRevisionId ?? null,
          canReadBrand:
            options.authority.effectivePermissions.includes("brand.read"),
          idempotencyKey: `agent-workflow:${action.id}`,
          agentInvocation: {
            authority: options.authority,
            actionReceiptId: action.id,
          },
          input: workflow!.input,
        });
        outcomeReference = {
          kind: "workflow_run",
          workflowRunId: result.run.id,
        };
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const terminalReasonCode = actionFailureReason(failureReason, error);
      const currentAction = await this.database.agentRuntime.getAction(
        options.authority,
        action.id,
        options.now,
      );
      if (currentAction?.lifecycleStatus === "running") {
        await this.database.agentRuntime.completeAction({
          authority: options.authority,
          agentRunId: run.id,
          actionReceiptId: action.id,
          expectedVersion: currentAction.version,
          status: "failed",
          terminalReasonCode,
          now: options.now,
        });
      }
      await completeRun();
      throw error;
    }
    const currentAction = await this.database.agentRuntime.getAction(
      options.authority,
      action.id,
      options.now,
    );
    if (!currentAction) {
      throw new DomainError(
        "agent.action_not_found",
        "Prepared Agent action was not found.",
      );
    }
    await this.database.agentRuntime.completeAction({
      authority: options.authority,
      agentRunId: run.id,
      actionReceiptId: action.id,
      expectedVersion: currentAction.version,
      status: "succeeded",
      outputDigest: digestProviderValue(outcomeReference),
      outcomeReference,
      now: options.now,
    });
    await completeRun();
    if (outcomeReference.kind === "capability_run") {
      return {
        actionReceiptId: action.id,
        outcomeKind: "capability_run",
        capabilityRunId: outcomeReference.capabilityRunId,
        lifecycleStatus: "succeeded",
      };
    }
    if (outcomeReference.kind === "workflow_run") {
      return {
        actionReceiptId: action.id,
        outcomeKind: "workflow_run",
        workflowRunId: outcomeReference.workflowRunId,
        lifecycleStatus: "succeeded",
      };
    }
    if (outcomeReference.kind === "brand_revision") {
      return {
        actionReceiptId: action.id,
        outcomeKind: "brand_revision",
        brandKitId: outcomeReference.brandKitId,
        brandKitRevisionId: outcomeReference.brandKitRevisionId,
        lifecycleStatus: "succeeded",
      };
    }
    return {
      actionReceiptId: action.id,
      outcomeKind: "skill_draft",
      skillDraftId: outcomeReference.skillDraftId,
      lifecycleStatus: "succeeded",
    };
  }

  public async decline(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly actionReceiptId: string;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<DeclinedAgentAction> {
    if (!options.idempotencyKey.trim()) {
      throw new DomainError(
        "agent.action_invalid",
        "Agent action decision is invalid.",
      );
    }
    const result = await this.database.agentRuntime.declinePendingAction({
      authority: options.authority,
      actionReceiptId: options.actionReceiptId,
      now: options.now,
    });
    return {
      actionReceiptId: result.action.id,
      lifecycleStatus: "cancelled",
    };
  }
}
