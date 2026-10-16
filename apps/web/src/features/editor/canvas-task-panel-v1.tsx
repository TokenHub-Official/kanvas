import { CloseOutlined, LeftOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  canvasEscapeEventPathOwnsOverlayV1,
  stopCanvasChromePointerDownV1,
  stopCanvasChromeWheelV1,
} from "./canvas-interaction-boundary-v1.js";

export function CanvasTaskPanelV1({
  accessibleLabel,
  backLabel,
  children,
  onBack,
  onClose,
  title,
}: {
  readonly accessibleLabel?: string;
  readonly backLabel?: string;
  readonly children: ReactNode;
  readonly onBack?: () => void;
  readonly onClose: () => void;
  readonly title: string;
}) {
  const { t } = useTranslation();

  function closeFromEscape(event: KeyboardEvent<HTMLElement>): void {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      canvasEscapeEventPathOwnsOverlayV1(event.nativeEvent.composedPath())
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <section
      aria-label={accessibleLabel ?? title}
      className="grid w-80 min-w-0 max-w-80 min-h-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden border-l border-[var(--canvas-panel-line)] bg-[var(--paper)] text-[var(--ink)] shadow-[10px_0_26px_rgb(26_28_38_/_0.045)] max-[900px]:w-[272px] max-[900px]:max-w-[272px]"
      data-canvas-keyboard-owner=""
      data-canvas-wheel-owner=""
      onKeyDown={closeFromEscape}
      onPointerDown={stopCanvasChromePointerDownV1}
      onWheel={stopCanvasChromeWheelV1}
      role="complementary"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--canvas-panel-line)] px-3.5">
        <div className="flex min-w-0 items-center gap-1">
          {onBack ? (
            <Tooltip title={backLabel ?? t("canvas.image.back")}>
              <Button
                aria-label={backLabel ?? t("canvas.image.back")}
                icon={<LeftOutlined aria-hidden="true" />}
                onClick={onBack}
                shape="circle"
                size="small"
                type="text"
              />
            </Tooltip>
          ) : null}
          <h2 className="m-0 truncate text-[13px] font-semibold">{title}</h2>
        </div>
        <Tooltip title={t("canvas.leftRail.close")}>
          <Button
            aria-label={t("canvas.leftRail.close")}
            icon={<CloseOutlined aria-hidden="true" />}
            onClick={onClose}
            shape="circle"
            size="small"
            type="text"
          />
        </Tooltip>
      </header>
      <div className="min-w-0 min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-3.5 py-4">
        {children}
      </div>
    </section>
  );
}
