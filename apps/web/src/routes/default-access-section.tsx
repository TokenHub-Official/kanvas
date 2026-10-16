import type {
  DefaultAccessPolicy,
  InstanceAccessOverview,
  InstanceRegistrationSettings,
} from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
} from "antd";
import { useState } from "react";
import { useToast } from "../components/toast.js";
import { useTranslation } from "react-i18next";
import {
  applyDefaultAccess,
  fetchDefaultAccessPolicy,
  previewDefaultAccess,
  updateDefaultAccessPolicy,
} from "../api/transport.js";

export function DefaultAccessSection(props: {
  readonly csrfToken: string;
  readonly overview: InstanceAccessOverview;
  readonly settings: InstanceRegistrationSettings;
}): React.JSX.Element {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["instance", "default-access"],
    queryFn: fetchDefaultAccessPolicy,
  });
  return (
    <section className="mt-8 rounded-card bg-paper p-5 sm:p-6">
      <h2 className="m-0 text-ui-title font-bold text-ink">
        {t("instanceAccess.defaultAccess.title")}
      </h2>
      {query.isPending ? <Skeleton active /> : null}
      {!query.isPending && query.data ? (
        <DefaultAccessForm
          key={query.data.version}
          {...props}
          policy={query.data}
        />
      ) : null}
      {!query.isPending && !query.data ? (
        <Alert
          type="error"
          showIcon
          title={t("instanceAccess.defaultAccess.loadError")}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : null}
    </section>
  );
}
function DefaultAccessForm({
  csrfToken,
  overview,
  settings,
  policy,
}: {
  readonly csrfToken: string;
  readonly overview: InstanceAccessOverview;
  readonly settings: InstanceRegistrationSettings;
  readonly policy: DefaultAccessPolicy;
}): React.JSX.Element {
  const { t } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const [enabled, setEnabled] = useState(policy.enabled);
  const [workspaceId, setWorkspaceId] = useState(policy.workspaceId);
  const [role, setRole] = useState(policy.role);
  const [domains, setDomains] = useState(policy.verifiedDomains.join("\n"));
  const [providerIds, setProviderIds] = useState(policy.oidcProviderIds);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      updateDefaultAccessPolicy(csrfToken, {
        enabled,
        workspaceId,
        role,
        verifiedDomains: domains.split(/[\s,;]+/u).filter(Boolean),
        oidcProviderIds: providerIds,
        expectedVersion: policy.version,
      }),
    onSuccess: async () => {
      toast.notify({
        title: t("instanceAccess.defaultAccess.saved"),
        tone: "positive",
      });
      await client.invalidateQueries({
        queryKey: ["instance", "default-access"],
      });
    },
  });
  const preview = useQuery({
    queryKey: ["instance", "default-access-preview"],
    queryFn: previewDefaultAccess,
    enabled: previewOpen,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const apply = useMutation({
    mutationFn: () =>
      applyDefaultAccess(csrfToken, {
        expectedVersion: preview.data?.policy.version ?? 0,
        principalIds: selected,
      }),
    onSuccess: async () => {
      setSelected([]);
      await Promise.all([
        preview.refetch(),
        client.invalidateQueries({ queryKey: ["instance", "access-overview"] }),
      ]);
    },
  });
  function openPreview(): void {
    setPreviewOpen(true);
    setSelected([]);
    apply.reset();
  }
  const changed =
    enabled !== policy.enabled ||
    workspaceId !== policy.workspaceId ||
    role !== policy.role ||
    domains !== policy.verifiedDomains.join("\n") ||
    JSON.stringify(providerIds) !== JSON.stringify(policy.oidcProviderIds);
  return (
    <>
      <p className="text-ui-body text-muted">
        {t("instanceAccess.defaultAccess.description")}
      </p>
      <Form layout="vertical" className="mt-5 max-w-2xl">
        <Form.Item
          htmlFor="default-access-enabled"
          label={t("instanceAccess.defaultAccess.enabled")}
        >
          <Switch
            id="default-access-enabled"
            checked={enabled}
            onChange={setEnabled}
            disabled={save.isPending}
          />
        </Form.Item>
        <Form.Item
          htmlFor="default-access-workspace"
          label={t("instanceAccess.defaultAccess.workspace")}
        >
          <Select
            id="default-access-workspace"
            value={workspaceId}
            onChange={setWorkspaceId}
            disabled={!enabled || save.isPending}
            options={overview.workspaces.map((w) => ({
              value: w.workspaceId,
              label: `${w.organizationName} / ${w.workspaceName}`,
            }))}
          />
        </Form.Item>
        <Form.Item
          htmlFor="default-access-role"
          label={t("instanceAccess.defaultAccess.role")}
        >
          <Select
            id="default-access-role"
            value={role}
            onChange={setRole}
            disabled={!enabled || save.isPending}
            options={(["viewer", "operator", "editor"] as const).map(
              (value) => ({
                value,
                label: t(`settings.people.roles.${value}.label`),
              }),
            )}
          />
        </Form.Item>
        <Form.Item
          htmlFor="default-access-domains"
          label={t("instanceAccess.defaultAccess.domains")}
          extra={t("instanceAccess.defaultAccess.identityHint")}
        >
          <Input.TextArea
            id="default-access-domains"
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            disabled={!enabled || save.isPending}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="example.com"
          />
        </Form.Item>
        {settings.capabilities.oidcProviders.length || providerIds.length ? (
          <Form.Item label={t("instanceAccess.defaultAccess.providers")}>
            <Checkbox.Group
              aria-label={t("instanceAccess.defaultAccess.providers")}
              value={providerIds}
              onChange={(values) => setProviderIds(values)}
              disabled={!enabled || save.isPending}
              options={[
                ...new Set([
                  ...settings.capabilities.oidcProviders.map((p) => p.id),
                  ...providerIds,
                ]),
              ].map((id) => ({
                value: id,
                label:
                  settings.capabilities.oidcProviders.find((p) => p.id === id)
                    ?.name ??
                  `${id} (${t("instanceAccess.defaultAccess.providerUnavailable")})`,
              }))}
            />
          </Form.Item>
        ) : null}
        {enabled && settings.policy.mode === "closed" ? (
          <Alert
            className="mb-4"
            type="warning"
            showIcon
            title={t("instanceAccess.defaultAccess.registrationClosed")}
          />
        ) : null}
        {save.isError ? (
          <Alert
            className="mb-4"
            type="error"
            showIcon
            title={t("instanceAccess.defaultAccess.saveError")}
          />
        ) : null}
        {changed ? (
          <p role="status" className="text-ui-body text-muted">
            {t("instanceAccess.defaultAccess.saveBeforePreview")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="primary"
            loading={save.isPending}
            disabled={
              !changed ||
              (enabled &&
                (!workspaceId || (!domains.trim() && !providerIds.length)))
            }
            onClick={() => save.mutate()}
          >
            {t("instanceAccess.defaultAccess.save")}
          </Button>
          <Button disabled={changed} onClick={openPreview}>
            {t("instanceAccess.defaultAccess.preview")}
          </Button>
        </div>
      </Form>
      <Modal
        open={previewOpen}
        title={t("instanceAccess.defaultAccess.preview")}
        onCancel={() => setPreviewOpen(false)}
        closable={!apply.isPending}
        mask={{ closable: !apply.isPending }}
        keyboard={!apply.isPending}
        width={760}
        footer={
          <Button
            type="primary"
            disabled={
              !selected.length ||
              selected.length > 100 ||
              preview.isFetching ||
              preview.isError
            }
            loading={apply.isPending}
            onClick={() => apply.mutate()}
          >
            {t("instanceAccess.defaultAccess.apply", {
              count: selected.length,
            })}
          </Button>
        }
      >
        <p>{t("instanceAccess.defaultAccess.previewHint")}</p>
        {preview.isError ? (
          <Alert
            type="error"
            showIcon
            title={t("instanceAccess.defaultAccess.loadError")}
            action={
              <Button
                onClick={() => {
                  void preview.refetch();
                }}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}
        {preview.data ? (
          <p>
            {t("instanceAccess.defaultAccess.destination", {
              workspace:
                overview.workspaces.find(
                  (w) => w.workspaceId === preview.data?.policy.workspaceId,
                )?.workspaceName ?? "—",
              role: t(
                `settings.people.roles.${preview.data.policy.role}.label`,
              ),
            })}
          </p>
        ) : null}
        <Table
          rowKey="principalId"
          loading={preview.isFetching}
          dataSource={preview.data?.candidates ?? []}
          pagination={{ pageSize: 10 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys.map(String)),
            getCheckboxProps: () => ({ disabled: apply.isPending }),
          }}
          columns={[
            {
              title: t("instanceAccess.defaultAccess.person"),
              dataIndex: "displayName",
            },
            {
              title: t("instanceAccess.defaultAccess.address"),
              dataIndex: "email",
            },
          ]}
        />
        {apply.isError ? (
          <Alert
            type="error"
            showIcon
            title={t("instanceAccess.defaultAccess.applyError")}
          />
        ) : null}
        {apply.data ? (
          <Alert
            type="info"
            showIcon
            title={t("instanceAccess.defaultAccess.applied", {
              granted: apply.data.results.filter((r) => r.state === "granted")
                .length,
              other: apply.data.results.filter((r) => r.state !== "granted")
                .length,
            })}
          />
        ) : null}
        {preview.data?.failures.length ? (
          <>
            <h3>{t("instanceAccess.defaultAccess.failures")}</h3>
            <Table
              rowKey="principalId"
              pagination={{ pageSize: 5 }}
              dataSource={preview.data.failures}
              scroll={{ x: 680 }}
              columns={[
                {
                  title: t("instanceAccess.defaultAccess.person"),
                  dataIndex: "displayName",
                },
                {
                  title: t("instanceAccess.defaultAccess.address"),
                  dataIndex: "email",
                },
                {
                  title: t("instanceAccess.defaultAccess.workspace"),
                  dataIndex: "workspaceName",
                },
                {
                  title: t("instanceAccess.defaultAccess.reason"),
                  render: (_, row) =>
                    t(`instanceAccess.defaultAccess.${row.reason}`),
                },
              ]}
            />
            <p>{t("instanceAccess.defaultAccess.failureHint")}</p>
          </>
        ) : null}
      </Modal>
    </>
  );
}
