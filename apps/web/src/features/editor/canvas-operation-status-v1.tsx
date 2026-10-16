import { CloseCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Spin, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { kanvasInverseControlTheme } from "../../theme/kanvas-inverse-control-theme.js";

import type { CanvasOperationSessionV1 } from "./canvas-operation-runtime-v1.js";

export function CanvasOperationStatusV1({
  busy,
  lifecycleStatus,
  onCancel,
  onReconnect,
  session,
  statusError,
}: {
  readonly busy: boolean;
  readonly lifecycleStatus?: string;
  readonly onCancel: () => void;
  readonly onReconnect: () => void;
  readonly session: CanvasOperationSessionV1;
  readonly statusError?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const cancelling =
    session.cancelRequested || lifecycleStatus === "cancelling";
  let status = t("canvas.operationStatus.running");
  if (cancelling) {
    status = t("canvas.operationStatus.cancelling");
  } else if (session.phase === "starting") {
    status = t("canvas.operationStatus.starting");
  } else if (lifecycleStatus === "waiting") {
    status = t("canvas.operationStatus.waiting");
  }
  const detail = statusError;

  return (
    <ConfigProvider theme={kanvasInverseControlTheme}>
      <div
        aria-label={t("canvas.operationStatus.aria", {
          tool: session.label,
        })}
        aria-live="polite"
        className="flex min-w-0 max-w-56 items-center gap-2 rounded-control bg-white/12 px-2 py-1 text-white"
        role="status"
      >
        <Spin aria-hidden="true" percent="auto" size="small" />
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-xs font-semibold">
            {t("canvas.operationStatus.label", {
              tool: session.label,
              status,
            })}
          </span>
          {detail ? (
            <Tooltip title={detail}>
              <span
                className={`truncate text-[11px] ${
                  statusError ? "text-amber-100" : "text-white/70"
                }`}
              >
                {detail}
              </span>
            </Tooltip>
          ) : null}
        </div>
        {statusError ? (
          <Tooltip title={t("canvas.operationStatus.reconnect")}>
            <Button
              aria-label={t("canvas.operationStatus.reconnect")}
              color="default"
              disabled={busy}
              icon={<ReloadOutlined aria-hidden="true" />}
              onClick={onReconnect}
              size="small"
              variant="text"
            />
          </Tooltip>
        ) : (
          <Tooltip
            title={
              cancelling
                ? t("canvas.operationStatus.cancelRequested")
                : t("canvas.operationStatus.cancel")
            }
          >
            <Button
              aria-label={
                cancelling
                  ? t("canvas.operationStatus.cancelRequested")
                  : t("canvas.operationStatus.cancel")
              }
              color="default"
              disabled={busy || cancelling}
              icon={<CloseCircleOutlined aria-hidden="true" />}
              onClick={onCancel}
              size="small"
              variant="text"
            />
          </Tooltip>
        )}
      </div>
    </ConfigProvider>
  );
}
