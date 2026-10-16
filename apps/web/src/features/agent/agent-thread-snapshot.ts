import type { AgentThreadView } from "@kanvas/contracts/api";

type CachedThread = AgentThreadView & { readonly optimisticRunId?: string };

/** The acceptance response establishes ownership before the next server snapshot. */
export function acceptedAgentThreadSnapshot(
  current: AgentThreadView,
  latestRun: NonNullable<AgentThreadView["latestRun"]>,
  expectedCurrentRunId: string | undefined,
): CachedThread {
  if (current.latestRun?.id !== expectedCurrentRunId) return current;
  return { ...current, latestRun, optimisticRunId: latestRun.id };
}

export function mergeAgentThreadSnapshot(
  current: CachedThread | undefined,
  next: CachedThread,
): CachedThread {
  if (!current || current.id !== next.id) return next;
  if (next.optimisticRunId && next.optimisticRunId === next.latestRun?.id)
    return next;
  if (current.viewRevision !== undefined && next.viewRevision === undefined)
    return current;
  if (current.viewRevision !== undefined && next.viewRevision !== undefined) {
    if (next.viewRevision < current.viewRevision) return current;
    if (
      next.viewRevision === current.viewRevision &&
      current.latestRun?.id !== next.latestRun?.id
    )
      return current;
  }
  if (
    current.optimisticRunId &&
    next.latestRun?.id !== current.optimisticRunId &&
    (next.viewRevision === undefined ||
      current.viewRevision === undefined ||
      next.viewRevision <= current.viewRevision)
  )
    return current;
  if (
    current.latestRun?.id === next.latestRun?.id &&
    current.latestRun &&
    next.latestRun &&
    ["succeeded", "failed", "cancelled"].includes(
      current.latestRun.lifecycleStatus,
    ) &&
    ["queued", "running"].includes(next.latestRun.lifecycleStatus)
  )
    return current;
  return next;
}

export function shareAgentThreadSnapshot(
  previous: unknown,
  incoming: unknown,
): unknown {
  if (
    !incoming ||
    typeof incoming !== "object" ||
    !("messages" in incoming) ||
    !("id" in incoming)
  )
    return incoming;
  return mergeAgentThreadSnapshot(
    previous as CachedThread | undefined,
    incoming as CachedThread,
  );
}
