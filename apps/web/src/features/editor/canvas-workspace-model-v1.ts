import type { EditorPaintV1, EditorTextNodeV1 } from "@kanvas/contracts/editor";

import { canvasShapeLabelTextNodeV1 } from "./canvas-shape-node-v1.js";
import type {
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
} from "./editor-runtime-v1.js";
import type { EditorStateV1 } from "./editor-state-v1.js";
import type { CanvasMediaContentTargetV1 } from "./canvas-media-container-v1.js";

export function activePage(state: EditorStateV1): EditorRuntimePageV1 {
  const page = state.document.pages.find(
    (candidate) => candidate.id === state.activePageId,
  );
  if (!page) {
    throw new Error(`Canvas page ${state.activePageId} does not exist.`);
  }
  return page;
}

export function paintColor(paint: EditorPaintV1): string {
  return paint.kind === "solid" ? paint.color : "#3048f5";
}

export function pageDocumentColorsV1(
  page: EditorRuntimePageV1,
): readonly string[] {
  const colors = new Set<string>();
  const addPaint = (paint: EditorPaintV1) => {
    if (paint.kind === "solid") {
      colors.add(paint.color);
    }
    if (paint.kind === "linear_gradient") {
      paint.stops.forEach((stop) => {
        colors.add(stop.color);
      });
    }
  };
  const addNode = (node: EditorRuntimeNodeV1) => {
    if (node.kind === "text") {
      node.content.paragraphs.forEach((paragraph) => {
        paragraph.runs.forEach((run) => {
          addPaint(run.fill);
        });
      });
    }
    if (node.kind === "shape") {
      addPaint(node.fill);
      addPaint(node.stroke.paint);
    }
    if (node.kind === "line") {
      addPaint(node.stroke.paint);
    }
    if (node.kind === "graphic") {
      Object.values(node.colorSlots).forEach((color) => {
        if (color) {
          colors.add(color);
        }
      });
    }
    if (node.kind === "frame") {
      addPaint(node.fill);
    }
    if (node.kind === "group") {
      node.children.forEach(addNode);
    }
  };
  if (page.background.kind === "paint") {
    addPaint(page.background.paint);
  }
  page.nodes.forEach(addNode);
  return [...colors];
}

export function topLevelNode(
  page: EditorRuntimePageV1,
  id: string,
): EditorRuntimeNodeV1 | undefined {
  return page.nodes.find((node) => node.id === id);
}

export function findCanvasNodeV1(
  nodes: readonly EditorRuntimeNodeV1[],
  id: string,
): EditorRuntimeNodeV1 | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === "group") {
      const child = findCanvasNodeV1(node.children, id);
      if (child) return child;
    }
  }
  return undefined;
}

export function eventTopLevelNodeId(
  event: {
    readonly nativeEvent: Event;
  },
  page: EditorRuntimePageV1,
): string | undefined {
  const topLevelIds = new Set(page.nodes.map((node) => node.id));
  for (const item of event.nativeEvent.composedPath()) {
    if (!(item instanceof Element)) {
      continue;
    }
    const id = item.getAttribute("data-node-id");
    if (id && topLevelIds.has(id)) {
      return id;
    }
  }
  return undefined;
}

export function canvasMediaContentTargetForEventV1(
  event: { readonly nativeEvent: Event },
  page: EditorRuntimePageV1,
): CanvasMediaContentTargetV1 | undefined {
  const nodeId = eventTopLevelNodeId(event, page);
  const node = nodeId ? topLevelNode(page, nodeId) : undefined;
  if (node?.kind === "frame") {
    return { kind: "frame", nodeId: node.id };
  }
  if (node?.kind !== "grid") return undefined;
  for (const item of event.nativeEvent.composedPath()) {
    if (!(item instanceof Element)) continue;
    const slotId = item.getAttribute("data-grid-slot");
    if (slotId && node.cells.some((cell) => cell.slotId === slotId)) {
      return { kind: "grid", nodeId: node.id, slotId };
    }
  }
  return undefined;
}

export function editableTextNodeV1(
  node: EditorRuntimeNodeV1,
): EditorTextNodeV1 | undefined {
  if (node.kind === "text") {
    return node;
  }
  return node.kind === "shape" ? canvasShapeLabelTextNodeV1(node) : undefined;
}

const defaultShapeLabelFontRevision = "google-fonts-2026-07-31";
const defaultShapeLabelPadding = 20;
const defaultShapeLabelFontSize = 40;
const defaultShapeLabelDarkColor = "#151515";
const defaultShapeLabelLightColor = "#ffffff";
const hexColorLength = 7;
const lightColorThreshold = 0.58;
const redHexStart = 1;
const redHexEnd = 3;
const greenHexStart = 3;
const greenHexEnd = 5;
const blueHexStart = 5;
const blueHexEnd = 7;
const redLuminanceWeight = 0.299;
const greenLuminanceWeight = 0.587;
const blueLuminanceWeight = 0.114;
const maximumColorChannel = 255;

function shapeLabelColorV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "shape" }>,
): string {
  if (node.fill.kind === "none") {
    return node.stroke.paint.kind === "solid"
      ? node.stroke.paint.color
      : defaultShapeLabelDarkColor;
  }
  if (node.fill.kind !== "solid" || node.fill.color.length !== hexColorLength) {
    return defaultShapeLabelLightColor;
  }
  const red = Number.parseInt(
    node.fill.color.slice(redHexStart, redHexEnd),
    16,
  );
  const green = Number.parseInt(
    node.fill.color.slice(greenHexStart, greenHexEnd),
    16,
  );
  const blue = Number.parseInt(
    node.fill.color.slice(blueHexStart, blueHexEnd),
    16,
  );
  const luminance =
    (red * redLuminanceWeight +
      green * greenLuminanceWeight +
      blue * blueLuminanceWeight) /
    maximumColorChannel;
  return luminance > lightColorThreshold
    ? defaultShapeLabelDarkColor
    : defaultShapeLabelLightColor;
}

export function shapeWithDefaultLabelV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "shape" }>,
  value = "",
): Extract<EditorRuntimeNodeV1, { kind: "shape" }> {
  if (node.label) {
    return node;
  }
  return {
    ...node,
    label: {
      content: {
        paragraphs: [
          {
            align: "center",
            direction: "auto",
            lineHeight: 1.1,
            spaceBefore: 0,
            spaceAfter: 0,
            runs: [
              {
                text: value,
                font: {
                  source: "builtin",
                  fontId: "noto-sans-sc",
                  family: "Noto Sans SC",
                  revision: defaultShapeLabelFontRevision,
                },
                fontSize: defaultShapeLabelFontSize,
                fontWeight: 600,
                fontStyle: "normal",
                letterSpacing: 0,
                fill: {
                  kind: "solid",
                  color: shapeLabelColorV1(node),
                },
                decoration: {
                  underline: false,
                  strikeThrough: false,
                },
              },
            ],
          },
        ],
        verticalAlign: "middle",
        resizeMode: "fixed",
      },
      padding: {
        top: defaultShapeLabelPadding,
        right: defaultShapeLabelPadding,
        bottom: defaultShapeLabelPadding,
        left: defaultShapeLabelPadding,
      },
    },
  };
}

export function shapeTextNodeForEditingV1(
  node: EditorRuntimeNodeV1,
): EditorTextNodeV1 | undefined {
  if (node.kind === "text") {
    return node;
  }
  if (node.kind !== "shape") {
    return undefined;
  }
  return canvasShapeLabelTextNodeV1(shapeWithDefaultLabelV1(node));
}

export function textNodeValue(node: EditorTextNodeV1): string {
  return node.content.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

export function textNodeWithValue(
  node: EditorTextNodeV1,
  value: string,
): EditorTextNodeV1 {
  const lines = value.split("\n");
  const templateParagraph = node.content.paragraphs[0]!;
  const templateRun = templateParagraph.runs[0]!;
  return {
    ...node,
    content: {
      ...node.content,
      paragraphs: lines.map((line, index) => {
        const paragraph = node.content.paragraphs[index] ?? templateParagraph;
        return {
          ...paragraph,
          runs: [
            {
              ...(paragraph.runs[0] ?? templateRun),
              text: line,
            },
          ],
        };
      }),
    },
  };
}

export function nodeWithEditedTextV1(
  node: EditorRuntimeNodeV1,
  value: string,
): EditorRuntimeNodeV1 {
  const textNode = shapeTextNodeForEditingV1(node);
  if (!textNode) {
    return node;
  }
  const updated = textNodeWithValue(textNode, value);
  if (node.kind === "text") {
    return updated;
  }
  if (node.kind === "shape") {
    const shape = shapeWithDefaultLabelV1(node);
    return {
      ...shape,
      label: {
        ...shape.label!,
        content: updated.content,
      },
    };
  }
  return node;
}

export function nodeWithTextNodeV1(
  node: EditorRuntimeNodeV1,
  textNode: EditorTextNodeV1,
): EditorRuntimeNodeV1 {
  if (node.kind === "text") {
    return textNode;
  }
  if (node.kind !== "shape" || !node.label) {
    return node;
  }
  return {
    ...node,
    label: {
      ...node.label,
      content: textNode.content,
    },
  };
}

export function shapeWithoutLabelV1(
  node: Extract<EditorRuntimeNodeV1, { kind: "shape" }>,
): Extract<EditorRuntimeNodeV1, { kind: "shape" }> {
  const { label, ...shape } = node;
  void label;
  return shape;
}

export function mapTextNodeRuns(
  node: Extract<EditorRuntimeNodeV1, { kind: "text" }>,
  update: (
    run: Extract<
      EditorRuntimeNodeV1,
      { kind: "text" }
    >["content"]["paragraphs"][number]["runs"][number],
  ) => Extract<
    EditorRuntimeNodeV1,
    { kind: "text" }
  >["content"]["paragraphs"][number]["runs"][number],
): Extract<EditorRuntimeNodeV1, { kind: "text" }> {
  return {
    ...node,
    content: {
      ...node.content,
      paragraphs: node.content.paragraphs.map((paragraph) => ({
        ...paragraph,
        runs: paragraph.runs.map(update),
      })),
    },
  };
}

export function cloneNodeV1(
  node: EditorRuntimeNodeV1,
  suffix: string,
  offsetTopLevel: boolean,
  copySuffix: string,
  pageBounds?: { readonly height: number; readonly width: number },
): EditorRuntimeNodeV1 {
  const CLONED_NODE_OFFSET = 32;
  const offsetWithinPage = (
    position: number,
    size: number,
    limit: number,
  ): number => {
    if (position + size + CLONED_NODE_OFFSET <= limit) {
      return position + CLONED_NODE_OFFSET;
    }
    const backward = position - CLONED_NODE_OFFSET;
    if (backward >= 0 && backward + size <= limit) {
      return backward;
    }
    return Math.max(0, Math.min(position, limit - size));
  };
  const transform = {
    ...node.transform,
    ...(offsetTopLevel
      ? {
          x: pageBounds
            ? offsetWithinPage(
                node.transform.x,
                node.transform.width,
                pageBounds.width,
              )
            : node.transform.x + CLONED_NODE_OFFSET,
          y: pageBounds
            ? offsetWithinPage(
                node.transform.y,
                node.transform.height,
                pageBounds.height,
              )
            : node.transform.y + CLONED_NODE_OFFSET,
        }
      : {}),
  };
  if (node.kind === "group") {
    return {
      ...node,
      id: `${node.id}:copy:${suffix}`,
      name: `${node.name}${copySuffix}`,
      transform,
      children: node.children.map((child) =>
        cloneNodeV1(child, suffix, false, copySuffix, pageBounds),
      ),
    };
  }
  return {
    ...node,
    id: `${node.id}:copy:${suffix}`,
    name: `${node.name}${copySuffix}`,
    transform,
  };
}

export function topLevelNodeIdForLocalImage(
  nodes: readonly EditorRuntimeNodeV1[],
  localId: string,
): string | undefined {
  const contains = (node: EditorRuntimeNodeV1): boolean => {
    if (node.kind === "image") {
      return (
        node.image.source.kind === "local" &&
        node.image.source.localId === localId
      );
    }
    if (node.kind === "frame") {
      return Boolean(
        node.content?.image.source.kind === "local" &&
        node.content.image.source.localId === localId,
      );
    }
    if (node.kind === "grid") {
      return node.cells.some(
        (cell) =>
          cell.content?.image.source.kind === "local" &&
          cell.content.image.source.localId === localId,
      );
    }
    return (
      node.kind === "group" && node.children.some((child) => contains(child))
    );
  };
  return nodes.find((node) => contains(node))?.id;
}
