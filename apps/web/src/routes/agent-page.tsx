import { AgentStarterTasks } from "../features/agent/agent-home-content.js";
import {
  agentEntryNeedsFreshDraft,
  prepareAgentEntryDraft,
  validateAgentCanvasSearch,
} from "../features/agent/agent-entry-search.js";
import { useResourceStates } from "../components/resource-lifecycle.js";
import { AgentCanvasExportExecutor } from "../features/agent/agent-canvas-export-executor.js";
import { AgentRunDiagnostics } from "../features/agent/agent-run-diagnostics.js";
import {
  CheckOutlined,
  DownOutlined,
  PicRightOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type {
  AgentHubSkill,
  CurrentHumanContext,
  AgentThreadView,
  CreateCanvasDraftBody,
  CreateWorkspaceAgentMessageBody,
  ResolveAgentInteractionBody,
  WorkspaceAgentModelSettings,
} from "@kanvas/contracts/api";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Drawer,
  Dropdown,
  Skeleton,
  Splitter,
  Tooltip,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  cancelAgentRun,
  cancelWorkflowRun,
  cancelCapabilityRun,
  confirmAgentAction,
  createWorkspaceAgentMessage,
  createCanvasDraft,
  fetchWorkflowRun,
  declineAgentAction,
  downloadArtifact,
  fetchAgentRun,
  fetchAgentThread,
  fetchBrandKitRevision,
  fetchAgentHubAgent,
  fetchAgentHubAgents,
  fetchAgentHubSkills,
  fetchWorkspaceAgentModelSettings,
  fetchCanvasDraft,
  regenerateAgentResponse,
  resolveAgentInteraction,
  recordSkillCandidateTest,
  selectAgentResponseBranch,
  streamAgentThread,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import {
  InlineNotice,
  PageLoading,
  PageEmptyState,
} from "../components/feedback.js";
import { WorkspaceBoundary } from "../components/workspace-page.js";
import { ConversationCatalogDrawer } from "../components/conversation-catalog-drawer.js";
import { AppShell } from "../components/app-shell.js";
export { threadListHasActiveRun } from "../components/conversation-history.js";
import { ConversationSidebar } from "../components/conversation-sidebar.js";
import { AgentAvatar } from "../components/agent-avatar.js";
import { AgentContextShelf } from "../features/agent/agent-context-shelf.js";
import { agentDisplaySummary } from "../features/agent/agent-presentation.js";
import { agentTaskDisplayText } from "../features/agent/agent-task-presentation.js";
import {
  agentComposerShouldAutoFocusOnEntry,
  focusAgentComposer,
} from "../features/agent/agent-focus.js";
import {
  acceptedAgentThreadSnapshot,
  mergeAgentThreadSnapshot,
  shareAgentThreadSnapshot,
} from "../features/agent/agent-thread-snapshot.js";
import { MainAgentThread } from "../features/agent/main-agent-thread.js";
import type {
  AgentPendingMessageView,
  AgentQueuePauseReason,
} from "../features/agent/agent-pending-message-queue.js";
import { agentBrowserCapabilitySignature } from "../features/agent/agent-browser-requirements.js";
import { useBrowserRuntimes } from "../features/browser-executor/use-browser-runtimes.js";
import { BrowserRuntimeNotice } from "../features/browser-executor/browser-runtime-notice.js";
import {
  agentComposerHasFilePayload,
  agentComposerImageFiles,
} from "../features/agent/agent-composer.js";
import {
  AgentComposerReferencePicker,
  agentComposerSkillPayload,
  type AgentComposerReference,
  type AgentComposerReferenceKind,
} from "../features/agent/agent-composer-reference-picker.js";
import {
  composerDraftStorageKey,
  agentComposerSubmissionAttempt,
  clearAgentComposerSubmission,
  persistAgentDraftContext,
  persistAgentComposerSubmission,
  readAgentComposerSubmission,
  readAgentDraftContext,
  type AgentComposerSubmissionAttempt,
} from "../features/agent/agent-composer-draft.js";
import { useAgentComposerAttachments } from "../features/agent/use-agent-composer-attachments.js";
import {
  withAgentMessageQueueDeliveryLock,
  type AgentMessageQueuePauseReason,
} from "../features/agent/agent-message-queue.js";
import { useAgentMessageQueue } from "../features/agent/use-agent-message-queue.js";
import { AgentResourceEditorModal } from "../features/agent/agent-resource-editor-modal.js";
import {
  AgentResourceWorkbench,
  agentWorkbenchEntryKey,
  currentAgentWorkbenchEntries,
  agentWorkbenchResourceEntry,
  agentWorkbenchTaskEntry,
  type AgentWorkbenchEntry,
  type AgentWorkbenchResource,
  type AgentWorkbenchTask,
} from "../features/agent/agent-resource-workbench.js";
import { queryClient } from "../query-client.js";
import { workspaceQueryKeys } from "../api/query-keys.js";

import { createWorkflowResultDraftV1 } from "../features/editor/workflow-result-draft-v1.js";

const THREAD_FALLBACK_POLL_INTERVAL_MS = 2_000;
const THREAD_STREAM_RETRY_INITIAL_MS = 250;
const THREAD_STREAM_RETRY_MAXIMUM_MS = 4_000;
const THREAD_STREAM_RETRY_MAXIMUM_EXPONENT = 8;
const THREAD_STREAM_RETRY_JITTER_RATIO = 0.25;
const QUEUE_DELIVERY_LOCK_RETRY_MS = 250;
const requestTimeoutHttpStatus = 408;
const conversationMinimumWidth = 520;
const workbenchDefaultWidth = 400;
const workbenchMinimumWidth = 320;
const workbenchMaximumWidth = 720;
const desktopAgentMediaQuery = "(min-width: 768px)";
const wideInspectorMediaQuery = "(min-width: 1280px)";
const maximumComposerAttachments = 8;
const maximumComposerReferences = 12;
const DEFAULT_AGENT_MODEL_REFETCH_INTERVAL_MS = 10_000;

const emptyAgentMessages: AgentThreadView["messages"] = [];
const emptyAgentTasks: AgentThreadView["tasks"] = [];
const emptyAgentRelatedContent: AgentThreadView["relatedContent"] = [];

type AgentRegenerationTarget =
  { readonly assistantMessageId: string } | { readonly agentRunId: string };
type CandidateTestStatus = "recording" | "passed" | "failed";

function candidateTestAlertType(
  status: CandidateTestStatus,
): "error" | "success" | "info" {
  if (status === "failed") return "error";
  if (status === "passed") return "success";
  return "info";
}

export function regeneratingAssistantMessageId(
  target: AgentRegenerationTarget,
  messages: AgentThreadView["messages"],
): string | undefined {
  return "assistantMessageId" in target
    ? target.assistantMessageId
    : messages.findLast((message) => message.role === "assistant")?.id;
}

export function reusableFailedAgentRequest(
  thread: Pick<AgentThreadView, "latestRun" | "messages"> | undefined,
): string | undefined {
  if (thread?.latestRun?.failureKind !== "tools_changed") return undefined;
  const boundaryMessageId =
    thread.latestRun.assistantMessageId ?? thread.latestRun.replacesMessageId;
  const boundaryIndex = boundaryMessageId
    ? thread.messages.findIndex((message) => message.id === boundaryMessageId)
    : -1;
  const request = (
    boundaryIndex >= 0
      ? thread.messages.slice(0, boundaryIndex)
      : thread.messages
  ).findLast((message) => message.role === "user");
  const text = request?.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  return text || undefined;
}

function readComposerDraft(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

interface AgentCanvasSearch {
  readonly invalidAgentSelection?: boolean;
  readonly invalidInitialPrompt?: boolean;
  readonly draftId?: string;
  readonly brandKitId?: string;
  readonly brandKitRevisionId?: string;
  readonly agentDefinitionId?: string;
  readonly skillCandidateId?: string;
  readonly skillRevisionId?: string;
  readonly skillCandidateDigest?: string;
  readonly skillTestRequest?: string;
  readonly initialPrompt?: string;
  readonly canvasDraftId?: string;
  readonly canvasDraftVersion?: number;
  readonly pageKey?: string;
  readonly selectedElementKeys?: readonly string[];
  readonly returnTo?: string;
}

type AgentComposerCanvasEntry = NonNullable<
  CreateWorkspaceAgentMessageBody["entryContext"]
>;

function retrievedCanvasEntryStorageKey(composerDraftKey: string): string {
  return `${composerDraftKey}:retrieved-canvas-entry`;
}

export function readRetrievedCanvasEntry(
  composerDraftKey: string,
  queuedItemIds: ReadonlySet<string>,
  storage?: Pick<Storage, "getItem" | "removeItem">,
): AgentComposerCanvasEntry | undefined {
  try {
    const target = storage ?? sessionStorage;
    const value: unknown = JSON.parse(
      target.getItem(retrievedCanvasEntryStorageKey(composerDraftKey)) ??
        "null",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const stored = value as Readonly<Record<string, unknown>>;
    if (typeof stored.itemId !== "string") return undefined;
    if (queuedItemIds.has(stored.itemId)) {
      target.removeItem(retrievedCanvasEntryStorageKey(composerDraftKey));
      return undefined;
    }
    const entry = stored.entryContext;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const context = entry as Readonly<Record<string, unknown>>;
    if (
      context.originSurface !== "canvas" ||
      typeof context.canvasDraftId !== "string" ||
      !Number.isSafeInteger(context.canvasDraftVersion) ||
      Number(context.canvasDraftVersion) < 1 ||
      !Array.isArray(context.selectedElementKeys) ||
      !context.selectedElementKeys.every((key) => typeof key === "string") ||
      (context.pageKey !== undefined && typeof context.pageKey !== "string") ||
      (context.returnTo !== undefined && typeof context.returnTo !== "string")
    ) {
      return undefined;
    }
    return context as unknown as AgentComposerCanvasEntry;
  } catch {
    return undefined;
  }
}

export function persistRetrievedCanvasEntry(
  composerDraftKey: string,
  itemId: string,
  entryContext: AgentComposerCanvasEntry,
  storage?: Pick<Storage, "setItem">,
): boolean {
  try {
    (storage ?? sessionStorage).setItem(
      retrievedCanvasEntryStorageKey(composerDraftKey),
      JSON.stringify({ itemId, entryContext }),
    );
    return true;
  } catch {
    return false;
  }
}

function clearRetrievedCanvasEntry(
  composerDraftKey: string,
  storage?: Pick<Storage, "removeItem">,
): void {
  try {
    (storage ?? sessionStorage).removeItem(
      retrievedCanvasEntryStorageKey(composerDraftKey),
    );
  } catch {
    /* The in-memory restored context remains usable in this page. */
  }
}

function agentCanvasSearch(value: unknown): AgentCanvasSearch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return validateAgentCanvasSearch(value as Record<string, unknown>);
}

function threadIsRunning(
  thread: Pick<AgentThreadView, "latestRun"> | undefined,
): boolean {
  return (
    thread?.latestRun?.lifecycleStatus === "queued" ||
    thread?.latestRun?.lifecycleStatus === "running"
  );
}

export function agentMessageQueuePauseReason(
  thread: Pick<AgentThreadView, "latestRun"> | undefined,
  resumedAfterRunId?: string,
): AgentMessageQueuePauseReason | undefined {
  const run = thread?.latestRun;
  if (!run) return undefined;
  if (run.lifecycleStatus === "waiting_approval") return "waiting_approval";
  if (run.lifecycleStatus === "waiting_for_user") return "waiting_for_user";
  if (run.id === resumedAfterRunId) return undefined;
  if (run.lifecycleStatus === "failed") return "failed";
  if (run.lifecycleStatus === "cancelled") return "cancelled";
  return undefined;
}

export function agentMessageQueueCanDrain(
  thread: Pick<AgentThreadView, "latestRun"> | undefined,
  resumedAfterRunId?: string,
): boolean {
  const run = thread?.latestRun;
  if (!run) return false;
  return (
    run.lifecycleStatus === "succeeded" ||
    ((run.lifecycleStatus === "failed" ||
      run.lifecycleStatus === "cancelled") &&
      run.id === resumedAfterRunId)
  );
}

export function agentStopRaceAlreadySettled(
  runId: string,
  thread: Pick<AgentThreadView, "latestRun"> | undefined,
): boolean {
  return (
    thread?.latestRun?.id === runId &&
    thread.latestRun.lifecycleStatus !== "queued" &&
    thread.latestRun.lifecycleStatus !== "running" &&
    thread.latestRun.lifecycleStatus !== "waiting_approval" &&
    thread.latestRun.lifecycleStatus !== "waiting_for_user"
  );
}

export function agentMessageQueueSnapshotIsCurrent(input: {
  readonly visible: boolean;
  readonly mounted: boolean;
  readonly dataUpdatedAt: number;
  readonly visibleSince: number;
  readonly currentRunId?: string;
  readonly currentRunStatus?: string;
  readonly expectedRunId?: string;
  readonly expectedRunStatus?: string;
}): boolean {
  return (
    input.visible &&
    input.mounted &&
    input.dataUpdatedAt >= input.visibleSince &&
    input.currentRunId === input.expectedRunId &&
    input.currentRunStatus === input.expectedRunStatus
  );
}

export function acceptedAgentMessageQueueBarrierAction(input: {
  readonly acceptedRunId?: string;
  readonly latestRunId?: string;
  readonly resolvedRunId?: string;
  readonly resolvedThreadId?: string;
  readonly threadId?: string;
  readonly pendingCount: number;
}): "wait" | "settle" | "pause_and_settle" {
  if (!input.acceptedRunId || !input.latestRunId) return "wait";
  if (input.latestRunId === input.acceptedRunId) return "settle";
  if (
    input.resolvedRunId !== input.acceptedRunId ||
    input.resolvedThreadId !== input.threadId
  ) {
    return "wait";
  }
  return input.pendingCount > 0 ? "pause_and_settle" : "settle";
}

export function queuedAgentMessageComposerReferences(
  request: CreateWorkspaceAgentMessageBody,
  labels: Readonly<
    Record<"asset" | "brand" | "canvas" | "skill" | "workflow", string> & {
      library?: string;
    }
  >,
): readonly AgentComposerReference[] {
  return [
    ...(request.libraryIds ?? []).map((libraryId) => ({
      kind: "library" as const,
      id: `library:${libraryId}`,
      libraryId,
      title: labels.library ?? "Resource library",
    })),
    ...(request.attachments ?? []).map((attachment) =>
      attachment.assetId
        ? {
            kind: "asset" as const,
            id: `asset:${attachment.assetId}:${attachment.artifactId}`,
            title: labels.asset,
            assetId: attachment.assetId,
            artifactId: attachment.artifactId,
          }
        : {
            kind: "artifact" as const,
            id: `artifact:${attachment.artifactId}`,
            title: labels.asset,
            artifactId: attachment.artifactId,
          },
    ),
    ...(request.references ?? []).map((reference) =>
      reference.kind === "canvas"
        ? {
            kind: "canvas" as const,
            id: `canvas:${reference.resourceId}`,
            title: labels.canvas,
            resourceId: reference.resourceId,
            version: reference.version,
          }
        : {
            kind: "workflow" as const,
            id: `workflow:${reference.resourceId}`,
            title: labels.workflow,
            resourceId: reference.resourceId,
          },
    ),
    ...(request.brandContext
      ? [
          {
            kind: "brand" as const,
            id: `brand:${request.brandContext.brandKitId}`,
            title: labels.brand,
            brandKitId: request.brandContext.brandKitId,
            brandKitRevisionId: request.brandContext.brandKitRevisionId,
          },
        ]
      : []),
    ...(request.skillRevisionId
      ? [
          {
            kind: "skill" as const,
            id: `skill:${request.skillRevisionId}`,
            title: labels.skill,
            skillRevisionId: request.skillRevisionId,
          },
        ]
      : []),
  ];
}

export function stageAgentResultComposerReference(input: {
  readonly references: readonly AgentComposerReference[];
  readonly activeReferenceCount: number;
  readonly uploadedAttachmentCount: number;
  readonly maximumAttachments: number;
  readonly maximumReferences: number;
  readonly artifactId: string;
  readonly title: string;
}): {
  readonly status: "added" | "existing" | "full";
  readonly references: readonly AgentComposerReference[];
} {
  const alreadySelected = input.references.some(
    (reference) =>
      (reference.kind === "asset" || reference.kind === "artifact") &&
      reference.artifactId === input.artifactId,
  );
  if (alreadySelected) {
    return { status: "existing", references: input.references };
  }
  const selectedImageCount = input.references.filter(
    (reference) => reference.kind === "asset" || reference.kind === "artifact",
  ).length;
  if (
    selectedImageCount + input.uploadedAttachmentCount >=
      input.maximumAttachments ||
    input.activeReferenceCount >= input.maximumReferences
  ) {
    return { status: "full", references: input.references };
  }
  return {
    status: "added",
    references: [
      ...input.references,
      {
        kind: "artifact",
        id: `artifact:${input.artifactId}`,
        title: input.title,
        artifactId: input.artifactId,
      },
    ],
  };
}

export function agentComposerBlocksQueueTake(input: {
  readonly message: string;
  readonly attachmentCount: number;
  readonly referenceCount: number;
  readonly hasCanvasEntry: boolean;
  readonly submissionPending: boolean;
}): boolean {
  return (
    input.message.length > 0 ||
    input.attachmentCount > 0 ||
    input.referenceCount > 0 ||
    input.hasCanvasEntry ||
    input.submissionPending
  );
}

export function agentThreadBlocksComposer(
  thread: Partial<Pick<AgentThreadView, "latestRun" | "tasks">> | undefined,
): boolean {
  return (
    threadIsRunning(thread) ||
    thread?.latestRun?.lifecycleStatus === "waiting_approval" ||
    thread?.latestRun?.lifecycleStatus === "waiting_for_user"
  );
}

export function agentThreadFallbackPollInterval(
  thread:
    | (Pick<AgentThreadView, "latestRun"> &
        Partial<Pick<AgentThreadView, "tasks">>)
    | undefined,
  streamConnected = false,
): number | false {
  return !streamConnected &&
    (threadIsRunning(thread) || agentThreadHasPendingTask(thread))
    ? THREAD_FALLBACK_POLL_INTERVAL_MS
    : false;
}

export function agentThreadStreamRetryDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(
    0,
    Math.min(THREAD_STREAM_RETRY_MAXIMUM_EXPONENT, Math.floor(attempt)),
  );
  const base = Math.min(
    THREAD_STREAM_RETRY_INITIAL_MS * 2 ** exponent,
    THREAD_STREAM_RETRY_MAXIMUM_MS,
  );
  return Math.round(
    base *
      (1 +
        Math.max(0, Math.min(1, random())) * THREAD_STREAM_RETRY_JITTER_RATIO),
  );
}

function agentThreadHasPendingTask(
  thread: Partial<Pick<AgentThreadView, "tasks">> | undefined,
): boolean {
  return Boolean(
    thread?.tasks?.some(
      (task) =>
        task.lifecycleStatus === "proposed" ||
        task.lifecycleStatus === "waiting_approval" ||
        task.lifecycleStatus === "unavailable" ||
        task.lifecycleStatus === "running",
    ),
  );
}

export function agentActionAwaitingAutoConfirmation(
  thread: Pick<AgentThreadView, "latestRun" | "tasks"> | undefined,
  attemptedActionIds: ReadonlySet<string>,
): AgentThreadView["tasks"][number] | undefined {
  if (thread?.latestRun?.lifecycleStatus !== "waiting_approval") {
    return undefined;
  }
  return thread.tasks.find(
    (task) =>
      task.lifecycleStatus === "waiting_approval" &&
      task.kind !== "brand" &&
      !attemptedActionIds.has(task.id),
  );
}

export function workspaceDefaultAgentModelReady(
  settings:
    | Pick<WorkspaceAgentModelSettings, "currentDefaultModelId" | "options">
    | undefined,
): boolean {
  return Boolean(
    settings?.currentDefaultModelId &&
    settings.options.some(
      (option) => option.id === settings.currentDefaultModelId && option.ready,
    ),
  );
}

export function agentModelSetupBlocksSend(input: {
  readonly currentAgentIsDefault: boolean;
  readonly settings?: Pick<
    WorkspaceAgentModelSettings,
    "currentDefaultModelId" | "options"
  >;
  readonly settingsError: boolean;
  readonly settingsPending: boolean;
}): boolean {
  return (
    input.currentAgentIsDefault &&
    (input.settingsPending ||
      input.settingsError ||
      !workspaceDefaultAgentModelReady(input.settings))
  );
}

function agentModelIsNotConfigured(error: unknown): boolean {
  return (
    error instanceof ApiProblem && error.code === "agent.model_not_configured"
  );
}

export function agentErrorKey(error: unknown): string {
  if (!(error instanceof ApiProblem)) return "agent.sendError";
  if (error.code === "agent.model_not_configured")
    return "agent.defaultModelSetup.sendBlocked";
  if (error.code === "resource_lifecycle.unavailable")
    return "agent.lifecycle.errors.unavailable";
  if (error.code === "agent.profile_unavailable") return "agent.notReady";
  if (error.code === "agent.retry_requires_task_recovery")
    return "agent.retryRequiresTaskRecovery";
  if (error.code.includes("budget")) return "agent.budgetUnavailable";
  if (error.code === "agent.skill_unavailable")
    return "agent.entrySkillUnavailable";
  if (error.code.startsWith("agent.brand_context"))
    return "agent.entryBrandUnavailable";
  if (error.code === "agent.canvas_context_changed") {
    return "agent.canvasChanged";
  }
  if (error.code.includes("canvas_context")) {
    return "agent.canvasEntryUnavailable";
  }
  return "agent.sendError";
}

function agentRunIsAlreadyActive(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === "agent.run_active";
}

function agentMessageDeliveryIsUncertain(error: unknown): boolean {
  return (
    !(error instanceof ApiProblem) ||
    error.status >= httpStatus.internalServerError ||
    error.status === requestTimeoutHttpStatus
  );
}

function agentQueueDisplayPauseReason(input: {
  readonly durable: boolean;
  readonly locksAvailable: boolean;
  readonly liveReason?: AgentMessageQueuePauseReason;
  readonly storedReason?: AgentMessageQueuePauseReason;
}): AgentQueuePauseReason | undefined {
  if (!input.durable) return "storage_unavailable";
  if (!input.locksAvailable) return "queue_unavailable";
  if (
    input.storedReason === "waiting_approval" ||
    input.storedReason === "waiting_for_user"
  ) {
    return input.liveReason ?? "manual";
  }
  return input.storedReason;
}

export async function synchronizeAcceptedAgentMessage(
  refreshThreads: () => Promise<unknown>,
  refreshThread: () => Promise<unknown>,
): Promise<void> {
  await Promise.allSettled([refreshThreads(), refreshThread()]);
}

export function fetchFreshAcceptedAgentThread(
  client: QueryClient,
  workspaceId: string,
  threadId: string,
  load: (
    workspaceId: string,
    threadId: string,
    fetcher?: typeof fetch,
    locale?: string,
  ) => Promise<AgentThreadView> = fetchAgentThread,
  locale?: string,
): Promise<AgentThreadView> {
  return client.fetchQuery({
    queryKey: ["agent-thread", workspaceId, threadId],
    queryFn: () => load(workspaceId, threadId, undefined, locale),
    staleTime: 0,
  });
}

export function agentThreadIsMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  return (
    error.status === httpStatus.badRequest ||
    error.status === httpStatus.notFound
  );
}

export function agentThreadCanRetainCachedView(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error))
    return true;
  return (
    typeof error.status === "number" &&
    error.status >= httpStatus.internalServerError
  );
}

function useAgentMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

let agentDocumentVisibleSince = 0;
let agentDocumentHiddenRevision = 0;

function agentDocumentVisibilitySnapshot(): string {
  if (typeof document === "undefined") return "hidden:0";
  return document.visibilityState === "visible"
    ? `visible:${String(agentDocumentVisibleSince)}`
    : `hidden:${String(agentDocumentHiddenRevision)}`;
}

function useDocumentVisibility(): {
  readonly visible: boolean;
  readonly visibleSince: number;
} {
  const snapshot = useSyncExternalStore(
    (onStoreChange) => {
      const handleVisibilityChange = (): void => {
        if (document.visibilityState === "visible") {
          agentDocumentVisibleSince = Date.now();
        } else {
          agentDocumentHiddenRevision += 1;
        }
        onStoreChange();
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      };
    },
    agentDocumentVisibilitySnapshot,
    () => "hidden:0",
  );
  const [visibility, visibleSince] = snapshot.split(":");
  return {
    visible: visibility === "visible",
    visibleSince:
      visibility === "visible"
        ? Number(visibleSince ?? "0")
        : Number.POSITIVE_INFINITY,
  };
}

function AgentLinkEntry({
  workspaceId,
  search,
}: {
  readonly workspaceId: string;
  readonly search: AgentCanvasSearch;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [draftId] = useState(() => crypto.randomUUID());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void Promise.resolve()
      .then(async () => {
        const prepared = prepareAgentEntryDraft(search, draftId);
        if (!prepared)
          throw new Error("Agent entry Draft is already prepared.");
        // Park text before authentication so login and OAuth keep a short return URL.
        // A fresh draft also isolates attachments and references from previous work.
        if (prepared.initialPrompt !== undefined) {
          sessionStorage.setItem(
            composerDraftStorageKey(workspaceId, undefined, draftId),
            prepared.initialPrompt,
          );
        }
        await navigate({
          to: "/w/$workspaceId/agent",
          params: { workspaceId },
          search: prepared.search,
          replace: true,
        });
      })
      .catch(() => setFailed(true));
  }, [navigate, workspaceId, search, draftId]);
  return failed ? (
    <PageEmptyState
      title={t("agent.linkPrepareFailed")}
      action={() => window.location.reload()}
      actionLabel={t("agent.retry")}
    >
      {null}
    </PageEmptyState>
  ) : (
    <PageLoading label={t("common.opening.agent")} />
  );
}

export function AgentPage(): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams({ strict: false });
  const searchValue: unknown = useSearch({ strict: false });
  const search = agentCanvasSearch(searchValue);
  const workspaceId = params.workspaceId;
  if (!workspaceId) {
    throw new Error("Agent route requires a Workspace.");
  }

  if (!params.threadId && agentEntryNeedsFreshDraft(search)) {
    return <AgentLinkEntry workspaceId={workspaceId} search={search} />;
  }

  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) =>
        workspace.permissions.includes("agent.run") ? (
          <AgentWorkspace
            invalidAgentSelection={search.invalidAgentSelection === true}
            invalidInitialPrompt={search.invalidInitialPrompt === true}
            context={context}
            workspace={workspace}
            key={`${context.human.principalId}:${workspace.id}:${params.threadId ?? search.draftId ?? search.agentDefinitionId ?? "new"}:${search.brandKitRevisionId ?? ""}:${search.skillRevisionId ?? ""}`}
            {...(search.draftId ? { draftId: search.draftId } : {})}
            {...(search.brandKitRevisionId
              ? {
                  brandKitId: search.brandKitId,
                  brandKitRevisionId: search.brandKitRevisionId,
                }
              : {})}
            {...(search.agentDefinitionId
              ? { agentDefinitionId: search.agentDefinitionId }
              : {})}
            {...(search.skillCandidateId && search.skillCandidateDigest
              ? {
                  skillCandidateId: search.skillCandidateId,
                  skillCandidateDigest: search.skillCandidateDigest,
                  skillTestRequest:
                    search.skillTestRequest ?? search.initialPrompt ?? "",
                  ...(search.returnTo
                    ? { skillTestReturnTo: search.returnTo }
                    : {}),
                }
              : {})}
            {...(search.skillRevisionId
              ? { skillRevisionId: search.skillRevisionId }
              : {})}
            {...(search.initialPrompt
              ? { initialPrompt: search.initialPrompt }
              : {})}
            canReadCanvas={workspace.permissions.includes("canvas.read")}
            canReadWorkflow={workspace.permissions.includes("workflow.read")}
            canRunWorkflow={workspace.permissions.includes("workflow.run")}
            csrfToken={context.csrfToken}
            permissions={workspace.permissions}
            {...(params.threadId ? { threadId: params.threadId } : {})}
            {...(search.canvasDraftId && search.canvasDraftVersion
              ? {
                  canvasEntry: {
                    canvasDraftId: search.canvasDraftId,
                    canvasDraftVersion: search.canvasDraftVersion,
                    selectedElementKeys: search.selectedElementKeys ?? [],
                    ...(search.pageKey ? { pageKey: search.pageKey } : {}),
                    ...(search.returnTo ? { returnTo: search.returnTo } : {}),
                  },
                }
              : {})}
            workspaceId={workspaceId}
          />
        ) : (
          <AppShell
            context={context}
            workspace={workspace}
            pageTitle={t("agent.documentTitle")}
          >
            <PageEmptyState title={t("agent.notReady")}>{null}</PageEmptyState>
          </AppShell>
        )
      }
    </WorkspaceBoundary>
  );
}

function AgentWorkspace({
  invalidAgentSelection = false,
  invalidInitialPrompt = false,
  context,
  workspace,
  brandKitId,
  brandKitRevisionId,
  draftId,
  agentDefinitionId: entryAgentDefinitionId,
  skillCandidateId,
  skillRevisionId: entrySkillRevisionId,
  skillCandidateDigest,
  skillTestRequest,
  skillTestReturnTo,
  initialPrompt,
  canReadCanvas,
  canReadWorkflow,
  canRunWorkflow,
  csrfToken,
  canvasEntry,
  permissions,
  threadId,
  workspaceId,
}: {
  readonly invalidAgentSelection?: boolean;
  readonly invalidInitialPrompt?: boolean;
  readonly context: CurrentHumanContext;
  readonly workspace: CurrentHumanContext["workspaces"][number];
  readonly brandKitId?: string;
  readonly brandKitRevisionId?: string;
  readonly draftId?: string;
  readonly agentDefinitionId?: string;
  readonly skillCandidateId?: string;
  readonly skillRevisionId?: string;
  readonly skillCandidateDigest?: string;
  readonly skillTestRequest?: string;
  readonly skillTestReturnTo?: string;
  readonly initialPrompt?: string;
  readonly canReadCanvas: boolean;
  readonly canReadWorkflow: boolean;
  readonly canRunWorkflow: boolean;
  readonly csrfToken: string;
  readonly permissions: readonly string[];
  readonly canvasEntry?: {
    readonly canvasDraftId: string;
    readonly canvasDraftVersion: number;
    readonly pageKey?: string;
    readonly selectedElementKeys: readonly string[];
    readonly returnTo?: string;
  };
  readonly threadId?: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const agentLocale = i18n.resolvedLanguage ?? i18n.language;
  const navigate = useNavigate();
  const [promptRejected, setPromptRejected] = useState(invalidInitialPrompt);
  const composerDraftKey = composerDraftStorageKey(
    workspaceId,
    threadId,
    draftId ?? entryAgentDefinitionId,
  );
  const messageQueueScope = useMemo(
    () =>
      threadId
        ? {
            principalId: context.human.principalId,
            workspaceId,
            threadId,
          }
        : undefined,
    [context.human.principalId, threadId, workspaceId],
  );
  const pendingMessageQueue = useAgentMessageQueue(messageQueueScope);
  const [restoredCanvasEntry, setRestoredCanvasEntry] = useState<
    AgentComposerCanvasEntry | undefined
  >(() =>
    readRetrievedCanvasEntry(
      composerDraftKey,
      new Set(pendingMessageQueue.state.items.map((item) => item.id)),
    ),
  );
  const effectiveCanvasEntry = useMemo<AgentComposerCanvasEntry | undefined>(
    () =>
      canvasEntry
        ? {
            originSurface: "canvas",
            ...canvasEntry,
            selectedElementKeys: [...canvasEntry.selectedElementKeys],
          }
        : restoredCanvasEntry,
    [canvasEntry, restoredCanvasEntry],
  );
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [queueDeliveryOwnerId] = useState(
    () => `agent-message-queue:${crypto.randomUUID()}`,
  );
  const queueDeliveryInProgressRef = useRef(false);
  const queueDeliveryRetryTimerRef = useRef<number | undefined>(undefined);
  const [queueDeliveryAttempt, setQueueDeliveryAttempt] = useState(0);
  const [storedContext] = useState(() =>
    readAgentDraftContext(composerDraftKey),
  );
  const [agentDefinitionId, setAgentDefinitionId] = useState(
    storedContext.agentDefinitionId ?? entryAgentDefinitionId,
  );
  const [agentDetailsOpen, setAgentDetailsOpen] = useState(false);
  const [diagnosticRunId, setDiagnosticRunId] = useState<string>();
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const skillRevisionId = entrySkillRevisionId;
  const desktopLayout = useAgentMediaQuery(desktopAgentMediaQuery);
  const documentVisibility = useDocumentVisibility();
  const documentVisible = documentVisibility.visible;
  const wideInspector = useAgentMediaQuery(wideInspectorMediaQuery);
  const [workbenchWidth, setWorkbenchWidth] = useState(workbenchDefaultWidth);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const canvasResultRequestsRef = useRef(
    new Map<string, { idempotencyKey: string; body: CreateCanvasDraftBody }>(),
  );
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  function closeWorkbench(): void {
    setWorkbenchOpen(false);
  }
  const [openedEntries, setOpenedEntries] = useState<AgentWorkbenchEntry[]>([]);
  const [activeEntryKey, setActiveEntryKey] = useState<string>();
  const [editingResource, setEditingResource] =
    useState<AgentWorkbenchResource>();
  const [messageErrorKey, setMessageErrorKey] = useState<string>();
  const [takingPendingMessageId, setTakingPendingMessageId] =
    useState<string>();
  const takingPendingMessageRef = useRef(false);
  const [candidateTestStatus, setCandidateTestStatus] =
    useState<CandidateTestStatus>();
  const candidateTestRunRef = useRef<string | undefined>(undefined);
  const branchActionPendingRef = useRef(false);
  const [branchActionPending, setBranchActionPending] = useState(false);
  const [stoppingRunId, setStoppingRunId] = useState<string>();
  const [confirmingActionId, setConfirmingActionId] = useState<string>();
  const autoConfirmedActionIdsRef = useRef(new Set<string>());
  const [failedAutoConfirmationId, setFailedAutoConfirmationId] =
    useState<string>();
  const [decliningActionId, setDecliningActionId] = useState<string>();
  const [resolvingInteractionId, setResolvingInteractionId] =
    useState<string>();
  const [composerReferences, setComposerReferences] = useState<
    readonly AgentComposerReference[]
  >(storedContext.references);
  const [brandCleared, setBrandCleared] = useState(
    storedContext.brandCleared === true,
  );
  const [entrySkillRemoved, setEntrySkillRemoved] = useState(
    storedContext.entrySkillRevisionId === entrySkillRevisionId &&
      (storedContext.entrySkillRemoved ?? false),
  );
  const entrySkills = useQuery({
    queryKey: ["agent-hub-skills", workspaceId],
    queryFn: () => fetchAgentHubSkills(workspaceId),
    enabled:
      Boolean(skillRevisionId) &&
      !entrySkillRemoved &&
      permissions.includes("skill.read"),
    retry: false,
  });
  const entrySkill = entrySkills.data?.items.find(
    (skill) => skill.skillRevisionId === skillRevisionId,
  );
  const [entryBrandRemoved, setEntryBrandRemoved] = useState(
    storedContext.entryBrandRevisionId === brandKitRevisionId &&
      (storedContext.entryBrandRemoved ?? false),
  );
  const entryBrand = useQuery({
    queryKey: [
      "brand-kit-revision",
      workspaceId,
      brandKitId,
      brandKitRevisionId,
    ],
    queryFn: () =>
      fetchBrandKitRevision(workspaceId, brandKitId!, brandKitRevisionId!),
    enabled: Boolean(brandKitRevisionId) && permissions.includes("brand.read"),
    retry: false,
  });
  const [threadStreamConnected, setThreadStreamConnected] = useState(false);
  const thread = useQuery({
    structuralSharing: shareAgentThreadSnapshot,
    queryKey: ["agent-thread", workspaceId, threadId],
    queryFn: () =>
      fetchAgentThread(workspaceId, threadId!, undefined, agentLocale),
    enabled: Boolean(threadId),
    refetchInterval: (query) =>
      agentThreadFallbackPollInterval(query.state.data, threadStreamConnected),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const threadFreshForVisibility =
    documentVisible && thread.dataUpdatedAt >= documentVisibility.visibleSince;
  useEffect(() => {
    if (
      !threadId ||
      !documentVisible ||
      threadFreshForVisibility ||
      thread.isFetching
    ) {
      return;
    }
    void thread.refetch();
  }, [documentVisible, thread, threadFreshForVisibility, threadId]);
  const previousAgentLocaleRef = useRef(agentLocale);
  useEffect(() => {
    if (previousAgentLocaleRef.current === agentLocale) return;
    previousAgentLocaleRef.current = agentLocale;
    if (!threadId) return;
    void queryClient.invalidateQueries({
      queryKey: ["agent-thread", workspaceId, threadId],
    });
  }, [agentLocale, threadId, workspaceId]);
  const activeThread = thread.data;
  const threadReadInterrupted =
    thread.isError &&
    Boolean(activeThread) &&
    agentThreadCanRetainCachedView(thread.error);
  const retryThreadRead = () => void thread.refetch();
  const entryBrandRequired = Boolean(brandKitRevisionId) && !entryBrandRemoved;
  const entryBrandBlocked = entryBrandRequired && !entryBrand.data;
  const inheritedBrand =
    !brandCleared && activeThread?.brandContext
      ? activeThread.brandContext
      : undefined;
  const effectiveBrand =
    entryBrandRequired && entryBrand.data
      ? {
          brandKitId: entryBrand.data.brandKitId,
          brandKitRevisionId: entryBrand.data.id,
          name: entryBrand.data.name,
        }
      : inheritedBrand;
  const brandComposerReferences: readonly AgentComposerReference[] =
    effectiveBrand &&
    !composerReferences.some((reference) => reference.kind === "brand")
      ? [
          {
            kind: "brand",
            id: `brand:${effectiveBrand.brandKitId}`,
            title: effectiveBrand.name,
            brandKitId: effectiveBrand.brandKitId,
            brandKitRevisionId: effectiveBrand.brandKitRevisionId,
          },
          ...composerReferences,
        ]
      : composerReferences;
  const activeComposerReferences: readonly AgentComposerReference[] =
    skillRevisionId &&
    !entrySkillRemoved &&
    !composerReferences.some((item) => item.kind === "skill")
      ? [
          {
            kind: "skill",
            id: `skill:${skillRevisionId}`,
            title: entrySkill?.displayName ?? t("agent.selectedSkill"),
            skillRevisionId,
          },
          ...brandComposerReferences,
        ]
      : brandComposerReferences;
  const [referencePickerKind, setReferencePickerKind] =
    useState<AgentComposerReferenceKind>();
  useEffect(() => {
    persistAgentDraftContext(composerDraftKey, {
      references: composerReferences,
      ...(entrySkillRevisionId ? { entrySkillRevisionId } : {}),
      ...(brandKitRevisionId
        ? { entryBrandRevisionId: brandKitRevisionId }
        : {}),
      ...(agentDefinitionId ? { agentDefinitionId } : {}),
      entrySkillRemoved,
      entryBrandRemoved,
      brandCleared,
    });
  }, [
    composerDraftKey,
    entrySkillRevisionId,
    brandKitRevisionId,
    composerReferences,
    agentDefinitionId,
    entrySkillRemoved,
    entryBrandRemoved,
    brandCleared,
  ]);
  const [composerDrafts, setComposerDrafts] = useState<
    Readonly<Record<string, string>>
  >({});
  const composerValue = Object.hasOwn(composerDrafts, composerDraftKey)
    ? (composerDrafts[composerDraftKey] ?? "")
    : (readComposerDraft(composerDraftKey) ??
      (!threadId || skillRevisionId ? (initialPrompt ?? "") : ""));
  const composerValueRef = useRef(composerValue);
  const pendingSubmissionRef = useRef<
    AgentComposerSubmissionAttempt | undefined
  >(undefined);
  const workspaceMountedRef = useRef(true);
  useEffect(() => {
    workspaceMountedRef.current = true;
    return () => {
      workspaceMountedRef.current = false;
      if (queueDeliveryRetryTimerRef.current !== undefined) {
        window.clearTimeout(queueDeliveryRetryTimerRef.current);
        queueDeliveryRetryTimerRef.current = undefined;
      }
    };
  }, []);
  const agentAttachments = useAgentComposerAttachments({
    csrfToken,
    draftKey: composerDraftKey,
    workspaceId,
    onError: () => setMessageErrorKey("agent.attachmentError"),
  });
  const conversationReady = !threadId || !thread.isPending;
  const focusOverlayOpenRef = useRef(false);
  useEffect(() => {
    focusOverlayOpenRef.current =
      agentDetailsOpen ||
      agentPickerOpen ||
      Boolean(referencePickerKind) ||
      Boolean(editingResource);
  }, [agentDetailsOpen, agentPickerOpen, referencePickerKind, editingResource]);
  useEffect(() => {
    if (
      !agentComposerShouldAutoFocusOnEntry({
        finePointer: window.matchMedia("(pointer: fine)").matches,
        ready: conversationReady && !entryBrandBlocked,
        overlayOpen: focusOverlayOpenRef.current,
      })
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() =>
      focusAgentComposer(composerInputRef.current, { moveCaretToEnd: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [conversationReady, entryBrandBlocked, threadId]);
  const agentCatalog = useQuery({
    queryKey: ["agent-hub-agents", workspaceId],
    queryFn: () => fetchAgentHubAgents(workspaceId),
    retry: false,
  });
  const missingThread = Boolean(
    threadId && thread.isError && agentThreadIsMissing(thread.error),
  );
  useEffect(() => {
    if (!missingThread) return;
    void navigate({
      params: { workspaceId },
      to: "/w/$workspaceId/agent",
      replace: true,
    });
  }, [missingThread, navigate, workspaceId]);
  const pendingCanvas = useQuery({
    queryKey: [
      "agent-entry-canvas",
      workspaceId,
      effectiveCanvasEntry?.canvasDraftId,
    ],
    queryFn: () =>
      fetchCanvasDraft(workspaceId, effectiveCanvasEntry!.canvasDraftId),
    enabled: canReadCanvas && Boolean(effectiveCanvasEntry),
    retry: false,
  });
  const selectedAgent = agentDefinitionId
    ? agentCatalog.data?.items.find((agent) => agent.id === agentDefinitionId)
    : agentCatalog.data?.items.find((agent) => agent.isDefault);
  const activeAgent = activeThread?.agent;
  const agentLinkId = activeAgent?.id ?? selectedAgent?.id ?? agentDefinitionId;
  const agentSummarySource = agentCatalog.data?.items.find(
    (agent) => agent.id === agentLinkId,
  );
  const currentAgentIsDefault = threadId
    ? Boolean(activeAgent && agentSummarySource?.isDefault)
    : selectedAgent?.isDefault === true;
  const defaultAgentModelSettings = useQuery({
    queryKey: workspaceQueryKeys.agentModelSettings(workspaceId),
    queryFn: () => fetchWorkspaceAgentModelSettings({ csrfToken, workspaceId }),
    enabled: currentAgentIsDefault,
    refetchInterval: (query) =>
      query.state.status === "success" &&
      !workspaceDefaultAgentModelReady(query.state.data)
        ? DEFAULT_AGENT_MODEL_REFETCH_INTERVAL_MS
        : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const defaultAgentModelReady =
    currentAgentIsDefault &&
    workspaceDefaultAgentModelReady(defaultAgentModelSettings.data);
  const defaultAgentModelQueryBlocked = agentModelSetupBlocksSend({
    currentAgentIsDefault,
    ...(defaultAgentModelSettings.data
      ? { settings: defaultAgentModelSettings.data }
      : {}),
    settingsError: defaultAgentModelSettings.isError,
    settingsPending: defaultAgentModelSettings.isPending,
  });
  const defaultAgentModelBlocked =
    defaultAgentModelQueryBlocked ||
    (currentAgentIsDefault &&
      !defaultAgentModelReady &&
      messageErrorKey === "agent.defaultModelSetup.sendBlocked");
  const defaultAgentModelNeedsConfiguration =
    currentAgentIsDefault &&
    defaultAgentModelSettings.isSuccess &&
    !defaultAgentModelReady;
  const canConfigureDefaultAgentModel =
    permissions.includes("workspace.manage") &&
    permissions.includes("credential.manage");
  const agentSummary = agentSummarySource
    ? agentDisplaySummary(
        agentSummarySource,
        t("agent.hub.defaultAgentSummary"),
      )
    : undefined;
  const lifecycle = useResourceStates(workspaceId, "agent");
  const agentResource = lifecycle.data?.items.find(
    (item) => item.id === agentLinkId,
  );
  const agentState = agentResource?.state;
  const agentName =
    activeAgent?.displayName ??
    selectedAgent?.displayName ??
    agentResource?.displayName;
  const availableAgents = (agentCatalog.data?.items ?? [])
    .filter((agent) => agent.resourceState === "enabled")
    .toSorted((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const draftAgentUnavailable =
    !threadId &&
    agentCatalog.isSuccess &&
    (agentDefinitionId
      ? !availableAgents.some((agent) => agent.id === agentDefinitionId)
      : invalidAgentSelection || !selectedAgent);
  const workspaceAgentUnconfigured =
    !threadId &&
    !agentDefinitionId &&
    !invalidAgentSelection &&
    agentCatalog.isSuccess &&
    agentCatalog.data.items.length === 0;
  let draftAgentNoticeKey = "agent.agentUnavailable";
  if (workspaceAgentUnconfigured) {
    draftAgentNoticeKey = "agent.workspaceAgentUnconfigured";
  } else if (agentCatalog.isError) {
    draftAgentNoticeKey = "agent.agentLoadError";
  }
  const draftAgentBlocked =
    !threadId &&
    (permissions.includes("agent.read") ||
      Boolean(agentDefinitionId) ||
      invalidAgentSelection) &&
    (agentCatalog.isPending || agentCatalog.isError || draftAgentUnavailable);
  let draftAgentName = agentName ?? t("agent.defaultName");
  if (invalidAgentSelection && !agentDefinitionId) {
    draftAgentName = t("agent.navigation.chooseAgent");
  } else if (selectedAgent?.isDefault) {
    draftAgentName = t("agent.defaultName");
  } else if (!agentName && agentDefinitionId) {
    draftAgentName = t("agent.navigation.chooseAgent");
  }
  const retainedAgentDetail = useQuery({
    queryKey: [
      "conversation-catalog",
      workspaceId,
      "agents",
      agentLinkId,
      threadId,
    ],
    queryFn: () =>
      fetchAgentHubAgent(workspaceId, agentLinkId!, fetch, threadId),
    enabled:
      agentState === "deleted" &&
      Boolean(agentLinkId) &&
      permissions.includes("agent.read"),
    retry: false,
  });
  const agentAvatar =
    agentCatalog.data?.items.find((agent) => agent.id === agentLinkId)
      ?.avatar ?? retainedAgentDetail.data?.avatar;
  useEffect(() => {
    if (
      !skillCandidateId ||
      !skillCandidateDigest ||
      !skillTestRequest ||
      !threadId ||
      activeThread?.latestRun?.lifecycleStatus !== "succeeded" ||
      agentThreadHasPendingTask(activeThread) ||
      candidateTestRunRef.current === activeThread.latestRun.id
    ) {
      return;
    }
    const artifactId = activeThread.tasks
      .flatMap((task) => task.resultArtifacts ?? [])
      .find(
        (artifact) =>
          artifact.kind === "image" && artifact.state === "available",
      )?.resourceId;
    candidateTestRunRef.current = activeThread.latestRun.id;
    queueMicrotask(() => setCandidateTestStatus("recording"));
    void recordSkillCandidateTest(
      { csrfToken, workspaceId },
      skillCandidateId,
      {
        expectedCandidateDigest: skillCandidateDigest,
        threadId,
        runId: activeThread.latestRun.id,
        ...(artifactId ? { artifactId } : {}),
        testRequest: skillTestRequest,
      },
      `skill-candidate-test:${crypto.randomUUID()}`,
    )
      .then(() => {
        setCandidateTestStatus("passed");
        return queryClient.invalidateQueries({
          queryKey: ["skill-drafts", workspaceId],
        });
      })
      .catch(() => setCandidateTestStatus("failed"));
  }, [
    activeThread,
    csrfToken,
    skillCandidateDigest,
    skillCandidateId,
    skillTestRequest,
    threadId,
    workspaceId,
  ]);
  useEffect(() => {
    if (
      !activeThread ||
      activeThread.actionConfirmationRequired ||
      confirmingActionId
    ) {
      return;
    }
    const action = agentActionAwaitingAutoConfirmation(
      activeThread,
      autoConfirmedActionIdsRef.current,
    );
    if (!action) return;
    autoConfirmedActionIdsRef.current.add(action.id);
    setConfirmingActionId(action.id);
    void confirmAgentAction(
      { csrfToken, workspaceId },
      action.id,
      `agent-action:${crypto.randomUUID()}`,
    )
      .then(() =>
        Promise.allSettled([
          queryClient.invalidateQueries({
            queryKey: ["agent-thread", workspaceId, threadId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["agent-threads", workspaceId],
          }),
        ]),
      )
      .catch(() => {
        setFailedAutoConfirmationId(action.id);
        setMessageErrorKey("agent.autoStartFailed");
      })
      .finally(() => setConfirmingActionId(undefined));
  }, [activeThread, confirmingActionId, csrfToken, threadId, workspaceId]);
  const messages = activeThread?.messages ?? emptyAgentMessages;
  const tasks = activeThread?.tasks ?? emptyAgentTasks;
  const reusableFailedRequest = reusableFailedAgentRequest(activeThread);
  const browserCapabilitySignature = agentBrowserCapabilitySignature(tasks);
  const browserCapabilityKeys = useMemo<readonly string[]>(
    () => JSON.parse(browserCapabilitySignature) as string[],
    [browserCapabilitySignature],
  );
  const [browserRestartKey, setBrowserRestartKey] = useState(0);
  const reconnectBrowserTasks = () =>
    setBrowserRestartKey((current) => current + 1);
  const browserTasksRequired = browserCapabilityKeys.length > 0;
  const browserTasksAllowed =
    permissions.includes("capability.run") ||
    permissions.includes("workflow.run");
  const browserTaskRuntimeState = useBrowserRuntimes({
    csrfToken,
    enabled: browserTasksRequired && browserTasksAllowed,
    requiredCapabilityKeys: browserCapabilityKeys,
    restartKey: browserRestartKey,
    workspaceId,
  });
  const failedAutoConfirmationTask = tasks.find(
    (task) => task.id === failedAutoConfirmationId,
  );
  const currentMessageErrorKey =
    messageErrorKey === "agent.defaultModelSetup.sendBlocked" &&
    (!currentAgentIsDefault || defaultAgentModelReady)
      ? undefined
      : messageErrorKey;
  const visibleMessageErrorKey =
    currentMessageErrorKey === "agent.autoStartFailed" &&
    failedAutoConfirmationTask &&
    failedAutoConfirmationTask.lifecycleStatus !== "waiting_approval"
      ? undefined
      : currentMessageErrorKey;
  const relatedContent =
    activeThread?.relatedContent ?? emptyAgentRelatedContent;
  const isRunning = threadIsRunning(activeThread);
  const threadBlocksComposer = agentThreadBlocksComposer(activeThread);
  const queuedMessageCount = pendingMessageQueue.state.items.length;
  const acceptedQueuedRunId = pendingMessageQueue.state.accepted?.runId;
  const acceptedQueuedAt = pendingMessageQueue.state.accepted?.acceptedAt;
  const acceptedBarrierRefreshAfter = acceptedQueuedAt
    ? Date.parse(acceptedQueuedAt)
    : Number.POSITIVE_INFINITY;
  const threadFreshForAcceptedBarrier =
    thread.dataUpdatedAt >= acceptedBarrierRefreshAfter;
  const nextQueuedMessage = pendingMessageQueue.nextForDelivery;
  const acceptedQueuedRun = useQuery({
    queryKey: ["agent-run", workspaceId, acceptedQueuedRunId],
    queryFn: () => fetchAgentRun(workspaceId, acceptedQueuedRunId!),
    enabled:
      Boolean(acceptedQueuedRunId) &&
      threadFreshForVisibility &&
      threadFreshForAcceptedBarrier &&
      activeThread?.latestRun?.id !== acceptedQueuedRunId,
    retry: false,
  });
  const pendingMessageViews = useMemo<readonly AgentPendingMessageView[]>(
    () =>
      pendingMessageQueue.state.items.map((item) => ({
        id: item.id,
        text: item.request.message,
        status: item.status,
        attachmentCount: item.request.attachments?.length ?? 0,
        referenceCount:
          (item.request.references?.length ?? 0) +
          (item.request.libraryIds?.length ?? 0) +
          (item.request.brandContext ? 1 : 0) +
          (item.request.skillRevisionId ? 1 : 0) +
          (item.request.entryContext ? 1 : 0),
        editable:
          item.status === "queued" &&
          pendingMessageQueue.durable &&
          pendingMessageQueue.locksAvailable,
      })),
    [
      pendingMessageQueue.durable,
      pendingMessageQueue.locksAvailable,
      pendingMessageQueue.state.items,
    ],
  );
  const livePauseReason = agentMessageQueuePauseReason(
    activeThread,
    pendingMessageQueue.state.resumedAfterRunId,
  );
  const queuePauseReason = agentQueueDisplayPauseReason({
    durable: pendingMessageQueue.durable,
    locksAvailable: pendingMessageQueue.locksAvailable,
    ...(livePauseReason ? { liveReason: livePauseReason } : {}),
    ...(pendingMessageQueue.state.pauseReason
      ? { storedReason: pendingMessageQueue.state.pauseReason }
      : {}),
  });
  const queuePaused =
    pendingMessageQueue.state.paused ||
    !pendingMessageQueue.locksAvailable ||
    !pendingMessageQueue.durable;
  const currentQueueThreadSnapshotMatches = useCallback(
    (expectedRunId?: string, expectedRunStatus?: string): boolean => {
      const current = queryClient.getQueryState<AgentThreadView>([
        "agent-thread",
        workspaceId,
        threadId,
      ]);
      return agentMessageQueueSnapshotIsCurrent({
        visible: document.visibilityState === "visible",
        mounted: workspaceMountedRef.current,
        dataUpdatedAt: current?.dataUpdatedAt ?? 0,
        visibleSince: documentVisibility.visibleSince,
        ...(current?.data?.latestRun?.id
          ? { currentRunId: current.data.latestRun.id }
          : {}),
        ...(current?.data?.latestRun?.lifecycleStatus
          ? { currentRunStatus: current.data.latestRun.lifecycleStatus }
          : {}),
        ...(expectedRunId ? { expectedRunId } : {}),
        ...(expectedRunStatus ? { expectedRunStatus } : {}),
      });
    },
    [documentVisibility.visibleSince, threadId, workspaceId],
  );
  useEffect(() => {
    const run = activeThread?.latestRun;
    if (
      queuedMessageCount === 0 ||
      !run ||
      !threadFreshForVisibility ||
      threadReadInterrupted ||
      pendingMessageQueue.state.paused
    ) {
      return;
    }
    const reason = agentMessageQueuePauseReason(
      activeThread,
      pendingMessageQueue.state.resumedAfterRunId,
    );
    if (reason) {
      void pendingMessageQueue.pause(reason, () =>
        currentQueueThreadSnapshotMatches(run.id, run.lifecycleStatus),
      );
    }
  }, [
    activeThread,
    currentQueueThreadSnapshotMatches,
    pendingMessageQueue,
    queuedMessageCount,
    threadFreshForVisibility,
    threadReadInterrupted,
  ]);
  useEffect(() => {
    const run = activeThread?.latestRun;
    const barrierAction = acceptedAgentMessageQueueBarrierAction({
      ...(acceptedQueuedRunId ? { acceptedRunId: acceptedQueuedRunId } : {}),
      ...(run?.id ? { latestRunId: run.id } : {}),
      ...(acceptedQueuedRun.data?.runId
        ? { resolvedRunId: acceptedQueuedRun.data.runId }
        : {}),
      ...(acceptedQueuedRun.data?.threadId
        ? { resolvedThreadId: acceptedQueuedRun.data.threadId }
        : {}),
      ...(threadId ? { threadId } : {}),
      pendingCount: queuedMessageCount,
    });
    if (
      !acceptedQueuedRunId ||
      !run ||
      !threadFreshForVisibility ||
      !threadFreshForAcceptedBarrier ||
      threadReadInterrupted ||
      barrierAction === "wait"
    ) {
      return;
    }
    void (async () => {
      const guard = (): boolean =>
        currentQueueThreadSnapshotMatches(run.id, run.lifecycleStatus);
      if (barrierAction === "pause_and_settle") {
        const paused = await pendingMessageQueue.pause("branch_changed", guard);
        if (!paused.persisted || !guard()) return;
      }
      await pendingMessageQueue.settleAccepted(acceptedQueuedRunId, guard);
    })();
  }, [
    acceptedQueuedRunId,
    acceptedQueuedRun.data,
    activeThread,
    currentQueueThreadSnapshotMatches,
    pendingMessageQueue,
    queuedMessageCount,
    threadFreshForVisibility,
    threadFreshForAcceptedBarrier,
    threadId,
    threadReadInterrupted,
  ]);
  const visibleRegeneratingMessageId = isRunning
    ? activeThread?.latestRun?.replacesMessageId
    : undefined;
  const contextEntries = useMemo(
    () => [
      ...relatedContent.map(agentWorkbenchResourceEntry),
      ...tasks.map(agentWorkbenchTaskEntry),
    ],
    [relatedContent, tasks],
  );
  const currentOpenedEntries = useMemo(
    () => currentAgentWorkbenchEntries(openedEntries, contextEntries),
    [contextEntries, openedEntries],
  );
  const activeOpenedEntry = currentOpenedEntries.find(
    (entry) => agentWorkbenchEntryKey(entry) === activeEntryKey,
  );
  const activeOpenedResource =
    activeOpenedEntry?.entryKind === "resource"
      ? activeOpenedEntry.resource
      : undefined;
  const composerReferenceKinds = useMemo(() => {
    const kinds: AgentComposerReferenceKind[] = [];
    if (permissions.includes("asset.read")) kinds.push("asset");
    if (permissions.includes("canvas.read")) kinds.push("canvas");
    if (permissions.includes("workflow.read")) kinds.push("workflow");
    if (permissions.includes("brand.read")) kinds.push("brand");
    if (permissions.includes("library.read")) kinds.push("library");
    if (permissions.includes("skill.read") && permissions.includes("skill.use"))
      kinds.push("skill");
    return kinds;
  }, [permissions]);

  const activeStreamRunId = activeThread?.latestRun?.id;
  useEffect(() => {
    if (!threadId || !isRunning || !activeStreamRunId) return;
    let stopped = false;
    let retryAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveReconnect: (() => void) | undefined;
    let activeController: AbortController | undefined;
    const waitToReconnect = (): Promise<void> =>
      new Promise((resolve) => {
        resolveReconnect = resolve;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          resolveReconnect = undefined;
          resolve();
        }, agentThreadStreamRetryDelay(retryAttempt++));
      });
    const connect = async (): Promise<void> => {
      while (!stopped) {
        activeController = new AbortController();
        let receivedTerminalRun = false;
        try {
          await streamAgentThread(
            workspaceId,
            threadId,
            (nextThread) => {
              if (stopped) return;
              const cached = queryClient.getQueryData<AgentThreadView>([
                "agent-thread",
                workspaceId,
                threadId,
              ]);
              if (mergeAgentThreadSnapshot(cached, nextThread) !== nextThread)
                return;
              retryAttempt = 0;
              receivedTerminalRun = !threadIsRunning(nextThread);
              setThreadStreamConnected(!receivedTerminalRun);
              queryClient.setQueryData(
                ["agent-thread", workspaceId, threadId],
                nextThread,
              );
            },
            activeController.signal,
            undefined,
            agentLocale,
          );
        } catch (error) {
          if (
            stopped ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            return;
          }
          void queryClient.invalidateQueries({
            queryKey: ["agent-thread", workspaceId, threadId],
          });
        } finally {
          activeController = undefined;
          if (!stopped) {
            setThreadStreamConnected(false);
            void queryClient.invalidateQueries({
              queryKey: ["agent-threads", workspaceId],
            });
          }
        }
        if (stopped || receivedTerminalRun) return;
        await waitToReconnect();
      }
    };
    void connect();
    return () => {
      stopped = true;
      activeController?.abort();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        resolveReconnect?.();
        resolveReconnect = undefined;
      }
    };
  }, [activeStreamRunId, agentLocale, isRunning, threadId, workspaceId]);

  useEffect(() => {
    const run = activeThread?.latestRun;
    if (
      !messageQueueScope ||
      !nextQueuedMessage ||
      !run ||
      !threadFreshForVisibility ||
      queueDeliveryInProgressRef.current ||
      threadReadInterrupted ||
      branchActionPending ||
      defaultAgentModelBlocked ||
      entryBrandBlocked ||
      (Boolean(effectiveCanvasEntry) &&
        (pendingCanvas.isError ||
          (pendingCanvas.data !== undefined &&
            pendingCanvas.data.version !==
              effectiveCanvasEntry?.canvasDraftVersion))) ||
      !agentMessageQueueCanDrain(
        activeThread,
        pendingMessageQueue.state.resumedAfterRunId,
      )
    ) {
      return;
    }
    const guard = (): boolean =>
      currentQueueThreadSnapshotMatches(run.id, run.lifecycleStatus);
    queueDeliveryInProgressRef.current = true;
    void withAgentMessageQueueDeliveryLock(messageQueueScope, async () => {
      if (!guard()) return false;
      const started = await pendingMessageQueue.startDelivery(
        nextQueuedMessage.id,
        queueDeliveryOwnerId,
        guard,
      );
      if (!started.changed || !started.persisted) return true;
      try {
        const accepted = await createWorkspaceAgentMessage(
          { csrfToken, workspaceId },
          nextQueuedMessage.request,
          nextQueuedMessage.idempotencyKey,
        );
        await pendingMessageQueue.acceptDelivery(
          nextQueuedMessage.id,
          queueDeliveryOwnerId,
          accepted,
        );
        if (!workspaceMountedRef.current) return true;
        await synchronizeAcceptedAgentMessage(
          () =>
            queryClient.invalidateQueries({
              queryKey: ["agent-threads", workspaceId],
            }),
          () =>
            fetchFreshAcceptedAgentThread(
              queryClient,
              workspaceId,
              accepted.threadId,
              undefined,
              agentLocale,
            ),
        );
      } catch (error) {
        if (agentRunIsAlreadyActive(error)) {
          await pendingMessageQueue.deferDelivery(
            nextQueuedMessage.id,
            queueDeliveryOwnerId,
          );
          if (!workspaceMountedRef.current) return true;
          await Promise.allSettled([
            queryClient.invalidateQueries({
              queryKey: ["agent-thread", workspaceId, threadId],
            }),
            queryClient.invalidateQueries({
              queryKey: ["agent-threads", workspaceId],
            }),
          ]);
          return true;
        }
        if (agentModelIsNotConfigured(error)) {
          void queryClient.invalidateQueries({
            queryKey: workspaceQueryKeys.agentModelSettings(workspaceId),
          });
        }
        await pendingMessageQueue.failDelivery(
          nextQueuedMessage.id,
          queueDeliveryOwnerId,
          agentMessageDeliveryIsUncertain(error),
        );
        if (workspaceMountedRef.current) {
          setMessageErrorKey(agentErrorKey(error));
        }
      }
      return true;
    }).then(
      (lockAcquired) => {
        queueDeliveryInProgressRef.current = false;
        if (!workspaceMountedRef.current) return;
        if (lockAcquired === undefined) {
          queueDeliveryRetryTimerRef.current = window.setTimeout(() => {
            queueDeliveryRetryTimerRef.current = undefined;
            if (workspaceMountedRef.current) {
              setQueueDeliveryAttempt((current) => current + 1);
            }
          }, QUEUE_DELIVERY_LOCK_RETRY_MS);
        } else {
          setQueueDeliveryAttempt((current) => current + 1);
        }
      },
      () => {
        queueDeliveryInProgressRef.current = false;
        if (workspaceMountedRef.current) {
          setMessageErrorKey("agent.sendError");
        }
      },
    );
  }, [
    activeThread,
    agentLocale,
    branchActionPending,
    effectiveCanvasEntry,
    csrfToken,
    currentQueueThreadSnapshotMatches,
    defaultAgentModelBlocked,
    entryBrandBlocked,
    messageQueueScope,
    nextQueuedMessage,
    pendingCanvas.data,
    pendingCanvas.isError,
    pendingMessageQueue,
    queueDeliveryAttempt,
    queueDeliveryOwnerId,
    threadId,
    threadFreshForVisibility,
    threadReadInterrupted,
    workspaceId,
  ]);

  function changeComposerValue(value: string): void {
    setPromptRejected(false);
    composerValueRef.current = value;
    setComposerDrafts((current) => ({
      ...current,
      [composerDraftKey]: value,
    }));
    try {
      sessionStorage.setItem(composerDraftKey, value);
    } catch {
      // The in-memory draft remains usable when browser storage is unavailable.
    }
  }

  function reuseFailedRequest(): void {
    if (!reusableFailedRequest) return;
    setMessageErrorKey(undefined);
    changeComposerValue(reusableFailedRequest);
    requestAnimationFrame(() => focusAgentComposer(composerInputRef.current));
  }

  function canEditResource(item: AgentWorkbenchResource | undefined): boolean {
    if (item?.state !== "available") return false;
    if (item?.kind === "canvas") {
      return (
        permissions.includes("canvas.write") &&
        permissions.includes("asset.write")
      );
    }
    return item?.kind === "workflow" && permissions.includes("workflow.author");
  }

  function openEntry(entry: AgentWorkbenchEntry): void {
    const key = agentWorkbenchEntryKey(entry);
    setOpenedEntries((current) =>
      current.some((candidate) => agentWorkbenchEntryKey(candidate) === key)
        ? current
        : [...current, entry],
    );
    setActiveEntryKey(key);
    setWorkbenchOpen(true);
  }

  function openResource(item: AgentWorkbenchResource): void {
    openEntry(agentWorkbenchResourceEntry(item));
  }

  function closeEntry(key: string): void {
    setOpenedEntries((current) => {
      const index = current.findIndex(
        (entry) => agentWorkbenchEntryKey(entry) === key,
      );
      const next = current.filter(
        (entry) => agentWorkbenchEntryKey(entry) !== key,
      );
      if (key === activeEntryKey) {
        const replacement = next[Math.min(index, next.length - 1)];
        setActiveEntryKey(
          replacement ? agentWorkbenchEntryKey(replacement) : undefined,
        );
      }
      return next;
    });
  }

  function removeComposerReference(id: string): void {
    if (
      activeComposerReferences.some(
        (item) => item.id === id && item.kind === "brand",
      )
    )
      setBrandCleared(true);
    if (id === `skill:${skillRevisionId}`) setEntrySkillRemoved(true);
    if (entryBrand.data && id === `brand:${entryBrand.data.brandKitId}`)
      setEntryBrandRemoved(true);
    setComposerReferences((current) =>
      current.filter((reference) => reference.id !== id),
    );
  }

  async function openTaskOnCanvas(task: AgentWorkbenchTask): Promise<void> {
    if (
      !permissions.includes("canvas.write") ||
      !permissions.includes("asset.write") ||
      !permissions.includes("artifact.download")
    )
      return;
    const images =
      task.resultArtifacts?.filter(
        (artifact) =>
          artifact.kind === "image" && artifact.state === "available",
      ) ?? [];
    if (images.length === 0) return;
    const taskDisplay = agentTaskDisplayText(task, t);
    const requestKey = images.map((artifact) => artifact.resourceId).join(":");
    let request = canvasResultRequestsRef.current.get(requestKey);
    if (!request) {
      const [documents, sourceRun] = await Promise.all([
        Promise.all(
          images.map(async (artifact, index) => {
            const blob = await downloadArtifact(
              workspaceId,
              artifact.resourceId,
            );
            const image = await createImageBitmap(blob);
            try {
              return createWorkflowResultDraftV1({
                workspaceId,
                runId: task.workflowRunId ?? task.capabilityRunId ?? task.id,
                artifactId: artifact.resourceId,
                sourceTitle: taskDisplay.title,
                intrinsicSize: { width: image.width, height: image.height },
                nodeIds: {
                  image: `result-${index + 1}`,
                  text: `headline-${index + 1}`,
                },
              });
            } finally {
              image.close();
            }
          }),
        ),
        canReadWorkflow && task.workflowRunId
          ? queryClient.fetchQuery({
              queryKey: [
                "agent-workflow-task",
                workspaceId,
                task.workflowRunId,
              ],
              queryFn: () => fetchWorkflowRun(workspaceId, task.workflowRunId!),
              staleTime: Number.POSITIVE_INFINITY,
            })
          : Promise.resolve(undefined),
      ]);
      const first = documents[0];
      if (!first) return;
      request = {
        idempotencyKey: `agent-result-canvas:${crypto.randomUUID()}`,
        body: {
          document: {
            ...first,
            pages: documents.flatMap((document, index) =>
              document.pages.map((page) => ({
                ...page,
                id: `page-${index + 1}`,
                name: t("agent.taskResultNumber", { count: index + 1 }),
              })),
            ),
          },
          brandKitRevisionId:
            task.brandContext?.brandKitRevisionId ??
            sourceRun?.brand?.brandKitRevisionId ??
            null,
        },
      };
      canvasResultRequestsRef.current.set(requestKey, request);
    }
    const result = await createCanvasDraft(
      { csrfToken, workspaceId },
      request.body,
      request.idempotencyKey,
    );
    await navigate({
      to: "/w/$workspaceId/boards/$canvasDraftId",
      params: { workspaceId, canvasDraftId: result.draft.id },
      search: {
        importImage: false,
        ...(threadId
          ? { returnTo: `/w/${workspaceId}/agent/${threadId}` }
          : {}),
      },
    });
  }

  function clearSubmittedComposer(
    submission?: AgentComposerSubmissionAttempt,
  ): void {
    if (submission) {
      pendingSubmissionRef.current = undefined;
      clearAgentComposerSubmission(composerDraftKey, submission.idempotencyKey);
    }
    changeComposerValue("");
    persistAgentDraftContext(composerDraftKey, {
      references: [],
      ...(agentDefinitionId ? { agentDefinitionId } : {}),
      entrySkillRemoved: false,
      entryBrandRemoved: false,
      brandCleared: false,
    });
    agentAttachments.clearAttachments();
    setComposerReferences([]);
    setRestoredCanvasEntry(undefined);
    clearRetrievedCanvasEntry(composerDraftKey);
    setEntryBrandRemoved(false);
    setEntrySkillRemoved(false);
    setBrandCleared(false);
  }

  async function sendMessage(message: string): Promise<void> {
    if (
      draftAgentBlocked ||
      defaultAgentModelBlocked ||
      takingPendingMessageRef.current ||
      branchActionPendingRef.current ||
      (threadBlocksComposer && !isRunning) ||
      entryBrandBlocked ||
      agentAttachments.busy ||
      agentAttachments.hasError
    )
      return;
    setMessageErrorKey(undefined);
    const selectedAssets = composerReferences.flatMap((reference) => {
      if (reference.kind === "asset") {
        return [
          { assetId: reference.assetId, artifactId: reference.artifactId },
        ];
      }
      return reference.kind === "artifact"
        ? [{ artifactId: reference.artifactId }]
        : [];
    });
    const attachments = [
      ...agentAttachments.references,
      ...selectedAssets,
    ].filter(
      (item, index, items) =>
        items.findIndex(
          (candidate) => candidate.artifactId === item.artifactId,
        ) === index,
    );
    const brand = activeComposerReferences.find(
      (reference) => reference.kind === "brand",
    );
    const skill = activeComposerReferences.find(
      (reference) => reference.kind === "skill",
    );
    const references: Array<
      | {
          readonly kind: "canvas";
          readonly resourceId: string;
          readonly version: number;
        }
      | { readonly kind: "workflow"; readonly resourceId: string }
    > = [];
    for (const reference of composerReferences) {
      if (reference.kind === "canvas") {
        references.push({
          kind: "canvas",
          resourceId: reference.resourceId,
          version: reference.version,
        });
      } else if (reference.kind === "workflow") {
        references.push({
          kind: "workflow",
          resourceId: reference.resourceId,
        });
      }
    }
    let submittedBrandContext: CreateWorkspaceAgentMessageBody["brandContext"];
    if (brand?.kind === "brand") {
      submittedBrandContext = {
        brandKitId: brand.brandKitId,
        brandKitRevisionId: brand.brandKitRevisionId,
      };
    } else if (brandCleared) {
      submittedBrandContext = null;
    }
    const request: CreateWorkspaceAgentMessageBody = {
      libraryIds: activeComposerReferences.flatMap((reference) =>
        reference.kind === "library" ? [reference.libraryId] : [],
      ),
      message,
      browserCanvasExport: true,
      ...(!threadId && agentDefinitionId ? { agentDefinitionId } : {}),
      ...(!threadId && skillCandidateId ? { skillCandidateId } : {}),
      ...agentComposerSkillPayload(skill),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(submittedBrandContext !== undefined
        ? { brandContext: submittedBrandContext }
        : {}),
      ...(references.length > 0 ? { references } : {}),
      ...(threadId ? { threadId } : {}),
      ...(effectiveCanvasEntry
        ? {
            entryContext: {
              originSurface: "canvas" as const,
              canvasDraftId: effectiveCanvasEntry.canvasDraftId,
              canvasDraftVersion: effectiveCanvasEntry.canvasDraftVersion,
              selectedElementKeys: [
                ...effectiveCanvasEntry.selectedElementKeys,
              ],
              ...(effectiveCanvasEntry.pageKey
                ? { pageKey: effectiveCanvasEntry.pageKey }
                : {}),
              ...(effectiveCanvasEntry.returnTo
                ? { returnTo: effectiveCanvasEntry.returnTo }
                : {}),
            },
          }
        : {}),
    };
    const shouldQueue =
      Boolean(threadId) &&
      (isRunning ||
        pendingMessageQueue.state.items.length > 0 ||
        Boolean(pendingMessageQueue.state.accepted));
    if (shouldQueue) {
      if (!pendingMessageQueue.locksAvailable || !pendingMessageQueue.durable) {
        setMessageErrorKey("agent.sendError");
        return;
      }
      const enqueued = await pendingMessageQueue.enqueue(request);
      if (!enqueued.persisted) {
        setMessageErrorKey("agent.sendError");
        return;
      }
      clearSubmittedComposer();
      if (effectiveCanvasEntry && threadId) {
        await navigate({
          params: { workspaceId, threadId },
          to: "/w/$workspaceId/agent/$threadId",
          ...(skillCandidateId && skillCandidateDigest
            ? {
                search: {
                  skillCandidateId,
                  skillCandidateDigest,
                  ...(skillTestRequest ? { skillTestRequest } : {}),
                  ...(skillTestReturnTo ? { returnTo: skillTestReturnTo } : {}),
                },
              }
            : {}),
          replace: true,
        });
      }
      return;
    }
    const submission = agentComposerSubmissionAttempt(
      pendingSubmissionRef.current ??
        readAgentComposerSubmission(composerDraftKey),
      JSON.stringify(request),
    );
    pendingSubmissionRef.current = submission;
    persistAgentComposerSubmission(composerDraftKey, submission);
    let accepted;
    try {
      accepted = await createWorkspaceAgentMessage(
        { csrfToken, workspaceId },
        request,
        submission.idempotencyKey,
      );
    } catch (error) {
      if (threadId && agentRunIsAlreadyActive(error)) {
        const enqueued = await pendingMessageQueue.enqueue(
          request,
          submission.idempotencyKey,
        );
        if (enqueued.persisted) {
          clearSubmittedComposer(submission);
          await Promise.allSettled([
            queryClient.invalidateQueries({
              queryKey: ["agent-thread", workspaceId, threadId],
            }),
            queryClient.invalidateQueries({
              queryKey: ["agent-threads", workspaceId],
            }),
          ]);
          if (effectiveCanvasEntry) {
            await navigate({
              params: { workspaceId, threadId },
              to: "/w/$workspaceId/agent/$threadId",
              ...(skillCandidateId && skillCandidateDigest
                ? {
                    search: {
                      skillCandidateId,
                      skillCandidateDigest,
                      ...(skillTestRequest ? { skillTestRequest } : {}),
                      ...(skillTestReturnTo
                        ? { returnTo: skillTestReturnTo }
                        : {}),
                    },
                  }
                : {}),
              replace: true,
            });
          }
          return;
        }
      }
      if (agentModelIsNotConfigured(error)) {
        void queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.agentModelSettings(workspaceId),
        });
      }
      setMessageErrorKey(agentErrorKey(error));
      throw error;
    }
    clearSubmittedComposer(submission);
    await synchronizeAcceptedAgentMessage(
      () =>
        queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        }),
      () =>
        fetchFreshAcceptedAgentThread(
          queryClient,
          workspaceId,
          accepted.threadId,
          undefined,
          agentLocale,
        ),
    );
    if (accepted.threadId !== threadId || effectiveCanvasEntry) {
      await navigate({
        params: { workspaceId, threadId: accepted.threadId },
        to: "/w/$workspaceId/agent/$threadId",
        ...(skillCandidateId && skillCandidateDigest
          ? {
              search: {
                skillCandidateId,
                skillCandidateDigest,
                ...(skillTestRequest ? { skillTestRequest } : {}),
                ...(skillTestReturnTo ? { returnTo: skillTestReturnTo } : {}),
              },
            }
          : {}),
        replace: true,
      });
    }
  }

  async function editPendingMessage(id: string): Promise<boolean> {
    if (takingPendingMessageRef.current) return false;
    const composerOccupied = agentComposerBlocksQueueTake({
      message: composerValueRef.current,
      attachmentCount: agentAttachments.attachments.length,
      referenceCount: activeComposerReferences.length,
      hasCanvasEntry: Boolean(effectiveCanvasEntry),
      submissionPending: Boolean(pendingSubmissionRef.current),
    });
    if (composerOccupied) {
      setMessageErrorKey("agent.messageQueue.retrieveComposerNotEmpty");
      requestAnimationFrame(() =>
        focusAgentComposer(composerInputRef.current, { moveCaretToEnd: true }),
      );
      return false;
    }
    const queued = pendingMessageQueue.state.items.find(
      (item) => item.id === id && item.status === "queued",
    );
    if (!queued) {
      setMessageErrorKey("agent.messageQueue.retrieveFailed");
      return false;
    }
    const request = queued.request;
    const restoredReferences = queuedAgentMessageComposerReferences(request, {
      asset: t("agent.referenceKind.asset"),
      brand: t("agent.referenceKind.brand"),
      canvas: t("agent.referenceKind.canvas"),
      skill: t("agent.referenceKind.skill"),
      workflow: t("agent.referenceKind.workflow"),
      library: t("agent.referenceKind.library"),
    });
    const restoredSkill = restoredReferences.some(
      (reference) => reference.kind === "skill",
    );
    const restoredBrand = restoredReferences.some(
      (reference) => reference.kind === "brand",
    );
    const nextEntrySkillRemoved =
      Boolean(entrySkillRevisionId) && !restoredSkill;
    const nextEntryBrandRemoved = Boolean(brandKitRevisionId) && !restoredBrand;
    const nextBrandCleared = request.brandContext === null;
    if (
      request.entryContext &&
      !persistRetrievedCanvasEntry(composerDraftKey, id, request.entryContext)
    ) {
      setMessageErrorKey("agent.messageQueue.retrieveFailed");
      return false;
    }
    takingPendingMessageRef.current = true;
    setTakingPendingMessageId(id);
    setMessageErrorKey(undefined);
    try {
      const taken = await pendingMessageQueue.take(
        id,
        () =>
          takingPendingMessageRef.current &&
          composerValueRef.current.length === 0,
      );
      if (!taken.persisted || !taken.item) {
        if (request.entryContext) clearRetrievedCanvasEntry(composerDraftKey);
        setMessageErrorKey("agent.messageQueue.retrieveFailed");
        return false;
      }
      changeComposerValue(request.message);
      agentAttachments.clearAttachments();
      setComposerReferences(restoredReferences);
      setRestoredCanvasEntry(request.entryContext);
      setEntrySkillRemoved(nextEntrySkillRemoved);
      setEntryBrandRemoved(nextEntryBrandRemoved);
      setBrandCleared(nextBrandCleared);
      persistAgentDraftContext(composerDraftKey, {
        references: restoredReferences,
        ...(entrySkillRevisionId ? { entrySkillRevisionId } : {}),
        ...(brandKitRevisionId
          ? { entryBrandRevisionId: brandKitRevisionId }
          : {}),
        ...(agentDefinitionId ? { agentDefinitionId } : {}),
        entrySkillRemoved: nextEntrySkillRemoved,
        entryBrandRemoved: nextEntryBrandRemoved,
        brandCleared: nextBrandCleared,
      });
      requestAnimationFrame(() =>
        focusAgentComposer(composerInputRef.current, { moveCaretToEnd: true }),
      );
      return true;
    } catch {
      setMessageErrorKey("agent.messageQueue.retrieveFailed");
      return false;
    } finally {
      takingPendingMessageRef.current = false;
      setTakingPendingMessageId(undefined);
    }
  }

  async function removePendingMessage(id: string): Promise<void> {
    const removed = await pendingMessageQueue.remove(id);
    if (!removed.persisted) setMessageErrorKey("agent.sendError");
  }

  async function pausePendingMessages(): Promise<boolean> {
    const paused = await pendingMessageQueue.pause("manual");
    if (!paused.persisted) {
      setMessageErrorKey("agent.sendError");
      return false;
    }
    return true;
  }

  async function resumePendingMessages(): Promise<void> {
    const run = activeThread?.latestRun;
    if (
      branchActionPendingRef.current ||
      stoppingRunId ||
      threadReadInterrupted ||
      run?.lifecycleStatus === "waiting_approval" ||
      run?.lifecycleStatus === "waiting_for_user"
    ) {
      return;
    }
    const resumed = await pendingMessageQueue.resume(
      run?.lifecycleStatus === "failed" || run?.lifecycleStatus === "cancelled"
        ? run.id
        : undefined,
    );
    if (!resumed.persisted) setMessageErrorKey("agent.sendError");
  }

  function openReferencePicker(kind: AgentComposerReferenceKind): void {
    setWorkbenchOpen(false);
    setReferencePickerKind(kind);
  }

  function closeReferencePicker(): void {
    setReferencePickerKind(undefined);
    requestAnimationFrame(() =>
      focusAgentComposer(composerInputRef.current, { moveCaretToEnd: true }),
    );
  }

  function addComposerReferences(
    picked: readonly AgentComposerReference[],
    replaceKind?: AgentComposerReferenceKind,
  ): void {
    if (picked.some((reference) => reference.kind === "brand"))
      setBrandCleared(false);
    if (replaceKind === "skill") setEntrySkillRemoved(true);
    if (replaceKind === "brand") setEntryBrandRemoved(true);
    if (picked.some((reference) => reference.kind === "skill"))
      setEntrySkillRemoved(true);
    setComposerReferences((current) => {
      const replaceKinds = new Set(
        picked
          .filter(
            (reference) =>
              reference.kind === "brand" || reference.kind === "skill",
          )
          .map((reference) => reference.kind),
      );
      const retained = current.filter(
        (reference) =>
          reference.kind !== replaceKind &&
          ((reference.kind !== "brand" && reference.kind !== "skill") ||
            !replaceKinds.has(reference.kind)),
      );
      const merged = [...retained, ...picked].filter(
        (reference, index, items) =>
          items.findIndex((candidate) => candidate.id === reference.id) ===
          index,
      );
      const attachmentSlots = Math.max(
        0,
        maximumComposerAttachments - agentAttachments.attachments.length,
      );
      let attachmentCount = 0;
      return merged
        .filter((reference) => {
          if (reference.kind !== "asset" && reference.kind !== "artifact")
            return true;
          attachmentCount += 1;
          return attachmentCount <= attachmentSlots;
        })
        .slice(0, maximumComposerReferences);
    });
    closeReferencePicker();
  }

  function addResultToComposer(artifactId: string, title: string): void {
    if (!threadId || threadReadInterrupted) return;
    const staged = stageAgentResultComposerReference({
      references: composerReferences,
      activeReferenceCount: activeComposerReferences.length,
      uploadedAttachmentCount: agentAttachments.attachments.length,
      maximumAttachments: maximumComposerAttachments,
      maximumReferences: maximumComposerReferences,
      artifactId,
      title,
    });
    if (staged.status === "full") {
      setMessageErrorKey("agent.resultAttachmentLimit");
      requestAnimationFrame(() =>
        composerInputRef.current?.scrollIntoView({ block: "nearest" }),
      );
      return;
    }
    if (staged.status === "added") setComposerReferences(staged.references);
    setMessageErrorKey(undefined);
    requestAnimationFrame(() =>
      focusAgentComposer(composerInputRef.current, { moveCaretToEnd: true }),
    );
  }

  async function stopRun(): Promise<void> {
    const run = activeThread?.latestRun;
    if (
      !run ||
      stoppingRunId === run.id ||
      !["queued", "running"].includes(run.lifecycleStatus)
    ) {
      return;
    }
    if (
      pendingMessageQueue.state.items.length > 0 ||
      pendingMessageQueue.state.accepted
    ) {
      const paused = await pendingMessageQueue.pause("stopped");
      if (!paused.persisted) {
        setMessageErrorKey("agent.sendError");
        return;
      }
    }
    setStoppingRunId(run.id);
    setMessageErrorKey(undefined);
    try {
      try {
        await cancelAgentRun({ csrfToken, workspaceId }, run.id);
      } catch {
        if (!threadId) throw new Error("Agent Thread is unavailable.");
        const refreshed = await fetchAgentThread(
          workspaceId,
          threadId,
          undefined,
          agentLocale,
        );
        queryClient.setQueryData(
          ["agent-thread", workspaceId, threadId],
          refreshed,
        );
        void queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        });
        if (agentStopRaceAlreadySettled(run.id, refreshed)) return;
        setMessageErrorKey("agent.threadActionError");
        return;
      }
      await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId, threadId],
        }),
      ]);
    } catch {
      setMessageErrorKey("agent.threadActionError");
    } finally {
      setStoppingRunId(undefined);
    }
  }

  async function regenerateResponse(
    target: AgentRegenerationTarget,
  ): Promise<void> {
    if (!threadId || threadBlocksComposer || branchActionPendingRef.current)
      return;
    if (
      pendingMessageQueue.state.items.length > 0 ||
      pendingMessageQueue.state.accepted
    ) {
      const paused = await pendingMessageQueue.pause("branch_changed");
      if (!paused.persisted) {
        setMessageErrorKey("agent.sendError");
        return;
      }
    }
    branchActionPendingRef.current = true;
    setBranchActionPending(true);
    setMessageErrorKey(undefined);
    try {
      const accepted = await regenerateAgentResponse(
        { csrfToken, workspaceId },
        threadId,
        target,
        `agent-regenerate:${crypto.randomUUID()}`,
      );
      const replacesMessageId = regeneratingAssistantMessageId(
        target,
        messages,
      );
      queryClient.setQueryData<AgentThreadView>(
        ["agent-thread", workspaceId, threadId],
        (current) =>
          current
            ? acceptedAgentThreadSnapshot(
                current,
                {
                  id: accepted.runId,
                  lifecycleStatus: accepted.lifecycleStatus,
                  updatedAt: new Date().toISOString(),
                  ...(replacesMessageId ? { replacesMessageId } : {}),
                },
                activeThread?.latestRun?.id,
              )
            : current,
      );
      await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId, threadId],
        }),
      ]);
    } catch (error) {
      setMessageErrorKey(agentErrorKey(error));
    } finally {
      branchActionPendingRef.current = false;
      setBranchActionPending(false);
    }
  }

  async function selectResponseBranch(
    assistantMessageId: string,
  ): Promise<void> {
    if (
      !threadId ||
      !activeThread ||
      threadBlocksComposer ||
      branchActionPendingRef.current
    )
      return;
    if (
      pendingMessageQueue.state.items.length > 0 ||
      pendingMessageQueue.state.accepted
    ) {
      const paused = await pendingMessageQueue.pause("branch_changed");
      if (!paused.persisted) {
        setMessageErrorKey("agent.sendError");
        return;
      }
    }
    branchActionPendingRef.current = true;
    setBranchActionPending(true);
    setMessageErrorKey(undefined);
    try {
      await selectAgentResponseBranch(
        { csrfToken, workspaceId },
        threadId,
        assistantMessageId,
        activeThread.version,
      );
      await queryClient.invalidateQueries({
        queryKey: ["agent-thread", workspaceId, threadId],
      });
    } catch {
      setMessageErrorKey("agent.branchSelectError");
    } finally {
      branchActionPendingRef.current = false;
      setBranchActionPending(false);
    }
  }

  async function confirmTask(actionId: string): Promise<void> {
    if (confirmingActionId) return;
    setConfirmingActionId(actionId);
    setMessageErrorKey(undefined);
    try {
      await confirmAgentAction(
        { csrfToken, workspaceId },
        actionId,
        `agent-action:${crypto.randomUUID()}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId, threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        }),
      ]);
    } catch (error) {
      setMessageErrorKey(agentErrorKey(error));
    } finally {
      setConfirmingActionId(undefined);
      requestAnimationFrame(() => focusAgentComposer(composerInputRef.current));
    }
  }

  async function cancelBackgroundTask(task: AgentWorkbenchTask): Promise<void> {
    if (task.capabilityRunId) {
      await cancelCapabilityRun(
        { csrfToken, workspaceId },
        task.capabilityRunId,
        `agent-task-cancel:${task.id}`,
      );
    } else if (task.workflowRunId) {
      await cancelWorkflowRun({ csrfToken, workspaceId }, task.workflowRunId);
    } else return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["agent-thread", workspaceId, threadId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["agent-workflow-task", workspaceId, task.workflowRunId],
      }),
    ]);
  }

  async function resolveQuestion(
    interactionId: string,
    body: ResolveAgentInteractionBody,
  ): Promise<void> {
    if (resolvingInteractionId) return;
    setResolvingInteractionId(interactionId);
    try {
      await resolveAgentInteraction(
        { csrfToken, workspaceId },
        interactionId,
        body,
        `agent-interaction:${interactionId}:v${String(body.expectedVersion)}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId, threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        }),
      ]);
    } finally {
      setResolvingInteractionId(undefined);
    }
  }

  async function declineTask(actionId: string): Promise<void> {
    if (decliningActionId || confirmingActionId) return;
    setDecliningActionId(actionId);
    setMessageErrorKey(undefined);
    try {
      await declineAgentAction(
        { csrfToken, workspaceId },
        actionId,
        `agent-action-decline:${crypto.randomUUID()}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-thread", workspaceId, threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-threads", workspaceId],
        }),
      ]);
    } catch {
      setMessageErrorKey("agent.sendError");
    } finally {
      setDecliningActionId(undefined);
      requestAnimationFrame(() => focusAgentComposer(composerInputRef.current));
    }
  }

  function startAgentConversation(id: string): void {
    void navigate({
      to: "/w/$workspaceId/agent",
      params: { workspaceId },
      search: { agentDefinitionId: id, draftId: crypto.randomUUID() },
    });
  }

  function selectStarterSkill(skill: AgentHubSkill, prompt?: string): void {
    addComposerReferences([
      {
        kind: "skill",
        id: `skill:${skill.skillRevisionId}`,
        title: skill.displayName,
        description: skill.summary,
        skillRevisionId: skill.skillRevisionId,
      },
    ]);
    if (prompt)
      changeComposerValue(
        composerValue.trim() ? `${composerValue.trimEnd()}\n${prompt}` : prompt,
      );
    composerInputRef.current?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
    requestAnimationFrame(() =>
      focusAgentComposer(composerInputRef.current, { moveCaretToEnd: true }),
    );
  }

  function chooseAgent(id: string): void {
    setAgentPickerOpen(false);
    if (!threadId) {
      setAgentDefinitionId(id);
      requestAnimationFrame(() =>
        focusAgentComposer(composerInputRef.current, { moveCaretToEnd: true }),
      );
    } else
      void navigate({
        to: "/w/$workspaceId/agent",
        params: { workspaceId },
        search: { agentDefinitionId: id, draftId: crypto.randomUUID() },
      });
  }

  const draftAgentIdentity = (
    <span className="flex min-w-0 items-center gap-2">
      <AgentAvatar
        isDefault={currentAgentIsDefault}
        alt=""
        {...(agentAvatar ? { avatar: agentAvatar } : {})}
        canReadAssets={permissions.includes("asset.read")}
        className="size-9 rounded-lg text-lg"
        workspaceId={workspaceId}
      />
      <span className="max-w-64 truncate font-bold">{draftAgentName}</span>
    </span>
  );

  const conversationHeader = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {!threadId ? (
          <>
            <h1
              id="app-shell-page-title"
              data-page-focus-target="false"
              className="m-0 min-w-0 text-base font-bold"
            >
              {permissions.includes("agent.read") &&
              (availableAgents.length > 1 ||
                (draftAgentUnavailable && availableAgents.length > 0)) ? (
                <Dropdown
                  trigger={["click"]}
                  open={agentPickerOpen}
                  onOpenChange={setAgentPickerOpen}
                  menu={{
                    selectable: true,
                    selectedKeys: agentLinkId ? [agentLinkId] : [],
                    items: availableAgents.flatMap((agent, index) => [
                      ...(index === 1 && availableAgents[0]?.isDefault
                        ? [{ type: "divider" as const }]
                        : []),
                      {
                        key: agent.id,
                        label: (
                          <span className="flex items-center gap-3">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {agent.isDefault
                                  ? t("agent.defaultName")
                                  : agent.displayName}
                              </span>
                              <span className="mt-1 block max-w-64 whitespace-normal text-xs leading-5 text-muted">
                                {agentDisplaySummary(
                                  agent,
                                  t("agent.hub.defaultAgentSummary"),
                                )}
                              </span>
                            </span>
                            {agent.id === agentLinkId ? (
                              <CheckOutlined aria-hidden="true" />
                            ) : null}
                          </span>
                        ),
                        icon: (
                          <AgentAvatar
                            isDefault={agent.isDefault}
                            alt=""
                            workspaceId={workspaceId}
                            canReadAssets={permissions.includes("asset.read")}
                            {...(agent.avatar ? { avatar: agent.avatar } : {})}
                            className="size-6 rounded-md text-base"
                          />
                        ),
                      },
                    ]),
                    onClick: ({ key }) => chooseAgent(key),
                    style: { maxHeight: 360, overflowY: "auto", maxWidth: 360 },
                  }}
                >
                  <Button
                    type="text"
                    aria-label={`${t("agent.navigation.chooseAgent")}: ${draftAgentName}`}
                    aria-expanded={agentPickerOpen}
                    style={{ height: "auto", padding: 4, gap: 8 }}
                  >
                    {draftAgentIdentity}
                    <DownOutlined />
                  </Button>
                </Dropdown>
              ) : (
                <span className="inline-flex p-1">{draftAgentIdentity}</span>
              )}
            </h1>
          </>
        ) : (
          <>
            {agentName ? (
              <AgentAvatar
                isDefault={currentAgentIsDefault}
                alt=""
                {...(agentAvatar ? { avatar: agentAvatar } : {})}
                canReadAssets={permissions.includes("asset.read")}
                className="size-9 rounded-lg text-lg"
                workspaceId={workspaceId}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h1
                id="app-shell-page-title"
                data-page-focus-target="false"
                className="m-0 truncate text-base leading-5 font-bold text-ink"
              >
                {activeThread?.title ?? t("agent.newThread")}
              </h1>
              {agentName && agentLinkId ? (
                <button
                  type="button"
                  onClick={() => setAgentDetailsOpen(true)}
                  aria-label={t("agent.polish.openDetails", {
                    name: agentName,
                  })}
                  aria-expanded={agentDetailsOpen}
                  aria-haspopup="dialog"
                  aria-controls="conversation-agent-details"
                  className="mt-1 flex max-w-full items-center gap-1.5 rounded-md border-0 bg-transparent p-0 text-xs leading-5 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="min-w-0 truncate">{agentName}</span>
                  {agentState && agentState !== "enabled" ? (
                    <span
                      className={`shrink-0 rounded px-1.5 text-[11px] font-medium ${agentState === "deleted" ? "bg-danger-surface text-danger" : "bg-amber-50 text-amber-700"}`}
                    >
                      {t(`agent.lifecycle.${agentState}`)}
                    </span>
                  ) : null}
                  <RightOutlined
                    aria-hidden="true"
                    className="shrink-0 text-[9px]"
                  />
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
      {contextEntries.length > 0 ? (
        <Tooltip
          title={t(
            workbenchOpen ? "agent.closeInspector" : "agent.openInspector",
          )}
        >
          <Button
            aria-controls="agent-resource-workbench"
            aria-expanded={workbenchOpen}
            aria-label={t(
              workbenchOpen ? "agent.closeInspector" : "agent.openInspector",
            )}
            icon={<PicRightOutlined aria-hidden="true" />}
            onClick={() => setWorkbenchOpen((current) => !current)}
            type="text"
          />
        </Tooltip>
      ) : null}
    </div>
  );
  const sidebar = (onNavigate: () => void) => (
    <ConversationSidebar
      context={context}
      workspace={workspace}
      {...(threadId ? { threadId } : {})}
      onConversationNavigate={() =>
        requestAnimationFrame(() =>
          focusAgentComposer(composerInputRef.current, {
            moveCaretToEnd: true,
          }),
        )
      }
      onNavigate={onNavigate}
      onSelectAgent={startAgentConversation}
      {...(agentLinkId ? { currentAgentId: agentLinkId } : {})}
      onOpenSkills={() => openReferencePicker("skill")}
    />
  );
  return (
    <AppShell
      context={context}
      workspace={workspace}
      fullBleed
      pageTitle={t("agent.documentTitle")}
      sidebar={sidebar}
      headerContent={conversationHeader}
    >
      {threadId &&
      thread.isError &&
      !threadReadInterrupted &&
      !missingThread ? (
        <PageEmptyState
          action={() => void thread.refetch()}
          actionLabel={t("agent.retry")}
          title={t("agent.loadError")}
        >
          {t("agent.loadErrorDescription")}
        </PageEmptyState>
      ) : (
        <div
          className="h-full min-h-0 w-full overflow-hidden bg-paper"
          onDragOver={(event) => {
            if (agentComposerHasFilePayload(event.dataTransfer)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            if (takingPendingMessageRef.current) return;
            if (!agentComposerHasFilePayload(event.dataTransfer)) return;
            event.preventDefault();
            const files = agentComposerImageFiles(event.dataTransfer.files);
            if (files.length === 0) return;
            agentAttachments.addFiles(files);
          }}
          onPaste={(event) => {
            if (takingPendingMessageRef.current) return;
            if (event.defaultPrevented) return;
            const files = agentComposerImageFiles(event.clipboardData.files);
            if (files.length === 0) return;
            event.preventDefault();
            agentAttachments.addFiles(files);
          }}
        >
          <Splitter
            className="h-full min-h-0"
            collapsible={{ motion: true }}
            onCollapse={(collapsed) => {
              if (wideInspector) {
                setWorkbenchOpen(collapsed.at(-1) !== true);
              }
            }}
            onResize={(sizes) => {
              if (workbenchOpen && wideInspector) {
                const nextWorkbenchWidth = sizes.at(-1);
                if (
                  nextWorkbenchWidth !== undefined &&
                  nextWorkbenchWidth >= workbenchMinimumWidth
                ) {
                  setWorkbenchWidth(nextWorkbenchWidth);
                }
              }
            }}
            orientation="horizontal"
          >
            <Splitter.Panel min={desktopLayout ? conversationMinimumWidth : 0}>
              <section className="flex h-full min-h-0 min-w-0 flex-col">
                {browserTasksRequired ? (
                  <div className="mx-4 mt-3 sm:mx-6">
                    <BrowserRuntimeNotice
                      canRun={browserTasksAllowed}
                      onReconnect={reconnectBrowserTasks}
                      state={browserTaskRuntimeState}
                    />
                  </div>
                ) : null}
                {threadReadInterrupted ? (
                  <Alert
                    className="mx-4 mt-3 sm:mx-6"
                    showIcon
                    type="warning"
                    title={t("agent.threadReadInterrupted")}
                    action={
                      <Button
                        size="small"
                        onClick={retryThreadRead}
                        loading={thread.isFetching}
                      >
                        {t("agent.retry")}
                      </Button>
                    }
                  />
                ) : null}
                {candidateTestStatus ? (
                  <Alert
                    action={
                      candidateTestStatus === "passed" && skillTestReturnTo ? (
                        <Button href={skillTestReturnTo} size="small">
                          {t("agent.skillCandidateTest.return")}
                        </Button>
                      ) : undefined
                    }
                    className="mx-4 mt-3 sm:mx-6"
                    showIcon
                    title={t(`agent.skillCandidateTest.${candidateTestStatus}`)}
                    type={candidateTestAlertType(candidateTestStatus)}
                  />
                ) : null}
                {effectiveCanvasEntry &&
                (pendingCanvas.isError ||
                  (pendingCanvas.data &&
                    pendingCanvas.data.version !==
                      effectiveCanvasEntry.canvasDraftVersion)) ? (
                  <Alert
                    className="mx-4 mt-3 sm:mx-6"
                    showIcon
                    title={t(
                      pendingCanvas.data
                        ? "agent.canvasChanged"
                        : "agent.canvasEntryUnavailable",
                    )}
                    type="warning"
                  />
                ) : null}

                {currentAgentIsDefault && defaultAgentModelSettings.isError ? (
                  <InlineNotice
                    action={
                      <Button
                        loading={defaultAgentModelSettings.isFetching}
                        onClick={() => void defaultAgentModelSettings.refetch()}
                        size="small"
                      >
                        {t("agent.defaultModelSetup.recheck")}
                      </Button>
                    }
                    className="mx-4 mt-3 sm:mx-6"
                    title={t("agent.defaultModelSetup.loadFailedTitle")}
                    tone="danger"
                  >
                    {t("agent.defaultModelSetup.loadFailedDescription")}
                  </InlineNotice>
                ) : null}
                {defaultAgentModelNeedsConfiguration ? (
                  <InlineNotice
                    action={
                      canConfigureDefaultAgentModel ? (
                        <Button
                          href={`/w/${workspaceId}/settings/models`}
                          size="small"
                        >
                          {t("agent.defaultModelSetup.configure")}
                        </Button>
                      ) : (
                        <Button
                          loading={defaultAgentModelSettings.isFetching}
                          onClick={() =>
                            void defaultAgentModelSettings.refetch()
                          }
                          size="small"
                        >
                          {t("agent.defaultModelSetup.recheck")}
                        </Button>
                      )
                    }
                    className="mx-4 mt-3 sm:mx-6"
                    title={t("agent.defaultModelSetup.title")}
                    tone="warning"
                  >
                    {t(
                      canConfigureDefaultAgentModel
                        ? "agent.defaultModelSetup.managerDescription"
                        : "agent.defaultModelSetup.memberDescription",
                    )}
                  </InlineNotice>
                ) : null}
                {!threadId &&
                (agentCatalog.isError || draftAgentUnavailable) ? (
                  <Alert
                    className="mx-4 mt-3"
                    type={workspaceAgentUnconfigured ? "info" : "error"}
                    title={t(draftAgentNoticeKey)}
                    action={
                      agentCatalog.isError ? (
                        <Button onClick={() => void agentCatalog.refetch()}>
                          {t("agent.retryAgentLoad")}
                        </Button>
                      ) : undefined
                    }
                  />
                ) : null}
                {promptRejected ? (
                  <Alert
                    className="mx-4 mt-3"
                    type="error"
                    title={t("agent.linkPromptInvalid")}
                  />
                ) : null}
                {entryBrandBlocked ? (
                  <Alert
                    className="mx-4 mt-3"
                    showIcon
                    type={
                      entryBrand.isError || !permissions.includes("brand.read")
                        ? "error"
                        : "info"
                    }
                    title={t(
                      entryBrand.isError || !permissions.includes("brand.read")
                        ? "agent.entryBrandUnavailable"
                        : "agent.entryBrandLoading",
                    )}
                    action={
                      <Button
                        size="small"
                        onClick={() => setEntryBrandRemoved(true)}
                      >
                        {t("agent.removeEntryBrand")}
                      </Button>
                    }
                  />
                ) : null}

                {threadId && thread.isPending ? (
                  <div className="p-6">
                    <Skeleton active paragraph={{ rows: 8 }} />
                  </div>
                ) : (
                  <div className="relative flex min-h-0 flex-1">
                    {(activeThread?.pendingCanvasExports ?? []).map(
                      (request) => (
                        <AgentCanvasExportExecutor
                          key={request.actionReceiptId}
                          request={request}
                          workspaceId={workspaceId}
                          csrfToken={csrfToken}
                        />
                      ),
                    )}
                    <MainAgentThread
                      {...(!threadId
                        ? {
                            entryShortcuts: (
                              <AgentStarterTasks
                                workspaceId={workspaceId}
                                permissions={permissions}
                                onSelect={selectStarterSkill}
                              />
                            ),
                          }
                        : {})}
                      {...(permissions.includes("audit.read")
                        ? { onOpenDiagnostics: setDiagnosticRunId }
                        : {})}
                      {...(agentSummary
                        ? { emptyAgentSummary: agentSummary }
                        : {})}
                      canDownloadArtifact={permissions.includes(
                        "artifact.download",
                      )}
                      canSaveAsset={permissions.includes("asset.write")}
                      csrfToken={csrfToken}
                      {...(permissions.includes("canvas.write") &&
                      permissions.includes("asset.write") &&
                      permissions.includes("artifact.download")
                        ? { onContinueTask: openTaskOnCanvas }
                        : {})}
                      {...(threadId &&
                      activeThread?.lifecycleStatus === "active" &&
                      permissions.includes("agent.run") &&
                      permissions.includes("artifact.download") &&
                      !threadReadInterrupted
                        ? { onAddResultToComposer: addResultToComposer }
                        : {})}
                      canReadCapabilities={permissions.includes(
                        "capability.run",
                      )}
                      canManageModels={permissions.includes(
                        "credential.manage",
                      )}
                      canReadWorkflow={canReadWorkflow}
                      canRunWorkflow={canRunWorkflow}
                      canManageBrand={permissions.includes("brand.manage")}
                      composerAttachments={agentAttachments.attachments}
                      composerInputRef={composerInputRef}
                      composerBusy={
                        agentAttachments.hasError ||
                        Boolean(takingPendingMessageId)
                      }
                      composerReferences={activeComposerReferences}
                      composerReferenceKinds={composerReferenceKinds}
                      composerValue={composerValue}
                      contextRailReserved={
                        !workbenchOpen && contextEntries.length > 0
                      }
                      {...(confirmingActionId ? { confirmingActionId } : {})}
                      {...(decliningActionId ? { decliningActionId } : {})}
                      {...(resolvingInteractionId
                        ? { resolvingInteractionId }
                        : {})}
                      isRunning={isRunning}
                      branchActionPending={
                        branchActionPending || threadBlocksComposer
                      }
                      {...(activeThread?.latestRun?.assistantMessageId
                        ? {
                            activeRunAssistantMessageId:
                              activeThread.latestRun.assistantMessageId,
                          }
                        : {})}
                      {...(activeThread?.latestRun?.updatedAt
                        ? { runUpdatedAt: activeThread.latestRun.updatedAt }
                        : {})}
                      {...(visibleRegeneratingMessageId
                        ? {
                            regeneratingMessageId: visibleRegeneratingMessageId,
                          }
                        : {})}
                      {...(activeThread?.latestRun?.failureKind
                        ? {
                            runFailureKind: activeThread.latestRun.failureKind,
                            failedRunId: activeThread.latestRun.id,
                          }
                        : {})}
                      {...(activeThread?.latestRun?.lifecycleStatus ===
                        "queued" ||
                      activeThread?.latestRun?.lifecycleStatus === "running"
                        ? { runStatus: activeThread.latestRun.lifecycleStatus }
                        : {})}
                      sendDisabled={
                        threadReadInterrupted ||
                        draftAgentBlocked ||
                        Boolean(takingPendingMessageId) ||
                        branchActionPending ||
                        (threadBlocksComposer && !isRunning) ||
                        ((!pendingMessageQueue.locksAvailable ||
                          !pendingMessageQueue.durable) &&
                          (isRunning ||
                            queuedMessageCount > 0 ||
                            Boolean(acceptedQueuedRunId))) ||
                        entryBrandBlocked ||
                        (Boolean(effectiveCanvasEntry) &&
                          (pendingCanvas.isError ||
                            (pendingCanvas.data !== undefined &&
                              pendingCanvas.data.version !==
                                effectiveCanvasEntry?.canvasDraftVersion)))
                      }
                      sendBlocked={defaultAgentModelBlocked}
                      messages={messages}
                      onConfirm={confirmTask}
                      onDecline={declineTask}
                      onComposerFiles={(files) => {
                        if (takingPendingMessageRef.current) return;
                        const selectedAssetCount = composerReferences.filter(
                          (reference) =>
                            reference.kind === "asset" ||
                            reference.kind === "artifact",
                        ).length;
                        agentAttachments.addFiles(
                          files.slice(
                            0,
                            Math.max(
                              0,
                              maximumComposerAttachments -
                                selectedAssetCount -
                                agentAttachments.attachments.length,
                            ),
                          ),
                        );
                      }}
                      onComposerChange={changeComposerValue}
                      onOpenComposerReferencePicker={openReferencePicker}
                      onOpenResource={openResource}
                      onOpenTask={(task) =>
                        openEntry(agentWorkbenchTaskEntry(task))
                      }

                      {...(reusableFailedRequest
                        ? { onReuseFailedRequest: reuseFailedRequest }
                        : {})}
                      {...(visibleMessageErrorKey
                        ? { systemError: t(visibleMessageErrorKey) }
                        : {})}
                      onRegenerate={regenerateResponse}
                      onResolveInteraction={resolveQuestion}
                      onSelectBranch={selectResponseBranch}
                      onSend={sendMessage}
                      onStop={stopRun}
                      onEditPendingMessage={editPendingMessage}
                      onPauseQueue={pausePendingMessages}
                      onRemovePendingMessage={(id) =>
                        void removePendingMessage(id)
                      }
                      {...(pendingMessageQueue.durable &&
                      pendingMessageQueue.locksAvailable
                        ? {
                            onResumeQueue: () => void resumePendingMessages(),
                          }
                        : {})}
                      onToggleQueueExpanded={() =>
                        setQueueExpanded((current) => !current)
                      }
                      onRemoveComposerAttachment={
                        agentAttachments.removeAttachment
                      }
                      onRemoveComposerReference={removeComposerReference}
                      {...(effectiveCanvasEntry
                        ? {
                            pendingCanvasTitle:
                              pendingCanvas.data?.document.title ??
                              t("agent.canvasAttached"),
                          }
                        : {})}
                      pendingSelectionCount={
                        effectiveCanvasEntry?.selectedElementKeys.length ?? 0
                      }
                      pendingMessages={pendingMessageViews}
                      queueActive={
                        queuedMessageCount > 0 || Boolean(acceptedQueuedRunId)
                      }
                      queueExpanded={queueExpanded}
                      queuePaused={queuePaused}
                      {...(queuePauseReason ? { queuePauseReason } : {})}
                      tasks={tasks}
                      workspaceId={workspaceId}
                    />
                    {!workbenchOpen ? (
                      <aside className="absolute top-4 right-4 z-10 hidden xl:block">
                        <AgentContextShelf
                          entries={contextEntries}
                          onOpen={openEntry}
                          workspaceId={workspaceId}
                        />
                      </aside>
                    ) : null}
                  </div>
                )}
              </section>
            </Splitter.Panel>

            {workbenchOpen && wideInspector ? (
              <Splitter.Panel
                collapsible
                max={workbenchMaximumWidth}
                min={workbenchMinimumWidth}
                size={workbenchWidth}
              >
                <aside className="flex h-full min-h-0 flex-col bg-paper">
                  <AgentResourceWorkbench
                    onCancelTask={cancelBackgroundTask}
                    canReadCapabilities={permissions.includes("capability.run")}
                    canManageModels={permissions.includes("credential.manage")}
                    {...(activeEntryKey ? { activeKey: activeEntryKey } : {})}
                    availableEntries={contextEntries}
                    canDownloadArtifact={permissions.includes(
                      "artifact.download",
                    )}
                    canEdit={canEditResource(activeOpenedResource)}
                    entries={currentOpenedEntries}
                    onActiveChange={setActiveEntryKey}
                    onClose={closeWorkbench}
                    onCloseItem={closeEntry}
                    onEdit={setEditingResource}
                    onOpenEntry={openEntry}
                    workspaceId={workspaceId}
                  />
                </aside>
              </Splitter.Panel>
            ) : null}
          </Splitter>
        </div>
      )}

      {!wideInspector && !editingResource ? (
        <Drawer
          closable={false}
          destroyOnHidden
          onClose={closeWorkbench}
          open={workbenchOpen}
          styles={{ body: { padding: 0 } }}
          size={420}
        >
          <AgentResourceWorkbench
            onCancelTask={cancelBackgroundTask}
            canReadCapabilities={permissions.includes("capability.run")}
            canManageModels={permissions.includes("credential.manage")}
            {...(activeEntryKey ? { activeKey: activeEntryKey } : {})}
            availableEntries={contextEntries}
            canDownloadArtifact={permissions.includes("artifact.download")}
            canEdit={canEditResource(activeOpenedResource)}
            entries={currentOpenedEntries}
            onActiveChange={setActiveEntryKey}
            onClose={closeWorkbench}
            onCloseItem={closeEntry}
            onEdit={setEditingResource}
            onOpenEntry={openEntry}
            workspaceId={workspaceId}
          />
        </Drawer>
      ) : null}

      {agentDetailsOpen && agentLinkId ? (
        <ConversationCatalogDrawer
          csrfToken={csrfToken}
          panel="agents"
          initialDetailId={agentLinkId}
          currentAgentId={agentLinkId}
          {...(threadId ? { threadId } : {})}
          workspace={workspace}
          onClose={() => setAgentDetailsOpen(false)}
          onSelectAgent={startAgentConversation}
        />
      ) : null}
      {diagnosticRunId && permissions.includes("audit.read") ? (
        <AgentRunDiagnostics
          workspaceId={workspaceId}
          runId={diagnosticRunId}
          onClose={() => setDiagnosticRunId(undefined)}
        />
      ) : null}
      <AgentResourceEditorModal
        canAuthorWorkflow={permissions.includes("workflow.author")}
        canEditCanvas={
          permissions.includes("canvas.write") &&
          permissions.includes("asset.write")
        }
        canPublishWorkflow={permissions.includes("workflow.publish")}
        canRunWorkflow={canRunWorkflow}
        csrfToken={csrfToken}
        {...(editingResource ? { item: editingResource } : {})}
        onClose={() => setEditingResource(undefined)}
        permissions={permissions}
        workspaceId={workspaceId}
      />
      {referencePickerKind ? (
        <AgentComposerReferencePicker
          key={referencePickerKind}
          kind={referencePickerKind}
          onCancel={closeReferencePicker}
          onConfirm={(picked) =>
            addComposerReferences(picked, referencePickerKind)
          }
          open
          maxSelected={Math.max(
            0,
            Math.min(
              maximumComposerReferences -
                activeComposerReferences.filter(
                  (item) => item.kind !== referencePickerKind,
                ).length,
              referencePickerKind === "asset"
                ? maximumComposerAttachments -
                    agentAttachments.attachments.length -
                    activeComposerReferences.filter(
                      (item) => item.kind === "artifact",
                    ).length
                : maximumComposerReferences,
            ),
          )}
          selected={activeComposerReferences}
          workspaceId={workspaceId}
          canManageSkills={permissions.includes("skill.manage")}
        />
      ) : null}
    </AppShell>
  );
}
