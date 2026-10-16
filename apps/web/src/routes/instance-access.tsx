import { DefaultAccessSection } from "./default-access-section.js";
import {
  HomeOutlined,
  LockOutlined,
  MoreOutlined,
  ReloadOutlined,
  StopOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import type {
  GrantInstanceWorkspaceAccessBody,
  InstanceAccessOverview,
  InstanceRegistrationSettings,
} from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRoute,
  Link,
  Navigate,
  useNavigate,
} from "@tanstack/react-router";
import {
  Alert,
  Drawer,
  Dropdown,
  Input,
  Form,
  Modal,
  Popconfirm,
  Button,
  Checkbox,
  Select,
  Skeleton,
  Switch,
  Table,
  type TableColumnsType,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createInstanceInvitation,
  revokeInstanceInvitation,
  changeInstanceWorkspaceMembership,
  changeInstancePrincipalStatus,
  fetchCurrentHumanContext,
  fetchInstanceAccessOverview,
  fetchInstanceRegistrationSettings,
  grantInstanceWorkspaceAccess,
  updateInstanceRegistrationPolicy,
} from "../api/transport.js";
import { AccountSettingsShell } from "../components/account-settings-shell.js";
import { PageLoading } from "../components/feedback.js";
import {
  PublicEntryShell,
  PublicResult,
} from "../components/public-entry-shell.js";
import { useToast } from "../components/toast.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { StatusTag } from "../components/status-tag.js";
import { authClient } from "../auth/auth-client.js";
import { registrationControlDisabled } from "./instance-access-model.js";
import { rootRoute } from "./root.js";

type GrantableRole =
  GrantInstanceWorkspaceAccessBody["assignments"][number]["role"];

const grantableRoles = [
  "admin",
  "editor",
  "operator",
  "reviewer",
  "viewer",
] as const satisfies readonly GrantableRole[];

function InstanceAccessPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t("instanceAccess.title"));
  const session = authClient.useSession();
  const context = useQuery({
    queryKey: ["authentication", "current-human-context"],
    queryFn: () => fetchCurrentHumanContext(),
    enabled: Boolean(session.data),
    retry: false,
  });
  const isAdministrator = Boolean(context.data?.instanceAdministrator);
  const registration = useQuery({
    queryKey: ["instance", "registration-settings"],
    queryFn: () => fetchInstanceRegistrationSettings(),
    enabled: isAdministrator,
    retry: false,
  });
  const access = useQuery({
    queryKey: ["instance", "access-overview"],
    queryFn: () => fetchInstanceAccessOverview(),
    enabled: isAdministrator,
    retry: false,
  });

  if (session.isPending || (session.data && context.isPending)) {
    return <PageLoading label={t("instanceAccess.opening")} />;
  }
  if (!session.data) {
    return (
      <Navigate to="/login" search={{ returnTo: "/admin/access" }} replace />
    );
  }
  if (context.isError) {
    return (
      <PublicEntryShell
        headerEnd={<Link to="/">{t("instanceAccess.returnHome")}</Link>}
      >
        <PublicResult
          description={t("instanceAccess.contextErrorDescription")}
          icon={<ReloadOutlined />}
          primaryAction={{
            icon: <ReloadOutlined />,
            label: t("instanceAccess.retry"),
            loading: context.isFetching,
            onClick: () => {
              void context.refetch();
            },
          }}
          secondaryAction={{
            icon: <HomeOutlined />,
            label: t("instanceAccess.returnHome"),
            onClick: () => {
              void navigate({ to: "/" });
            },
          }}
          title={t("instanceAccess.contextErrorTitle")}
          tone="danger"
        />
      </PublicEntryShell>
    );
  }
  const humanContext = context.data;
  if (!humanContext?.instanceAdministrator) {
    return (
      <PublicEntryShell
        headerEnd={<Link to="/">{t("instanceAccess.returnHome")}</Link>}
      >
        <PublicResult
          description={t("instanceAccess.forbiddenDescription")}
          icon={<LockOutlined />}
          primaryAction={{
            icon: <HomeOutlined />,
            label: t("instanceAccess.returnHome"),
            onClick: () => {
              void navigate({ to: "/" });
            },
          }}
          title={t("instanceAccess.forbiddenTitle")}
          tone="warning"
        />
      </PublicEntryShell>
    );
  }

  function retryAccessData(): void {
    void registration.refetch();
    void access.refetch();
  }
  return (
    <AccountSettingsShell scope="site">
      <div className="mx-auto w-full max-w-[920px]">
        <h1
          className="m-0 text-ui-headline font-bold tracking-[-0.025em] text-ink"
          data-page-focus-target
          tabIndex={-1}
        >
          {t("instanceAccess.title")}
        </h1>

        {registration.isError || access.isError ? (
          <Alert
            action={
              <Button
                icon={<ReloadOutlined />}
                loading={registration.isFetching || access.isFetching}
                onClick={retryAccessData}
              >
                {t("instanceAccess.retry")}
              </Button>
            }
            className="mt-6"
            description={t("instanceAccess.loadErrorDescription")}
            showIcon
            title={t("instanceAccess.loadErrorTitle")}
            type="error"
          />
        ) : null}

        {registration.isPending || access.isPending ? (
          <div
            aria-label={t("instanceAccess.loadingSettings")}
            className="mt-8 rounded-card bg-paper p-6"
          >
            <Skeleton active paragraph={{ rows: 6 }} title={{ width: "38%" }} />
          </div>
        ) : null}

        {registration.data ? (
          <RegistrationPolicySection
            csrfToken={humanContext.csrfToken}
            key={registration.data.policy.version}
            settings={registration.data}
          />
        ) : null}

        {access.data && registration.data ? (
          <DefaultAccessSection
            csrfToken={humanContext.csrfToken}
            overview={access.data}
            settings={registration.data}
          />
        ) : null}
        {access.data ? (
          <SiteInvitations
            overview={access.data}
            csrfToken={humanContext.csrfToken}
          />
        ) : null}
        {access.data ? (
          <PendingAccessSection
            emailVerificationRequired={
              registration.data?.policy.emailVerificationRequired ?? true
            }
            currentPrincipalId={humanContext.human.principalId}
            csrfToken={humanContext.csrfToken}
            overview={access.data}
          />
        ) : null}
      </div>
    </AccountSettingsShell>
  );
}

function RegistrationPolicySection({
  csrfToken,
  settings,
}: {
  readonly csrfToken: string;
  readonly settings: InstanceRegistrationSettings;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const availableProviderIds = settings.capabilities.oidcProviders.map(
    ({ id }) => id,
  );
  const [enabled, setEnabled] = useState(
    settings.policy.mode === "account_only",
  );
  const [providerIds, setProviderIds] = useState<string[]>([
    ...settings.policy.oidcProviderIds,
  ]);
  const [emailPasswordEnabled, setEmailPasswordEnabled] = useState(
    settings.policy.emailPasswordEnabled,
  );
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(
    settings.policy.emailVerificationRequired,
  );
  const normalizedProviderIds = [...providerIds].sort();
  const originalProviderIds = [...settings.policy.oidcProviderIds].sort();
  const changed =
    enabled !== (settings.policy.mode === "account_only") ||
    emailPasswordEnabled !== settings.policy.emailPasswordEnabled ||
    emailVerificationRequired !== settings.policy.emailVerificationRequired ||
    normalizedProviderIds.join("\0") !== originalProviderIds.join("\0");
  const registrationMethodAvailable =
    settings.capabilities.emailPasswordRegistrationAvailable ||
    availableProviderIds.length > 0;
  const registrationMethodSelected =
    emailPasswordEnabled || normalizedProviderIds.length > 0;

  const save = useMutation({
    mutationFn: () =>
      updateInstanceRegistrationPolicy(csrfToken, {
        expectedVersion: settings.policy.version,
        mode: enabled ? "account_only" : "closed",
        emailPasswordEnabled: enabled && emailPasswordEnabled,
        emailVerificationRequired,
        oidcProviderIds: enabled ? normalizedProviderIds : [],
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["instance", "registration-settings"], next);
      toast.notify({
        title: t("instanceAccess.registration.saved"),
        tone: "positive",
      });
    },
    onError: () => {
      toast.notify({
        title: t("instanceAccess.registration.saveError"),
        tone: "danger",
      });
    },
  });

  function toggleRegistration(next: boolean): void {
    setEnabled(next);
    if (next && providerIds.length === 0 && !emailPasswordEnabled) {
      if (settings.capabilities.emailPasswordRegistrationAvailable) {
        setEmailPasswordEnabled(true);
      } else {
        setProviderIds(availableProviderIds);
      }
    }
    if (!next) {
      setEmailPasswordEnabled(false);
      setProviderIds([]);
    }
  }

  const canSave =
    changed &&
    !save.isPending &&
    (!enabled || registrationMethodSelected) &&
    !(
      enabled &&
      emailPasswordEnabled &&
      emailVerificationRequired &&
      settings.capabilities.emailVerificationDelivery === "unavailable"
    );

  return (
    <section className="mt-8 rounded-card bg-paper p-5 sm:p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:gap-6">
        <div className="min-w-0">
          <h2 className="m-0 text-ui-title font-bold text-ink">
            {t("instanceAccess.registration.title")}
          </h2>
          <p className="mb-0 mt-1.5 max-w-[62ch] text-ui-body leading-6 text-muted">
            {t("instanceAccess.registration.description")}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-3 text-ui-label font-bold text-ink">
          <span>{t("instanceAccess.registration.allow")}</span>
          <Switch
            aria-label={t("instanceAccess.registration.allow")}
            checked={enabled}
            disabled={
              save.isPending ||
              registrationControlDisabled({
                enabled,
                emailRegistrationAvailable:
                  settings.capabilities.emailPasswordRegistrationAvailable,
                oidcProviderCount: availableProviderIds.length,
              })
            }
            onChange={toggleRegistration}
          />
        </label>
      </div>

      <div className="mt-5 border-t border-line pt-5">
        {!registrationMethodAvailable ? (
          <Alert
            description={t("instanceAccess.registration.noMethods")}
            showIcon
            type="warning"
          />
        ) : null}

        {settings.capabilities.oidcProviders.length > 0 ? (
          <fieldset className="m-0 mt-5 min-w-0 border-0 p-0">
            <legend className="mb-3 p-0 text-ui-label font-bold text-ink">
              {t("instanceAccess.registration.providers")}
            </legend>
            <Checkbox.Group
              disabled={!enabled || save.isPending}
              onChange={(values) => {
                setProviderIds(values.map(String));
              }}
              options={settings.capabilities.oidcProviders.map(
                ({ id, name }) => ({ label: name, value: id }),
              )}
              value={providerIds}
            />
          </fieldset>
        ) : null}

        {settings.capabilities.emailPasswordRegistrationAvailable ? (
          <div className="mt-5">
            <p className="mb-3 mt-0 text-ui-label font-bold text-ink">
              {t("instanceAccess.registration.email")}
            </p>
            <Checkbox
              checked={emailPasswordEnabled}
              disabled={!enabled || save.isPending}
              onChange={(event) => {
                setEmailPasswordEnabled(event.target.checked);
              }}
            >
              {t("instanceAccess.registration.emailVerified")}
            </Checkbox>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label
                htmlFor="email-verification-required"
                className="text-sm font-medium"
              >
                {t("instanceAccess.registration.requireVerification")}
              </label>
              <Switch
                id="email-verification-required"
                checked={emailVerificationRequired}
                disabled={save.isPending}
                onChange={setEmailVerificationRequired}
              />
            </div>
            <p className="mb-0 mt-2 text-ui-label leading-5 text-muted">
              {t("instanceAccess.registration.verificationScope")}
            </p>
            {!emailVerificationRequired ? (
              <Alert
                className="mt-3"
                showIcon
                type="warning"
                title={t("instanceAccess.registration.verificationRiskTitle")}
                description={t("instanceAccess.registration.verificationRisk")}
              />
            ) : null}
            {emailVerificationRequired &&
            settings.capabilities.emailVerificationDelivery ===
              "unavailable" ? (
              <Alert
                className="mt-3"
                showIcon
                type="warning"
                title={t("instanceAccess.registration.deliveryRequired")}
              />
            ) : null}
            {emailVerificationRequired &&
            settings.capabilities.emailVerificationDelivery ===
              "development_outbox" ? (
              <Alert
                className="mt-3"
                description={t("instanceAccess.registration.developmentOutbox")}
                showIcon
                type="info"
              />
            ) : null}
          </div>
        ) : null}

        {enabled && !registrationMethodSelected ? (
          <p
            className="mb-0 mt-4 text-ui-label leading-5 text-warning"
            role="status"
          >
            {t("instanceAccess.registration.methodRequired")}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <span
            aria-live="polite"
            className="text-ui-label leading-5 text-muted"
          >
            {changed ? t("instanceAccess.registration.unsaved") : null}
          </span>
          <Button
            disabled={!canSave}
            loading={save.isPending}
            onClick={() => save.mutate()}
            size="large"
            type="primary"
          >
            {t(
              save.isPending
                ? "instanceAccess.registration.saving"
                : "instanceAccess.registration.save",
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

function SiteInvitations({
  overview,
  csrfToken,
}: {
  readonly overview: InstanceAccessOverview;
  readonly csrfToken: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GrantableRole>("viewer");
  const pending = overview.invitations.filter(
    (invitation) => invitation.state === "pending",
  );
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["instance", "access-overview"],
    });
  const invite = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Select a workspace");
      return createInstanceInvitation(csrfToken, workspaceId, {
        targetEmail: email.trim(),
        workspaceRole: role,
      });
    },
    onSuccess: async (created) => {
      setLink(`${window.location.origin}${created.invitePath}`);
      await refresh();
    },
    onError: () =>
      toast.notify({
        title: t("instanceAccess.invites.failed"),
        tone: "danger",
      }),
  });
  const revoke = useMutation({
    mutationFn: (invitation: InstanceAccessOverview["invitations"][number]) =>
      revokeInstanceInvitation(
        csrfToken,
        invitation.workspaceId,
        invitation.invitationId,
        { expectedVersion: invitation.version },
      ),
    onSuccess: async () => {
      toast.notify({
        title: t("instanceAccess.invites.revoked"),
        tone: "positive",
      });
      await refresh();
    },
    onError: () =>
      toast.notify({
        title: t("instanceAccess.invites.failed"),
        tone: "danger",
      }),
  });
  function openInviteDialog(): void {
    setLink(undefined);
    setOpen(true);
  }
  return (
    <section className="mt-8 border-t border-line pt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-ui-title font-bold">
          {t("instanceAccess.invites.title")}
        </h2>
        <Button
          disabled={overview.workspaces.length === 0}
          onClick={openInviteDialog}
        >
          {t("instanceAccess.invites.create")}
        </Button>
      </div>
      {pending.length > 0 ? (
        <div className="mt-4 divide-y divide-line rounded-card bg-paper">
          {pending.map((invitation) => (
            <div
              key={invitation.invitationId}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm">
                  {invitation.targetEmail}
                </strong>
                <span className="block truncate text-xs text-muted">
                  {
                    overview.workspaces.find(
                      (workspace) =>
                        workspace.workspaceId === invitation.workspaceId,
                    )?.workspaceName
                  }{" "}
                  ·{" "}
                  {t(`settings.people.roles.${invitation.workspaceRole}.label`)}
                </span>
              </div>
              <Popconfirm
                title={t("instanceAccess.invites.revokeConfirm")}
                onConfirm={() => revoke.mutate(invitation)}
                okText={t("instanceAccess.accounts.confirm")}
                cancelText={t("instanceAccess.accounts.cancel")}
              >
                <Button danger type="text" disabled={revoke.isPending}>
                  {t("instanceAccess.invites.revoke")}
                </Button>
              </Popconfirm>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-0 text-sm text-muted">
          {t("instanceAccess.invites.empty")}
        </p>
      )}
      <Drawer
        title={t("instanceAccess.invites.create")}
        open={open}
        onClose={() => {
          if (!invite.isPending) setOpen(false);
        }}
        size={480}
        destroyOnHidden
      >
        {link ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm">{t("instanceAccess.invites.share")}</p>
            <Input
              readOnly
              value={link}
              aria-label={t("instanceAccess.invites.link")}
            />
            <Button
              type="primary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(link)
                  .then(() =>
                    toast.notify({
                      title: t("instanceAccess.invites.copied"),
                      tone: "positive",
                    }),
                  )
                  .catch(() =>
                    toast.notify({
                      title: t("instanceAccess.invites.copyFailed"),
                      tone: "danger",
                    }),
                  );
              }}
            >
              {t("instanceAccess.invites.copy")}
            </Button>
          </div>
        ) : (
          <Form layout="vertical" onFinish={() => invite.mutate()}>
            <Form.Item label={t("instanceAccess.pending.workspace")}>
              <Select
                aria-label={t("instanceAccess.pending.workspace")}
                disabled={invite.isPending}
                value={workspaceId}
                onChange={setWorkspaceId}
                options={overview.workspaces.map((workspace) => ({
                  value: workspace.workspaceId,
                  label: `${workspace.organizationName} / ${workspace.workspaceName}`,
                }))}
              />
            </Form.Item>
            <Form.Item label={t("instanceAccess.invites.email")}>
              <Input
                aria-label={t("instanceAccess.invites.email")}
                disabled={invite.isPending}
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Form.Item>
            <Form.Item label={t("instanceAccess.pending.role")}>
              <Select
                aria-label={t("instanceAccess.pending.role")}
                disabled={invite.isPending}
                value={role}
                onChange={setRole}
                options={grantableRoles.map((value) => ({
                  value,
                  label: t(`settings.people.roles.${value}.label`),
                }))}
              />
            </Form.Item>
            <Button
              block
              type="primary"
              htmlType="submit"
              loading={invite.isPending}
              disabled={!workspaceId || !email.trim()}
            >
              {t("instanceAccess.invites.create")}
            </Button>
          </Form>
        )}
      </Drawer>
    </section>
  );
}

type SitePrincipal = InstanceAccessOverview["principals"][number];
type SiteMembership = SitePrincipal["memberships"][number];

function PendingAccessSection({
  emailVerificationRequired,
  csrfToken,
  overview,
  currentPrincipalId,
}: {
  readonly csrfToken: string;
  readonly overview: InstanceAccessOverview;
  readonly currentPrincipalId: string;
  readonly emailVerificationRequired: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [statusTarget, setStatusTarget] = useState<SitePrincipal>();
  const selected = overview.principals.find(
    (item) => item.principalId === selectedId,
  );
  const accounts = overview.principals.filter((item) => {
    const matches = `${item.displayName} ${item.email ?? ""}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
    return (
      matches &&
      (filter === "all" ||
        (filter === "unassigned" &&
          !item.memberships.some(
            (membership) => membership.status === "active",
          )) ||
        (filter === "suspended" && item.status === "suspended"))
    );
  });
  const updateStatus = useMutation({
    mutationFn: (principal: SitePrincipal) =>
      changeInstancePrincipalStatus(csrfToken, principal.principalId, {
        expectedVersion: principal.version,
        status: principal.status === "active" ? "suspended" : "active",
      }),
    onSuccess: async () => {
      setStatusTarget(undefined);
      toast.notify({
        title: t("instanceAccess.accounts.statusUpdated"),
        tone: "positive",
      });
      await queryClient.invalidateQueries({
        queryKey: ["instance", "access-overview"],
      });
    },
    onError: () =>
      toast.notify({
        title: t("instanceAccess.accounts.statusFailed"),
        tone: "danger",
      }),
  });
  const columns: TableColumnsType<SitePrincipal> = [
    {
      key: "identity",
      render: (_, principal) => (
        <div className="min-w-0">
          <strong className="block truncate text-sm">
            {principal.displayName}
          </strong>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {principal.email}
          </span>
          {!principal.emailVerified ? (
            <span className="text-xs text-muted">
              {t("instanceAccess.accounts.emailUnverified")}
            </span>
          ) : null}
        </div>
      ),
      title: t("instanceAccess.accounts.columns.account"),
      width: 340,
    },
    {
      key: "status",
      render: (_, principal) => {
        let tone: "neutral" | "positive" | "warning" = "neutral";
        if (principal.status === "active") tone = "positive";
        if (principal.status === "suspended") tone = "warning";
        return (
          <StatusTag tone={tone}>
            {t(`instanceAccess.accounts.states.${principal.status}`)}
          </StatusTag>
        );
      },
      title: t("instanceAccess.accounts.columns.status"),
      width: 140,
    },
    {
      align: "right",
      key: "actions",
      render: (_, principal) => {
        const canChangeStatus =
          !principal.isInstanceAdministrator &&
          principal.principalId !== currentPrincipalId &&
          principal.status !== "revoked";
        const statusPending =
          updateStatus.isPending &&
          updateStatus.variables?.principalId === principal.principalId;
        return (
          <div className="grid grid-cols-[minmax(0,1fr)_24px] items-center gap-1">
            <Button
              className="justify-self-end"
              onClick={() => setSelectedId(principal.principalId)}
              size="small"
            >
              {t("instanceAccess.accounts.manage")}
            </Button>
            {canChangeStatus ? (
              <Dropdown
                disabled={updateStatus.isPending}
                menu={{
                  items: [
                    {
                      danger: principal.status === "active",
                      icon:
                        principal.status === "active" ? (
                          <StopOutlined aria-hidden="true" />
                        ) : (
                          <UndoOutlined aria-hidden="true" />
                        ),
                      key: "change-status",
                      label: t(
                        principal.status === "active"
                          ? "instanceAccess.accounts.suspend"
                          : "instanceAccess.accounts.restore",
                      ),
                    },
                  ],
                  onClick: () => setStatusTarget(principal),
                }}
                placement="bottomRight"
                trigger={["click"]}
              >
                <Button
                  aria-label={t("instanceAccess.accounts.moreFor", {
                    name: principal.displayName,
                  })}
                  icon={<MoreOutlined aria-hidden="true" />}
                  loading={statusPending}
                  size="small"
                  type="text"
                />
              </Dropdown>
            ) : (
              <span aria-hidden="true" className="block size-6" />
            )}
          </div>
        );
      },
      title: t("instanceAccess.accounts.columns.actions"),
      width: 220,
    },
  ];
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="m-0 text-ui-title font-bold">
        {t("instanceAccess.accounts.title")}
      </h2>
      <div className="my-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input.Search
          className="w-full sm:max-w-[360px]"
          aria-label={t("instanceAccess.accounts.search")}
          placeholder={t("instanceAccess.accounts.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
        <Select
          className="w-full sm:w-44"
          aria-label={t("instanceAccess.accounts.filter")}
          value={filter}
          onChange={setFilter}
          options={["all", "unassigned", "suspended"].map((value) => ({
            value,
            label: t(`instanceAccess.accounts.filters.${value}`),
          }))}
        />
      </div>
      <div className="overflow-hidden rounded-card bg-paper">
        <Table<SitePrincipal>
          classNames={{
            body: { cell: "px-4" },
            header: { cell: "px-4 py-2.5 text-xs font-semibold" },
          }}
          columns={columns}
          dataSource={[...accounts]}
          locale={{
            emptyText: (
              <span className="text-sm text-muted">
                {t("instanceAccess.accounts.empty")}
              </span>
            ),
          }}
          pagination={false}
          rowKey="principalId"
          scroll={{ x: 700 }}
          size="middle"
          tableLayout="fixed"
        />
      </div>
      <Modal
        cancelText={t("instanceAccess.accounts.cancel")}
        confirmLoading={updateStatus.isPending}
        destroyOnHidden
        okButtonProps={{ danger: statusTarget?.status === "active" }}
        okText={
          statusTarget
            ? t(
                statusTarget.status === "active"
                  ? "instanceAccess.accounts.suspend"
                  : "instanceAccess.accounts.restore",
              )
            : undefined
        }
        onCancel={() => {
          if (!updateStatus.isPending) setStatusTarget(undefined);
        }}
        onOk={() => {
          if (statusTarget) updateStatus.mutate(statusTarget);
        }}
        open={Boolean(statusTarget)}
        title={
          statusTarget
            ? t(
                statusTarget.status === "active"
                  ? "instanceAccess.accounts.suspendTitle"
                  : "instanceAccess.accounts.restoreTitle",
                { name: statusTarget.displayName },
              )
            : undefined
        }
      >
        {statusTarget ? (
          <p className="m-0 text-sm leading-6 text-muted">
            {t(
              statusTarget.status === "active"
                ? "instanceAccess.accounts.suspendConfirm"
                : "instanceAccess.accounts.restoreConfirm",
            )}
          </p>
        ) : null}
      </Modal>
      <Drawer
        title={t("instanceAccess.accounts.manage")}
        open={Boolean(selected)}
        onClose={() => setSelectedId(undefined)}
        size={560}
        destroyOnHidden
      >
        {selected ? (
          <PrincipalMembershipEditor
            emailVerificationRequired={emailVerificationRequired}
            key={selected.principalId}
            principal={selected}
            overview={overview}
            csrfToken={csrfToken}
          />
        ) : null}
      </Drawer>
    </section>
  );
}

function PrincipalMembershipEditor({
  emailVerificationRequired,
  principal,
  overview,
  csrfToken,
}: {
  readonly emailVerificationRequired: boolean;
  readonly principal: SitePrincipal;
  readonly overview: InstanceAccessOverview;
  readonly csrfToken: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [role, setRole] = useState<GrantableRole>("viewer");
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["instance", "access-overview"],
    });
  const add = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Select a workspace");
      return grantInstanceWorkspaceAccess(csrfToken, principal.principalId, {
        assignments: [{ workspaceId, role }],
      });
    },
    onSuccess: async () => {
      setWorkspaceId(undefined);
      toast.notify({
        title: t("instanceAccess.pending.assigned", {
          name: principal.displayName,
        }),
        tone: "positive",
      });
      await refresh();
    },
    onError: () =>
      toast.notify({
        title: t("instanceAccess.pending.assignError", {
          name: principal.displayName,
        }),
        tone: "danger",
      }),
  });
  const available = overview.workspaces.filter(
    (workspace) =>
      !principal.memberships.some(
        (membership) => membership.workspaceId === workspace.workspaceId,
      ),
  );
  return (
    <div className="grid gap-6">
      <div>
        <strong className="text-base">{principal.displayName}</strong>
        <p className="m-0 mt-1 break-all text-sm text-muted">
          {principal.email}
        </p>
      </div>
      <div className="grid gap-3">
        {principal.memberships.length === 0 ? (
          <p className="text-sm text-muted">
            {t("instanceAccess.accounts.noMembership")}
          </p>
        ) : (
          principal.memberships.map((membership) => (
            <SiteMembershipRow
              key={`${membership.membershipId}:${membership.version}`}
              membership={membership}
              principal={principal}
              workspace={overview.workspaces.find(
                (workspace) => workspace.workspaceId === membership.workspaceId,
              )}
              csrfToken={csrfToken}
              onUpdated={refresh}
            />
          ))
        )}
      </div>
      {principal.status === "active" &&
      (principal.emailVerified || !emailVerificationRequired) &&
      available.length > 0 ? (
        <section className="grid gap-3 border-t border-line pt-5">
          <h3 className="m-0 text-sm font-semibold">
            {t("instanceAccess.accounts.addWorkspace")}
          </h3>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("instanceAccess.pending.workspace")}
            <Select
              disabled={add.isPending}
              aria-label={t("instanceAccess.pending.workspace")}
              placeholder={t("instanceAccess.pending.workspacePlaceholder")}
              value={workspaceId}
              onChange={setWorkspaceId}
              options={available.map((workspace) => ({
                value: workspace.workspaceId,
                label: `${workspace.organizationName} / ${workspace.workspaceName}`,
              }))}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("instanceAccess.pending.role")}
            <Select
              disabled={add.isPending}
              aria-label={t("instanceAccess.pending.role")}
              value={role}
              onChange={setRole}
              options={grantableRoles.map((value) => ({
                value,
                label: t(`settings.people.roles.${value}.label`),
              }))}
            />
          </label>
          <Button
            type="primary"
            disabled={!workspaceId}
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            {t("instanceAccess.pending.assign")}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function SiteMembershipRow({
  membership,
  principal,
  workspace,
  csrfToken,
  onUpdated,
}: {
  readonly membership: SiteMembership;
  readonly principal: SitePrincipal;
  readonly workspace: InstanceAccessOverview["workspaces"][number] | undefined;
  readonly csrfToken: string;
  readonly onUpdated: () => Promise<unknown>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [role, setRole] = useState(membership.role);
  const change = useMutation({
    mutationFn: (status: SiteMembership["status"]) =>
      changeInstanceWorkspaceMembership(
        csrfToken,
        membership.workspaceId,
        principal.principalId,
        { expectedVersion: membership.version, role, status },
      ),
    onSuccess: async () => {
      toast.notify({
        title: t("instanceAccess.accounts.membershipUpdated"),
        tone: "positive",
      });
      await onUpdated();
    },
    onError: () =>
      toast.notify({
        title: t("instanceAccess.accounts.membershipFailed"),
        tone: "danger",
      }),
  });
  return (
    <section className="grid gap-3 rounded-control bg-mist p-4">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">
          {workspace?.workspaceName ??
            t("instanceAccess.accounts.unavailableWorkspace")}
        </strong>
        <span className="text-xs text-muted">
          {t(`instanceAccess.accounts.memberStates.${membership.status}`)}
        </span>
      </div>
      <Select
        aria-label={t("instanceAccess.pending.role")}
        disabled={change.isPending || principal.status !== "active"}
        value={role}
        onChange={setRole}
        options={["owner", ...grantableRoles].map((value) => ({
          value,
          label: t(`settings.people.roles.${value}.label`),
        }))}
      />
      <div className="flex justify-end gap-2">
        {membership.status === "active" ? (
          <Popconfirm
            title={t("instanceAccess.accounts.removeConfirm")}
            onConfirm={() => change.mutate("revoked")}
            okText={t("instanceAccess.accounts.confirm")}
            cancelText={t("instanceAccess.accounts.cancel")}
          >
            <Button danger type="text" disabled={change.isPending}>
              {t("instanceAccess.accounts.remove")}
            </Button>
          </Popconfirm>
        ) : (
          <Button
            disabled={principal.status !== "active"}
            loading={change.isPending}
            onClick={() => change.mutate("active")}
          >
            {t("instanceAccess.accounts.restore")}
          </Button>
        )}
        <Button
          disabled={
            role === membership.role ||
            membership.status !== "active" ||
            principal.status !== "active"
          }
          loading={change.isPending}
          onClick={() => change.mutate(membership.status)}
        >
          {t("instanceAccess.accounts.saveRole")}
        </Button>
      </div>
    </section>
  );
}

export const instanceAccessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/access",
  component: InstanceAccessPage,
});
