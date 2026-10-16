import { Alert, Tag } from "antd";
import type { RuntimeConfigurationOverview } from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";
import { configurationFeedback } from "./runtime-configuration-feedback.js";

export function RuntimeConfigurationStatus({
  overview,
  checkedAt,
}: {
  overview: RuntimeConfigurationOverview;
  checkedAt: number;
}) {
  const { t } = useTranslation();
  const current = overview.current;
  const feedback = configurationFeedback(overview, checkedAt);
  const rule = current?.document.downloads.defaults;
  const warning =
    current?.document.activated &&
    ["deployment", "mixed", "older"].includes(feedback.state);
  return (
    <section className="rounded-card bg-paper p-5 grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-ui-title">
          {t("runtimeConfiguration.savedConfiguration")}
        </h2>
        <Tag>
          {t(
            current?.document.activated
              ? "runtimeConfiguration.activated"
              : "runtimeConfiguration.notActivated",
          )}
        </Tag>
      </div>
      {current && !current.document.activated ? (
        <Alert type="info" title={t("runtimeConfiguration.savedInactive")} />
      ) : null}
      <dl className="m-0 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">
            {t("runtimeConfiguration.agent")}
          </dt>
          <dd className="m-0 mt-1">
            {current?.document.activated
              ? t("runtimeConfiguration.limitsSummary", current.document.agent)
              : t("runtimeConfiguration.legacyAgent")}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">
            {t("runtimeConfiguration.savedDownloads")}
          </dt>
          <dd className="m-0 mt-1">
            {rule ? (
              <>
                {t(
                  rule.enabled
                    ? "runtimeConfiguration.downloadsOn"
                    : "runtimeConfiguration.disabled",
                )}{" "}
                ·{" "}
                {rule.allowedOrigins === null
                  ? t("runtimeConfiguration.unrestricted")
                  : t("runtimeConfiguration.originCount", {
                      count: rule.allowedOrigins.length,
                    })}
              </>
            ) : (
              t("runtimeConfiguration.notSaved")
            )}
          </dd>
        </div>
      </dl>
      <p className="m-0 text-sm text-muted">
        {t("runtimeConfiguration.currentVersion", {
          version: current?.version ?? "—",
        })}
      </p>
      {feedback.emergencyDisabled ? (
        <Alert
          type="warning"
          title={t("runtimeConfiguration.emergencyDisabled")}
        />
      ) : null}
      {warning || feedback.state === "inactive" ? (
        <Alert
          type="warning"
          title={t(`runtimeConfiguration.feedbackAction.${feedback.state}`)}
        />
      ) : null}
      <div className="border-t border-line pt-4 grid gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-medium">
            {t("runtimeConfiguration.executionFeedback")}
          </span>
          <span className="text-sm text-muted">
            {t(`runtimeConfiguration.feedbackState.${feedback.state}`, {
              count: feedback.count,
            })}
          </span>
        </div>
        {feedback.state === "unknown" ? (
          <p className="m-0 text-xs text-muted">
            {t("runtimeConfiguration.feedbackUnknownHelp")}
            {feedback.lastReportedAt
              ? ` ${t("runtimeConfiguration.lastReport", { time: new Date(feedback.lastReportedAt).toLocaleString() })}`
              : ""}
          </p>
        ) : null}
        {feedback.groups.length ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              {t("runtimeConfiguration.feedbackDetails")}
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    {[
                      "processes",
                      "source",
                      "version",
                      "downloadSwitch",
                      "reportedAt",
                    ].map((key) => (
                      <th
                        className="py-2 pr-4 font-medium text-muted"
                        scope="col"
                        key={key}
                      >
                        {t(`runtimeConfiguration.feedbackColumns.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {feedback.groups.map((group) => (
                    <tr
                      key={`${group.source}:${group.version}:${group.enabled}`}
                      className="border-t border-line"
                    >
                      <td className="py-2 pr-4">{group.count}</td>
                      <td className="py-2 pr-4">
                        {t(`runtimeConfiguration.sources.${group.source}`)}
                      </td>
                      <td className="py-2 pr-4">
                        {group.version ??
                          t("runtimeConfiguration.notApplicable")}
                      </td>
                      <td className="py-2 pr-4">
                        {t(
                          group.enabled
                            ? "runtimeConfiguration.enabled"
                            : "runtimeConfiguration.deploymentDisabled",
                        )}
                      </td>
                      <td className="py-2">
                        {new Date(group.observedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mb-0 text-xs text-muted">
              {t("runtimeConfiguration.feedbackDetailsHelp")}
            </p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
