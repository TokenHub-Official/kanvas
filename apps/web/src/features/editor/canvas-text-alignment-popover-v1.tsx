import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  ColumnWidthOutlined,
} from "@ant-design/icons";
import { Button, Popover, Tooltip } from "antd";
import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";

import {
  canvasTextAlignmentOptionsV1,
  canvasTextFormattingV1,
  updateCanvasTextParagraphsV1,
  type CanvasTextFormattingV1,
} from "./canvas-text-formatting-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const alignmentIcons = {
  left: AlignLeftOutlined,
  center: AlignCenterOutlined,
  right: AlignRightOutlined,
  justify: ColumnWidthOutlined,
} as const satisfies Record<
  CanvasTextFormattingV1["align"],
  ComponentType<{ readonly "aria-hidden"?: boolean | "true" | "false" }>
>;

export function CanvasTextAlignmentPopoverV1({
  disabled,
  node,
  onChange,
}: {
  readonly disabled: boolean;
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "text" }>;
  readonly onChange: (node: EditorRuntimeNodeV1) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = canvasTextFormattingV1(node).align;
  const CurrentIcon = alignmentIcons[current];
  const currentLabel = t(`canvas.editor.textAlign.${current}`);
  const content = (
    <div
      aria-label={t("canvas.text.alignmentGroup")}
      className="grid grid-cols-4 gap-0.5"
      role="radiogroup"
    >
      {canvasTextAlignmentOptionsV1.map(([value]) => {
        const Icon = alignmentIcons[value];
        const label = t(`canvas.editor.textAlign.${value}`);
        const selected = current === value;
        return (
          <Tooltip key={value} title={label}>
            <Button
              aria-checked={selected}
              aria-label={label}
              className="!size-8 !min-w-8 !p-0"
              color={selected ? "primary" : "default"}
              icon={<Icon aria-hidden="true" />}
              onClick={() => {
                onChange(updateCanvasTextParagraphsV1(node, { align: value }));
                setOpen(false);
              }}
              role="radio"
              size="small"
              type="text"
              variant={selected ? "filled" : "text"}
            />
          </Tooltip>
        );
      })}
    </div>
  );

  return (
    <Popover
      arrow={false}
      classNames={{ container: "!p-1", content: "!p-0" }}
      content={content}
      onOpenChange={setOpen}
      open={open}
      placement="bottom"
      trigger="click"
    >
      <Tooltip open={open ? false : undefined} title={currentLabel}>
        <Button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={currentLabel}
          disabled={disabled}
          icon={<CurrentIcon aria-hidden="true" />}
          type="text"
        />
      </Tooltip>
    </Popover>
  );
}
