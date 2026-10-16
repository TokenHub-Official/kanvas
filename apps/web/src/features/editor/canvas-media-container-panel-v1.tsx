import { DeleteOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Segmented } from "antd";
import { useTranslation } from "react-i18next";

import { CanvasInspectorRangeFieldV1 } from "./canvas-inspector-controls-v1.js";
import {
  canvasPlacedImageWithFitV1,
  canvasPlacedImageWithFocalPointV1,
  canvasPlacedImageWithZoomV1,
  canvasPlacedImageZoomV1,
  type CanvasMediaContentTargetV1,
} from "./canvas-media-container-v1.js";
import type { EditorRuntimePlacedImageV1 } from "./editor-runtime-v1.js";
import type { CanvasGridSlotV1 } from "./frame-grid-catalog-v1.js";

export function CanvasMediaContainerPanelV1({
  disabled,
  gridSlots = [],
  image,
  onBrowseAssets,
  onChange,
  onCommit,
  onPreview,
  onRemove,
  onSelectGridSlot,
  target,
}: {
  readonly disabled: boolean;
  readonly gridSlots?: readonly CanvasGridSlotV1[];
  readonly image?: EditorRuntimePlacedImageV1;
  readonly onBrowseAssets: () => void;
  readonly onChange: (image: EditorRuntimePlacedImageV1) => void;
  readonly onCommit: () => void;
  readonly onPreview: (image: EditorRuntimePlacedImageV1) => void;
  readonly onRemove: () => void;
  readonly onSelectGridSlot: (slotId: string) => void;
  readonly target: CanvasMediaContentTargetV1;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-5">
      {target.kind === "grid" ? (
        <section className="grid gap-2">
          <strong className="text-xs">{t("canvas.mediaContainer.cell")}</strong>
          <div className="grid grid-cols-2 gap-2">
            {gridSlots.map((slot) => (
              <Button
                aria-pressed={target.slotId === slot.id}
                key={slot.id}
                onClick={() => onSelectGridSlot(slot.id)}
                type={target.slotId === slot.id ? "primary" : "default"}
              >
                {slot.id}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      <Button
        block
        disabled={disabled}
        icon={<PictureOutlined aria-hidden="true" />}
        onClick={onBrowseAssets}
        type="primary"
      >
        {t(
          image ? "canvas.mediaContainer.replace" : "canvas.mediaContainer.add",
        )}
      </Button>
      {image ? (
        <>
          <section className="grid gap-2">
            <strong className="text-xs">
              {t("canvas.mediaContainer.fit")}
            </strong>
            <Segmented<EditorRuntimePlacedImageV1["fit"]>
              block
              disabled={disabled}
              onChange={(fit) =>
                onChange(canvasPlacedImageWithFitV1(image, fit))
              }
              options={(["contain", "cover", "fill"] as const).map((value) => ({
                value,
                label: t(`canvas.crop.fit.${value}`),
              }))}
              value={image.fit}
            />
          </section>
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            formatValue={(value) => `${String(value.toFixed(1))}×`}
            label={t("canvas.mediaContainer.zoom")}
            maximum={4}
            minimum={1}
            onChange={(zoom) =>
              onPreview(canvasPlacedImageWithZoomV1(image, zoom))
            }
            onCommit={onCommit}
            step={0.1}
            value={canvasPlacedImageZoomV1(image)}
          />
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            formatValue={(value) => `${String(Math.round(value * 100))}%`}
            label={t("canvas.mediaContainer.focalX")}
            maximum={1}
            minimum={0}
            onChange={(x) =>
              onPreview(
                canvasPlacedImageWithFocalPointV1(image, x, image.focalPoint.y),
              )
            }
            onCommit={onCommit}
            step={0.01}
            value={image.focalPoint.x}
          />
          <CanvasInspectorRangeFieldV1
            disabled={disabled}
            formatValue={(value) => `${String(Math.round(value * 100))}%`}
            label={t("canvas.mediaContainer.focalY")}
            maximum={1}
            minimum={0}
            onChange={(y) =>
              onPreview(
                canvasPlacedImageWithFocalPointV1(image, image.focalPoint.x, y),
              )
            }
            onCommit={onCommit}
            step={0.01}
            value={image.focalPoint.y}
          />
          <Button
            danger
            disabled={disabled}
            icon={<DeleteOutlined aria-hidden="true" />}
            onClick={onRemove}
          >
            {t("canvas.mediaContainer.remove")}
          </Button>
        </>
      ) : (
        <p className="m-0 rounded-xl bg-[#f7f7f8] p-3 text-xs leading-5 text-[var(--muted)]">
          {t("canvas.mediaContainer.empty")}
        </p>
      )}
    </div>
  );
}
