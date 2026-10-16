import type {
  ProviderModelPricingConfiguration,
  ProviderSettingSummary,
} from "@kanvas/contracts/api";

export type ProviderActivationPricingMode = "fixed" | "provider_reported";

export interface ProviderActivationPricingEntry {
  readonly providerModelId: string;
  readonly mode: ProviderActivationPricingMode;
  readonly amount: string;
}

export function validProviderPricingAmount(value: string): boolean {
  return (
    /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u.test(value) &&
    Number(value) > 0
  );
}

export function createProviderActivationPricingEntries(
  provider: ProviderSettingSummary,
): readonly ProviderActivationPricingEntry[] {
  return Object.freeze(
    provider.modelKeys.map((providerModelId) =>
      Object.freeze({
        providerModelId,
        mode: "fixed" as const,
        amount: "",
      }),
    ),
  );
}

export function compileProviderActivationPricing(
  entries: readonly ProviderActivationPricingEntry[],
):
  | {
      readonly status: "ready";
      readonly configurations: readonly ProviderModelPricingConfiguration[];
    }
  | {
      readonly status: "invalid";
      readonly invalidModelIds: readonly string[];
    } {
  const invalidModelIds = entries.flatMap((entry) =>
    validProviderPricingAmount(entry.amount) ? [] : [entry.providerModelId],
  );
  if (invalidModelIds.length > 0) {
    return Object.freeze({
      status: "invalid",
      invalidModelIds: Object.freeze(invalidModelIds),
    });
  }
  return Object.freeze({
    status: "ready",
    configurations: Object.freeze(
      entries.map((entry) =>
        entry.mode === "fixed"
          ? Object.freeze({
              providerModelId: entry.providerModelId,
              billingMode: "fixed" as const,
              fixedChargeAmount: entry.amount,
            })
          : Object.freeze({
              providerModelId: entry.providerModelId,
              billingMode: "provider_reported" as const,
              maximumChargeAmount: entry.amount,
            }),
      ),
    ),
  });
}
