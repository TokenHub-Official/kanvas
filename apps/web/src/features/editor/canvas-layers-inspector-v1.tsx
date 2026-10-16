import { Button, InputNumber, Space, Tabs, Tooltip } from "antd";
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  AppstoreOutlined,
  BlockOutlined,
  BorderOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FontSizeOutlined,
  GatewayOutlined,
  LineOutlined,
  LockOutlined,
  PictureOutlined,
  UnlockOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignMiddleOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { canvasLockControlV1 } from "./canvas-operation-bars-model.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";
import type { EditorAlignmentV1 } from "./editor-state-v1.js";

export function LayersInspectorV1({
  disabled,
  mode,
  nodes,
  onAlign,
  onModeChange,
  onMove,
  onPreview,
  onPreviewCommit,
  onReplace,
  onSelect,
  pageHeight,
  pageWidth,
  selectedIds,
}: {
  readonly disabled: boolean;
  readonly mode: "layers" | "position";
  readonly nodes: readonly EditorRuntimeNodeV1[];
  readonly onAlign: (alignment: EditorAlignmentV1) => void;
  readonly onModeChange: (mode: "layers" | "position") => void;
  readonly onMove: (id: string, move: "backward" | "forward") => void;
  readonly onPreview: (node: EditorRuntimeNodeV1) => void;
  readonly onPreviewCommit: () => void;
  readonly onReplace: (node: EditorRuntimeNodeV1) => void;
  readonly onSelect: (id: string) => void;
  readonly pageHeight: number;
  readonly pageWidth: number;
  readonly selectedIds: readonly string[];
}) {
  const { t } = useTranslation();
  const layerKindIcons = {
    frame: BorderOutlined,
    graphic: GatewayOutlined,
    grid: AppstoreOutlined,
    group: BlockOutlined,
    image: PictureOutlined,
    line: LineOutlined,
    shape: BorderOutlined,
    text: FontSizeOutlined,
  } as const;
  const selected =
    selectedIds.length === 1
      ? nodes.find((node) => selectedIds.includes(node.id))
      : undefined;
  const selectedLayerIndex = selected
    ? nodes.findIndex((node) => node.id === selected.id)
    : -1;
  const transformDisabled = disabled || !selected || selected.locked;
  const positionDisabled =
    disabled ||
    selectedIds.length === 0 ||
    nodes.some((node) => selectedIds.includes(node.id) && node.locked);
  const alignPosition = (
    alignment: EditorAlignmentV1,
    singlePatch: () => void,
  ) => {
    if (selectedIds.length > 1) {
      onAlign(alignment);
      return;
    }
    singlePatch();
  };
  const replaceTransform = (
    patch: Partial<EditorRuntimeNodeV1["transform"]>,
  ) => {
    if (!selected) {
      return;
    }
    onReplace({
      ...selected,
      transform: {
        ...selected.transform,
        ...patch,
      },
    });
  };

  function previewTransformField(
    key: "height" | "rotation" | "width" | "x" | "y",
    value: number | null,
  ): void {
    if (value === null || !selected) {
      return;
    }
    onPreview({
      ...selected,
      transform: {
        ...selected.transform,
        [key]: Number(value),
      },
    });
  }

  const horizontalPosition = (
    alignment: "center_horizontal" | "left" | "right",
  ): number => {
    if (!selected || alignment === "left") return 0;
    if (alignment === "right") {
      return pageWidth - selected.transform.width;
    }
    return (pageWidth - selected.transform.width) / 2;
  };
  const verticalPosition = (
    alignment: "bottom" | "center_vertical" | "top",
  ): number => {
    if (!selected || alignment === "top") return 0;
    if (alignment === "bottom") {
      return pageHeight - selected.transform.height;
    }
    return (pageHeight - selected.transform.height) / 2;
  };

  const arrange = (
    <div className="grid gap-6">
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2">
        <span className="text-xs font-semibold text-[var(--muted)]">层级</span>
        <Space.Compact block>
          <Button
            block
            disabled={
              transformDisabled || selectedLayerIndex === nodes.length - 1
            }
            icon={<ArrowUpOutlined aria-hidden="true" />}
            onClick={() => {
              if (selected) {
                onMove(selected.id, "forward");
              }
            }}
          >
            {t("canvas.layers.forward")}
          </Button>
          <Button
            block
            disabled={transformDisabled || selectedLayerIndex === 0}
            icon={<ArrowDownOutlined aria-hidden="true" />}
            onClick={() => {
              if (selected) {
                onMove(selected.id, "backward");
              }
            }}
          >
            {t("canvas.layers.backward")}
          </Button>
        </Space.Compact>
      </div>
      <section className="grid gap-3">
        <h3 className="m-0 text-sm font-bold">
          {t(
            selectedIds.length > 1
              ? "canvas.layers.selectionAlignment"
              : "canvas.layers.pageAlignment",
          )}
        </h3>
        <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2">
          <span className="text-xs font-semibold text-[var(--muted)]">
            水平
          </span>
          <Space.Compact block>
            {(
              [
                ["left", AlignLeftOutlined],
                ["center_horizontal", AlignCenterOutlined],
                ["right", AlignRightOutlined],
              ] as const
            ).map(([alignment, Icon]) => {
              const label = t(
                alignment === "center_horizontal"
                  ? "canvas.layers.align.center"
                  : `canvas.layers.align.${alignment}`,
              );
              return (
                <Tooltip key={alignment} title={label}>
                  <Button
                    aria-label={label}
                    className="flex-1"
                    disabled={positionDisabled}
                    icon={<Icon aria-hidden="true" />}
                    onClick={() => {
                      alignPosition(alignment, () => {
                        if (!selected) return;
                        replaceTransform({
                          x: horizontalPosition(alignment),
                        });
                      });
                    }}
                  />
                </Tooltip>
              );
            })}
          </Space.Compact>
          <span className="text-xs font-semibold text-[var(--muted)]">
            垂直
          </span>
          <Space.Compact block>
            {(
              [
                ["top", VerticalAlignTopOutlined],
                ["center_vertical", VerticalAlignMiddleOutlined],
                ["bottom", VerticalAlignBottomOutlined],
              ] as const
            ).map(([alignment, Icon]) => {
              const label = t(
                alignment === "center_vertical"
                  ? "canvas.layers.align.middle"
                  : `canvas.layers.align.${alignment}`,
              );
              return (
                <Tooltip key={alignment} title={label}>
                  <Button
                    aria-label={label}
                    className="flex-1"
                    disabled={positionDisabled}
                    icon={<Icon aria-hidden="true" />}
                    onClick={() => {
                      alignPosition(alignment, () => {
                        if (!selected) return;
                        replaceTransform({
                          y: verticalPosition(alignment),
                        });
                      });
                    }}
                  />
                </Tooltip>
              );
            })}
          </Space.Compact>
        </div>
      </section>
      {selected ? (
        <section className="grid gap-3">
          <h3 className="m-0 text-sm font-bold">
            {t("canvas.layers.exactPosition")}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["width", t("canvas.layers.fields.width")],
                ["height", t("canvas.layers.fields.height")],
                ["x", "X"],
                ["y", "Y"],
                ["rotation", t("canvas.layers.fields.rotation")],
              ] as const
            ).map(([key, label]) => (
              <label className="grid gap-1" key={key}>
                <span className="text-xs font-bold text-[var(--muted)]">
                  {label}
                </span>
                <InputNumber
                  className="w-full"
                  controls={false}
                  disabled={transformDisabled}
                  {...(key === "width" || key === "height" ? { min: 1 } : {})}
                  onBlur={onPreviewCommit}
                  onChange={(value) => previewTransformField(key, value)}
                  onPressEnter={onPreviewCommit}
                  size="small"
                  step={key === "rotation" ? 1 : 0.5}
                  variant="filled"
                  value={Number(selected.transform[key].toFixed(2))}
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}
      {!selected && selectedIds.length === 0 ? (
        <p className="m-0 text-sm text-[var(--muted)]">
          {t("canvas.layers.empty")}
        </p>
      ) : null}
    </div>
  );
  const layers = (
    <div
      aria-label={t("canvas.layers.layerTree")}
      className="grid gap-1"
      role="tree"
    >
      {[...nodes].reverse().map((node, layerIndex, orderedLayers) => (
        <div
          aria-level={1}
          aria-selected={selectedIds.includes(node.id)}
          className="group grid grid-cols-[32px_minmax(0,1fr)_32px_32px_32px] items-center gap-1 rounded-lg px-1 py-1 transition-colors hover:bg-[var(--paper-hover)] focus-within:bg-[var(--paper-hover)] aria-selected:bg-[var(--mist)]"
          key={node.id}
          role="treeitem"
        >
          <Tooltip
            title={t(
              node.visible ? "canvas.layers.hide" : "canvas.layers.show",
            )}
          >
            <Button
              aria-label={t(
                node.visible ? "canvas.layers.hide" : "canvas.layers.show",
              )}
              disabled={disabled}
              icon={
                node.visible ? (
                  <EyeOutlined aria-hidden="true" />
                ) : (
                  <EyeInvisibleOutlined aria-hidden="true" />
                )
              }
              onClick={() => {
                onReplace({
                  ...node,
                  visible: !node.visible,
                });
              }}
              shape="circle"
              size="small"
              type="text"
            />
          </Tooltip>
          <Button
            aria-label={t("canvas.layers.selectLayer", {
              name: node.name,
              number: layerIndex + 1,
            })}
            className="min-w-0 justify-start px-2"
            icon={(() => {
              const Icon = layerKindIcons[node.kind];
              return <Icon aria-hidden="true" className="text-xs" />;
            })()}
            onClick={() => {
              onSelect(node.id);
            }}
            type="text"
          >
            <span className="block min-w-0 truncate text-left">
              {node.name}
            </span>
          </Button>
          {(
            [
              [
                t(node.locked ? "canvas.layers.unlock" : "canvas.layers.lock"),
                canvasLockControlV1(node.locked).icon === "unlock" ? (
                  <UnlockOutlined aria-hidden="true" key="unlock" />
                ) : (
                  <LockOutlined aria-hidden="true" key="lock" />
                ),
                () => {
                  onReplace({ ...node, locked: !node.locked });
                },
              ],
              [
                t("canvas.layers.moveDown"),
                <ArrowDownOutlined aria-hidden="true" key="move-down" />,
                () => {
                  onMove(node.id, "backward");
                },
              ],
              [
                t("canvas.layers.moveUp"),
                <ArrowUpOutlined aria-hidden="true" key="move-up" />,
                () => {
                  onMove(node.id, "forward");
                },
              ],
            ] as const
          ).map(([label, icon, action], index) => (
            <Tooltip key={label} title={label}>
              <Button
                aria-label={label}
                className={`transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
                  selectedIds.includes(node.id) || (index === 0 && node.locked)
                    ? "opacity-100"
                    : "opacity-0"
                }`}
                disabled={
                  disabled ||
                  (node.locked && index > 0) ||
                  (index === 1 && layerIndex === orderedLayers.length - 1) ||
                  (index === 2 && layerIndex === 0)
                }
                icon={icon}
                onClick={action}
                shape="circle"
                size="small"
                type="text"
              />
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <Tabs
      activeKey={mode}
      destroyOnHidden
      items={[
        {
          children: arrange,
          key: "position",
          label: t("canvas.layers.arrange"),
        },
        {
          children: layers,
          key: "layers",
          label: t("canvas.layers.layers"),
        },
      ]}
      onChange={(key) => {
        onModeChange(key as "layers" | "position");
      }}
      size="small"
    />
  );
}
