import { App as AntApp } from "antd";
import { useCallback, useMemo } from "react";

interface SettingsNotification {
  readonly description?: string;
  readonly title: string;
  readonly tone: "positive" | "danger";
}

interface SettingsNotificationActions {
  notify(input: SettingsNotification): void;
}

export function useSettingsNotification(): SettingsNotificationActions {
  const { notification } = AntApp.useApp();
  const notify = useCallback(
    (input: SettingsNotification) => {
      notification[input.tone === "positive" ? "success" : "error"]({
        description: input.description,
        message: input.title,
        placement: "topRight",
      });
    },
    [notification],
  );

  return useMemo(() => ({ notify }), [notify]);
}
