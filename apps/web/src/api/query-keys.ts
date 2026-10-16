export const workspaceQueryKeys = Object.freeze({
  agentModelSettings(workspaceId: string) {
    return ["workspace-agent-model-settings", workspaceId] as const;
  },
  capabilityDefinitions(workspaceId: string) {
    return ["workspace-capability-definitions", workspaceId] as const;
  },
  creationEntrypoints(workspaceId: string) {
    return ["workspace", workspaceId, "creation-entrypoints"] as const;
  },
  canvasCapabilities(
    workspaceId: string,
    actionGroup: string,
    selectedSemanticType: string,
  ) {
    return [
      "workspace",
      workspaceId,
      "canvas-capabilities",
      actionGroup,
      selectedSemanticType,
    ] as const;
  },
  providerSettings(workspaceId: string) {
    return ["provider-settings", workspaceId] as const;
  },
  models(workspaceId: string) {
    return ["workspace-models", workspaceId] as const;
  },
  modelResources(workspaceId: string) {
    return ["workspace-model-resources", workspaceId] as const;
  },
  providerModelCatalog(workspaceId: string, providerSettingId: string) {
    return ["provider-model-catalog", workspaceId, providerSettingId] as const;
  },
  team(workspaceId: string) {
    return ["workspace-team", workspaceId] as const;
  },
  usageSummary(workspaceId: string) {
    return ["workspace-usage-summary", workspaceId] as const;
  },
});
