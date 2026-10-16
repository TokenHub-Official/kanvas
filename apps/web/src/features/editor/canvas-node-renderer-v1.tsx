import type { EditorStrokeV1 } from "@kanvas/contracts/editor";
import type { CSSProperties, ReactNode } from "react";

import {
  editorArtifactSourceUrlV1,
  type HydratedEditorDocumentV1,
} from "./editor-document-v1.js";
import type {
  EditorRuntimeGroupNodeV1,
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
  EditorRuntimePlacedImageV1,
} from "./editor-runtime-v1.js";
import {
  canvasFrameDefinitionV1,
  canvasGridDefinitionV1,
} from "./frame-grid-catalog-v1.js";
import {
  editorImageAdjustmentsV1,
  editorImageCssFilterV1,
} from "./image-adjustments-v1.js";
import { canvasGraphicDefinitionV1 } from "./graphic-catalog-v1.js";
import { CanvasShapeNodeV1 } from "./canvas-shape-node-v1.js";
import {
  safeSvgIdV1,
  SvgPaintGradientV1,
  svgPaintPresentationV1,
} from "./canvas-svg-paint-v1.js";
import { CanvasTextNodeV1 } from "./canvas-text-node-v1.js";
import type { CanvasMediaContentTargetV1 } from "./canvas-media-container-v1.js";

type RuntimeResources = HydratedEditorDocumentV1["resources"];
const UNAVAILABLE_IMAGE_STROKE_RATIO = 0.02;
const VIGNETTE_OPACITY_SCALE = 0.9;
const CURVE_POINT_COUNT = 3;
const LOADING_BAR_MIN_HEIGHT = 4;
const LOADING_BAR_HEIGHT_RATIO = 0.04;
const LOADING_BAR_RADIUS_RATIO = 0.02;
const LOADING_BAR_WIDTH_RATIO = 0.38;
const LOADING_BAR_X_RATIO = 0.31;
const LOADING_BAR_Y_RATIO = 0.48;

function blendMode(
  value: EditorRuntimeNodeV1["blendMode"],
): CSSProperties["mixBlendMode"] {
  return value.replaceAll("_", "-") as CSSProperties["mixBlendMode"];
}

function NodeTransform({
  children,
  node,
}: {
  readonly children: ReactNode;
  readonly node: EditorRuntimeNodeV1;
}) {
  const transform = node.transform;
  return (
    <g
      aria-label={node.name}
      data-node-id={node.id}
      data-node-kind={node.kind}
      opacity={node.opacity}
      style={{
        display: node.visible ? undefined : "none",
        mixBlendMode: blendMode(node.blendMode),
      }}
      transform={`translate(${String(transform.x)} ${String(transform.y)})`}
    >
      <g
        transform={`rotate(${String(transform.rotation)} ${String(
          transform.width / 2,
        )} ${String(transform.height / 2)})`}
      >
        <g
          transform={`translate(${String(
            transform.flipX ? transform.width : 0,
          )} ${String(
            transform.flipY ? transform.height : 0,
          )}) scale(${transform.flipX ? "-1" : "1"} ${
            transform.flipY ? "-1" : "1"
          })`}
        >
          {children}
        </g>
      </g>
    </g>
  );
}

function imagePreserveAspectRatio(
  fit: EditorRuntimePlacedImageV1["fit"],
): string {
  if (fit === "fill") {
    return "none";
  }
  return fit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
}

function imageFilter(image: EditorRuntimePlacedImageV1): string | undefined {
  return image.adjustments
    ? editorImageCssFilterV1(editorImageAdjustmentsV1(image))
    : undefined;
}

function UnavailableImage({
  height,
  width,
}: {
  readonly height: number;
  readonly width: number;
}) {
  return (
    <g data-source-unavailable="true">
      <rect fill="#f5f5f5" height={height} width={width} />
      <path
        d={`M0 0 L${String(width)} ${String(
          height,
        )} M${String(width)} 0 L0 ${String(height)}`}
        fill="none"
        stroke="#a6a9b5"
        strokeWidth={Math.max(
          2,
          Math.min(width, height) * UNAVAILABLE_IMAGE_STROKE_RATIO,
        )}
      />
    </g>
  );
}

function LoadingImage({
  height,
  width,
}: {
  readonly height: number;
  readonly width: number;
}) {
  return (
    <g data-source-loading="true">
      <rect fill="#f5f5f5" height={height} width={width} />
      <rect
        fill="#e1e0e8"
        height={Math.max(
          LOADING_BAR_MIN_HEIGHT,
          height * LOADING_BAR_HEIGHT_RATIO,
        )}
        rx={Math.max(
          LOADING_BAR_MIN_HEIGHT / 2,
          height * LOADING_BAR_RADIUS_RATIO,
        )}
        width={width * LOADING_BAR_WIDTH_RATIO}
        x={width * LOADING_BAR_X_RATIO}
        y={height * LOADING_BAR_Y_RATIO}
      />
    </g>
  );
}

function PlacedImage({
  clipPathId,
  height,
  image,
  renderId,
  resources,
  width,
}: {
  readonly clipPathId?: string;
  readonly height: number;
  readonly image: EditorRuntimePlacedImageV1;
  readonly renderId: string;
  readonly resources: RuntimeResources;
  readonly width: number;
}) {
  const resource =
    image.source.kind === "local"
      ? undefined
      : resources.get(image.source.artifactId);
  const sourceUrl =
    image.source.kind === "local"
      ? image.source.previewUrl
      : resource?.sourceUrl;
  if (!sourceUrl) {
    return resource?.sourceUnavailable ? (
      <UnavailableImage height={height} width={width} />
    ) : (
      <LoadingImage height={height} width={width} />
    );
  }
  const intrinsicWidth = image.intrinsicWidth;
  const intrinsicHeight = image.intrinsicHeight;
  const style = {
    filter: imageFilter(image),
  };
  const clipPath = clipPathId ? `url(#${clipPathId})` : undefined;
  let content: ReactNode;
  if (intrinsicWidth && intrinsicHeight) {
    content = (
      <svg
        height={height}
        overflow="hidden"
        preserveAspectRatio={imagePreserveAspectRatio(image.fit)}
        style={style}
        viewBox={`${String(image.crop.x * intrinsicWidth)} ${String(
          image.crop.y * intrinsicHeight,
        )} ${String(image.crop.width * intrinsicWidth)} ${String(
          image.crop.height * intrinsicHeight,
        )}`}
        width={width}
        x={0}
        y={0}
      >
        <image
          height={intrinsicHeight}
          href={sourceUrl}
          preserveAspectRatio="none"
          width={intrinsicWidth}
        />
      </svg>
    );
  } else {
    content = (
      <image
        height={height}
        href={sourceUrl}
        preserveAspectRatio={imagePreserveAspectRatio(image.fit)}
        style={style}
        width={width}
      />
    );
  }
  const vignette = image.adjustments?.vignette ?? 0;
  if (vignette <= 0) {
    return <g clipPath={clipPath}>{content}</g>;
  }
  const vignetteId = `${safeSvgIdV1(renderId)}-vignette`;
  return (
    <g clipPath={clipPath}>
      <defs>
        <radialGradient id={vignetteId} r="72%">
          <stop offset="46%" stopColor="#000000" stopOpacity={0} />
          <stop offset="100%" stopColor="#000000" stopOpacity={1} />
        </radialGradient>
      </defs>
      {content}
      <rect
        fill={`url(#${vignetteId})`}
        height={height}
        opacity={vignette * VIGNETTE_OPACITY_SCALE}
        pointerEvents="none"
        width={width}
      />
    </g>
  );
}

function ImageNode({
  node,
  resources,
}: {
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "image" }>;
  readonly resources: RuntimeResources;
}) {
  const id = `${safeSvgIdV1(node.id)}-clip`;
  const shadow = node.shadow;
  return (
    <NodeTransform node={node}>
      <defs>
        <clipPath id={id}>
          <rect
            height={node.transform.height}
            rx={node.cornerRadius}
            width={node.transform.width}
          />
        </clipPath>
      </defs>
      <g
        style={{
          filter: shadow
            ? `drop-shadow(${String(shadow.offsetX)}px ${String(
                shadow.offsetY,
              )}px ${String(shadow.blur)}px ${shadow.color})`
            : undefined,
        }}
      >
        <PlacedImage
          clipPathId={id}
          height={node.transform.height}
          image={node.image}
          renderId={node.id}
          resources={resources}
          width={node.transform.width}
        />
      </g>
    </NodeTransform>
  );
}

function strokePresentation(stroke: EditorStrokeV1, id: string) {
  return svgPaintPresentationV1(stroke.paint, id);
}

function linePath(
  node: Extract<EditorRuntimeNodeV1, { kind: "line" }>,
): string {
  const points = node.points.map((point) => ({
    x: point.x * node.transform.width,
    y: point.y * node.transform.height,
  }));
  if (node.pathKind === "curve" && points.length >= CURVE_POINT_COUNT) {
    const [start, control, end, ...remaining] = points;
    return [
      `M${String(start!.x)} ${String(start!.y)}`,
      `Q${String(control!.x)} ${String(
        control!.y,
      )} ${String(end!.x)} ${String(end!.y)}`,
      ...remaining.map((point) => `T${String(point.x)} ${String(point.y)}`),
    ].join(" ");
  }
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${String(point.x)} ${String(point.y)}`,
    )
    .join(" ");
}

function markerShape(
  cap: Extract<EditorRuntimeNodeV1, { kind: "line" }>["startCap"],
  color: string,
): ReactNode {
  if (cap === "arrow") {
    return (
      <path
        d="M1 1 L9 5 L1 9"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    );
  }
  if (cap === "circle") {
    return <circle cx={5} cy={5} fill={color} r={4} />;
  }
  if (cap === "hollow_circle") {
    return <circle cx={5} cy={5} fill="none" r={3.7} stroke={color} />;
  }
  if (cap === "diamond") {
    return <path d="M5 0 L10 5 L5 10 L0 5 Z" fill={color} />;
  }
  if (cap === "hollow_diamond") {
    return (
      <path d="M5 0.7 L9.3 5 L5 9.3 L0.7 5 Z" fill="none" stroke={color} />
    );
  }
  if (cap === "square") {
    return <rect fill={color} height={8} width={8} x={1} y={1} />;
  }
  if (cap === "hollow_square") {
    return (
      <rect
        fill="none"
        height={7.5}
        stroke={color}
        width={7.5}
        x={1.25}
        y={1.25}
      />
    );
  }
  if (cap === "bar") {
    return <path d="M5 1 V9" fill="none" stroke={color} strokeWidth={2} />;
  }
  if (cap === "triangle") {
    return <path d="M0.8 0.8 L9.2 5 L0.8 9.2 Z" fill={color} />;
  }
  return null;
}

function LineNode({
  node,
}: {
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "line" }>;
}) {
  const id = safeSvgIdV1(node.id);
  const stroke = strokePresentation(node.stroke, `${id}-stroke`);
  const startMarker = `${id}-start`;
  const endMarker = `${id}-end`;
  return (
    <NodeTransform node={node}>
      <defs>
        {stroke.gradient ? (
          <SvgPaintGradientV1 gradient={stroke.gradient} />
        ) : null}
        {node.startCap !== "none" ? (
          <marker
            id={startMarker}
            markerHeight={10}
            markerWidth={10}
            orient="auto-start-reverse"
            refX={5}
            refY={5}
            viewBox="0 0 10 10"
          >
            {markerShape(node.startCap, stroke.fill)}
          </marker>
        ) : null}
        {node.endCap !== "none" ? (
          <marker
            id={endMarker}
            markerHeight={10}
            markerWidth={10}
            orient="auto"
            refX={5}
            refY={5}
            viewBox="0 0 10 10"
          >
            {markerShape(node.endCap, stroke.fill)}
          </marker>
        ) : null}
      </defs>
      <path
        d={linePath(node)}
        fill="none"
        markerEnd={node.endCap === "none" ? undefined : `url(#${endMarker})`}
        markerStart={
          node.startCap === "none" ? undefined : `url(#${startMarker})`
        }
        stroke={stroke.fill}
        strokeDasharray={node.stroke.dash?.join(" ")}
        strokeLinecap={node.capStyle ?? "round"}
        strokeLinejoin={node.joinStyle ?? "round"}
        strokeWidth={node.stroke.width}
        vectorEffect="non-scaling-stroke"
      />
    </NodeTransform>
  );
}

function GraphicNode({
  catalogResourceUrl,
  node,
  resources,
}: {
  readonly catalogResourceUrl?: (
    catalogId: string,
    resourceId: string,
    revision: string,
  ) => string | undefined;
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "graphic" }>;
  readonly resources: RuntimeResources;
}) {
  const catalogDefinition =
    node.source.kind === "catalog"
      ? canvasGraphicDefinitionV1(
          node.source.catalogId,
          node.source.resourceId,
          node.source.revision,
        )
      : undefined;
  const sourceUrl =
    node.source.kind === "artifact"
      ? editorArtifactSourceUrlV1(resources, node.source.artifactId)
      : catalogResourceUrl?.(
          node.source.catalogId,
          node.source.resourceId,
          node.source.revision,
        );
  const artifactResource =
    node.source.kind === "artifact"
      ? resources.get(node.source.artifactId)
      : undefined;
  let content = artifactResource?.sourceUnavailable ? (
    <UnavailableImage
      height={node.transform.height}
      width={node.transform.width}
    />
  ) : (
    <LoadingImage height={node.transform.height} width={node.transform.width} />
  );
  if (catalogDefinition) {
    content = (
      <svg
        height={node.transform.height}
        preserveAspectRatio={
          node.preserveAspectRatio ? "xMidYMid meet" : "none"
        }
        viewBox={catalogDefinition.viewBox}
        width={node.transform.width}
      >
        {catalogDefinition.paths.map((path, index) => (
          <path
            d={path.d}
            fill={
              node.colorSlots[path.colorSlot] ??
              catalogDefinition.defaultColors[path.colorSlot]
            }
            fillRule={path.fillRule}
            key={`${path.colorSlot}-${String(index)}`}
            opacity={path.opacity}
          />
        ))}
      </svg>
    );
  } else if (sourceUrl) {
    content = (
      <image
        height={node.transform.height}
        href={sourceUrl}
        preserveAspectRatio={
          node.preserveAspectRatio ? "xMidYMid meet" : "none"
        }
        width={node.transform.width}
      />
    );
  }
  return <NodeTransform node={node}>{content}</NodeTransform>;
}

function FrameNode({
  mediaContentTarget,
  node,
  resources,
}: {
  readonly mediaContentTarget?: CanvasMediaContentTargetV1;
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "frame" }>;
  readonly resources: RuntimeResources;
}) {
  const definition = canvasFrameDefinitionV1(node.definition);
  const id = `${safeSvgIdV1(node.id)}-frame`;
  const fill = svgPaintPresentationV1(node.fill, `${id}-fill`);
  const stroke = strokePresentation(node.stroke, `${id}-stroke`);
  return (
    <NodeTransform node={node}>
      <defs>
        <clipPath id={id}>
          <path
            d={definition.path.d}
            transform={`scale(${String(
              node.transform.width / 100,
            )} ${String(node.transform.height / 100)})`}
          />
        </clipPath>
        {fill.gradient ? <SvgPaintGradientV1 gradient={fill.gradient} /> : null}
        {stroke.gradient ? (
          <SvgPaintGradientV1 gradient={stroke.gradient} />
        ) : null}
      </defs>
      <svg
        height={node.transform.height}
        preserveAspectRatio="none"
        viewBox={definition.path.viewBox}
        width={node.transform.width}
      >
        <path
          d={definition.path.d}
          fill={fill.fill}
          fillRule={definition.path.fillRule}
          stroke={stroke.fill}
          strokeDasharray={node.stroke.dash?.join(" ")}
          strokeWidth={node.stroke.width}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {node.content ? (
        <PlacedImage
          clipPathId={id}
          height={node.transform.height}
          image={node.content.image}
          renderId={node.id}
          resources={resources}
          width={node.transform.width}
        />
      ) : null}
      {mediaContentTarget?.kind === "frame" &&
      mediaContentTarget.nodeId === node.id ? (
        <svg
          height={node.transform.height}
          pointerEvents="none"
          preserveAspectRatio="none"
          viewBox={definition.path.viewBox}
          width={node.transform.width}
        >
          <path
            d={definition.path.d}
            fill="none"
            stroke="#3048f5"
            strokeDasharray="6 4"
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </NodeTransform>
  );
}

function GridNode({
  mediaContentTarget,
  node,
  resources,
}: {
  readonly mediaContentTarget?: CanvasMediaContentTargetV1;
  readonly node: Extract<EditorRuntimeNodeV1, { kind: "grid" }>;
  readonly resources: RuntimeResources;
}) {
  const definition = canvasGridDefinitionV1(node.definition);
  const cells = new Map(node.cells.map((cell) => [cell.slotId, cell]));
  return (
    <NodeTransform node={node}>
      {definition.slots.map((slot) => {
        const id = `${safeSvgIdV1(node.id)}-${safeSvgIdV1(slot.id)}`;
        const halfGap = node.gap / 2;
        const x = slot.x * node.transform.width + halfGap;
        const y = slot.y * node.transform.height + halfGap;
        const width = Math.max(0, slot.width * node.transform.width - node.gap);
        const height = Math.max(
          0,
          slot.height * node.transform.height - node.gap,
        );
        const cell = cells.get(slot.id);
        return (
          <g
            data-grid-slot={slot.id}
            key={slot.id}
            transform={`translate(${String(x)} ${String(y)})`}
          >
            <defs>
              <clipPath id={id}>
                <rect height={height} rx={node.cornerRadius} width={width} />
              </clipPath>
            </defs>
            <rect
              fill="#f5f5f5"
              height={height}
              rx={node.cornerRadius}
              width={width}
            />
            {cell?.content ? (
              <PlacedImage
                clipPathId={id}
                height={height}
                image={cell.content.image}
                renderId={`${node.id}-${slot.id}`}
                resources={resources}
                width={width}
              />
            ) : null}
            {mediaContentTarget?.kind === "grid" &&
            mediaContentTarget.nodeId === node.id &&
            mediaContentTarget.slotId === slot.id ? (
              <rect
                fill="none"
                height={height}
                pointerEvents="none"
                rx={node.cornerRadius}
                stroke="#3048f5"
                strokeDasharray="6 4"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                width={width}
              />
            ) : null}
          </g>
        );
      })}
    </NodeTransform>
  );
}

function GroupNode({
  catalogResourceUrl,
  editingTextNodeId,
  mediaContentTarget,
  node,
  resources,
}: {
  readonly catalogResourceUrl?: (
    catalogId: string,
    resourceId: string,
    revision: string,
  ) => string | undefined;
  readonly editingTextNodeId?: string;
  readonly mediaContentTarget?: CanvasMediaContentTargetV1;
  readonly node: EditorRuntimeGroupNodeV1;
  readonly resources: RuntimeResources;
}) {
  return (
    <NodeTransform node={node}>
      {node.children.map((child) => (
        <CanvasNodeRendererV1
          key={child.id}
          {...(catalogResourceUrl ? { catalogResourceUrl } : {})}
          {...(editingTextNodeId ? { editingTextNodeId } : {})}
          {...(mediaContentTarget ? { mediaContentTarget } : {})}
          node={child}
          resources={resources}
        />
      ))}
    </NodeTransform>
  );
}

export function CanvasNodeRendererV1({
  catalogResourceUrl,
  editingTextNodeId,
  mediaContentTarget,
  node,
  resources,
}: {
  readonly catalogResourceUrl?: (
    catalogId: string,
    resourceId: string,
    revision: string,
  ) => string | undefined;
  readonly editingTextNodeId?: string;
  readonly mediaContentTarget?: CanvasMediaContentTargetV1;
  readonly node: EditorRuntimeNodeV1;
  readonly resources: RuntimeResources;
}) {
  if (node.kind === "image") {
    return <ImageNode node={node} resources={resources} />;
  }
  if (node.kind === "text") {
    return (
      <CanvasTextNodeV1 editing={editingTextNodeId === node.id} node={node} />
    );
  }
  if (node.kind === "shape") {
    return (
      <CanvasShapeNodeV1
        editingLabel={editingTextNodeId === node.id}
        node={node}
      />
    );
  }
  if (node.kind === "line") {
    return <LineNode node={node} />;
  }
  if (node.kind === "graphic") {
    return (
      <GraphicNode
        {...(catalogResourceUrl ? { catalogResourceUrl } : {})}
        node={node}
        resources={resources}
      />
    );
  }
  if (node.kind === "frame") {
    return (
      <FrameNode
        {...(mediaContentTarget ? { mediaContentTarget } : {})}
        node={node}
        resources={resources}
      />
    );
  }
  if (node.kind === "grid") {
    return (
      <GridNode
        {...(mediaContentTarget ? { mediaContentTarget } : {})}
        node={node}
        resources={resources}
      />
    );
  }
  return (
    <GroupNode
      {...(catalogResourceUrl ? { catalogResourceUrl } : {})}
      {...(editingTextNodeId ? { editingTextNodeId } : {})}
      {...(mediaContentTarget ? { mediaContentTarget } : {})}
      node={node}
      resources={resources}
    />
  );
}

function PageBackground({
  page,
  resources,
}: {
  readonly page: EditorRuntimePageV1;
  readonly resources: RuntimeResources;
}) {
  if (page.background.kind === "transparent") {
    return null;
  }
  if (page.background.kind === "paint") {
    const paint = svgPaintPresentationV1(
      page.background.paint,
      `${safeSvgIdV1(page.id)}-background`,
    );
    return (
      <>
        {paint.gradient ? (
          <defs>
            <SvgPaintGradientV1 gradient={paint.gradient} />
          </defs>
        ) : null}
        <rect fill={paint.fill} height={page.height} width={page.width} />
      </>
    );
  }
  return (
    <g opacity={page.background.opacity}>
      <PlacedImage
        height={page.height}
        image={page.background.image}
        renderId={`${page.id}-background`}
        resources={resources}
        width={page.width}
      />
    </g>
  );
}

export function CanvasPageV1({
  catalogResourceUrl,
  clipToPage = false,
  editingTextNodeId,
  mediaContentTarget,
  page,
  resources,
}: {
  readonly catalogResourceUrl?: (
    catalogId: string,
    resourceId: string,
    revision: string,
  ) => string | undefined;
  readonly clipToPage?: boolean;
  readonly editingTextNodeId?: string;
  readonly mediaContentTarget?: CanvasMediaContentTargetV1;
  readonly page: EditorRuntimePageV1;
  readonly resources: RuntimeResources;
}) {
  const clipId = `${safeSvgIdV1(page.id)}-page-clip`;
  return (
    <svg
      data-page-id={page.id}
      height={page.height}
      overflow={clipToPage ? "hidden" : "visible"}
      viewBox={`0 0 ${String(page.width)} ${String(page.height)}`}
      width={page.width}
    >
      {clipToPage ? (
        <defs>
          <clipPath id={clipId}>
            <rect height={page.height} width={page.width} />
          </clipPath>
        </defs>
      ) : null}
      <g clipPath={clipToPage ? `url(#${clipId})` : undefined}>
        <PageBackground page={page} resources={resources} />
        {page.nodes.map((node) => (
          <CanvasNodeRendererV1
            key={node.id}
            {...(catalogResourceUrl ? { catalogResourceUrl } : {})}
            {...(editingTextNodeId ? { editingTextNodeId } : {})}
            {...(mediaContentTarget ? { mediaContentTarget } : {})}
            node={node}
            resources={resources}
          />
        ))}
      </g>
    </svg>
  );
}
