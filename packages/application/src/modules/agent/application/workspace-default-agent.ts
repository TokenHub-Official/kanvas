export type AgentManagementKind = "system" | "workspace";

export interface AgentManagementIdentityV1 {
  readonly managementKind: AgentManagementKind;
  readonly systemKey?: string;
}

export const workspaceDefaultAgentProfileKeyV1 = "first-party.main-agent";
export const workspaceDefaultAgentSystemKeyV1 = "workspace-default";

export function agentManagementIdentityForProfileV1(
  profileKey: string,
): AgentManagementIdentityV1 {
  return profileKey === workspaceDefaultAgentProfileKeyV1
    ? Object.freeze({
        managementKind: "system" as const,
        systemKey: workspaceDefaultAgentSystemKeyV1,
      })
    : Object.freeze({ managementKind: "workspace" as const });
}

export function isSystemManagedAgentV1(value: {
  readonly managementKind: AgentManagementKind;
}): boolean {
  return value.managementKind === "system";
}
