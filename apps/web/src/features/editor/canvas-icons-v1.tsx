import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BgColorsOutlined,
  BlockOutlined,
  CheckOutlined,
  CloseOutlined,
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  GroupOutlined,
  InsertRowAboveOutlined,
  InsertRowBelowOutlined,
  LockOutlined,
  MinusOutlined,
  PlusOutlined,
  RedoOutlined,
  ScissorOutlined,
  SelectOutlined,
  SlidersOutlined,
  UndoOutlined,
  UngroupOutlined,
  UnlockOutlined,
  VerticalAlignMiddleOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import type { ComponentProps, ComponentType } from "react";

import { cn } from "../../lib/cn.js";

type CanvasIconProperties = Pick<
  ComponentProps<"svg">,
  "aria-hidden" | "className"
>;

function antCanvasIcon(
  Icon: ComponentType<{
    readonly "aria-hidden"?: ComponentProps<"span">["aria-hidden"];
    readonly className?: string;
  }>,
) {
  return function CanvasAntIcon({
    "aria-hidden": ariaHidden = true,
    className,
  }: CanvasIconProperties): React.JSX.Element {
    return (
      <Icon
        aria-hidden={ariaHidden}
        className={cn("canvas-ant-icon h-[1em] w-[1em] shrink-0", className)}
      />
    );
  };
}

export const AlignCenter = antCanvasIcon(AlignCenterOutlined);
export const AlignCenterHorizontal = AlignCenter;
export const AlignCenterVertical = antCanvasIcon(VerticalAlignMiddleOutlined);
export const AlignHorizontalSpaceBetween = antCanvasIcon(ColumnWidthOutlined);
export const AlignJustify = antCanvasIcon(ColumnWidthOutlined);
export const AlignLeft = antCanvasIcon(AlignLeftOutlined);
export const AlignRight = antCanvasIcon(AlignRightOutlined);
export const AlignStartHorizontal = antCanvasIcon(VerticalAlignTopOutlined);
export const AlignStartVertical = antCanvasIcon(AlignLeftOutlined);
export const AlignVerticalSpaceBetween = antCanvasIcon(ColumnHeightOutlined);
export const ArrowDown = antCanvasIcon(ArrowDownOutlined);
export const ArrowLeft = antCanvasIcon(ArrowLeftOutlined);
export const ArrowRight = antCanvasIcon(ArrowRightOutlined);
export const ArrowUp = antCanvasIcon(ArrowUpOutlined);
export const BringToFront = antCanvasIcon(InsertRowAboveOutlined);
export const Check = antCanvasIcon(CheckOutlined);
export const Copy = antCanvasIcon(CopyOutlined);
export const Crop = antCanvasIcon(ScissorOutlined);
export const Download = antCanvasIcon(DownloadOutlined);
export const Eye = antCanvasIcon(EyeOutlined);
export const EyeOff = antCanvasIcon(EyeInvisibleOutlined);
export const ImageFile = antCanvasIcon(FileImageOutlined);
export const CursorPointer = antCanvasIcon(SelectOutlined);
export const Brush = antCanvasIcon(EditOutlined);
export const FlipHorizontal = antCanvasIcon(ColumnWidthOutlined);
export const FlipVertical = antCanvasIcon(ColumnHeightOutlined);
export const FolderOpen = antCanvasIcon(FolderOpenOutlined);
export const Group = antCanvasIcon(GroupOutlined);
export const History = antCanvasIcon(HistoryOutlined);
export const Layers3 = antCanvasIcon(BlockOutlined);
export const Lock = antCanvasIcon(LockOutlined);
export const LockOpen = antCanvasIcon(UnlockOutlined);
export const Minus = antCanvasIcon(MinusOutlined);
export const Plus = antCanvasIcon(PlusOutlined);
export const Redo2 = antCanvasIcon(RedoOutlined);
export const Ruler = antCanvasIcon(ColumnWidthOutlined);
export const SendToBack = antCanvasIcon(InsertRowBelowOutlined);
export const SetAsBackground = antCanvasIcon(BgColorsOutlined);
export const SlidersHorizontal = antCanvasIcon(SlidersOutlined);
export const Trash2 = antCanvasIcon(DeleteOutlined);
export const Undo2 = antCanvasIcon(UndoOutlined);
export const Ungroup = antCanvasIcon(UngroupOutlined);
export const X = antCanvasIcon(CloseOutlined);
