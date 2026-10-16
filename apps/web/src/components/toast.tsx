import { App as AntApp } from "antd";
import { useCallback, useMemo, type ReactNode } from "react";

import { NetworkStatusToast } from "./network-status.js";

interface ToastMessage {
  readonly description?: string;
  readonly title: string;
  readonly tone: "positive" | "danger";
}

interface ToastActions {
  notify(input: ToastMessage): void;
}

export function ToastProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <>
      {children}
      <NetworkStatusToast />
    </>
  );
}

export function useToast(): ToastActions {
  const { message, notification } = AntApp.useApp();
  const notify = useCallback(
    (input: ToastMessage): void => {
      if (input.tone === "positive") {
        void message.success({
          content: input.description ? (
            <span className="inline-flex max-w-[min(480px,calc(100vw-80px))] flex-wrap items-baseline justify-center gap-x-2 text-left">
              <span>{input.title}</span>
              <span className="text-muted">{input.description}</span>
            </span>
          ) : (
            input.title
          ),
          duration: 3,
        });
        return;
      }
      notification.open({
        ...(input.description ? { description: input.description } : {}),
        duration: 5,
        placement: "bottomRight",
        role: input.tone === "danger" ? "alert" : "status",
        title: input.title,
        type: "error",
      });
    },
    [message, notification],
  );
  return useMemo(() => ({ notify }), [notify]);
}
