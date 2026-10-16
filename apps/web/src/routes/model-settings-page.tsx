import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Skeleton } from "antd";
import { useTranslation } from "react-i18next";

import { fetchWorkspaceProviderSettings } from "../api/transport.js";
import { workspaceQueryKeys } from "../api/query-keys.js";
import { EmptyState, InlineNotice } from "../components/feedback.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { ModelControlPlanePanel } from "../features/provider-settings/model-control-plane-panel.js";
import { ModelServiceTabs } from "../features/provider-settings/model-service-tabs.js";
import { providerSettingsError } from "../features/provider-settings/provider-settings-runtime.js";

const modelSettingsRouteApi = getRouteApi("/w/$workspaceId/settings/models");

export function ModelSettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = modelSettingsRouteApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.models.title")}
      workspaceId={workspaceId}
    >
      {({ context, workspace }) => (
        <SettingsShell active="providers" workspace={workspace}>
          {workspace.permissions.includes("credential.manage") ? (
            <ModelSettingsContent
              canManageApplications={workspace.permissions.includes(
                "workspace.manage",
              )}
              csrfToken={context.csrfToken}
              workspaceId={workspace.id}
            />
          ) : (
            <EmptyState title={t("settings.models.forbiddenTitle")}>
              {t("settings.models.forbiddenDescription")}
            </EmptyState>
          )}
        </SettingsShell>
      )}
    </WorkspacePage>
  );
}

function ModelSettingsContent({
  canManageApplications,
  csrfToken,
  workspaceId,
}: {
  readonly canManageApplications: boolean;
  readonly csrfToken: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const providers = useQuery({
    queryKey: workspaceQueryKeys.providerSettings(workspaceId),
    queryFn: () => fetchWorkspaceProviderSettings(workspaceId),
    retry: false,
  });

  return (
    <div className="w-full">
      <SettingsPageHeader title={t("settings.modelServices.title")} />
      <ModelServiceTabs active="models" workspaceId={workspaceId} />
      {providers.isPending ? (
        <div className="rounded-[20px] bg-paper p-5">
          <Skeleton active paragraph={{ rows: 4 }} />
        </div>
      ) : null}
      {providers.isError ? (
        <InlineNotice title={t("settings.models.loadErrorTitle")} tone="danger">
          {providerSettingsError(providers.error)}
        </InlineNotice>
      ) : null}
      {providers.data ? (
        <ModelControlPlanePanel
          canManageApplications={canManageApplications}
          csrfToken={csrfToken}
          providers={providers.data.providers}
          workspaceId={workspaceId}
        />
      ) : null}
    </div>
  );
}
