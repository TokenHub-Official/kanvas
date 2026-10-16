/** Unpromoted conversation content is accessible only to its creating principal. */
export function privateConversationArtifactOwner(facts: {
  readonly assetId: string | null;
  readonly createdByPrincipalId: string | null;
  readonly createdByCapabilityPrincipalId: string | null;
  readonly capabilityInvocationKind: string | null;
  readonly createdByWorkflowPrincipalId: string | null;
  readonly workflowIdempotencyKey: string | null;
  readonly metadata: unknown;
}): string | undefined {
  if (facts.assetId) return undefined;
  const metadata: unknown =
    typeof facts.metadata === "string"
      ? JSON.parse(facts.metadata)
      : facts.metadata;
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "importedFrom" in metadata &&
    metadata.importedFrom === "agent-composer"
  ) {
    return facts.createdByPrincipalId ?? undefined;
  }
  if (facts.workflowIdempotencyKey?.startsWith("agent-workflow:")) {
    return facts.createdByWorkflowPrincipalId ?? undefined;
  }
  return facts.capabilityInvocationKind === "agent"
    ? (facts.createdByCapabilityPrincipalId ?? undefined)
    : undefined;
}
