import type { WorkflowRunListState } from "@kanvas/contracts/api";

const ACTIVE_RUN_POLL_INTERVAL_MS = 2_000;
export type WorkflowRunsViewState = WorkflowRunListState | "all";

export function workflowRunsRefetchIntervalV1(
  state: WorkflowRunsViewState,
  hasError: boolean,
): number | false {
  return (state === "all" || state === "active") && !hasError
    ? ACTIVE_RUN_POLL_INTERVAL_MS
    : false;
}
