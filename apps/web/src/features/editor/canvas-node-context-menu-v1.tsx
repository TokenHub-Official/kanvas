import {
  BgColorsOutlined,
  CopyOutlined,
  DeleteOutlined,
  InsertRowAboveOutlined,
  InsertRowBelowOutlined,
} from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { stopCanvasChromeWheelV1 } from "./canvas-interaction-boundary-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export function CanvasNodeContextMenuV1({
  children,
  node,
  onApplyImageAsBackground,
  onBringToFront,
  onClose,
  onDelete,
  onDuplicate,
  onSendToBack,
  open,
}: {
  readonly children: ReactElement;
  readonly node?: EditorRuntimeNodeV1;
  readonly onApplyImageAsBackground: () => void;
  readonly onBringToFront: () => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onSendToBack: () => void;
  readonly open: boolean;
}) {
  const { t } = useTranslation();
  const items: MenuProps["items"] = [
    {
      icon: <CopyOutlined aria-hidden="true" />,
      key: "duplicate",
      label: t("canvas.editor.copy"),
      extra: "⌘D",
    },
    { type: "divider" },
    {
      icon: <InsertRowAboveOutlined aria-hidden="true" />,
      key: "front",
      label: t("canvas.editor.bringFront"),
    },
    {
      icon: <InsertRowBelowOutlined aria-hidden="true" />,
      key: "back",
      label: t("canvas.editor.sendBack"),
    },
    ...(node?.kind === "image"
      ? [
          { type: "divider" as const },
          {
            icon: <BgColorsOutlined aria-hidden="true" />,
            key: "background",
            label: t("canvas.editor.setBackground"),
          },
        ]
      : []),
    { type: "divider" },
    {
      danger: true,
      extra: "⌫",
      icon: <DeleteOutlined aria-hidden="true" />,
      key: "delete",
      label: t("canvas.editor.delete"),
    },
  ];
  const actions: Readonly<Record<string, () => void>> = {
    duplicate: onDuplicate,
    front: onBringToFront,
    back: onSendToBack,
    background: onApplyImageAsBackground,
    delete: onDelete,
  };
  return (
    <Dropdown
      destroyOnHidden
      menu={{
        items,
        onClick: ({ key }) => {
          actions[key]?.();
          onClose();
        },
      }}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
      popupRender={(menu) => (
        <div data-canvas-wheel-owner="" onWheel={stopCanvasChromeWheelV1}>
          {menu}
        </div>
      )}
      trigger={["contextMenu"]}
    >
      {children}
    </Dropdown>
  );
}
