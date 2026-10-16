import type {
  EditorArtifactReferenceV1,
  EditorNodeKindV1,
  EditorTextContentV1,
} from "@kanvas/contracts/editor";

import type {
  EditorImageInsertionSource,
  EditorIntrinsicSize,
  EditorNodeInsertionPayload,
  EditorRect,
} from "./editor-node-insertion.js";
import type {
  EditorLocalImageSourceV1,
  EditorRuntimeNodeV1,
  EditorRuntimePlacedImageV1,
} from "./editor-runtime-v1.js";
import {
  canvasFrameDefinitionV1,
  canvasGridDefinitionV1,
} from "./frame-grid-catalog-v1.js";
import { canvasFontDefinitionV1 } from "./font-catalog-v1.js";
import { canvasLineDefinitionV1 } from "./line-catalog-v1.js";
import { canvasShapeDefinitionV1 } from "./shape-catalog-v1.js";
import { canvasTextPresetV1 } from "./text-preset-catalog-v1.js";

const defaultFontRevision = "google-fonts-2026-07-31";

interface ResolvedCanvasFontV1 {
  readonly family: string;
  readonly fontId: string;
  readonly revision: string;
  readonly source: "brand" | "builtin" | "system" | "workspace";
}

function localSource(
  source: Extract<
    EditorImageInsertionSource,
    { kind: "clipboard" | "local_file" }
  >,
): EditorLocalImageSourceV1 {
  return {
    kind: "local",
    localId: source.localId,
    mediaType: source.mediaType,
    name: source.name,
    previewUrl: source.previewUrl,
    size: source.kind === "local_file" ? source.size : 0,
    uploadState: "uploading",
  };
}

function artifactReference(
  source: Extract<
    EditorImageInsertionSource,
    { kind: "artifact" | "generated_result" }
  >,
): EditorArtifactReferenceV1 {
  return source.reference;
}

function imageSource(source: EditorImageInsertionSource) {
  return source.kind === "local_file" || source.kind === "clipboard"
    ? localSource(source)
    : artifactReference(source);
}

export function createEditorRuntimePlacedImageV1(
  source: EditorImageInsertionSource,
  intrinsicSize: EditorIntrinsicSize,
): EditorRuntimePlacedImageV1 {
  return {
    source: imageSource(source),
    intrinsicWidth: intrinsicSize.width,
    intrinsicHeight: intrinsicSize.height,
    ...(source.kind === "artifact" || source.kind === "generated_result"
      ? {}
      : { mediaType: source.mediaType }),
    crop: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
    fit: "contain",
    focalPoint: {
      x: 0.5,
      y: 0.5,
    },
  };
}

function textContent(
  text: string,
  font: ResolvedCanvasFontV1,
  fontWeight: number,
  letterSpacing: number,
  fill: EditorTextContentV1["paragraphs"][number]["runs"][number]["fill"],
): EditorTextContentV1 {
  return {
    paragraphs: [
      {
        align: "center",
        direction: "auto",
        lineHeight: 1.1,
        spaceBefore: 0,
        spaceAfter: 0,
        runs: [
          {
            text,
            font,
            fontSize: 64,
            fontWeight,
            fontStyle: "normal",
            letterSpacing,
            fill,
            decoration: {
              underline: false,
              strikeThrough: false,
            },
          },
        ],
      },
    ],
    verticalAlign: "middle",
    resizeMode: "auto_height",
  };
}

function textContentFromStyle(
  text: string,
  style: NonNullable<
    Extract<EditorNodeInsertionPayload, { kind: "text" }>["style"]
  >,
): EditorTextContentV1 {
  const content = textContent(
    text,
    {
      family: style.font.family,
      fontId: style.font.fontId,
      revision: style.font.revision ?? defaultFontRevision,
      source: style.font.source,
    },
    style.fontWeight,
    style.letterSpacing,
    style.fill,
  );
  return {
    ...content,
    verticalAlign: style.verticalAlign,
    paragraphs: content.paragraphs.map((paragraph) => ({
      ...paragraph,
      align: style.align,
      lineHeight: style.lineHeight,
      spaceAfter: style.spaceAfter,
      spaceBefore: style.spaceBefore,
      runs: paragraph.runs.map((run) => ({
        ...run,
        decoration: style.decoration,
        font: style.font,
        fontSize: style.fontSize,
        fontStyle: style.fontStyle,
      })),
    })),
  };
}

function noteTextContent(text: string): EditorTextContentV1 {
  const content = textContent(
    text,
    {
      family: "Noto Sans SC",
      fontId: "noto-sans-sc",
      revision: defaultFontRevision,
      source: "builtin",
    },
    600,
    0,
    {
      kind: "solid",
      color: "#202126",
    },
  );
  return {
    ...content,
    paragraphs: content.paragraphs.map((paragraph) => ({
      ...paragraph,
      align: "left",
      lineHeight: 1.35,
      runs: paragraph.runs.map((run) => ({
        ...run,
        fontSize: 28,
      })),
    })),
    verticalAlign: "top",
    resizeMode: "fixed",
  };
}

function common(id: string, name: string, rect: EditorRect) {
  return {
    id,
    name,
    transform: {
      ...rect,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal" as const,
    visible: true,
    locked: false,
  };
}

export function defaultEditorNodeSizeV1(
  payload: EditorNodeInsertionPayload,
): EditorIntrinsicSize {
  if (payload.kind === "image" || payload.kind === "graphic") {
    return payload.intrinsicSize;
  }
  if (payload.kind === "text") {
    return {
      width: 520,
      height: 160,
    };
  }
  if (payload.kind === "note") {
    return {
      width: 280,
      height: 260,
    };
  }
  if (payload.kind === "shape") {
    const definition = canvasShapeDefinitionV1(payload.definition);
    return {
      width: 240 * definition.defaultAspectRatio,
      height: 240,
    };
  }
  if (payload.kind === "line") {
    return {
      width: 360,
      height: 48,
    };
  }
  if (payload.kind === "frame") {
    const definition = canvasFrameDefinitionV1(payload.definition);
    return {
      width: 320 * definition.defaultAspectRatio,
      height: 320,
    };
  }
  const definition = canvasGridDefinitionV1(payload.definition);
  return {
    width: 520 * definition.defaultAspectRatio,
    height: 520,
  };
}

export function createEditorRuntimeNodeV1(
  payload: EditorNodeInsertionPayload,
  id: string,
  rect: EditorRect,
): EditorRuntimeNodeV1 {
  if (payload.kind === "image") {
    return {
      ...common(
        id,
        payload.source.kind === "local_file" ? payload.source.name : "图片",
        rect,
      ),
      kind: "image",
      image: createEditorRuntimePlacedImageV1(
        payload.source,
        payload.intrinsicSize,
      ),
      cornerRadius: 0,
    };
  }
  if (payload.kind === "text") {
    const text = payload.text?.trim() || "输入文字";
    if (payload.style) {
      return {
        ...common(id, "文档文字样式", rect),
        kind: "text",
        content: textContentFromStyle(text, payload.style),
        effects: [...payload.style.effects],
      };
    }
    if (payload.preset) {
      const preset = canvasTextPresetV1(payload.preset);
      const font = canvasFontDefinitionV1(preset.fontId, preset.fontRevision);
      return {
        ...common(id, preset.label, rect),
        kind: "text",
        content: textContent(
          text,
          {
            family: font.family,
            fontId: font.id,
            revision: font.revision,
            source: font.source,
          },
          preset.fontWeight,
          preset.letterSpacing,
          preset.fill,
        ),
        effects: [...preset.effects],
        preset: payload.preset,
      };
    }
    const font =
      payload.font?.family && payload.font.source
        ? {
            family: payload.font.family,
            id: payload.font.fontId,
            revision: payload.font.revision,
            source: payload.font.source,
            weights: [400],
            label: payload.font.family,
          }
        : canvasFontDefinitionV1(
            payload.font?.fontId ?? "noto-sans-sc",
            payload.font?.revision ?? defaultFontRevision,
          );
    return {
      ...common(id, font.label, rect),
      kind: "text",
      content: textContent(
        text,
        {
          family: font.family,
          fontId: font.id,
          revision: font.revision,
          source: font.source,
        },
        font.weights.includes(700) ? 700 : (font.weights.at(-1) ?? 400),
        0,
        {
          kind: "solid",
          color: "#151515",
        },
      ),
      effects: [],
    };
  }
  if (payload.kind === "note") {
    return {
      ...common(id, "便签", rect),
      kind: "shape",
      definition: {
        catalogId: "kanvas.core.shapes",
        definitionId: "basic.sticky-note",
        revision: "2026-07-31",
      },
      parameters: {},
      fill: {
        kind: "solid",
        color: payload.color,
      },
      stroke: {
        paint: {
          kind: "none",
        },
        width: 0,
        alignment: "center",
      },
      label: {
        content: noteTextContent(payload.text?.trim() || "添加便签"),
        padding: {
          top: 30,
          right: 34,
          bottom: 52,
          left: 30,
        },
      },
    };
  }
  if (payload.kind === "shape") {
    const definition = canvasShapeDefinitionV1(payload.definition);
    return {
      ...common(id, definition.label, rect),
      kind: "shape",
      definition: payload.definition,
      parameters: Object.fromEntries(
        definition.parameters.map((parameter) => [
          parameter.id,
          parameter.defaultValue,
        ]),
      ),
      fill: {
        kind: "solid",
        color: "#3048f5",
      },
      stroke: {
        paint: {
          kind: "none",
        },
        width: 0,
        alignment: "center",
      },
    };
  }
  if (payload.kind === "line") {
    const definition = canvasLineDefinitionV1(payload.definition);
    return {
      ...common(id, definition.label, rect),
      kind: "line",
      pathKind: definition.pathKind,
      points: [...definition.points],
      stroke: {
        paint: {
          kind: "solid",
          color: "#151515",
        },
        width: definition.strokeWidth,
        alignment: "center",
        ...(definition.dash ? { dash: [...definition.dash] } : {}),
      },
      startCap: definition.startCap,
      endCap: definition.endCap,
      role: "design",
      capStyle: "round",
      joinStyle: "round",
    };
  }
  if (payload.kind === "graphic") {
    return {
      ...common(id, "矢量素材", rect),
      kind: "graphic",
      source:
        payload.source.kind === "artifact"
          ? payload.source.reference
          : payload.source,
      colorSlots: {},
      preserveAspectRatio: true,
    };
  }
  if (payload.kind === "frame") {
    const definition = canvasFrameDefinitionV1(payload.definition);
    return {
      ...common(id, definition.label, rect),
      kind: "frame",
      definition: payload.definition,
      fill: {
        kind: "none",
      },
      stroke: {
        paint: {
          kind: "solid",
          color: "#b8bac4",
        },
        width: 2,
        alignment: "inside",
      },
    };
  }
  const definition = canvasGridDefinitionV1(payload.definition);
  return {
    ...common(id, definition.label, rect),
    kind: "grid",
    definition: payload.definition,
    gap: 12,
    cornerRadius: 0,
    cells: definition.slots.map((slot) => ({
      slotId: slot.id,
    })),
  };
}

export function editorNodeKindFromFactoryV1(
  payload: EditorNodeInsertionPayload,
): Exclude<EditorNodeKindV1, "group"> {
  return payload.kind === "note" ? "shape" : payload.kind;
}
