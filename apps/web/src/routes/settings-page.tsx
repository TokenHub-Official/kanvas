import { getRouteApi, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EmptyState } from "../components/feedback.js";
import { firstSettingsRoute } from "../components/settings-shell.js";
import { WorkspacePage } from "../components/workspace-page.js";

const settingsRouteApi = getRouteApi("/w/$workspaceId/settings");

export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = settingsRouteApi.useParams();
  return (
    <WorkspacePage
      pageTitle={t("settings.shell.title")}
      workspaceId={workspaceId}
    >
      {({ workspace }) => {
        const destination = firstSettingsRoute(workspace);
        return destination ? (
          <Navigate params={{ workspaceId }} replace to={destination} />
        ) : (
          <EmptyState title={t("settings.gateway.emptyTitle")}>
            {t("settings.gateway.emptyDescription")}
          </EmptyState>
        );
      }}
    </WorkspacePage>
  );
}
