import type { ProviderSettingSummary } from "@kanvas/contracts/api";

import type { StatusBadgeTone } from "../../components/status-badge.js";

export function providerSettingStatus(provider: ProviderSettingSummary): {
  readonly key: "active" | "revoked" | "ready" | "disabled" | "inactive";
  readonly label: string;
  readonly tone: StatusBadgeTone;
} {
  if (provider.lifecycle === "active") {
    return {
      key: "active",
      label: "使用中",
      tone: "positive",
    };
  }
  if (provider.lifecycle === "revoked") {
    return {
      key: "revoked",
      label: "不可用",
      tone: "danger",
    };
  }
  if (provider.validation === "passed" && !provider.activatedAt) {
    return {
      key: "ready",
      label: "待启用",
      tone: "warning",
    };
  }
  if (provider.activatedAt) {
    return {
      key: "disabled",
      label: "已停用",
      tone: "neutral",
    };
  }
  return {
    key: "inactive",
    label: "未启用",
    tone: "neutral",
  };
}

export function providerSettingActions(provider: ProviderSettingSummary): {
  readonly canActivate: boolean;
  readonly canDisable: boolean;
  readonly canRotate: boolean;
  readonly canRefreshCatalog: boolean;
  readonly canReviewCatalog: boolean;
  readonly canValidate: boolean;
  readonly activationKey: "activate" | "reactivate";
  readonly activationLabel: "启用" | "重新启用";
} {
  const canValidate =
    provider.lifecycle !== "active" &&
    provider.lifecycle !== "revoked" &&
    (provider.validation === "pending" || provider.validation === "failed");
  const canActivate =
    provider.lifecycle === "disabled" && provider.validation === "passed";
  return {
    canActivate,
    canDisable: provider.lifecycle === "active",
    canRotate: provider.lifecycle === "active",
    canRefreshCatalog:
      provider.canRefreshModelCatalog && provider.secretConfigured,
    canReviewCatalog: provider.modelCatalog?.changesPendingReview === true,
    canValidate,
    activationKey: provider.activatedAt ? "reactivate" : "activate",
    activationLabel: provider.activatedAt ? "重新启用" : "启用",
  };
}
