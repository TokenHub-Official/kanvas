import { useQuery } from "@tanstack/react-query";
import { toolLibrary } from "./library-api.js";

const availabilityRefreshMilliseconds = 30_000;

/** Navigation never advertises a tool collection the current workspace cannot use. */
export function useToolAvailability(
  workspaceId: string,
  permissions: readonly string[],
): boolean {
  const allowed = permissions.includes("workspace.read");
  const catalogue = useQuery({
    queryKey: ["tools", workspaceId],
    queryFn: () => toolLibrary.list(workspaceId),
    enabled: allowed,
    retry: false,
    staleTime: availabilityRefreshMilliseconds,
    refetchInterval: availabilityRefreshMilliseconds,
    refetchOnWindowFocus: "always",
  });
  return allowed && !catalogue.isError && Boolean(catalogue.data?.items.length);
}
