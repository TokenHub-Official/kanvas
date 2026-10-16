import { ProviderResultRecovery } from "./provider-result-recovery.js";
import { useQuery } from "@tanstack/react-query";
import type { WorkflowRunDetails } from "@kanvas/contracts/api";
import { Alert, Button } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { agentCapabilityTaskQueryOptions } from "./agent-capability-task-query.js";

function errorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function agentTaskFailureKind(
  error: unknown,
):
  | "access"
  | "input"
  | "timeout"
  | "unconfirmed"
  | "busy"
  | "budget"
  | "delivery"
  | "storage"
  | "unknown" {
  const details = errorRecord(error);
  const code = details.code;
  if (typeof code !== "string") return "unknown";
  if (code === "provider.storage_preflight_failed") return "storage";
  if (code === "provider.output_materialization_failed") return "delivery";
  if (
    code === "attempt.execution_deadline_expired" &&
    details.externalState === "unknown"
  )
    return "unconfirmed";
  if (/authentication_failed|access_denied|not_configured/u.test(code))
    return "access";
  if (/invalid_request|invalid_input/u.test(code)) return "input";
  if (/timeout|deadline_expired/u.test(code)) return "timeout";
  if (/rate_limited|unavailable/u.test(code)) return "busy";
  if (/budget|insufficient/u.test(code)) return "budget";
  return "unknown";
}
export function AgentTaskFailure({
  run,
  workspaceId,
  capabilityRunId: directCapabilityRunId,
  canReadCapabilities = false,
  canManageModels = false,
  workflowRunId,
  agentRunId,
  presentation = "detail",
  onOpenDetails,
}: {
  readonly run?: WorkflowRunDetails;
  readonly workspaceId: string;
  readonly capabilityRunId?: string;
  readonly canReadCapabilities?: boolean;
  readonly canManageModels?: boolean;
  readonly workflowRunId?: string | undefined;
  readonly agentRunId?: string | undefined;
  readonly presentation?: "inline" | "detail";
  readonly onOpenDetails?: () => void;
}) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const failure = errorRecord(
    run?.nodes.find((node) => node.lifecycleStatus === "failed")?.error,
  );
  const capabilityRunId =
    directCapabilityRunId ??
    (typeof failure.capabilityRunId === "string"
      ? failure.capabilityRunId
      : undefined);
  const capability = useQuery(
    agentCapabilityTaskQueryOptions(
      workspaceId,
      capabilityRunId,
      canReadCapabilities,
    ),
  );
  const error = capability.data?.error ?? failure.cause ?? failure;
  const kind = agentTaskFailureKind(error);
  const code = errorRecord(error).code;
  const diagnosticCode =
    typeof code === "string" && /^[a-z0-9][a-z0-9._:-]{0,159}$/u.test(code)
      ? code
      : undefined;
  const problemReference =
    directCapabilityRunId ??
    workflowRunId ??
    run?.id ??
    capabilityRunId ??
    agentRunId;
  async function copyProblemReference(): Promise<void> {
    if (!problemReference) return;
    try {
      await navigator.clipboard.writeText(problemReference);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  if (capability.data?.externalResultUrls?.length) {
    return (
      <div className="grid gap-4">
        <AgentExternalResults urls={capability.data.externalResultUrls} />
        {capabilityRunId && presentation !== "inline" ? (
          <ProviderResultRecovery
            workspaceId={workspaceId}
            runId={capabilityRunId}
          />
        ) : null}
      </div>
    );
  }
  if (presentation === "inline") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 text-xs text-muted">
        <span>
          {t(
            kind === "access" ||
              kind === "budget" ||
              kind === "input" ||
              kind === "storage"
              ? "agent.taskFailure.inlineSummary"
              : "agent.taskFailure.inlineContinue",
          )}
        </span>
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t("agent.taskFailure.openDetails")}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-2 text-sm">
      <Alert
        type="warning"
        showIcon
        title={t(`agent.taskFailure.${kind}.title`)}
        description={t(`agent.taskFailure.${kind}.description`)}
      />
      <div className="flex flex-wrap gap-2">
        {problemReference ? (
          <Button size="small" onClick={() => void copyProblemReference()}>
            {t(
              copyState === "copied"
                ? "agent.problemReferenceCopied"
                : "agent.copyProblemReference",
            )}
          </Button>
        ) : null}
        {canManageModels && (kind === "access" || kind === "budget") ? (
          <Button size="small" href={`/w/${workspaceId}/settings/models`}>
            {t("agent.runFailure.openModels")}
          </Button>
        ) : null}
      </div>
      {problemReference ? (
        <div className="grid gap-1 text-xs text-muted">
          <p className="m-0">
            {t("agent.problemReferenceLabel")}{" "}
            <code className="break-all text-ink">{problemReference}</code>
          </p>
          <p className="m-0">{t("agent.problemReferenceHint")}</p>
        </div>
      ) : null}
      {capabilityRunId ? (
        <ProviderResultRecovery
          workspaceId={workspaceId}
          runId={capabilityRunId}
        />
      ) : null}
      {diagnosticCode ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">
            {t("agent.taskFailure.diagnosticDetails")}
          </summary>
          <p className="m-0 mt-1">
            {t("agent.taskFailure.diagnosticCode")}{" "}
            <code className="break-all text-ink">{diagnosticCode}</code>
          </p>
        </details>
      ) : null}
      {copyState === "failed" ? (
        <p role="alert" className="m-0 break-all text-xs">
          {t("agent.problemReferenceCopyFailed", { id: problemReference })}
        </p>
      ) : null}
    </div>
  );
}

export function AgentExternalResults({
  urls,
}: {
  readonly urls: readonly string[];
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 text-sm">
      <p className="m-0 font-medium text-ink">
        {t("agent.taskFailure.externalResultTitle")}
      </p>
      <p className="m-0 text-xs text-muted">
        {t("agent.taskFailure.externalResultHint")}
      </p>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, index) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t("agent.taskFailure.openExternalResult", { index: index + 1 })}
          </a>
        ))}
      </div>
    </div>
  );
}
