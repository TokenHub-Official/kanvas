import type { ProviderSettingSummary } from "@kanvas/contracts/api";

import type { StatusTagTone } from "../../components/status-tag.js";

export type ProviderLifecycleKey = "active" | "disabled" | "draft" | "revoked";

export function providerLifecyclePresentation(
  provider: Pick<ProviderSettingSummary, "lifecycle">,
): {
  readonly key: ProviderLifecycleKey;
  readonly tone: StatusTagTone;
} {
  switch (provider.lifecycle) {
    case "active":
      return { key: "active", tone: "positive" };
    case "disabled":
      return { key: "disabled", tone: "neutral" };
    case "revoked":
      return { key: "revoked", tone: "danger" };
    case "draft":
      return { key: "draft", tone: "warning" };
  }
}

export function providerValidationTone(
  validation: ProviderSettingSummary["validation"],
): StatusTagTone {
  if (validation === "passed") return "positive";
  if (validation === "failed") return "danger";
  return "warning";
}

export function formatProviderCheckDate(
  value: string,
  locale: string,
  timeZone?: string,
): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
