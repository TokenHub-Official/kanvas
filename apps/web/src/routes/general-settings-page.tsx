import { ReloadOutlined } from "@ant-design/icons";
import type { WorkspaceGeneralSettings } from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button, Form, Skeleton } from "antd";
import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  fetchWorkspaceGeneralSettings,
  renameWorkspace,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import { EmptyState, InlineNotice } from "../components/feedback.js";
import { KanvasInput } from "../components/kanvas-input.js";
import { usePageQueryRecovery } from "../components/page-query-recovery.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { useSettingsNotification } from "../components/settings-notification.js";
import { UnsavedChangesGuard } from "../components/unsaved-changes-guard.js";
import { WorkspacePage } from "../components/workspace-page.js";

const generalSettingsRouteApi = getRouteApi("/w/$workspaceId/settings/general");

export function GeneralSettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = generalSettingsRouteApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.general.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="general" workspace={workspace}>
          {workspace.permissions.includes("workspace.manage") ? (
            <GeneralSettingsContent
              csrfToken={context.csrfToken}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState title={t("settings.general.forbiddenTitle")}>
              {t("settings.general.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function GeneralSettingsContent({
  csrfToken,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const settings = useQuery({
    queryKey: ["workspace-general-settings", workspaceId],
    queryFn: () => fetchWorkspaceGeneralSettings(workspaceId),
    retry: false,
  });
  const recovery = usePageQueryRecovery(settings.refetch);

  if (settings.isPending) {
    return (
      <div className="w-full max-w-180">
        <SettingsPageHeader title={t("settings.general.title")} />
        <section
          aria-label={t("settings.general.loading")}
          className="max-w-165 rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6"
        >
          <Skeleton active paragraph={{ rows: 3 }} />
        </section>
      </div>
    );
  }
  if (settings.isError && !settings.data) {
    const forbidden =
      settings.error instanceof ApiProblem &&
      settings.error.status === httpStatus.forbidden;
    return (
      <div className="w-full max-w-180">
        <SettingsPageHeader title={t("settings.general.title")} />
        <EmptyState
          action={() => {
            if (forbidden) {
              window.location.reload();
              return;
            }
            recovery.retry();
          }}
          actionLabel={
            forbidden
              ? t("settings.general.recheckPermission")
              : t("settings.general.reload")
          }
          actionPending={!forbidden && recovery.pending}
          title={
            forbidden
              ? t("settings.general.forbiddenLoadTitle")
              : t("settings.general.loadErrorTitle")
          }
        >
          {forbidden
            ? t("settings.general.forbiddenLoadDescription")
            : t("common.checkConnection")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="w-full max-w-180">
      <SettingsPageHeader title={t("settings.general.title")} />

      {settings.isError ? (
        <InlineNotice
          className="mb-5"
          title={t("settings.general.staleTitle")}
          tone="info"
        >
          <span>{t("settings.general.staleDescription")}</span>
          <Button
            className="!ml-3"
            disabled={settings.isFetching}
            onClick={() => {
              void settings.refetch();
            }}
            size="small"
          >
            <ReloadOutlined aria-hidden="true" />
            {settings.isFetching
              ? t("settings.general.refreshing")
              : t("settings.general.refresh")}
          </Button>
        </InlineNotice>
      ) : null}

      <WorkspaceGeneralForm
        canSave={!settings.isError}
        csrfToken={csrfToken}
        key={settings.data.version}
        onRefresh={settings.refetch}
        settings={settings.data}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function WorkspaceGeneralForm({
  canSave,
  csrfToken,
  onRefresh,
  settings,
  workspaceId,
}: {
  readonly canSave: boolean;
  readonly csrfToken: string;
  readonly onRefresh: () => Promise<unknown>;
  readonly settings: WorkspaceGeneralSettings;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useSettingsNotification();
  const queryClient = useQueryClient();
  const [name, setName] = useState(settings.name);
  const [fieldError, setFieldError] = useState<string>();
  const trimmedName = name.trim();
  const changed = trimmedName !== settings.name;

  async function refreshContext(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: ["authentication", "current-human-context"],
    });
  }

  const rename = useMutation({
    mutationFn: () =>
      renameWorkspace(
        { csrfToken, workspaceId },
        {
          expectedVersion: settings.version,
          name: trimmedName,
        },
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        ["workspace-general-settings", workspaceId],
        result,
      );
      await refreshContext();
      toast.notify({
        title: t("settings.general.savedTitle"),
        description: t("settings.general.savedDescription"),
        tone: "positive",
      });
    },
    onError: async (error) => {
      const refreshed = await onRefresh();
      await refreshContext();
      const current = (
        refreshed as {
          readonly data?: WorkspaceGeneralSettings;
        }
      ).data;
      if (current?.name === trimmedName) {
        toast.notify({
          title: t("settings.general.savedTitle"),
          description: t("settings.general.savedAfterRecovery"),
          tone: "positive",
        });
        return;
      }
      if (error instanceof ApiProblem && error.status === httpStatus.conflict) {
        toast.notify({
          title: t("settings.general.conflictTitle"),
          description: t("settings.general.conflictDescription"),
          tone: "danger",
        });
        return;
      }
      toast.notify({
        title: t("settings.general.confirmingTitle"),
        description: t("settings.general.confirmingDescription"),
        tone: "danger",
      });
    },
  });

  function submitWorkspaceRename(): void {
    if (!trimmedName) {
      setFieldError(t("settings.general.nameRequired"));
      return;
    }
    if (changed && canSave) {
      setFieldError(undefined);
      rename.mutate();
    }
  }

  function updateWorkspaceName(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value);
    if (fieldError) {
      setFieldError(undefined);
    }
  }

  return (
    <>
      <UnsavedChangesGuard
        active={changed || rename.isPending}
        title={t("settings.general.leaveTitle")}
      >
        {t("settings.general.leaveDescription")}
      </UnsavedChangesGuard>
      <Form
        className="max-w-165"
        layout="vertical"
        onFinish={submitWorkspaceRename}
        requiredMark={false}
      >
        <section
          aria-labelledby="workspace-identity-title"
          className="rounded-[20px] bg-paper p-5 shadow-[0_12px_32px_rgb(35_32_68_/_6%)] sm:p-6"
        >
          <h3
            className="mb-5 text-[17px] font-semibold tracking-[-0.015em]"
            id="workspace-identity-title"
          >
            {t("settings.general.identityTitle")}
          </h3>

          <Form.Item
            className="!mb-0"
            htmlFor="workspace-name"
            label={t("settings.general.nameLabel")}
            {...(fieldError ? { validateStatus: "error" as const } : {})}
          >
            <div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <KanvasInput
                  aria-describedby={
                    fieldError ? "workspace-name-error" : undefined
                  }
                  aria-invalid={fieldError ? true : undefined}
                  autoComplete="organization"
                  disabled={rename.isPending}
                  id="workspace-name"
                  maxLength={160}
                  onChange={updateWorkspaceName}
                  size="large"
                  value={name}
                />
                <Button
                  className="!h-11 sm:!min-w-30"
                  disabled={!changed || !canSave || rename.isPending}
                  htmlType="submit"
                  loading={rename.isPending}
                  size="large"
                  type="primary"
                >
                  {t("settings.general.save")}
                </Button>
              </div>
              {fieldError ? (
                <p
                  className="mt-2 mb-0 text-xs leading-5 text-danger"
                  id="workspace-name-error"
                  role="alert"
                >
                  {fieldError}
                </p>
              ) : null}
            </div>
          </Form.Item>

          <dl className="mt-6 border-t border-line pt-5">
            <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start sm:gap-5">
              <dt className="text-sm font-semibold text-ink">
                {t("settings.general.slugLabel")}
              </dt>
              <dd className="m-0 min-w-0">
                <span className="block font-mono text-sm font-semibold text-ink">
                  {settings.slug}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted">
                  {t("settings.general.slugDescription")}
                </span>
              </dd>
            </div>
          </dl>
        </section>
      </Form>
    </>
  );
}
