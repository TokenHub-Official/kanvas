import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Empty, Form, Input, Skeleton, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchAgentRunDiagnostics } from "../../api/transport.js";
import { InlineNotice } from "../../components/feedback.js";

const millisecondsPerSecond = 1_000;

export function AgentRunDiagnostics({
  workspaceId,
  runId,
  onClose,
}: {
  readonly workspaceId: string;
  readonly runId?: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [selectedRunId, setSelectedRunId] = useState(runId);
  return (
    <Drawer
      open
      onClose={onClose}
      title={t("agent.diagnostics.title")}
      size="min(600px, 100vw)"
    >
      {!runId ? (
        <Form
          layout="vertical"
          onFinish={(values: { reference: string }) =>
            setSelectedRunId(values.reference.trim())
          }
        >
          <p className="mb-4 text-sm text-muted">
            {t("agent.diagnostics.lookupDescription")}
          </p>
          <Form.Item
            label={t("agent.diagnostics.reference")}
            name="reference"
            rules={[
              {
                required: true,
                pattern: /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u,
                transform: (value: string) => value?.trim(),
                message: t("agent.diagnostics.invalidReference"),
              },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" type="primary">
              {t("agent.diagnostics.search")}
            </Button>
          </Form.Item>
        </Form>
      ) : null}
      {selectedRunId ? (
        <AgentRunDiagnosticResult
          workspaceId={workspaceId}
          runId={selectedRunId}
        />
      ) : null}
    </Drawer>
  );
}

function routeResolutionLabel(value: boolean | null): string {
  if (value === null) return "pending";
  return value ? "resolved" : "failed";
}

function AgentRunDiagnosticResult({
  workspaceId,
  runId,
}: {
  readonly workspaceId: string;
  readonly runId: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const diagnostic = useQuery({
    queryKey: ["agent-run-diagnostics", workspaceId, runId],
    queryFn: () => fetchAgentRunDiagnostics(workspaceId, runId),
    retry: false,
  });
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "medium",
  });
  const formatTime = (value: string) => dateFormatter.format(new Date(value));
  const numberFormatter = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  });
  if (diagnostic.isPending) return <Skeleton active />;
  if (diagnostic.isError)
    return (
      <InlineNotice
        tone="danger"
        title={t("agent.diagnostics.loadFailed")}
        action={
          <Button onClick={() => void diagnostic.refetch()}>
            {t("agent.taskStatusRetry")}
          </Button>
        }
      />
    );
  return (
    <div className="grid gap-5">
      <dl className="m-0 grid gap-2 text-sm">
        <div>
          <dt className="text-muted">{t("agent.diagnostics.reference")}</dt>
          <dd className="m-0 break-all font-mono text-xs">
            <Typography.Text copyable={{ text: diagnostic.data.runId }}>
              {diagnostic.data.runId}
            </Typography.Text>
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("agent.diagnostics.status")}</dt>
          <dd className="m-0">
            {t(`agent.diagnostics.states.${diagnostic.data.lifecycleStatus}`)}
          </dd>
        </div>
        {diagnostic.data.reasonCode ? (
          <div>
            <dt className="text-muted">{t("agent.diagnostics.reason")}</dt>
            <dd className="m-0 break-all font-mono text-xs">
              {diagnostic.data.reasonCode}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="m-0 text-sm text-muted">
        {diagnostic.data.runtimeConfigurationVersion
          ? t("agent.diagnostics.configurationVersion", {
              version: diagnostic.data.runtimeConfigurationVersion,
            })
          : t("agent.diagnostics.profileLimits")}
      </p>
      {diagnostic.data.limits ? (
        <p className="m-0 text-sm text-muted">
          {t("agent.diagnostics.limits", diagnostic.data.limits)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button href={`/w/${workspaceId}/settings/models`}>
          {t("agent.runFailure.openModels")}
        </Button>
        <Button
          onClick={() => void diagnostic.refetch()}
          loading={diagnostic.isFetching}
        >
          {t("agent.taskStatusRetry")}
        </Button>
      </div>
      {diagnostic.data.discoveries?.length ? (
        <section className="grid gap-3">
          <h3 className="m-0 text-sm font-semibold">
            {t("agent.diagnostics.discovery")}
          </h3>
          <ol className="m-0 grid list-none gap-3 p-0">
            {diagnostic.data.discoveries.map((item) => (
              <li key={item.actionId} className="grid gap-1 text-sm">
                <span>
                  {t(`agent.diagnostics.catalogStates.${item.catalogState}`)} ·{" "}
                  {t("agent.diagnostics.duration", {
                    seconds: numberFormatter.format(
                      item.durationMs / millisecondsPerSecond,
                    ),
                  })}
                </span>
                <time
                  className="text-xs text-muted"
                  dateTime={item.evaluatedAt}
                >
                  {formatTime(item.evaluatedAt)}
                </time>
                {item.exclusions.map((entry) => (
                  <code key={entry.key} className="break-all text-xs">
                    {entry.key}: {entry.stage} / {entry.reason ?? entry.status}
                  </code>
                ))}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {diagnostic.data.calls.length === 0 ? (
        <Empty description={t("agent.diagnostics.noCalls")} />
      ) : (
        <ol className="m-0 grid list-none gap-4 p-0">
          {diagnostic.data.calls.map((call) => (
            <li
              key={call.id}
              className="grid gap-2 rounded-control bg-mist p-4 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {call.callNumber !== undefined
                    ? `#${call.callNumber} · `
                    : ""}
                  {t(`agent.diagnostics.purposes.${call.purpose}`)}
                </strong>
                <span>
                  {t(`agent.diagnostics.states.${call.lifecycleStatus}`)}
                </span>
              </div>
              <time className="text-xs text-muted" dateTime={call.createdAt}>
                {formatTime(call.createdAt)}
              </time>
              <p className="m-0">
                {t(
                  `agent.diagnostics.route.${routeResolutionLabel(call.routeResolved)}`,
                )}
              </p>
              <p className="m-0 text-muted">
                {t(
                  call.providerAccepted
                    ? "agent.diagnostics.accepted"
                    : "agent.diagnostics.notAccepted",
                )}
              </p>
              <p className="m-0 text-muted">
                {t("agent.diagnostics.recordedDuration", {
                  seconds: numberFormatter.format(
                    Math.max(
                      0,
                      new Date(call.updatedAt).getTime() -
                        new Date(call.createdAt).getTime(),
                    ) / millisecondsPerSecond,
                  ),
                })}
              </p>
              {call.finishReason ? (
                <p className="m-0">
                  {t("agent.diagnostics.finishReason")}:{" "}
                  <code>{call.finishReason}</code>
                </p>
              ) : null}
              {call.inputTokens !== undefined ||
              call.outputTokens !== undefined ? (
                <p className="m-0 text-xs text-muted">
                  {t("agent.diagnostics.tokens", {
                    input: call.inputTokens ?? "—",
                    output: call.outputTokens ?? "—",
                  })}
                </p>
              ) : null}
              <details>
                <summary className="cursor-pointer">
                  {t("operations.technicalDetails")}
                </summary>
                <dl className="grid gap-1 text-xs">
                  <dt>{t("agent.diagnostics.modelCallId")}</dt>
                  <dd className="m-0 break-all font-mono">{call.id}</dd>
                  {call.modelProfileKey ? (
                    <>
                      <dt>{t("agent.diagnostics.modelProfile")}</dt>
                      <dd className="m-0 break-all font-mono">
                        {call.modelProfileKey}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </details>
              {call.reasonCode ? (
                <code className="break-all text-xs">{call.reasonCode}</code>
              ) : null}
              {call.requestId ? (
                <p className="m-0 break-all text-xs">
                  {t("agent.taskFailure.requestId", { id: call.requestId })}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {diagnostic.data.actions?.length ? (
        <section className="grid gap-3">
          <h3 className="m-0 text-sm font-semibold">
            {t("agent.diagnostics.actions")}
          </h3>
          <p className="m-0 text-xs text-muted">
            {t("agent.diagnostics.actionsDescription")}
          </p>
          <ol className="m-0 grid list-none gap-3 p-0">
            {diagnostic.data.actions.map((action) => (
              <li key={action.id} className="grid gap-1 text-sm">
                <strong>
                  #{action.actionNumber} · {action.toolKey}
                </strong>
                <span>
                  {t(`agent.diagnostics.states.${action.lifecycleStatus}`, {
                    defaultValue: action.lifecycleStatus,
                  })}
                </span>
                <time
                  className="text-xs text-muted"
                  dateTime={action.createdAt}
                >
                  {formatTime(action.createdAt)}
                </time>
                {action.reasonCode ? (
                  <code className="break-all text-xs">{action.reasonCode}</code>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {diagnostic.data.truncated ? (
        <p className="text-sm text-muted">{t("agent.diagnostics.truncated")}</p>
      ) : null}
    </div>
  );
}
