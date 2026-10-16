import { App as AntApp } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export type NetworkStatus = "online" | "offline" | "restored";
export type NetworkStatusEvent = "offline" | "online" | "settled";
const RESTORED_TOAST_DURATION_MS = 4_000;
const MILLISECONDS_PER_SECOND = 1_000;
const NETWORK_STATUS_NOTIFICATION_KEY = "kanvas-network-status";

export function nextNetworkStatus(
  current: NetworkStatus,
  event: NetworkStatusEvent,
): NetworkStatus {
  if (event === "offline") {
    return "offline";
  }
  if (event === "online") {
    return current === "offline" ? "restored" : "online";
  }
  return current === "restored" ? "online" : current;
}

function initialNetworkStatus(): NetworkStatus {
  return typeof navigator === "undefined" || navigator.onLine
    ? "online"
    : "offline";
}

export function NetworkStatusToast(): React.JSX.Element | null {
  const { notification } = AntApp.useApp();
  const { t } = useTranslation();
  const [status, setStatus] = useState<NetworkStatus>(initialNetworkStatus);

  useEffect(() => {
    const handleOffline = (): void => {
      setStatus((current) => nextNetworkStatus(current, "offline"));
    };
    const handleOnline = (): void => {
      setStatus((current) => nextNetworkStatus(current, "online"));
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    if (status === "online") {
      notification.destroy(NETWORK_STATUS_NOTIFICATION_KEY);
      return;
    }

    const restored = status === "restored";
    notification.open({
      closable: restored,
      description: restored
        ? t("common.network.restoredDescription")
        : t("common.network.offlineDescription"),
      duration: restored
        ? RESTORED_TOAST_DURATION_MS / MILLISECONDS_PER_SECOND
        : false,
      key: NETWORK_STATUS_NOTIFICATION_KEY,
      placement: "bottomRight",
      role: restored ? "status" : "alert",
      title: restored
        ? t("common.network.restoredTitle")
        : t("common.network.offlineTitle"),
      type: restored ? "success" : "warning",
    });

    if (!restored) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setStatus((current) => nextNetworkStatus(current, "settled"));
    }, RESTORED_TOAST_DURATION_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [notification, status, t]);

  useEffect(() => {
    return () => {
      notification.destroy(NETWORK_STATUS_NOTIFICATION_KEY);
    };
  }, [notification]);

  return null;
}
