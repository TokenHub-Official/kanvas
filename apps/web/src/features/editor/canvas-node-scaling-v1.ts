import type { EditorTextContentV1 } from "@kanvas/contracts/editor";

import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const minimumScale = 0.000_1;

export function canvasResizeScalesVisualMetricsV1(
  scaleX: number,
  scaleY: number,
): boolean {
  return (
    Math.abs(scaleX - 1) > Number.EPSILON &&
    Math.abs(scaleY - 1) > Number.EPSILON
  );
}

function visualScale(scaleX: number, scaleY: number): number {
  return Math.sqrt(Math.max(minimumScale, Math.abs(scaleX * scaleY)));
}

function scaleTextContentV1(
  content: EditorTextContentV1,
  scaleX: number,
  scaleY: number,
): EditorTextContentV1 {
  const scale = visualScale(scaleX, scaleY);
  return {
    ...content,
    paragraphs: content.paragraphs.map((paragraph) => ({
      ...paragraph,
      spaceBefore: paragraph.spaceBefore * scaleY,
      spaceAfter: paragraph.spaceAfter * scaleY,
      runs: paragraph.runs.map((run) => ({
        ...run,
        fontSize: run.fontSize * scale,
        letterSpacing: run.letterSpacing * scaleX,
      })),
    })),
  };
}

function scaleTextEffectsV1(
  effects: Extract<EditorRuntimeNodeV1, { kind: "text" }>["effects"],
  scaleX: number,
  scaleY: number,
): Extract<EditorRuntimeNodeV1, { kind: "text" }>["effects"] {
  const scale = visualScale(scaleX, scaleY);
  return effects.map((effect) => {
    if (effect.kind === "outline" || effect.kind === "hollow") {
      return { ...effect, width: effect.width * scale };
    }
    if (effect.kind === "shadow") {
      return {
        ...effect,
        blur: effect.blur * scale,
        offsetX: effect.offsetX * scaleX,
        offsetY: effect.offsetY * scaleY,
      };
    }
    if (effect.kind === "glow") {
      return { ...effect, blur: effect.blur * scale };
    }
    if (effect.kind === "background") {
      return {
        ...effect,
        paddingX: effect.paddingX * scaleX,
        paddingY: effect.paddingY * scaleY,
        cornerRadius: effect.cornerRadius * scale,
      };
    }
    if (effect.kind === "offset_layers") {
      return {
        ...effect,
        layers: effect.layers.map((layer) => ({
          ...layer,
          offsetX: layer.offsetX * scaleX,
          offsetY: layer.offsetY * scaleY,
        })),
      };
    }
    return effect;
  });
}

export function scaleCanvasNodeVisualsV1(
  node: EditorRuntimeNodeV1,
  scaleX: number,
  scaleY: number,
): EditorRuntimeNodeV1 {
  const scale = visualScale(scaleX, scaleY);
  if (node.kind === "text") {
    return {
      ...node,
      content: scaleTextContentV1(node.content, scaleX, scaleY),
      effects: scaleTextEffectsV1(node.effects, scaleX, scaleY),
    };
  }
  if (node.kind === "shape") {
    return {
      ...node,
      stroke: {
        ...node.stroke,
        width: node.stroke.width * scale,
        ...(node.stroke.dash
          ? { dash: node.stroke.dash.map((value) => value * scale) }
          : {}),
      },
      ...(node.label
        ? {
            label: {
              ...node.label,
              content: scaleTextContentV1(node.label.content, scaleX, scaleY),
              padding: {
                top: node.label.padding.top * scaleY,
                right: node.label.padding.right * scaleX,
                bottom: node.label.padding.bottom * scaleY,
                left: node.label.padding.left * scaleX,
              },
            },
          }
        : {}),
    };
  }
  if (node.kind === "line") {
    return {
      ...node,
      stroke: {
        ...node.stroke,
        width: node.stroke.width * scale,
        ...(node.stroke.dash
          ? { dash: node.stroke.dash.map((value) => value * scale) }
          : {}),
      },
    };
  }
  if (node.kind === "image") {
    return { ...node, cornerRadius: node.cornerRadius * scale };
  }
  if (node.kind === "frame") {
    return {
      ...node,
      stroke: { ...node.stroke, width: node.stroke.width * scale },
    };
  }
  if (node.kind === "grid") {
    return {
      ...node,
      gap: node.gap * scale,
      cornerRadius: node.cornerRadius * scale,
    };
  }
  return node;
}
