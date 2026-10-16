import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { CommonNodeInspectorV1 } from "./canvas-inspector-controls-v1.js";
import type {
  EditorRuntimeGroupNodeV1,
  EditorRuntimeNodeV1,
} from "./editor-runtime-v1.js";

export function CanvasGroupIsolationPanelV1({
  canEdit,
  group,
  onExit,
  onMove,
  onPreview,
  onPreviewCommit,
  onReplace,
  onSelect,
  selectedChild,
}: {
  readonly canEdit: boolean;
  readonly group: EditorRuntimeGroupNodeV1;
  readonly onExit: () => void;
  readonly onMove: (id: string, direction: "backward" | "forward") => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly onReplace: (node: EditorRuntimeNodeV1) => void;
  readonly onSelect: (id: string) => void;
  readonly selectedChild?: EditorRuntimeNodeV1;
}) {
  const { t } = useTranslation();
  const selectedIndex = selectedChild
    ? group.children.findIndex((child) => child.id === selectedChild.id)
    : -1;
  return (
    <div className="grid gap-5">
      <Button icon={<LogoutOutlined aria-hidden="true" />} onClick={onExit}>
        {t("canvas.groupIsolation.exit")}
      </Button>
      <section className="grid gap-2">
        <strong className="text-xs">
          {t("canvas.groupIsolation.children")}
        </strong>
        <div className="grid gap-1" role="listbox">
          {[...group.children].reverse().map((child) => (
            <Button
              aria-selected={child.id === selectedChild?.id}
              className="justify-start"
              key={child.id}
              onClick={() => onSelect(child.id)}
              role="option"
              type={child.id === selectedChild?.id ? "primary" : "default"}
            >
              {child.name}
            </Button>
          ))}
        </div>
      </section>
      {selectedChild ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={!canEdit || selectedChild.locked || selectedIndex <= 0}
              icon={<ArrowDownOutlined aria-hidden="true" />}
              onClick={() => onMove(selectedChild.id, "backward")}
            >
              {t("canvas.layers.moveDown")}
            </Button>
            <Button
              disabled={
                !canEdit ||
                selectedChild.locked ||
                selectedIndex >= group.children.length - 1
              }
              icon={<ArrowUpOutlined aria-hidden="true" />}
              onClick={() => onMove(selectedChild.id, "forward")}
            >
              {t("canvas.layers.moveUp")}
            </Button>
          </div>
          <CommonNodeInspectorV1
            disabled={!canEdit}
            node={selectedChild}
            onChange={onReplace}
            onPreview={onPreview}
            onPreviewCommit={onPreviewCommit}
          />
        </>
      ) : null}
    </div>
  );
}
