import type { UserCapabilityCatalog } from "@kanvas/contracts/api";

export async function fetchUserCapabilities(
  workspaceId: string,
  locale: string,
): Promise<UserCapabilityCatalog> {
  const response = await fetch("/api/v1/user-capabilities", {
    credentials: "include",
    headers: {
      accept: "application/json",
      "accept-language": locale,
      "x-kanvas-workspace-id": workspaceId,
    },
  });
  if (!response.ok) throw new Error("Capability discovery failed.");
  return (await response.json()) as UserCapabilityCatalog;
}
