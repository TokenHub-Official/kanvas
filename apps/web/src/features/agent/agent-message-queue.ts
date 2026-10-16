import type {
  AgentRunAccepted,
  CreateWorkspaceAgentMessageBody,
} from "@kanvas/contracts/api";

export type AgentMessageQueueItemStatus = "queued" | "sending" | "uncertain";

export type AgentMessageQueuePauseReason =
  | "stopped"
  | "cancelled"
  | "failed"
  | "waiting_approval"
  | "waiting_for_user"
  | "delivery_uncertain"
  | "delivery_failed"
  | "branch_changed"
  | "manual";

export interface AgentMessageQueueScope {
  readonly principalId: string;
  readonly workspaceId: string;
  readonly threadId: string;
}

export interface AgentMessageQueueItem {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly request: CreateWorkspaceAgentMessageBody;
  readonly enqueuedAt: string;
  readonly updatedAt: string;
  readonly status: AgentMessageQueueItemStatus;
  readonly deliveryOwnerId?: string;
  readonly deliveryLeaseExpiresAt?: number;
}

export interface AcceptedAgentMessageQueueItem {
  readonly itemId: string;
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly acceptedAt: string;
}

export interface AgentMessageQueueState {
  readonly version: 1;
  readonly revision: number;
  readonly paused: boolean;
  readonly pauseReason?: AgentMessageQueuePauseReason;
  readonly resumedAfterRunId?: string;
  readonly items: readonly AgentMessageQueueItem[];
  readonly accepted?: AcceptedAgentMessageQueueItem;
}

export interface AgentMessageQueueMutation {
  readonly changed: boolean;
  readonly state: AgentMessageQueueState;
}

const queueStoragePrefix = "kanvas:agent-message-queue:v1";
export const agentMessageDeliveryLeaseMs = 30_000;

export function agentMessageQueueStorageKey(
  scope: AgentMessageQueueScope,
): string {
  return [
    queueStoragePrefix,
    scope.principalId,
    scope.workspaceId,
    scope.threadId,
  ]
    .map(encodeURIComponent)
    .join(":");
}

export function emptyAgentMessageQueueState(): AgentMessageQueueState {
  return { version: 1, revision: 0, paused: false, items: [] };
}

function nextState(
  state: AgentMessageQueueState,
  patch: Omit<Partial<AgentMessageQueueState>, "revision" | "version">,
): AgentMessageQueueState {
  return { ...state, ...patch, version: 1, revision: state.revision + 1 };
}

function snapshotRequest(
  request: CreateWorkspaceAgentMessageBody,
): CreateWorkspaceAgentMessageBody {
  return JSON.parse(JSON.stringify(request)) as CreateWorkspaceAgentMessageBody;
}

function isQueueRequest(
  value: unknown,
  scope: AgentMessageQueueScope,
): value is CreateWorkspaceAgentMessageBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Readonly<Record<string, unknown>>;
  return (
    typeof request.message === "string" &&
    request.message.trim().length > 0 &&
    request.threadId === scope.threadId
  );
}

const pauseReasons: ReadonlySet<string> = new Set([
  "stopped",
  "cancelled",
  "failed",
  "waiting_approval",
  "waiting_for_user",
  "delivery_uncertain",
  "delivery_failed",
  "branch_changed",
  "manual",
]);

function parseQueueItem(
  value: unknown,
  scope: AgentMessageQueueScope,
): AgentMessageQueueItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Readonly<Record<string, unknown>>;
  if (
    typeof item.id !== "string" ||
    typeof item.idempotencyKey !== "string" ||
    !item.idempotencyKey.startsWith("agent-message:") ||
    typeof item.enqueuedAt !== "string" ||
    typeof item.updatedAt !== "string" ||
    !["queued", "sending", "uncertain"].includes(String(item.status)) ||
    !isQueueRequest(item.request, scope)
  ) {
    return undefined;
  }
  const status = item.status as AgentMessageQueueItemStatus;
  return {
    id: item.id,
    idempotencyKey: item.idempotencyKey,
    request: snapshotRequest(item.request),
    enqueuedAt: item.enqueuedAt,
    updatedAt: item.updatedAt,
    status,
    ...(status === "sending" && typeof item.deliveryOwnerId === "string"
      ? { deliveryOwnerId: item.deliveryOwnerId }
      : {}),
    ...(status === "sending" &&
    typeof item.deliveryLeaseExpiresAt === "number" &&
    Number.isFinite(item.deliveryLeaseExpiresAt)
      ? { deliveryLeaseExpiresAt: item.deliveryLeaseExpiresAt }
      : {}),
  };
}

function parseAcceptedItem(
  value: unknown,
): AcceptedAgentMessageQueueItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const accepted = value as Readonly<Record<string, unknown>>;
  return typeof accepted.itemId === "string" &&
    typeof accepted.idempotencyKey === "string" &&
    accepted.idempotencyKey.startsWith("agent-message:") &&
    typeof accepted.runId === "string" &&
    typeof accepted.acceptedAt === "string"
    ? {
        itemId: accepted.itemId,
        idempotencyKey: accepted.idempotencyKey,
        runId: accepted.runId,
        acceptedAt: accepted.acceptedAt,
      }
    : undefined;
}

export function parseAgentMessageQueueState(
  value: unknown,
  scope: AgentMessageQueueScope,
): AgentMessageQueueState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyAgentMessageQueueState();
  }
  const stored = value as Readonly<Record<string, unknown>>;
  if (stored.version !== 1 || !Array.isArray(stored.items)) {
    return emptyAgentMessageQueueState();
  }
  const pauseReason =
    typeof stored.pauseReason === "string" &&
    pauseReasons.has(stored.pauseReason)
      ? (stored.pauseReason as AgentMessageQueuePauseReason)
      : undefined;
  const accepted = parseAcceptedItem(stored.accepted);
  return {
    version: 1,
    revision:
      typeof stored.revision === "number" &&
      Number.isSafeInteger(stored.revision) &&
      stored.revision >= 0
        ? stored.revision
        : 0,
    paused: stored.paused === true,
    ...(pauseReason ? { pauseReason } : {}),
    ...(typeof stored.resumedAfterRunId === "string"
      ? { resumedAfterRunId: stored.resumedAfterRunId }
      : {}),
    items: stored.items.flatMap((item) => {
      const parsed = parseQueueItem(item, scope);
      return parsed ? [parsed] : [];
    }),
    ...(accepted ? { accepted } : {}),
  };
}

export function readAgentMessageQueue(
  scope: AgentMessageQueueScope,
  storage?: Pick<Storage, "getItem">,
): AgentMessageQueueState {
  let target = storage;
  if (!target) {
    try {
      target = typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      return emptyAgentMessageQueueState();
    }
  }
  if (!target) return emptyAgentMessageQueueState();
  try {
    return parseAgentMessageQueueState(
      JSON.parse(target.getItem(agentMessageQueueStorageKey(scope)) ?? "null"),
      scope,
    );
  } catch {
    return emptyAgentMessageQueueState();
  }
}

export function persistAgentMessageQueue(
  scope: AgentMessageQueueScope,
  state: AgentMessageQueueState,
  storage?: Pick<Storage, "setItem">,
): boolean {
  let target = storage;
  if (!target) {
    try {
      target = typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      return false;
    }
  }
  if (!target) return false;
  try {
    target.setItem(agentMessageQueueStorageKey(scope), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function enqueueAgentMessage(
  state: AgentMessageQueueState,
  scope: AgentMessageQueueScope,
  request: CreateWorkspaceAgentMessageBody,
  options: {
    readonly createId?: () => string;
    readonly idempotencyKey?: string;
    readonly now?: () => Date;
  } = {},
): {
  readonly item: AgentMessageQueueItem;
  readonly state: AgentMessageQueueState;
} {
  if (request.threadId !== scope.threadId) {
    throw new Error("Queued Agent message must target its scoped Thread.");
  }
  if (
    options.idempotencyKey !== undefined &&
    !options.idempotencyKey.startsWith("agent-message:")
  ) {
    throw new Error("Queued Agent message requires an Agent message key.");
  }
  const createId = options.createId ?? (() => crypto.randomUUID());
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const id = createId();
  const item: AgentMessageQueueItem = {
    id,
    idempotencyKey: options.idempotencyKey ?? `agent-message:${id}`,
    request: snapshotRequest(request),
    enqueuedAt: timestamp,
    updatedAt: timestamp,
    status: "queued",
  };
  return { item, state: nextState(state, { items: [...state.items, item] }) };
}

export function takeQueuedAgentMessage(
  state: AgentMessageQueueState,
  itemId: string,
): AgentMessageQueueMutation & { readonly item?: AgentMessageQueueItem } {
  const current = state.items.find((item) => item.id === itemId);
  if (!current || current.status !== "queued") {
    return { changed: false, state };
  }
  return {
    changed: true,
    item: current,
    state: nextState(state, {
      items: state.items.filter((item) => item.id !== itemId),
    }),
  };
}

export function removeQueuedAgentMessage(
  state: AgentMessageQueueState,
  itemId: string,
): AgentMessageQueueMutation {
  const current = state.items.find((item) => item.id === itemId);
  if (!current || current.status !== "queued") {
    return { changed: false, state };
  }
  return {
    changed: true,
    state: nextState(state, {
      items: state.items.filter((item) => item.id !== itemId),
    }),
  };
}

export function pauseAgentMessageQueue(
  state: AgentMessageQueueState,
  reason: AgentMessageQueuePauseReason,
): AgentMessageQueueMutation {
  if (state.paused && state.pauseReason === reason) {
    return { changed: false, state };
  }
  const withoutResume = { ...state };
  delete withoutResume.resumedAfterRunId;
  return {
    changed: true,
    state: {
      ...withoutResume,
      paused: true,
      pauseReason: reason,
      revision: state.revision + 1,
    },
  };
}

export function resumeAgentMessageQueue(
  state: AgentMessageQueueState,
  afterRunId?: string,
): AgentMessageQueueMutation {
  if (!state.paused) return { changed: false, state };
  const withoutReason = { ...state };
  delete withoutReason.pauseReason;
  return {
    changed: true,
    state: {
      ...withoutReason,
      paused: false,
      revision: state.revision + 1,
      ...(afterRunId ? { resumedAfterRunId: afterRunId } : {}),
    },
  };
}

export function nextAgentMessageForDelivery(
  state: AgentMessageQueueState,
): AgentMessageQueueItem | undefined {
  if (state.paused || state.accepted) return undefined;
  const item = state.items[0];
  return item && (item.status === "queued" || item.status === "uncertain")
    ? item
    : undefined;
}

export function startAgentMessageDelivery(
  state: AgentMessageQueueState,
  itemId: string,
  ownerId: string,
  now = Date.now(),
): AgentMessageQueueMutation {
  const index = state.items.findIndex((item) => item.id === itemId);
  const current = state.items[index];
  if (
    state.paused ||
    state.accepted ||
    index !== 0 ||
    !current ||
    (current.status !== "queued" && current.status !== "uncertain")
  ) {
    return { changed: false, state };
  }
  const items = [...state.items];
  items[index] = {
    ...current,
    status: "sending",
    deliveryOwnerId: ownerId,
    deliveryLeaseExpiresAt: now + agentMessageDeliveryLeaseMs,
    updatedAt: new Date(now).toISOString(),
  };
  return { changed: true, state: nextState(state, { items }) };
}

export function recoverExpiredAgentMessageDelivery(
  state: AgentMessageQueueState,
  now = Date.now(),
): AgentMessageQueueMutation {
  const current = state.items[0];
  if (
    !current ||
    current.status !== "sending" ||
    (current.deliveryLeaseExpiresAt ?? 0) > now
  ) {
    return { changed: false, state };
  }
  const recovered: AgentMessageQueueItem = {
    id: current.id,
    idempotencyKey: current.idempotencyKey,
    request: current.request,
    enqueuedAt: current.enqueuedAt,
    updatedAt: new Date(now).toISOString(),
    status: "uncertain",
  };
  return {
    changed: true,
    state: nextState(state, {
      items: [recovered, ...state.items.slice(1)],
      paused: true,
      pauseReason: "delivery_uncertain",
    }),
  };
}

export function failAgentMessageDelivery(
  state: AgentMessageQueueState,
  itemId: string,
  ownerId: string,
  uncertain: boolean,
  now = Date.now(),
): AgentMessageQueueMutation {
  const index = state.items.findIndex((item) => item.id === itemId);
  const current = state.items[index];
  if (
    !current ||
    current.status !== "sending" ||
    current.deliveryOwnerId !== ownerId
  ) {
    return { changed: false, state };
  }
  const items = [...state.items];
  items[index] = {
    id: current.id,
    idempotencyKey: current.idempotencyKey,
    request: current.request,
    enqueuedAt: current.enqueuedAt,
    updatedAt: new Date(now).toISOString(),
    status: uncertain ? "uncertain" : "queued",
  };
  return {
    changed: true,
    state: nextState(state, {
      items,
      paused: true,
      pauseReason: uncertain ? "delivery_uncertain" : "delivery_failed",
    }),
  };
}

export function deferAgentMessageDelivery(
  state: AgentMessageQueueState,
  itemId: string,
  ownerId: string,
  now = Date.now(),
): AgentMessageQueueMutation {
  const index = state.items.findIndex((item) => item.id === itemId);
  const current = state.items[index];
  if (
    !current ||
    current.status !== "sending" ||
    current.deliveryOwnerId !== ownerId
  ) {
    return { changed: false, state };
  }
  const items = [...state.items];
  items[index] = {
    id: current.id,
    idempotencyKey: current.idempotencyKey,
    request: current.request,
    enqueuedAt: current.enqueuedAt,
    updatedAt: new Date(now).toISOString(),
    status: "queued",
  };
  return { changed: true, state: nextState(state, { items }) };
}

export function acceptAgentMessageDelivery(
  state: AgentMessageQueueState,
  itemId: string,
  ownerId: string,
  accepted: AgentRunAccepted,
  now = new Date(),
): AgentMessageQueueMutation {
  const index = state.items.findIndex((item) => item.id === itemId);
  const current = state.items[index];
  if (
    accepted.threadId !== current?.request.threadId ||
    !current ||
    current.status !== "sending" ||
    current.deliveryOwnerId !== ownerId
  ) {
    return { changed: false, state };
  }
  return {
    changed: true,
    state: nextState(state, {
      items: state.items.filter((item) => item.id !== itemId),
      accepted: {
        itemId,
        idempotencyKey: current.idempotencyKey,
        runId: accepted.runId,
        acceptedAt: now.toISOString(),
      },
    }),
  };
}

export function settleAcceptedAgentMessage(
  state: AgentMessageQueueState,
  runId: string,
): AgentMessageQueueMutation {
  if (state.accepted?.runId !== runId) {
    return { changed: false, state };
  }
  const withoutAccepted = { ...state };
  delete withoutAccepted.accepted;
  return {
    changed: true,
    state: { ...withoutAccepted, revision: state.revision + 1 },
  };
}

function queueLockName(scope: AgentMessageQueueScope): string {
  return `kanvas-agent-message-queue:${scope.principalId}:${scope.workspaceId}:${scope.threadId}`;
}

interface WebLockManager {
  request<T>(
    name: string,
    options: { readonly ifAvailable: true; readonly mode: "exclusive" },
    callback: (lock: object | null) => Promise<T | undefined>,
  ): Promise<T | undefined>;
}

export async function withAgentMessageQueueDeliveryLock<T>(
  scope: AgentMessageQueueScope,
  operation: () => Promise<T>,
  lockManager: WebLockManager | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.locks,
): Promise<T | undefined> {
  if (!lockManager) return undefined;
  return lockManager.request(
    `${queueLockName(scope)}:delivery`,
    { ifAvailable: true, mode: "exclusive" },
    (lock) => (lock ? operation() : Promise.resolve(undefined)),
  );
}

interface MutationLockManager {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
}

export async function withAgentMessageQueueMutationLock<T>(
  scope: AgentMessageQueueScope,
  operation: () => T | Promise<T>,
  lockManager: MutationLockManager | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator.locks,
): Promise<T> {
  if (!lockManager) {
    throw new Error("Agent message queue requires the Web Locks API.");
  }
  return lockManager.request(
    `${queueLockName(scope)}:mutation`,
    { mode: "exclusive" },
    operation,
  );
}
