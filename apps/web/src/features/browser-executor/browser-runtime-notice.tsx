import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";
import type { BrowserRuntimeConnectionState } from "./use-browser-runtimes.js";

export function BrowserRuntimeNotice({
  canRun,
  onReconnect,
  state,
}: {
  readonly canRun: boolean;
  readonly onReconnect: () => void;
  readonly state: BrowserRuntimeConnectionState;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!canRun) {
    return (
      <Alert
        description={t("workflows.runSession.browser.permissionRequired")}
        showIcon
        type="warning"
      />
    );
  }
  const needsReconnect = state === "reconnecting" || state === "unavailable";
  let type: "error" | "info" | "success" | "warning" = "info";
  if (state === "ready") type = "success";
  else if (state === "reconnecting") type = "warning";
  else if (state === "unavailable") type = "error";
  return (
    <Alert
      action={
        needsReconnect ? (
          <Button onClick={onReconnect} size="small">
            {t("workflows.runSession.browser.reconnect")}
          </Button>
        ) : undefined
      }
      description={t(`workflows.runSession.browser.${state}`)}
      showIcon
      type={type}
    />
  );
}
