import type { ProviderSettingSummary } from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";

import { StatusTag } from "../../components/status-tag.js";
import { providerSettingStatus } from "./provider-settings-model.js";

function compactDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ProviderSettingStatusTag({
  provider,
}: {
  readonly provider: ProviderSettingSummary;
}): React.JSX.Element {
  const { t } = useTranslation();
  const status = providerSettingStatus(provider);
  return (
    <StatusTag data-provider-status={status.key} tone={status.tone}>
      {t(`settings.providers.statusLabels.${status.key}`)}
    </StatusTag>
  );
}

export function ProviderSettingValidationText({
  locale,
  provider,
}: {
  readonly locale: string;
  readonly provider: ProviderSettingSummary;
}): React.JSX.Element {
  const { t } = useTranslation();
  const validationLabel = t(
    `settings.providers.validationLabels.${provider.validation}`,
  );
  return (
    <span
      className="whitespace-nowrap text-xs text-muted"
      data-provider-validation={provider.validation}
    >
      {provider.validatedAt
        ? t("settings.providers.validationAt", {
            date: compactDate(provider.validatedAt, locale),
            status: validationLabel,
          })
        : validationLabel}
    </span>
  );
}
