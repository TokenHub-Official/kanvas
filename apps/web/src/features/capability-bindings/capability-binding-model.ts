import type { CapabilityBindingSummary } from "@kanvas/contracts/api";

export function activeBindingCount(
  bindings: readonly CapabilityBindingSummary[],
): number {
  return bindings.filter((binding) => binding.status === "enabled").length;
}
