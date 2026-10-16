import type { EditorTextEffectV1 } from "@kanvas/contracts/editor";

import type {
  EditorRuntimeNodeV1,
  EditorRuntimePageV1,
} from "./editor-runtime-v1.js";

type TextNodeV1 = Extract<EditorRuntimeNodeV1, { kind: "text" }>;
type TextRunV1 = TextNodeV1["content"]["paragraphs"][number]["runs"][number];
type TextParagraphV1 = TextNodeV1["content"]["paragraphs"][number];

export interface CanvasTextStyleSnapshotV1 {
  readonly align: TextParagraphV1["align"];
  readonly decoration: TextRunV1["decoration"];
  readonly effects: readonly EditorTextEffectV1[];
  readonly fill: TextRunV1["fill"];
  readonly font: TextRunV1["font"];
  readonly fontSize: number;
  readonly fontStyle: TextRunV1["fontStyle"];
  readonly fontWeight: number;
  readonly letterSpacing: number;
  readonly lineHeight: number;
  readonly spaceAfter: number;
  readonly spaceBefore: number;
  readonly verticalAlign: TextNodeV1["content"]["verticalAlign"];
}

export interface CanvasDocumentTextStyleV1 {
  readonly id: string;
  readonly label: string;
  readonly snapshot: CanvasTextStyleSnapshotV1;
}

export function canvasTextStyleSnapshotV1(
  node: TextNodeV1,
): CanvasTextStyleSnapshotV1 {
  const paragraph = node.content.paragraphs[0]!;
  const run = paragraph.runs[0]!;
  return {
    align: paragraph.align,
    decoration: run.decoration,
    effects: node.effects,
    fill: run.fill,
    font: run.font,
    fontSize: run.fontSize,
    fontStyle: run.fontStyle,
    fontWeight: run.fontWeight,
    letterSpacing: run.letterSpacing,
    lineHeight: paragraph.lineHeight,
    spaceAfter: paragraph.spaceAfter,
    spaceBefore: paragraph.spaceBefore,
    verticalAlign: node.content.verticalAlign,
  };
}

export function canvasDocumentTextStylesV1(
  page: EditorRuntimePageV1,
  maximum = 8,
): readonly CanvasDocumentTextStyleV1[] {
  const styles = new Map<string, CanvasDocumentTextStyleV1>();
  for (const node of [...page.nodes].reverse()) {
    if (node.kind !== "text") continue;
    const snapshot = canvasTextStyleSnapshotV1(node);
    const key = JSON.stringify(snapshot);
    if (!styles.has(key)) {
      styles.set(key, {
        id: `document-text-style:${node.id}`,
        label: `${snapshot.font.family} · ${String(snapshot.fontSize)}`,
        snapshot,
      });
    }
    if (styles.size >= maximum) break;
  }
  return [...styles.values()];
}
