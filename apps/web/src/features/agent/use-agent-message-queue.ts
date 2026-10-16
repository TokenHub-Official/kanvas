import type {
  AgentRunAccepted,
  CreateWorkspaceAgentMessageBody,
} from "@kanvas/contracts/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  acceptAgentMessageDelivery,
  agentMessageQueueStorageKey,
  deferAgentMessageDelivery,
  emptyAgentMessageQueueState,
  enqueueAgentMessage,
  failAgentMessageDelivery,
  nextAgentMessageForDelivery,
  parseAgentMessageQueueState,
  pauseAgentMessageQueue,
  persistAgentMessageQueue,
  readAgentMessageQueue,
  recoverExpiredAgentMessageDelivery,
  removeQueuedAgentMessage,
  resumeAgentMessageQueue,
  settleAcceptedAgentMessage,
  startAgentMessageDelivery,
  takeQueuedAgentMessage,
  withAgentMessageQueueDeliveryLock,
  withAgentMessageQueueMutationLock,
  type AgentMessageQueueItem,
  type AgentMessageQueueMutation,
  type AgentMessageQueuePauseReason,
  type AgentMessageQueueScope,
  type AgentMessageQueueState,
} from "./agent-message-queue.js";

interface QueueCommitResult {
  readonly changed: boolean;
  readonly persisted: boolean;
  readonly state: AgentMessageQueueState;
}

interface QueueEnqueueResult extends QueueCommitResult {
  readonly item?: AgentMessageQueueItem;
}

interface QueueTakeResult extends QueueCommitResult {
  readonly item?: AgentMessageQueueItem;
}

type QueueMutationGuard = () => boolean;
const deliveryRecoveryRetryMs = 1_000;

function newestQueueState(
  current: AgentMessageQueueState,
  scope: AgentMessageQueueScope,
  preferMemory: boolean,
): AgentMessageQueueState {
  if (preferMemory) return current;
  const stored = readAgentMessageQueue(scope);
  return stored.revision >= current.revision ? stored : current;
}

function messageQueueLocksAvailable(): boolean {
  try {
    return typeof navigator !== "undefined" && Boolean(navigator.locks);
  } catch {
    return false;
  }
}

export function useAgentMessageQueue(
  scope: AgentMessageQueueScope | undefined,
) {
  const locksAvailable = messageQueueLocksAvailable();
  const scopeKey = scope ? agentMessageQueueStorageKey(scope) : undefined;
  const [state, setState] = useState<AgentMessageQueueState>(() =>
    scope ? readAgentMessageQueue(scope) : emptyAgentMessageQueueState(),
  );
  const [durable, setDurable] = useState(true);
  const stateRef = useRef(state);
  const persistenceFailedRef = useRef(false);
  const activeScopeKeyRef = useRef(scopeKey);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const replaceState = useCallback((next: AgentMessageQueueState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    activeScopeKeyRef.current = scopeKey;
    persistenceFailedRef.current = false;
    setDurable(true);
    replaceState(
      scope ? readAgentMessageQueue(scope) : emptyAgentMessageQueueState(),
    );
  }, [replaceState, scope?.principalId, scope?.threadId, scope?.workspaceId]);

  useEffect(() => {
    if (!scope) return;
    const storageKey = agentMessageQueueStorageKey(scope);
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea !== localStorage || event.key !== storageKey)
        return;
      persistenceFailedRef.current = false;
      setDurable(true);
      try {
        replaceState(
          parseAgentMessageQueueState(
            JSON.parse(event.newValue ?? "null"),
            scope,
          ),
        );
      } catch {
        replaceState(emptyAgentMessageQueueState());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [replaceState, scope?.principalId, scope?.threadId, scope?.workspaceId]);

  const commit = useCallback(
    async (
      update: (current: AgentMessageQueueState) => AgentMessageQueueMutation,
      guard?: QueueMutationGuard,
      retainCurrentOnPersistenceFailure = false,
    ): Promise<QueueCommitResult> => {
      if (!scope)
        return { changed: false, persisted: false, state: stateRef.current };
      const capturedKey = agentMessageQueueStorageKey(scope);
      const capturedState = stateRef.current;
      const preferMemory = persistenceFailedRef.current;
      try {
        return await withAgentMessageQueueMutationLock(scope, () => {
          const current = newestQueueState(capturedState, scope, preferMemory);
          if (guard && !guard()) {
            return { changed: false, persisted: true, state: current };
          }
          const mutation = update(current);
          if (!mutation.changed) {
            if (
              mountedRef.current &&
              activeScopeKeyRef.current === capturedKey &&
              mutation.state !== stateRef.current
            ) {
              replaceState(mutation.state);
            }
            return { ...mutation, persisted: true };
          }
          const persisted = persistAgentMessageQueue(scope, mutation.state);
          if (mountedRef.current && activeScopeKeyRef.current === capturedKey) {
            persistenceFailedRef.current = !persisted;
            setDurable(persisted);
            replaceState(
              !persisted && retainCurrentOnPersistenceFailure
                ? current
                : mutation.state,
            );
          }
          return {
            ...mutation,
            state:
              !persisted && retainCurrentOnPersistenceFailure
                ? current
                : mutation.state,
            persisted,
          };
        });
      } catch {
        return { changed: false, persisted: false, state: capturedState };
      }
    },
    [replaceState, scope?.principalId, scope?.threadId, scope?.workspaceId],
  );

  const enqueue = useCallback(
    async (
      request: CreateWorkspaceAgentMessageBody,
      idempotencyKey?: string,
    ): Promise<QueueEnqueueResult> => {
      if (!scope) {
        return { changed: false, persisted: false, state: stateRef.current };
      }
      const capturedKey = agentMessageQueueStorageKey(scope);
      const capturedState = stateRef.current;
      const preferMemory = persistenceFailedRef.current;
      try {
        return await withAgentMessageQueueMutationLock(scope, () => {
          const current = newestQueueState(capturedState, scope, preferMemory);
          const requestFingerprint = JSON.stringify(request);
          const retained = persistenceFailedRef.current
            ? current.items.find(
                (item) =>
                  JSON.stringify(item.request) === requestFingerprint &&
                  (!idempotencyKey || item.idempotencyKey === idempotencyKey),
              )
            : undefined;
          if (retained) {
            const persisted = persistAgentMessageQueue(scope, current);
            if (
              mountedRef.current &&
              activeScopeKeyRef.current === capturedKey
            ) {
              persistenceFailedRef.current = !persisted;
              setDurable(persisted);
              replaceState(current);
            }
            return {
              changed: false,
              item: retained,
              persisted,
              state: current,
            };
          }
          const enqueued = enqueueAgentMessage(current, scope, request, {
            ...(idempotencyKey ? { idempotencyKey } : {}),
          });
          const persisted = persistAgentMessageQueue(scope, enqueued.state);
          if (mountedRef.current && activeScopeKeyRef.current === capturedKey) {
            persistenceFailedRef.current = !persisted;
            setDurable(persisted);
            replaceState(enqueued.state);
          }
          return {
            changed: true,
            item: enqueued.item,
            persisted,
            state: enqueued.state,
          };
        });
      } catch {
        return { changed: false, persisted: false, state: capturedState };
      }
    },
    [replaceState, scope?.principalId, scope?.threadId, scope?.workspaceId],
  );

  const take = useCallback(
    async (
      itemId: string,
      guard?: QueueMutationGuard,
    ): Promise<QueueTakeResult> => {
      let item: AgentMessageQueueItem | undefined;
      const committed = await commit(
        (current) => {
          const taken = takeQueuedAgentMessage(current, itemId);
          item = taken.item;
          return taken;
        },
        guard,
        true,
      );
      return {
        ...committed,
        ...(committed.persisted && item ? { item } : {}),
      };
    },
    [commit],
  );
  const remove = useCallback(
    (itemId: string) =>
      commit((current) => removeQueuedAgentMessage(current, itemId)),
    [commit],
  );
  const pause = useCallback(
    (reason: AgentMessageQueuePauseReason, guard?: QueueMutationGuard) =>
      commit((current) => pauseAgentMessageQueue(current, reason), guard),
    [commit],
  );
  const resume = useCallback(
    (afterRunId?: string) =>
      commit((current) => resumeAgentMessageQueue(current, afterRunId)),
    [commit],
  );
  const startDelivery = useCallback(
    (itemId: string, ownerId: string, guard?: QueueMutationGuard) =>
      commit(
        (current) => startAgentMessageDelivery(current, itemId, ownerId),
        guard,
      ),
    [commit],
  );
  const failDelivery = useCallback(
    (itemId: string, ownerId: string, uncertain: boolean) =>
      commit((current) =>
        failAgentMessageDelivery(current, itemId, ownerId, uncertain),
      ),
    [commit],
  );
  const deferDelivery = useCallback(
    (itemId: string, ownerId: string) =>
      commit((current) => deferAgentMessageDelivery(current, itemId, ownerId)),
    [commit],
  );
  const acceptDelivery = useCallback(
    (itemId: string, ownerId: string, accepted: AgentRunAccepted) =>
      commit((current) =>
        acceptAgentMessageDelivery(current, itemId, ownerId, accepted),
      ),
    [commit],
  );
  const settleAccepted = useCallback(
    (runId: string, guard?: QueueMutationGuard) =>
      commit((current) => settleAcceptedAgentMessage(current, runId), guard),
    [commit],
  );
  const recoverExpired = useCallback(
    () => commit((current) => recoverExpiredAgentMessageDelivery(current)),
    [commit],
  );

  useEffect(() => {
    if (!scope || !locksAvailable || state.items[0]?.status !== "sending") {
      return;
    }
    const expiresAt = state.items[0].deliveryLeaseExpiresAt ?? 0;
    let cancelled = false;
    let timeout: number | undefined;
    const recoverAfterSenderReleases = async (): Promise<void> => {
      const recovered = await withAgentMessageQueueDeliveryLock(scope, () =>
        recoverExpired(),
      );
      if (!cancelled && recovered === undefined) {
        timeout = window.setTimeout(
          () => void recoverAfterSenderReleases(),
          deliveryRecoveryRetryMs,
        );
      }
    };
    timeout = window.setTimeout(
      () => void recoverAfterSenderReleases(),
      Math.max(0, expiresAt - Date.now()) + 10,
    );
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [locksAvailable, recoverExpired, scope, state.items]);

  return useMemo(
    () => ({
      acceptDelivery,
      durable,
      deferDelivery,
      enqueue,
      failDelivery,
      locksAvailable,
      nextForDelivery:
        durable && locksAvailable
          ? nextAgentMessageForDelivery(state)
          : undefined,
      pause,
      recoverExpired,
      remove,
      resume,
      settleAccepted,
      startDelivery,
      state,
      take,
    }),
    [
      acceptDelivery,
      durable,
      deferDelivery,
      enqueue,
      failDelivery,
      locksAvailable,
      pause,
      recoverExpired,
      remove,
      resume,
      settleAccepted,
      startDelivery,
      state,
      take,
    ],
  );
}
