import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Spin } from "antd";
import { useTranslation } from "react-i18next";
import {
  ApiProblem,
  fetchProviderResultRecovery,
  requestProviderResultRecovery,
  fetchCurrentHumanContext,
  downloadArtifact,
} from "../../api/transport.js";
import { useToast } from "../../components/toast.js";
const pollMilliseconds = 2000;
const awaitingRecoveryPollMilliseconds = 10_000;
const forbiddenStatus = 403;
const notFoundStatus = 404;
const hiddenStatuses = new Set([forbiddenStatus, notFoundStatus]);
function failureMessage(code: string) {
  if (code.startsWith("storage_upload."))
    return "agent.resultRecovery.storageFailed";
  if (code === "result_recovery.expired") return "agent.resultRecovery.expired";
  if (code === "provider.output_origin_not_allowed")
    return "agent.resultRecovery.blocked";
  return "agent.resultRecovery.failed";
}
const downloadUrlRetentionMilliseconds = 1000;
export function ProviderResultRecovery({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId: string;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const toast = useToast();
  const requestKeyRef = useRef<string | undefined>(undefined);
  const queryKey = ["provider-result-recovery", workspaceId, runId];
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
  });
  const records = useQuery({
    queryKey,
    queryFn: () => fetchProviderResultRecovery(workspaceId, runId),
    retry: false,
    refetchInterval: (query) => {
      if (
        query.state.data?.items.some(
          (item) => item.state === "queued" || item.state === "running",
        )
      )
        return pollMilliseconds;
      return query.state.data?.canRecover
        ? awaitingRecoveryPollMilliseconds
        : false;
    },
    refetchIntervalInBackground: false,
  });
  const recover = useMutation({
    mutationFn: () => {
      if (!context.data?.csrfToken) throw new Error("Session unavailable");
      requestKeyRef.current ??= crypto.randomUUID();
      return requestProviderResultRecovery(
        workspaceId,
        runId,
        context.data.csrfToken,
        requestKeyRef.current,
      );
    },
    onSuccess: (data) => {
      cache.setQueryData(queryKey, data);
      requestKeyRef.current = undefined;
    },
  });
  async function download(artifactId: string) {
    try {
      const blob = await downloadArtifact(workspaceId, artifactId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "recovered-result";
      link.click();
      setTimeout(
        () => URL.revokeObjectURL(url),
        downloadUrlRetentionMilliseconds,
      );
    } catch {
      toast.notify({
        tone: "danger",
        title: t("agent.resultRecovery.downloadError"),
      });
    }
  }
  if (
    records.isError &&
    records.error instanceof ApiProblem &&
    hiddenStatuses.has(records.error.status)
  )
    return null;
  if (records.isPending) return <Spin size="small" />;
  if (!records.data)
    return (
      <Alert
        type="error"
        title={t("agent.resultRecovery.loadError")}
        action={
          <Button size="small" onClick={() => void records.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  const active = records.data.items.some(
    (item) => item.state === "queued" || item.state === "running",
  );
  if (!records.data.canRecover && !records.data.items.length)
    return records.data.unavailableReason === "no_results" ? (
      <p className="text-xs text-muted">
        {t("agent.resultRecovery.noResults")}
      </p>
    ) : null;
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong>{t("agent.resultRecovery.title")}</strong>
        <Button
          size="small"
          loading={recover.isPending || active}
          disabled={
            !records.data.canRecover || active || !context.data?.csrfToken
          }
          onClick={() => recover.mutate()}
        >
          {t("agent.resultRecovery.recover")}
        </Button>
      </div>
      <p className="m-0 text-xs text-muted">{t("agent.resultRecovery.help")}</p>
      {!records.data.canDownload ? (
        <p className="m-0 text-xs text-muted">
          {t("agent.resultRecovery.administratorHelp")}
        </p>
      ) : null}
      {recover.isError ? (
        <Alert type="error" title={t("agent.resultRecovery.requestError")} />
      ) : null}
      {records.data.items.map((item) => (
        <div
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
          key={item.id}
        >
          <span>
            {t("agent.resultRecovery.item", { index: item.resultIndex + 1 })} ·{" "}
            {t(`agent.resultRecovery.states.${item.state}`)} ·{" "}
            {new Date(item.createdAt).toLocaleString()}
            {item.initiatedByAdministrator
              ? ` · ${t("agent.resultRecovery.administratorInitiated")}`
              : null}
          </span>
          {item.artifactId && records.data.canDownload ? (
            <Button
              size="small"
              onClick={() => void download(item.artifactId!)}
            >
              {t("agent.resultRecovery.download")}
            </Button>
          ) : null}
          {item.errorCode ? (
            <p className="m-0 w-full text-xs text-muted">
              {t(failureMessage(item.errorCode))}
            </p>
          ) : null}
        </div>
      ))}
      {records.data.truncated ? (
        <p className="text-xs text-muted">
          {t("agent.resultRecovery.truncated")}
        </p>
      ) : null}
    </section>
  );
}
