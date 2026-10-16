import { CheckOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Segmented } from "antd";
import { useState, type FormEvent } from "react";

import { CanvasPanelSection } from "./canvas-left-panel-shared-v1.js";
import { editorPagePresetsV1 } from "./editor-document-factory-v1.js";

export function CanvasDesignPanelV1({
  height,
  name,
  onRenamePage,
  onResizePage,
  width,
}: {
  readonly height: number;
  readonly name: string;
  readonly onRenamePage: (name: string) => void;
  readonly onResizePage: (
    width: number,
    height: number,
    mode: "keep" | "scale",
  ) => void;
  readonly width: number;
}) {
  const pageSizeKey = `${String(width)}:${String(height)}`;
  const [customSizeOverride, setCustomSizeOverride] = useState<{
    readonly height: number;
    readonly key: string;
    readonly width: number;
  }>();
  const customWidth =
    customSizeOverride?.key === pageSizeKey ? customSizeOverride.width : width;
  const customHeight =
    customSizeOverride?.key === pageSizeKey
      ? customSizeOverride.height
      : height;
  const [nameDraftOverride, setNameDraftOverride] = useState<{
    readonly source: string;
    readonly value: string;
  }>();
  const nameDraft =
    nameDraftOverride?.source === name ? nameDraftOverride.value : name;
  const [resizeMode, setResizeMode] = useState<"keep" | "scale">("keep");

  const applyPreset = (preset: (typeof editorPagePresetsV1)[number]) => {
    onResizePage(preset.width, preset.height, resizeMode);
    setCustomSizeOverride(undefined);
  };
  const applyCustomSize = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onResizePage(customWidth, customHeight, resizeMode);
  };
  const changeCustomWidth = (value: number | null) => {
    setCustomSizeOverride({
      key: pageSizeKey,
      width: Number(value ?? width),
      height: customHeight,
    });
  };
  const changeCustomHeight = (value: number | null) => {
    setCustomSizeOverride({
      key: pageSizeKey,
      width: customWidth,
      height: Number(value ?? height),
    });
  };

  return (
    <>
      <CanvasPanelSection title="页面名称">
        <Input
          aria-label="页面名称"
          maxLength={240}
          onBlur={() => onRenamePage(nameDraft)}
          onChange={(event) =>
            setNameDraftOverride({ source: name, value: event.target.value })
          }
          onPressEnter={() => onRenamePage(nameDraft)}
          value={nameDraft}
          variant="filled"
        />
      </CanvasPanelSection>
      <CanvasPanelSection title="页面尺寸">
        <div className="grid overflow-hidden rounded-xl bg-[#f7f7f8]">
          {editorPagePresetsV1.map((preset, index) => {
            const selected = width === preset.width && height === preset.height;
            return (
              <button
                aria-pressed={selected}
                key={preset.id}
                className={`grid min-w-0 grid-cols-[34px_minmax(0,1fr)_18px] items-center gap-x-2.5 px-2.5 py-2 text-left transition-colors hover:bg-[#eeeef1] aria-pressed:bg-[#e7e7eb] ${
                  index > 0 ? "border-t border-[#e4e4e8]" : ""
                }`}
                onClick={() => applyPreset(preset)}
                type="button"
              >
                <span
                  className="max-h-8 w-7 justify-self-center border border-[#cacbd3] bg-[#f4f4f7]"
                  style={{
                    aspectRatio: `${String(
                      preset.width,
                    )} / ${String(preset.height)}`,
                  }}
                />
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-xs">{preset.label}</strong>
                  <small className="truncate text-xs text-[#858690]">
                    {preset.width} × {preset.height}
                  </small>
                </span>
                {selected ? (
                  <CheckOutlined
                    aria-hidden="true"
                    className="text-[var(--primary)]"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </CanvasPanelSection>
      <CanvasPanelSection title="自定义尺寸">
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2"
          onSubmit={applyCustomSize}
        >
          <label className="grid gap-1.5 text-xs text-[#6c6d77]">
            <span>宽</span>
            <InputNumber
              className="w-full"
              controls={false}
              min={64}
              onChange={changeCustomWidth}
              value={customWidth}
              variant="filled"
            />
          </label>
          <span className="pb-2 text-[#858690]">×</span>
          <label className="grid gap-1.5 text-xs text-[#6c6d77]">
            <span>高</span>
            <InputNumber
              className="w-full"
              controls={false}
              min={64}
              onChange={changeCustomHeight}
              value={customHeight}
              variant="filled"
            />
          </label>
          <Button className="col-span-full" htmlType="submit" type="primary">
            应用
          </Button>
        </form>
      </CanvasPanelSection>
      <CanvasPanelSection title="调整尺寸时">
        <Segmented
          aria-label="页面调整尺寸策略"
          block
          onChange={setResizeMode}
          options={[
            { label: "保留对象尺寸", value: "keep" },
            { label: "按比例缩放内容", value: "scale" },
          ]}
          value={resizeMode}
        />
        <p className="m-0 mt-2 text-xs leading-5 text-[var(--muted)]">
          {resizeMode === "keep"
            ? "只改变页面边界；对象尺寸和坐标保持不变，可能落到页面外。"
            : "对象位置、宽高和辅助线随页面宽高比例一起缩放。"}
        </p>
      </CanvasPanelSection>
    </>
  );
}
