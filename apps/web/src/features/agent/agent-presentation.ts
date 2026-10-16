import type {
  AgentHubAgent,
  AgentThreadView,
  WorkflowRunDetails,
} from "@kanvas/contracts/api";

import type { StatusTagTone } from "../../components/status-tag.js";

export const agentCardClassName =
  "flex min-h-12 items-center gap-2.5 rounded-[12px] px-3 py-2 text-left transition-[background-color,transform] active:scale-[0.99] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transform-none motion-reduce:transition-none";

export const agentCardIconClassName =
  "grid size-8 shrink-0 place-items-center rounded-[8px] bg-paper text-sm text-primary";

export function agentDisplaySummary(
  agent: Pick<AgentHubAgent, "managementKind" | "summary" | "systemKey">,
  workspaceDefaultSummary: string,
): string {
  return agent.managementKind === "system" &&
    agent.systemKey === "workspace-default"
    ? workspaceDefaultSummary
    : agent.summary;
}

export type AgentTaskPresentationStatus =
  | AgentThreadView["tasks"][number]["lifecycleStatus"]
  | "completed"
  | "queued"
  | "waiting"
  | "working"
  | "cancelling";

export function agentTaskStatusTone(
  status: AgentTaskPresentationStatus,
): StatusTagTone {
  if (status === "completed" || status === "succeeded") return "positive";
  if (status === "failed") return "danger";
  if (
    status === "waiting" ||
    status === "waiting_approval" ||
    status === "cancelling"
  ) {
    return "warning";
  }
  if (status === "queued" || status === "running" || status === "working") {
    return "info";
  }
  return "neutral";
}

export function agentTaskPresentationStatus(
  taskStatus: AgentThreadView["tasks"][number]["lifecycleStatus"],
  workflowStatus: WorkflowRunDetails["lifecycleStatus"] | undefined,
  kind?: AgentThreadView["tasks"][number]["kind"],
  capabilityStatus?: AgentThreadView["tasks"][number]["capabilityRunStatus"],
): AgentTaskPresentationStatus {
  if (taskStatus === "unavailable") return "unavailable";
  workflowStatus = capabilityStatus ?? workflowStatus;
  if ((kind === "skill" || kind === "brand") && taskStatus === "succeeded")
    return "completed";
  if (workflowStatus === "completed") return "completed";
  if (workflowStatus === "queued") return "queued";
  if (workflowStatus === "running") return "working";
  if (workflowStatus === "waiting") return "waiting";
  if (workflowStatus === "cancelling") return "cancelling";
  if (workflowStatus === "failed") return "failed";
  if (workflowStatus === "cancelled") return "cancelled";
  return taskStatus;
}
