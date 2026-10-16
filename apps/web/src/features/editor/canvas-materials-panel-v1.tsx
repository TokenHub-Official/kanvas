import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";
import {
  AppstoreOutlined,
  BorderOutlined,
  GatewayOutlined,
  HighlightOutlined,
  LineOutlined,
  PictureOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Input, Segmented, Tabs } from "antd";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  canvasShapeCategoriesV1,
  canvasShapesForCategoryV1,
  searchCanvasMaterialsV1,
} from "./canvas-left-panel-catalog-v1.js";
import {
  canvasCatalogDragPropsV1,
  canvasCatalogReferenceV1,
} from "./canvas-left-panel-shared-v1.js";
import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";
import type { CanvasGraphicDefinitionV1 } from "./graphic-catalog-v1.js";
import type { CanvasShapeCategoryV1 } from "./shape-catalog-v1.js";
import { materializeCanvasShapePathV1 } from "./shape-geometry-v1.js";

type CanvasMaterialCategoryV1 =
  "frames" | "graphics" | "grids" | "images" | "lines" | "shapes";

const materialCategories = [
  { icon: PictureOutlined, id: "images" },
  { icon: HighlightOutlined, id: "graphics" },
  { icon: GatewayOutlined, id: "shapes" },
  { icon: LineOutlined, id: "lines" },
  { icon: BorderOutlined, id: "frames" },
  { icon: AppstoreOutlined, id: "grids" },
] as const satisfies readonly {
  readonly icon: ComponentType<{
    readonly "aria-hidden"?: boolean | "true" | "false";
  }>;
  readonly id: CanvasMaterialCategoryV1;
}[];

const catalogGraphicSize = 240;
const linePreviewInset = 4;
const linePreviewWidth = 92;
const linePreviewHeight = 32;
const minimumCurvePointCount = 3;
const gridPreviewScale = 96;
const gridPreviewInset = 2;
const catalogIconGridClassName = "grid grid-cols-4 gap-2";
const catalogSpatialGridClassName = "grid grid-cols-3 gap-2";
const catalogLineGridClassName = "grid grid-cols-2 gap-2";
const catalogIconItemClassName =
  "group grid min-w-0 place-items-center gap-1.5 rounded-xl bg-mist/70 px-1 py-2 text-center text-muted transition-colors hover:bg-mist-deep";
const catalogWideItemClassName =
  "group grid min-w-0 gap-1.5 rounded-xl bg-mist/70 px-2 py-2 text-left text-muted transition-colors hover:bg-mist-deep";
const catalogIconPreviewClassName =
  "h-11 w-11 overflow-visible fill-current p-1 text-[#474852]";
const catalogLabelClassName = "w-full truncate text-center text-xs";

export function CanvasMaterialsPanelV1({
  imageLibrary,
  onCatalogDragEnd,
  onCatalogDragStart,
  onInsertFrame,
  onInsertGraphic,
  onInsertGrid,
  onInsertLine,
  onInsertShape,
}: {
  readonly imageLibrary: ReactNode;
  readonly onCatalogDragEnd: () => void;
  readonly onCatalogDragStart: (payload: EditorNodeInsertionPayload) => void;
  readonly onInsertFrame: (definition: EditorCatalogReferenceV1) => void;
  readonly onInsertGraphic: (definition: CanvasGraphicDefinitionV1) => void;
  readonly onInsertGrid: (definition: EditorCatalogReferenceV1) => void;
  readonly onInsertLine: (definition: EditorCatalogReferenceV1) => void;
  readonly onInsertShape: (definition: EditorCatalogReferenceV1) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CanvasMaterialCategoryV1>("images");
  const [shapeCategory, setShapeCategory] =
    useState<CanvasShapeCategoryV1>("basic");
  const normalized = query.trim().toLowerCase();
  const { frames, graphics, grids, lines } = useMemo(
    () => searchCanvasMaterialsV1(normalized),
    [normalized],
  );
  const visibleShapes = canvasShapesForCategoryV1(shapeCategory, query);

  const selectMaterialCategory = (next: CanvasMaterialCategoryV1) => {
    setCategory(next);
    setQuery("");
  };
  const selectShapeCategory = (next: CanvasShapeCategoryV1) => {
    setShapeCategory(next);
    setQuery("");
  };

  return (
    <>
      <Tabs
        activeKey={category}
        aria-label={t("canvas.materials.categoriesLabel")}
        className="-mx-1 mb-3"
        classNames={{ header: "mb-0", item: "px-1" }}
        items={materialCategories.map((item) => {
          const CategoryIcon = item.icon;
          return {
            key: item.id,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <CategoryIcon aria-hidden="true" />
                {t(`canvas.materials.categories.${item.id}`)}
              </span>
            ),
          };
        })}
        onChange={(key) => {
          selectMaterialCategory(key as CanvasMaterialCategoryV1);
        }}
        size="small"
        tabBarGutter={12}
      />
      {category === "images" ? null : (
        <Input
          allowClear
          aria-label={t("canvas.materials.search", {
            category: t(`canvas.materials.categories.${category}`),
          })}
          className="mb-4"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("canvas.materials.search", {
            category: t(`canvas.materials.categories.${category}`),
          })}
          prefix={<SearchOutlined aria-hidden="true" />}
          size="medium"
          value={query}
          variant="filled"
        />
      )}
      {category === "images" ? imageLibrary : null}
      {category === "graphics" ? (
        <div className={catalogIconGridClassName}>
          {graphics.map((graphic) => (
            <button
              key={graphic.resourceId}
              {...canvasCatalogDragPropsV1(
                {
                  kind: "graphic",
                  source: {
                    kind: "catalog",
                    catalogId: graphic.catalogId,
                    resourceId: graphic.resourceId,
                    revision: graphic.revision,
                  },
                  intrinsicSize: {
                    width: catalogGraphicSize * graphic.defaultAspectRatio,
                    height: catalogGraphicSize,
                  },
                },
                onCatalogDragStart,
                onCatalogDragEnd,
              )}
              className={catalogIconItemClassName}
              onClick={() => onInsertGraphic(graphic)}
              title={graphic.label}
              type="button"
            >
              <svg
                aria-hidden="true"
                className={catalogIconPreviewClassName}
                viewBox={graphic.viewBox}
              >
                {graphic.paths.map((path, index) => (
                  <path
                    d={path.d}
                    fill={graphic.defaultColors[path.colorSlot]}
                    fillRule={path.fillRule}
                    key={`${path.colorSlot}-${String(index)}`}
                    opacity={path.opacity}
                  />
                ))}
              </svg>
              <span className={catalogLabelClassName}>{graphic.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {category === "shapes" ? (
        <>
          <Segmented<CanvasShapeCategoryV1>
            aria-label={t("canvas.materials.shapeCategoriesLabel")}
            block
            className="mb-3"
            onChange={selectShapeCategory}
            options={canvasShapeCategoriesV1.map(([id]) => ({
              label: t(`canvas.materials.shapeCategories.${id}`),
              value: id,
            }))}
            size="small"
            value={shapeCategory}
          />
          <div className={catalogIconGridClassName}>
            {visibleShapes.map((shape) => {
              const path = materializeCanvasShapePathV1(shape);
              const definition = canvasCatalogReferenceV1(
                "kanvas.core.shapes",
                shape.definitionId,
                shape.revision,
              );
              return (
                <button
                  key={shape.definitionId}
                  {...canvasCatalogDragPropsV1(
                    { kind: "shape", definition },
                    onCatalogDragStart,
                    onCatalogDragEnd,
                  )}
                  className={catalogIconItemClassName}
                  onClick={() => onInsertShape(definition)}
                  title={shape.label}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className={catalogIconPreviewClassName}
                    viewBox={path.viewBox}
                  >
                    <path d={path.d} fillRule={path.fillRule} />
                  </svg>
                  <span className={catalogLabelClassName}>{shape.label}</span>
                  {normalized ? (
                    <small className="w-full truncate text-center text-[10px] leading-tight text-muted">
                      {t(`canvas.materials.shapeCategories.${shape.category}`)}
                    </small>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {category === "lines" ? (
        <div className={catalogLineGridClassName}>
          {lines.map((line) => {
            const points = line.points.map((point) => ({
              x: linePreviewInset + point.x * linePreviewWidth,
              y: linePreviewInset + point.y * linePreviewHeight,
            }));
            const path =
              line.pathKind === "curve" &&
              points.length >= minimumCurvePointCount
                ? `M${String(points[0]!.x)} ${String(
                    points[0]!.y,
                  )} Q${String(points[1]!.x)} ${String(
                    points[1]!.y,
                  )} ${String(points[2]!.x)} ${String(points[2]!.y)}`
                : points
                    .map(
                      (point, index) =>
                        `${
                          index === 0 ? "M" : "L"
                        }${String(point.x)} ${String(point.y)}`,
                    )
                    .join(" ");
            const definition = canvasCatalogReferenceV1(
              "kanvas.core.lines",
              line.definitionId,
              line.revision,
            );
            return (
              <button
                key={line.definitionId}
                {...canvasCatalogDragPropsV1(
                  { kind: "line", definition },
                  onCatalogDragStart,
                  onCatalogDragEnd,
                )}
                className={catalogWideItemClassName}
                onClick={() => onInsertLine(definition)}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-8 w-full overflow-visible"
                  viewBox="0 0 100 40"
                >
                  <path
                    className="stroke-[#3e3f49] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3]"
                    d={path}
                    fill="none"
                    strokeDasharray={line.dash?.join(" ")}
                  />
                </svg>
                <span className={catalogLabelClassName}>{line.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {category === "frames" ? (
        <div className={catalogIconGridClassName}>
          {frames.map((frame) => {
            const definition = canvasCatalogReferenceV1(
              "kanvas.core.frames",
              frame.definitionId,
              frame.revision,
            );
            return (
              <button
                key={frame.definitionId}
                {...canvasCatalogDragPropsV1(
                  { kind: "frame", definition },
                  onCatalogDragStart,
                  onCatalogDragEnd,
                )}
                className={catalogIconItemClassName}
                onClick={() => onInsertFrame(definition)}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className={catalogIconPreviewClassName}
                  viewBox={frame.path.viewBox}
                >
                  <path d={frame.path.d} fillRule={frame.path.fillRule} />
                </svg>
                <span className={catalogLabelClassName}>{frame.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {category === "grids" ? (
        <div className={catalogSpatialGridClassName}>
          {grids.map((grid) => {
            const definition = canvasCatalogReferenceV1(
              "kanvas.core.grids",
              grid.definitionId,
              grid.revision,
            );
            return (
              <button
                key={grid.definitionId}
                {...canvasCatalogDragPropsV1(
                  { kind: "grid", definition },
                  onCatalogDragStart,
                  onCatalogDragEnd,
                )}
                className={catalogWideItemClassName}
                onClick={() => onInsertGrid(definition)}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="aspect-square w-full fill-[#d7d7df] stroke-paper [stroke-width:3]"
                  viewBox="0 0 100 100"
                >
                  {grid.slots.map((slot) => (
                    <rect
                      height={slot.height * gridPreviewScale}
                      key={slot.id}
                      rx={3}
                      width={slot.width * gridPreviewScale}
                      x={gridPreviewInset + slot.x * gridPreviewScale}
                      y={gridPreviewInset + slot.y * gridPreviewScale}
                    />
                  ))}
                </svg>
                <span className={catalogLabelClassName}>{grid.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
