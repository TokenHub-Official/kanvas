import { RuntimeConfigurationReview } from "./runtime-configuration-review.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { RuntimeConfigurationStatus } from "./runtime-configuration-status.js";
import { authClient } from "../auth/auth-client.js";
import { useState, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createRoute, Navigate } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
} from "antd";
import type {
  ResultDownloadRule,
  RuntimeConfigurationDocument,
  RuntimeConfigurationOverview,
  RuntimeConfigurationRevision,
} from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";
import {
  fetchCurrentHumanContext,
  fetchRuntimeConfiguration,
  fetchRuntimeConfigurationHistory,
  publishRuntimeConfiguration,
  restoreRuntimeConfiguration,
} from "../api/transport.js";
import { AccountSettingsShell } from "../components/account-settings-shell.js";
import { useToast } from "../components/toast.js";
import { rootRoute } from "./root.js";
import {
  deploymentImport,
  initialRuntimeConfiguration,
  originLines,
  validResultOrigin,
} from "./runtime-configuration-model.js";

function DownloadRuleEditor({
  rule,
  onChange,
}: {
  rule: ResultDownloadRule;
  onChange: (value: ResultDownloadRule) => void;
}) {
  const { t } = useTranslation();
  const canonicalOrigins = rule.allowedOrigins?.join("\n") ?? "";
  const [originDraft, setOriginDraft] = useState({
    canonical: canonicalOrigins,
    text: canonicalOrigins,
  });
  const originsText =
    originDraft.canonical === canonicalOrigins
      ? originDraft.text
      : canonicalOrigins;
  function updateOrigins(event: ChangeEvent<HTMLTextAreaElement>) {
    setOriginDraft({
      canonical: originLines(event.target.value).join("\n"),
      text: event.target.value,
    });
    onChange({
      ...rule,
      allowedOrigins: originLines(event.target.value),
    });
  }
  const invalidOrigins =
    rule.allowedOrigins?.some((origin) => !validResultOrigin(origin)) ?? false;
  return (
    <div className="grid gap-3">
      <label className="flex items-center gap-3">
        <Switch
          checked={rule.enabled}
          onChange={(enabled) => onChange({ ...rule, enabled })}
        />
        {t("runtimeConfiguration.downloadsEnabled")}
      </label>
      <Select
        aria-label={t("runtimeConfiguration.domainMode")}
        value={rule.allowedOrigins === null ? "unrestricted" : "list"}
        options={[
          { value: "list", label: t("runtimeConfiguration.exactOrigins") },
          {
            value: "unrestricted",
            label: t("runtimeConfiguration.unrestricted"),
          },
        ]}
        onChange={(value) =>
          onChange({
            ...rule,
            allowedOrigins: value === "unrestricted" ? null : [],
          })
        }
      />
      {rule.allowedOrigins !== null ? (
        <Input.TextArea
          aria-label={t("runtimeConfiguration.origins")}
          status={invalidOrigins ? "error" : ""}
          aria-invalid={invalidOrigins}
          rows={4}
          value={originsText}
          placeholder="https://results.example.com"
          onChange={updateOrigins}
        />
      ) : null}
      {invalidOrigins ? (
        <Alert type="error" title={t("runtimeConfiguration.invalidOrigins")} />
      ) : null}
      <p className="m-0 text-xs text-muted">
        {t("runtimeConfiguration.originHelp")}
      </p>
    </div>
  );
}
function ConfigurationEditor({
  overview,
  csrfToken,
}: {
  overview: RuntimeConfigurationOverview;
  csrfToken: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const cache = useQueryClient();
  const [document, setDocument] = useState<RuntimeConfigurationDocument>(
    overview.current?.document ?? initialRuntimeConfiguration,
  );
  const [reason, setReason] = useState("");
  const [baseVersion, setBaseVersion] = useState(
    overview.current?.version ?? 0,
  );
  const [review, setReview] = useState<{
    document: RuntimeConfigurationDocument;
    restoredFrom?: number;
    reason: string;
  }>();
  const history = useQuery({
    queryKey: ["instance", "runtime-configuration-history"],
    queryFn: fetchRuntimeConfigurationHistory,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!review) return;
      const expectedVersion = baseVersion;
      if (review.restoredFrom)
        return restoreRuntimeConfiguration(csrfToken, {
          expectedVersion,
          sourceVersion: review.restoredFrom,
          reason: review.reason,
        });
      return publishRuntimeConfiguration(csrfToken, {
        expectedVersion,
        document: review.document,
        reason: review.reason,
      });
    },
    onSuccess: async (revision) => {
      if (revision) {
        setDocument(revision.document);
        setBaseVersion(revision.version);
      }
      setReason("");
      setReview(undefined);
      toast.notify({
        tone: "positive",
        title: t("runtimeConfiguration.saved"),
      });
      await Promise.all([
        cache.invalidateQueries({
          queryKey: ["instance", "runtime-configuration"],
        }),
        cache.invalidateQueries({
          queryKey: ["instance", "runtime-configuration-history"],
        }),
      ]);
    },
    onError: () =>
      toast.notify({
        tone: "danger",
        title: t("runtimeConfiguration.saveError"),
      }),
  });
  const invalidDocument = [
    document.downloads.defaults,
    ...document.downloads.providers.map((entry) => entry.rule),
  ].some((rule) =>
    rule.allowedOrigins?.some((origin) => !validResultOrigin(origin)),
  );
  function replaceDraft() {
    setDocument(overview.current?.document ?? initialRuntimeConfiguration);
    setBaseVersion(overview.current?.version ?? 0);
    setReview(undefined);
    setReason("");
  }
  function addServiceRule(value: string) {
    const [workspaceId, providerEndpointId] = value.split(":");
    if (workspaceId && providerEndpointId)
      setDocument({
        ...document,
        downloads: {
          ...document.downloads,
          providers: [
            ...document.downloads.providers,
            {
              workspaceId,
              providerEndpointId,
              rule: structuredClone(document.downloads.defaults),
            },
          ],
        },
      });
  }
  const imported = deploymentImport(overview.workers);
  const updateAgent = (
    key: keyof RuntimeConfigurationDocument["agent"],
    value: number | null,
  ) => {
    if (value !== null)
      setDocument({ ...document, agent: { ...document.agent, [key]: value } });
  };
  return (
    <div className="grid gap-6">
      {baseVersion !== (overview.current?.version ?? 0) ? (
        <Alert
          type="warning"
          title={t("runtimeConfiguration.concurrentChange")}
          action={
            <Button onClick={replaceDraft}>
              {t("runtimeConfiguration.replaceDraft")}
            </Button>
          }
        />
      ) : null}
      {!overview.current ? (
        <Alert
          type="info"
          title={t("runtimeConfiguration.importTitle")}
          description={t("runtimeConfiguration.importDescription")}
          action={
            <Button
              disabled={!imported}
              onClick={() => {
                if (imported) setDocument(imported);
              }}
            >
              {t("runtimeConfiguration.import")}
            </Button>
          }
        />
      ) : null}
      <div className="grid gap-1">
        <h2 className="m-0 text-ui-title">
          {t("runtimeConfiguration.editHeading")}
        </h2>
        <p className="m-0 text-sm text-muted">
          {t("runtimeConfiguration.editHelp")}
        </p>
      </div>
      <section className="rounded-card bg-paper p-5 grid gap-4">
        <h3 className="m-0 text-ui-title">{t("runtimeConfiguration.agent")}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2">
            {t("runtimeConfiguration.modelCalls")}
            <InputNumber
              min={1}
              max={64}
              value={document.agent.maximumModelCalls}
              onChange={(value) => updateAgent("maximumModelCalls", value)}
            />
          </label>
          <label className="grid gap-2">
            {t("runtimeConfiguration.toolCalls")}
            <InputNumber
              min={0}
              max={128}
              value={document.agent.maximumToolCalls}
              onChange={(value) => updateAgent("maximumToolCalls", value)}
            />
          </label>
          <label className="grid gap-2">
            {t("runtimeConfiguration.timeout")}
            <InputNumber
              min={5}
              max={1800}
              value={document.agent.timeoutSeconds}
              onChange={(value) => updateAgent("timeoutSeconds", value)}
            />
          </label>
        </div>
        <p className="m-0 text-sm text-muted">
          {t("runtimeConfiguration.agentEffect", {
            steps: Math.min(
              document.agent.maximumModelCalls,
              document.agent.maximumToolCalls + 1,
            ),
          })}
        </p>
      </section>
      <section className="rounded-card bg-paper p-5 grid gap-4">
        <h2 className="m-0 text-ui-title">
          {t("runtimeConfiguration.defaultRule")}
        </h2>
        <DownloadRuleEditor
          rule={document.downloads.defaults}
          onChange={(defaults) =>
            setDocument({
              ...document,
              downloads: { ...document.downloads, defaults },
            })
          }
        />
        <h3 className="m-0 text-sm font-semibold">
          {t("runtimeConfiguration.overrides")}
        </h3>
        {document.downloads.providers.map((entry, index) => (
          <div
            className="border-t border-line pt-4 grid gap-3"
            key={`${entry.workspaceId}:${entry.providerEndpointId}`}
          >
            <div className="flex justify-between gap-3">
              <strong>
                {overview.services.find(
                  (service) =>
                    service.workspaceId === entry.workspaceId &&
                    service.providerEndpointId === entry.providerEndpointId,
                )?.name ?? entry.providerEndpointId}
              </strong>
              <Button
                onClick={() =>
                  setDocument({
                    ...document,
                    downloads: {
                      ...document.downloads,
                      providers: document.downloads.providers.filter(
                        (_, position) => position !== index,
                      ),
                    },
                  })
                }
              >
                {t("runtimeConfiguration.inherit")}
              </Button>
            </div>
            <DownloadRuleEditor
              rule={entry.rule}
              onChange={(rule) =>
                setDocument({
                  ...document,
                  downloads: {
                    ...document.downloads,
                    providers: document.downloads.providers.map(
                      (item, position) =>
                        position === index ? { ...item, rule } : item,
                    ),
                  },
                })
              }
            />
          </div>
        ))}
        <Select
          aria-label={t("runtimeConfiguration.addOverride")}
          placeholder={t("runtimeConfiguration.addOverride")}
          value={null}
          options={overview.services
            .filter(
              (service) =>
                !document.downloads.providers.some(
                  (entry) =>
                    entry.workspaceId === service.workspaceId &&
                    entry.providerEndpointId === service.providerEndpointId,
                ),
            )
            .map((service) => ({
              value: `${service.workspaceId}:${service.providerEndpointId}`,
              label: `${service.workspaceName} / ${service.name}`,
            }))}
          onChange={addServiceRule}
        />
        <p className="m-0 text-sm text-muted">
          {t("runtimeConfiguration.downloadEffect")}
        </p>
      </section>
      <section className="rounded-card bg-paper p-5 grid gap-4">
        <h2 className="m-0 text-ui-title">
          {t("runtimeConfiguration.saveHeading")}
        </h2>
        {!overview.current?.document.activated ? (
          <label className="flex items-center gap-3">
            <Switch
              checked={document.activated}
              onChange={(activated) => setDocument({ ...document, activated })}
            />
            {t("runtimeConfiguration.activate")}
          </label>
        ) : null}
        <p className="m-0 text-sm text-muted">
          {t(
            document.activated
              ? "runtimeConfiguration.scopeEffect"
              : "runtimeConfiguration.importOnly",
          )}
        </p>
        <Input
          aria-label={t("runtimeConfiguration.reason")}
          placeholder={t("runtimeConfiguration.reason")}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button
          type="primary"
          disabled={!reason.trim() || invalidDocument}
          onClick={() =>
            setReview({ document: structuredClone(document), reason })
          }
        >
          {t("runtimeConfiguration.review")}
        </Button>
      </section>
      <section className="rounded-card bg-paper p-5 grid gap-3">
        <h2 className="m-0 text-ui-title">
          {t("runtimeConfiguration.history")}
        </h2>
        <Table<RuntimeConfigurationRevision>
          rowKey="version"
          size="small"
          dataSource={history.data?.items ?? []}
          loading={history.isPending}
          columns={[
            { title: t("runtimeConfiguration.version"), dataIndex: "version" },
            {
              title: t("runtimeConfiguration.changeReason"),
              dataIndex: "reason",
            },
            {
              title: t("runtimeConfiguration.publishedAt"),
              dataIndex: "publishedAt",
              render: (value: string) => new Date(value).toLocaleString(),
            },
            {
              title: t("runtimeConfiguration.restore"),
              render: (_, revision) => (
                <Button
                  disabled={
                    revision.version === overview.current?.version ||
                    Boolean(
                      overview.current?.document.activated &&
                      !revision.document.activated,
                    )
                  }
                  onClick={() =>
                    setReview({
                      document: revision.document,
                      restoredFrom: revision.version,
                      reason: "",
                    })
                  }
                >
                  {t("runtimeConfiguration.restore")}
                </Button>
              ),
            },
          ]}
        />
        {overview.current?.document.activated ? (
          <p className="text-xs text-muted">
            {t("runtimeConfiguration.activeRollbackOnly")}
          </p>
        ) : null}
        {history.isError ? (
          <Alert type="error" title={t("runtimeConfiguration.loadError")} />
        ) : null}
        {history.data?.truncated ? (
          <p>{t("runtimeConfiguration.historyTruncated")}</p>
        ) : null}
      </section>
      <Modal
        width={800}
        open={Boolean(review)}
        title={t("runtimeConfiguration.review")}
        onCancel={() => setReview(undefined)}
        onOk={() => save.mutate()}
        confirmLoading={save.isPending}
        okButtonProps={{ disabled: !review?.reason.trim() }}
        okText={t(
          review?.document.activated
            ? "runtimeConfiguration.publish"
            : "runtimeConfiguration.savePreparation",
        )}
        cancelText={t("common.cancel")}
      >
        {review ? (
          <div className="grid gap-4">
            <Alert
              type="info"
              title={t(
                review.document.activated
                  ? "runtimeConfiguration.scopeEffect"
                  : "runtimeConfiguration.importOnly",
              )}
            />
            <RuntimeConfigurationReview
              before={overview.current?.document}
              after={review.document}
              overview={overview}
            />
            {review.restoredFrom ? (
              <Input
                aria-label={t("runtimeConfiguration.reason")}
                placeholder={t("runtimeConfiguration.reason")}
                value={review.reason}
                maxLength={500}
                onChange={(event) =>
                  setReview({ ...review, reason: event.target.value })
                }
              />
            ) : (
              <div className="grid gap-1 text-sm">
                <span className="text-muted">
                  {t("runtimeConfiguration.changeReason")}
                </span>
                <p className="m-0 break-words">{review.reason}</p>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
function RuntimeConfigurationPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("runtimeConfiguration.title"));
  const session = authClient.useSession();
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    enabled: Boolean(session.data),
    retry: false,
  });
  const overview = useQuery({
    queryKey: ["instance", "runtime-configuration"],
    queryFn: fetchRuntimeConfiguration,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    enabled: Boolean(context.data?.instanceAdministrator),
    retry: false,
  });
  if (session.isPending || (session.data && context.isPending))
    return <Skeleton active />;
  if (!session.data)
    return (
      <Navigate to="/login" search={{ returnTo: "/admin/runtime" }} replace />
    );
  if (context.isError || !context.data)
    return (
      <AccountSettingsShell scope="site">
        <Alert
          type="error"
          title={t("runtimeConfiguration.loadError")}
          action={
            <Button onClick={() => void context.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </AccountSettingsShell>
    );
  if (!context.data.instanceAdministrator)
    return (
      <AccountSettingsShell scope="site">
        <Alert type="error" title={t("instanceAccess.forbiddenTitle")} />
      </AccountSettingsShell>
    );
  return (
    <AccountSettingsShell scope="site">
      <div className="grid gap-6">
        <div className="flex justify-between gap-4">
          <h1 className="m-0 text-2xl font-bold">
            {t("runtimeConfiguration.title")}
          </h1>
          <Button
            loading={overview.isFetching}
            onClick={() => void overview.refetch()}
          >
            {t("runtimeConfiguration.refresh")}
          </Button>
        </div>
        {overview.isPending ? <Skeleton active /> : null}
        {!overview.isPending && overview.data ? (
          <>
            <RuntimeConfigurationStatus
              overview={overview.data}
              checkedAt={Math.max(
                overview.dataUpdatedAt,
                overview.errorUpdatedAt,
              )}
            />
            <ConfigurationEditor
              overview={overview.data}
              csrfToken={context.data.csrfToken}
            />
          </>
        ) : null}
        {!overview.isPending && !overview.data ? (
          <Alert type="error" title={t("runtimeConfiguration.loadError")} />
        ) : null}
      </div>
    </AccountSettingsShell>
  );
}
export const runtimeConfigurationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/runtime",
  component: RuntimeConfigurationPage,
});
