import type {
  RuntimeConfigurationDocument,
  RuntimeConfigurationOverview,
  ResultDownloadRule,
} from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";

export function configurationChanges(
  before: RuntimeConfigurationDocument | undefined,
  after: RuntimeConfigurationDocument,
) {
  const fields = [
    { key: "activate", before: before?.activated, after: after.activated },
    {
      key: "modelCalls",
      before: before?.agent.maximumModelCalls,
      after: after.agent.maximumModelCalls,
    },
    {
      key: "toolCalls",
      before: before?.agent.maximumToolCalls,
      after: after.agent.maximumToolCalls,
    },
    {
      key: "timeout",
      before: before?.agent.timeoutSeconds,
      after: after.agent.timeoutSeconds,
    },
    {
      key: "defaultRule",
      before: before?.downloads.defaults,
      after: after.downloads.defaults,
    },
  ];
  const services = new Set(
    [...(before?.downloads.providers ?? []), ...after.downloads.providers].map(
      (entry) => `${entry.workspaceId}:${entry.providerEndpointId}`,
    ),
  );
  const serviceFields = [...services].map((key) => ({
    key,
    before: before?.downloads.providers.find(
      (entry) => `${entry.workspaceId}:${entry.providerEndpointId}` === key,
    )?.rule,
    after: after.downloads.providers.find(
      (entry) => `${entry.workspaceId}:${entry.providerEndpointId}` === key,
    )?.rule,
  }));
  const comparable = (value: unknown) => {
    if (value && typeof value === "object" && "allowedOrigins" in value) {
      const rule = value as ResultDownloadRule;
      return JSON.stringify({
        enabled: rule.enabled,
        allowedOrigins:
          rule.allowedOrigins === null ? null : [...rule.allowedOrigins].sort(),
      });
    }
    return JSON.stringify(value);
  };
  return [...fields, ...serviceFields].filter(
    (field) => comparable(field.before) !== comparable(field.after),
  );
}

export function RuntimeConfigurationReview({
  before,
  after,
  overview,
}: {
  before: RuntimeConfigurationDocument | undefined;
  after: RuntimeConfigurationDocument;
  overview: RuntimeConfigurationOverview;
}) {
  const { t } = useTranslation();
  const changes = configurationChanges(before, after);
  function valueContent(value: unknown, service: boolean) {
    if (value === undefined)
      return t(
        service
          ? "runtimeConfiguration.inheritsDefault"
          : "runtimeConfiguration.notSaved",
      );
    if (typeof value === "boolean")
      return t(
        value
          ? "runtimeConfiguration.usePage"
          : "runtimeConfiguration.saveOnly",
      );
    if (typeof value === "number") return value;
    const rule = value as ResultDownloadRule;
    return (
      <div className="grid gap-2">
        <span>
          {t(
            rule.enabled
              ? "runtimeConfiguration.enabled"
              : "runtimeConfiguration.disabled",
          )}
        </span>
        {rule.allowedOrigins === null ? (
          <span>{t("runtimeConfiguration.unrestricted")}</span>
        ) : (
          <>
            <span className="text-muted">
              {rule.allowedOrigins.length
                ? t("runtimeConfiguration.originCount", {
                    count: rule.allowedOrigins.length,
                  })
                : t("runtimeConfiguration.denyAll")}
            </span>
            <ul className="m-0 list-none p-0 grid gap-1">
              {rule.allowedOrigins.map((origin) => (
                <li className="break-all text-xs" key={origin}>
                  {origin}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }
  if (!changes.length)
    return (
      <p className="m-0 text-muted">{t("runtimeConfiguration.noChanges")}</p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <caption className="text-left mb-3 text-muted">
          {t("runtimeConfiguration.changedCount", { count: changes.length })}
        </caption>
        <thead>
          <tr className="border-b border-line">
            {["setting", "before", "after"].map((key) => (
              <th
                className="px-3 py-2 font-medium text-muted"
                key={key}
                scope="col"
              >
                {t(`runtimeConfiguration.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => {
            const service = change.key.includes(":");
            const name = overview.services.find(
              (entry) =>
                `${entry.workspaceId}:${entry.providerEndpointId}` ===
                change.key,
            );
            return (
              <tr className="border-b border-line align-top" key={change.key}>
                <th scope="row" className="w-1/4 px-3 py-4 font-medium">
                  {service
                    ? `${name?.workspaceName ?? ""} / ${name?.name ?? t("runtimeConfiguration.unavailableService")}`
                    : t(`runtimeConfiguration.${change.key}`)}
                </th>
                <td className="w-1/3 px-3 py-4 text-muted">
                  {valueContent(change.before, service)}
                </td>
                <td className="px-3 py-4">
                  {valueContent(change.after, service)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
