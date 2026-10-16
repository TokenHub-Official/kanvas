export const expectedGenerationTasksImageProtocolRevision =
  "generation.tasks.images.v2.response-drift.v3";

const workflowAdapterKeys = Object.freeze({
  reconstructiveUpscale: "generation-tasks.image.upscale.reconstructive.v1",
  canvasExpand: "generation-tasks.image.canvas-expand.v1",
  objectRemove: "generation-tasks.image.object-remove.v1",
  imageGenerate: "generation-tasks.image.generate.v1",
  imageEdit: "generation-tasks.image.edit.v1",
});

function invalid(message) {
  throw new Error(`Provider canary runtime preflight failed: ${message}`);
}

export function assertProviderCanaryRuntime(runtime, selectedWorkflowKeys) {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    return invalid("the Provider Worker returned an invalid runtime document.");
  }
  if (runtime.status !== "ok" || runtime.processRole !== "worker") {
    return invalid("the Provider Worker is not ready.");
  }
  if (
    !Array.isArray(runtime.roles) ||
    !runtime.roles.includes("provider-execution") ||
    !runtime.roles.includes("reconciler")
  ) {
    return invalid(
      "the Worker must run provider-execution and reconciler roles.",
    );
  }
  if (
    runtime.generationTasksImageProtocolRevision !==
    expectedGenerationTasksImageProtocolRevision
  ) {
    return invalid(
      `expected protocol revision ${expectedGenerationTasksImageProtocolRevision}. Restart the Provider Worker from the current build before submitting.`,
    );
  }
  if (!Array.isArray(runtime.providerAdapterKeys)) {
    return invalid(
      "the Provider Worker did not disclose its active Adapter keys.",
    );
  }
  for (const workflowKey of selectedWorkflowKeys) {
    const adapterKey = workflowAdapterKeys[workflowKey];
    if (!adapterKey || !runtime.providerAdapterKeys.includes(adapterKey)) {
      return invalid(
        `the Provider Worker is missing ${adapterKey ?? workflowKey}.`,
      );
    }
  }
  return Object.freeze({
    serviceVersion:
      typeof runtime.serviceVersion === "string"
        ? runtime.serviceVersion
        : "unknown",
    startedAt:
      typeof runtime.startedAt === "string" ? runtime.startedAt : undefined,
    protocolRevision: runtime.generationTasksImageProtocolRevision,
  });
}

export async function verifyProviderCanaryRuntime({
  baseUrl,
  selectedWorkflowKeys,
  fetcher = fetch,
}) {
  let response;
  try {
    response = await fetcher(`${baseUrl}/health/provider-runtime`, {
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return invalid("the Provider Worker runtime endpoint is unavailable.");
  }
  if (response.status !== 200) {
    return invalid(
      `the Provider Worker runtime endpoint returned HTTP ${String(
        response.status,
      )}. Restart it from the current build before submitting.`,
    );
  }
  let runtime;
  try {
    runtime = await response.json();
  } catch {
    return invalid("the Provider Worker returned non-JSON runtime evidence.");
  }
  return assertProviderCanaryRuntime(runtime, selectedWorkflowKeys);
}
