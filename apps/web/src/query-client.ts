import { subscribeResourceStateChanges } from "./api/resource-state-events.js";
import { shareAgentThreadSnapshot } from "./features/agent/agent-thread-snapshot.js";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
    },
  },
});

queryClient.setQueryDefaults(["agent-thread"], {
  structuralSharing: shareAgentThreadSnapshot,
});

if (typeof window !== "undefined") {
  const dispose = subscribeResourceStateChanges(queryClient);
  import.meta.hot?.dispose(dispose);
}
