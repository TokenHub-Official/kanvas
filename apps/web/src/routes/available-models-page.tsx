import { ArrowLeftOutlined } from "@ant-design/icons";
import { getRouteApi } from "@tanstack/react-router";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { EmptyState } from "../components/feedback.js";
import {
  SettingsPageHeader,
  SettingsShell,
} from "../components/settings-shell.js";
import { WorkspacePage } from "../components/workspace-page.js";
import { AvailableModelsPanel } from "../features/provider-settings/model-control-plane-panel.js";
import { ModelServiceTabs } from "../features/provider-settings/model-service-tabs.js";

const availableModelsRouteApi = getRouteApi(
  "/w/$workspaceId/settings/models/available",
);

export function AvailableModelsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { workspaceId } = availableModelsRouteApi.useParams();
  return (
    <WorkspacePage pageTitle="可选模型" workspaceId={workspaceId}>
      {({ workspace }) => (
        <SettingsShell active="providers" workspace={workspace}>
          {workspace.permissions.includes("credential.manage") ? (
            <div className="w-full">
              <SettingsPageHeader title={t("settings.modelServices.title")} />
              <ModelServiceTabs active="models" workspaceId={workspaceId} />
              <section className="grid gap-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">可选模型</h3>
                  <Button
                    href={`/w/${workspaceId}/settings/models`}
                    icon={<ArrowLeftOutlined />}
                  >
                    返回模型
                  </Button>
                </div>
                <AvailableModelsPanel workspaceId={workspaceId} />
              </section>
            </div>
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
