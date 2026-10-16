import type {
  BrandKitRevision,
  BrandKitTextStyle,
} from "@kanvas/contracts/api";
import type { EditorDraftContentV1 } from "@kanvas/contracts/editor";

import { brandSocialStarterTitleStyleV1 } from "../workflows/brand-social-starter-v1.js";
import {
  createEditorDocumentV1,
  createEditorPageV1,
} from "./editor-document-factory-v1.js";
import { createEditorRuntimeNodeV1 } from "./editor-node-factory-v1.js";
import type { CanvasTextStyleSnapshotV1 } from "./canvas-text-style-v1.js";

const defaultHeadlineColor = "#FFFFFF";
const HEX_RED_START = 1;
const HEX_RED_END = 3;
const HEX_GREEN_START = 3;
const HEX_GREEN_END = 5;
const HEX_BLUE_START = 5;
const HEX_BLUE_END = 7;
const RGB_CHANNEL_MAX = 255;
const SRGB_LINEAR_THRESHOLD = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_EXPONENT = 2.4;
const RED_LUMINANCE_WEIGHT = 0.2126;
const GREEN_LUMINANCE_WEIGHT = 0.7152;
const BLUE_LUMINANCE_WEIGHT = 0.0722;
const CONTRAST_OFFSET = 0.05;
const MINIMUM_TEXT_CONTRAST = 4.5;
const DRAFT_TITLE_MAX_LENGTH = 240;
const HEADLINE_X_RATIO = 0.08;
const HEADLINE_Y_RATIO = 0.76;
const HEADLINE_WIDTH_RATIO = 0.84;
const HEADLINE_HEIGHT_RATIO = 0.16;

function rgb(
  value: string | undefined,
): readonly [number, number, number] | undefined {
  if (!value || !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(value)) {
    return undefined;
  }
  return [
    Number.parseInt(value.slice(HEX_RED_START, HEX_RED_END), 16),
    Number.parseInt(value.slice(HEX_GREEN_START, HEX_GREEN_END), 16),
    Number.parseInt(value.slice(HEX_BLUE_START, HEX_BLUE_END), 16),
  ];
}

function luminance(value: readonly [number, number, number]): number {
  const channels = value.map((channel) => {
    const normalized = channel / RGB_CHANNEL_MAX;
    return normalized <= SRGB_LINEAR_THRESHOLD
      ? normalized / SRGB_LINEAR_DIVISOR
      : ((normalized + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT;
  });
  return (
    RED_LUMINANCE_WEIGHT * channels[0]! +
    GREEN_LUMINANCE_WEIGHT * channels[1]! +
    BLUE_LUMINANCE_WEIGHT * channels[2]!
  );
}

function contrast(left: string, right: string): number {
  const leftRgb = rgb(left);
  const rightRgb = rgb(right);
  if (!leftRgb || !rightRgb) return 1;
  const light = Math.max(luminance(leftRgb), luminance(rightRgb));
  const dark = Math.min(luminance(leftRgb), luminance(rightRgb));
  return (light + CONTRAST_OFFSET) / (dark + CONTRAST_OFFSET);
}

export function readableWorkflowHeadlineColorV1(
  candidates: readonly string[],
  backgroundColor: string | undefined,
): string {
  if (!backgroundColor) return candidates[0] ?? defaultHeadlineColor;
  const unique = [...new Set([...candidates, "#FFFFFF", "#151515"])];
  return (
    unique.find(
      (candidate) =>
        contrast(candidate, backgroundColor) >= MINIMUM_TEXT_CONTRAST,
    ) ??
    unique.toSorted(
      (left, right) =>
        contrast(right, backgroundColor) - contrast(left, backgroundColor),
    )[0] ??
    defaultHeadlineColor
  );
}

function title(input: string): string {
  const suffix = " · 继续编辑";
  const name = input.trim() || "制作结果";
  return `${name.slice(0, DRAFT_TITLE_MAX_LENGTH - suffix.length)}${suffix}`;
}

function textStyleSnapshot(
  style: BrandKitTextStyle | undefined,
  revision: BrandKitRevision | undefined,
  backgroundColor: string | undefined,
): CanvasTextStyleSnapshotV1 | undefined {
  if (!style) return undefined;
  const color = style.colorKey
    ? revision?.colors.find((item) => item.key === style.colorKey)?.value
    : revision?.colors.find((item) => item.role === "text_primary")?.value;
  const brandTextColors =
    revision?.colors
      .filter(
        (item) =>
          item.role === "text_primary" || item.role === "text_secondary",
      )
      .map((item) => item.value) ?? [];
  return {
    align: "center",
    decoration: { underline: false, strikeThrough: false },
    effects: [],
    fill: {
      kind: "solid",
      color: readableWorkflowHeadlineColorV1(
        [color ?? defaultHeadlineColor, ...brandTextColors],
        backgroundColor,
      ),
    },
    font: {
      source: "builtin",
      fontId: style.fontId,
      family: style.fontFamily,
      revision: style.fontRevision,
    },
    fontSize: style.fontSize,
    fontStyle: "normal",
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    spaceAfter: 0,
    spaceBefore: 0,
    verticalAlign: "middle",
  };
}

export function createWorkflowResultDraftV1(input: {
  readonly artifactId: string;
  readonly brandRevision?: BrandKitRevision;
  readonly backgroundColor?: string;
  readonly headline?: string;
  readonly intrinsicSize: {
    readonly height: number;
    readonly width: number;
  };
  readonly nodeIds: {
    readonly image: string;
    readonly text: string;
  };
  readonly runId: string;
  readonly sourceTitle: string;
  readonly workspaceId: string;
}): EditorDraftContentV1 {
  const draftTitle = title(input.sourceTitle);
  const document = createEditorDocumentV1(input.workspaceId, {
    title: draftTitle,
  });
  const page = createEditorPageV1("page-1", "页面 1", input.intrinsicSize);
  const image = createEditorRuntimeNodeV1(
    {
      kind: "image",
      source: {
        kind: "generated_result",
        reference: { kind: "artifact", artifactId: input.artifactId },
        runId: input.runId,
      },
      intrinsicSize: input.intrinsicSize,
    },
    input.nodeIds.image,
    {
      x: 0,
      y: 0,
      width: input.intrinsicSize.width,
      height: input.intrinsicSize.height,
    },
  );
  if (image.kind !== "image") {
    throw new Error("制作结果没有形成图片节点。");
  }
  const headline = input.headline?.trim();
  const titleStyle = brandSocialStarterTitleStyleV1(input.brandRevision);
  const headlineStyle = textStyleSnapshot(
    titleStyle,
    input.brandRevision,
    input.backgroundColor,
  );
  const text = headline
    ? createEditorRuntimeNodeV1(
        {
          kind: "text",
          text: headline,
          ...(headlineStyle ? { style: headlineStyle } : {}),
        },
        input.nodeIds.text,
        {
          x: input.intrinsicSize.width * HEADLINE_X_RATIO,
          y: input.intrinsicSize.height * HEADLINE_Y_RATIO,
          width: input.intrinsicSize.width * HEADLINE_WIDTH_RATIO,
          height: input.intrinsicSize.height * HEADLINE_HEIGHT_RATIO,
        },
      )
    : undefined;
  if (text && text.kind !== "text") {
    throw new Error("制作标题没有形成文字节点。");
  }
  const durableImage = {
    ...image,
    image: {
      ...image.image,
      source: { kind: "artifact" as const, artifactId: input.artifactId },
    },
  };

  return {
    schemaVersion: document.schemaVersion,
    title: draftTitle,
    pages: [
      {
        ...page,
        nodes: [durableImage, ...(text ? [text] : [])],
      },
    ],
    metadata: document.metadata,
  };
}
