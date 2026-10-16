import { fetchCapabilityRun } from "../../api/transport.js";

type CapabilityRun = Awaited<ReturnType<typeof fetchCapabilityRun>>;

/** Cards, details and failure guidance observe the same task identity and cache. */
export function agentCapabilityTaskQueryOptions(
  workspaceId: string,
  capabilityRunId: string | undefined,
  canReadCapabilities: boolean,
) {
  return {
    queryKey: ["agent-capability-task", workspaceId, capabilityRunId],
    queryFn: () => fetchCapabilityRun(workspaceId, capabilityRunId!),
    enabled: Boolean(capabilityRunId) && canReadCapabilities,
    refetchInterval: (query: {
      state: { data: CapabilityRun | undefined };
    }) => {
      const status = query.state.data?.lifecycleStatus;
      return status && ["cancelled", "completed", "failed"].includes(status)
        ? (false as const)
        : 1_000;
    },
    refetchIntervalInBackground: false,
    retry: false as const,
  };
}
