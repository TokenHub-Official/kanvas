export interface WorkflowRunAssetAdoption {
  readonly idempotencyKey: string;
  readonly assetId?: string;
}

export type WorkflowRunAssetAdoptions = Readonly<
  Record<string, WorkflowRunAssetAdoption>
>;

export function prepareWorkflowRunAssetAdoption(
  current: WorkflowRunAssetAdoptions,
  artifactId: string,
  createId: () => string,
): {
  readonly adoption: WorkflowRunAssetAdoption;
  readonly state: WorkflowRunAssetAdoptions;
} {
  const existing = current[artifactId];
  if (existing) return { adoption: existing, state: current };
  const idempotencyKey = createId();
  const adoption = { idempotencyKey };
  return {
    adoption,
    state: { ...current, [artifactId]: adoption },
  };
}

export function completeWorkflowRunAssetAdoption(
  current: WorkflowRunAssetAdoptions,
  artifactId: string,
  assetId: string,
): WorkflowRunAssetAdoptions {
  const adoption = current[artifactId];
  if (!adoption) return current;
  return {
    ...current,
    [artifactId]: { ...adoption, assetId },
  };
}
