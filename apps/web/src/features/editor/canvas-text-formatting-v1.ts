import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

export type CanvasTextNodeV1 = Extract<EditorRuntimeNodeV1, { kind: "text" }>;

type CanvasTextRunV1 =
  CanvasTextNodeV1["content"]["paragraphs"][number]["runs"][number];
type CanvasTextParagraphV1 = CanvasTextNodeV1["content"]["paragraphs"][number];
type CanvasTextEffectV1 = CanvasTextNodeV1["effects"][number];

export interface CanvasTextRunFormatPatchV1 {
  readonly fontSize?: number;
  readonly fontStyle?: CanvasTextRunV1["fontStyle"];
  readonly fontWeight?: number;
  readonly letterSpacing?: number;
  readonly strikeThrough?: boolean;
  readonly underline?: boolean;
}

export interface CanvasTextParagraphFormatPatchV1 {
  readonly align?: CanvasTextParagraphV1["align"];
  readonly lineHeight?: number;
  readonly spaceAfter?: number;
  readonly spaceBefore?: number;
}

export interface CanvasTextFormattingV1 {
  readonly align: CanvasTextParagraphV1["align"];
  readonly fontSize: number;
  readonly fontStyle: CanvasTextRunV1["fontStyle"];
  readonly fontWeight: number;
  readonly letterSpacing: number;
  readonly lineHeight: number;
  readonly spaceAfter: number;
  readonly spaceBefore: number;
  readonly strikeThrough: boolean;
  readonly underline: boolean;
  readonly verticalAlign: CanvasTextNodeV1["content"]["verticalAlign"];
}

export const canvasTextAlignmentOptionsV1 = [
  ["left", "左对齐"],
  ["center", "居中"],
  ["right", "右对齐"],
  ["justify", "两端对齐"],
] as const satisfies readonly [CanvasTextParagraphV1["align"], string][];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function canvasTextFormattingV1(
  node: CanvasTextNodeV1,
): CanvasTextFormattingV1 {
  const paragraph = node.content.paragraphs[0]!;
  const run = paragraph.runs[0]!;
  return {
    align: paragraph.align,
    fontSize: run.fontSize,
    fontStyle: run.fontStyle,
    fontWeight: run.fontWeight,
    letterSpacing: run.letterSpacing,
    lineHeight: paragraph.lineHeight,
    spaceAfter: paragraph.spaceAfter,
    spaceBefore: paragraph.spaceBefore,
    strikeThrough: run.decoration.strikeThrough,
    underline: run.decoration.underline,
    verticalAlign: node.content.verticalAlign,
  };
}

export function updateCanvasTextRunsV1(
  node: CanvasTextNodeV1,
  patch: CanvasTextRunFormatPatchV1,
): CanvasTextNodeV1 {
  return {
    ...node,
    content: {
      ...node.content,
      paragraphs: node.content.paragraphs.map((paragraph) => ({
        ...paragraph,
        runs: paragraph.runs.map((run) => ({
          ...run,
          ...(patch.fontSize === undefined
            ? {}
            : {
                fontSize: clamp(patch.fontSize, 1, 2_048),
              }),
          ...(patch.fontStyle === undefined
            ? {}
            : { fontStyle: patch.fontStyle }),
          ...(patch.fontWeight === undefined
            ? {}
            : {
                fontWeight: Math.round(clamp(patch.fontWeight, 100, 1_000)),
              }),
          ...(patch.letterSpacing === undefined
            ? {}
            : {
                letterSpacing: clamp(patch.letterSpacing, -200, 2_000),
              }),
          decoration: {
            ...run.decoration,
            ...(patch.underline === undefined
              ? {}
              : { underline: patch.underline }),
            ...(patch.strikeThrough === undefined
              ? {}
              : { strikeThrough: patch.strikeThrough }),
          },
        })),
      })),
    },
  };
}

export function updateCanvasTextParagraphsV1(
  node: CanvasTextNodeV1,
  patch: CanvasTextParagraphFormatPatchV1,
): CanvasTextNodeV1 {
  return {
    ...node,
    content: {
      ...node.content,
      paragraphs: node.content.paragraphs.map((paragraph) => ({
        ...paragraph,
        ...(patch.align === undefined ? {} : { align: patch.align }),
        ...(patch.lineHeight === undefined
          ? {}
          : {
              lineHeight: clamp(patch.lineHeight, 0.5, 10),
            }),
        ...(patch.spaceBefore === undefined
          ? {}
          : {
              spaceBefore: clamp(patch.spaceBefore, 0, 4_096),
            }),
        ...(patch.spaceAfter === undefined
          ? {}
          : {
              spaceAfter: clamp(patch.spaceAfter, 0, 4_096),
            }),
      })),
    },
  };
}

export function updateCanvasTextVerticalAlignV1(
  node: CanvasTextNodeV1,
  verticalAlign: CanvasTextNodeV1["content"]["verticalAlign"],
): CanvasTextNodeV1 {
  return {
    ...node,
    content: {
      ...node.content,
      verticalAlign,
    },
  };
}

export function updateCanvasTextEffectV1(
  node: CanvasTextNodeV1,
  kind: CanvasTextEffectV1["kind"],
  next: CanvasTextEffectV1 | undefined,
): CanvasTextNodeV1 {
  return {
    ...node,
    effects: [
      ...node.effects.filter((effect) => effect.kind !== kind),
      ...(next ? [next] : []),
    ],
  };
}
