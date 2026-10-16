import type { EditorTextNodeV1 } from "@kanvas/contracts/editor";

type TextParagraph = EditorTextNodeV1["content"]["paragraphs"][number];
export type CanvasTextRunV1 = TextParagraph["runs"][number];

export interface CanvasTextParagraphLayoutV1 {
  readonly baseline: number;
  readonly height: number;
  readonly paragraph: TextParagraph;
}

export interface CanvasTextMeasurementContextV1 {
  font: string;
  measureText(text: string): { readonly width: number };
}

export interface CanvasTextFontLoadRequestV1 {
  readonly font: string;
  readonly text: string;
}

export type CanvasTextMeasureV1 = (
  text: string,
  run: CanvasTextRunV1,
) => number;

interface TextFragment {
  readonly run: CanvasTextRunV1;
  readonly runIndex: number;
  readonly text: string;
}

interface TextToken extends TextFragment {
  readonly kind: "break" | "content" | "space";
}

const wideCharacterPattern =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u;
const narrowCharacterPattern = /[ilI1|!.,:;'\u0060]/u;
const broadCharacterPattern = /[MW@#%&]/u;
const punctuationPattern = /[()[\]{}<>/\\+*=~_-]/u;
const defaultCharacterWidthRatio = 0.62;
const whitespaceWidthRatio = 0.34;
const wideCharacterWidthRatio = 1;
const narrowCharacterWidthRatio = 0.36;
const broadCharacterWidthRatio = 0.9;
const punctuationWidthRatio = 0.46;
const minimumCharacterWidthRatio = 0.1;
const fallbackFontLoadText = "BESbswy";

const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

function graphemes(text: string): readonly string[] {
  if (!graphemeSegmenter) return [...text];
  return [...graphemeSegmenter.segment(text)].map(({ segment }) => segment);
}

function fallbackCharacterAdvance(
  character: string,
  run: CanvasTextRunV1,
): number {
  let widthRatio = defaultCharacterWidthRatio;
  if (/\s/u.test(character)) widthRatio = whitespaceWidthRatio;
  else if (wideCharacterPattern.test(character)) {
    widthRatio = wideCharacterWidthRatio;
  } else if (narrowCharacterPattern.test(character)) {
    widthRatio = narrowCharacterWidthRatio;
  } else if (broadCharacterPattern.test(character)) {
    widthRatio = broadCharacterWidthRatio;
  } else if (punctuationPattern.test(character)) {
    widthRatio = punctuationWidthRatio;
  }
  return Math.max(
    run.fontSize * minimumCharacterWidthRatio,
    run.fontSize * widthRatio,
  );
}

function letterSpacingAdvance(text: string, run: CanvasTextRunV1): number {
  return Math.max(0, graphemes(text).length - 1) * run.letterSpacing;
}

const fallbackCanvasTextMeasureV1: CanvasTextMeasureV1 = (text, run) =>
  Math.max(
    0,
    graphemes(text).reduce(
      (width, character) => width + fallbackCharacterAdvance(character, run),
      0,
    ) + letterSpacingAdvance(text, run),
  );

function cssFontFamily(family: string): string {
  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function canvasTextFontShorthandV1(run: CanvasTextRunV1): string {
  return `${run.fontStyle} ${String(run.fontWeight)} ${String(
    run.fontSize,
  )}px ${cssFontFamily(run.font.family)}`;
}

export function canvasTextMeasureFromContextV1(
  context: CanvasTextMeasurementContextV1,
): CanvasTextMeasureV1 {
  return (text, run) => {
    context.font = canvasTextFontShorthandV1(run);
    return Math.max(
      0,
      context.measureText(text).width + letterSpacingAdvance(text, run),
    );
  };
}

let browserMeasurement: CanvasTextMeasureV1 | undefined;

export const browserCanvasTextMeasureV1: CanvasTextMeasureV1 = (text, run) => {
  if (!browserMeasurement && typeof document !== "undefined") {
    const context = document.createElement("canvas").getContext("2d");
    if (context) browserMeasurement = canvasTextMeasureFromContextV1(context);
  }
  return browserMeasurement
    ? browserMeasurement(text, run)
    : fallbackCanvasTextMeasureV1(text, run);
};

export function canvasTextFontLoadRequestsV1(
  node: EditorTextNodeV1,
): readonly CanvasTextFontLoadRequestV1[] {
  const textByFont = new Map<string, string>();
  for (const paragraph of node.content.paragraphs) {
    for (const run of paragraph.runs) {
      const font = canvasTextFontShorthandV1(run);
      textByFont.set(font, `${textByFont.get(font) ?? ""}${run.text}`);
    }
  }
  return [...textByFont].map(([font, text]) => ({
    font,
    text: text || fallbackFontLoadText,
  }));
}

export function watchCanvasTextFontsV1(
  fonts: Pick<FontFaceSet, "addEventListener" | "load" | "removeEventListener">,
  requests: readonly CanvasTextFontLoadRequestV1[],
  onMetricsChange: () => void,
): () => void {
  let disposed = false;
  const notify = (): void => {
    if (!disposed) onMetricsChange();
  };
  fonts.addEventListener("loadingdone", notify);
  fonts.addEventListener("loadingerror", notify);
  void Promise.allSettled(
    requests.map((request) => fonts.load(request.font, request.text)),
  ).then(notify);
  return () => {
    disposed = true;
    fonts.removeEventListener("loadingdone", notify);
    fonts.removeEventListener("loadingerror", notify);
  };
}

function tokensForRun(
  run: CanvasTextRunV1,
  runIndex: number,
): readonly TextToken[] {
  const tokens: TextToken[] = [];
  let kind: "content" | "space" | undefined;
  let text = "";
  const flush = (): void => {
    if (!kind || !text) return;
    tokens.push({ kind, run, runIndex, text });
    kind = undefined;
    text = "";
  };
  for (const character of graphemes(run.text.replaceAll(/\r\n?/gu, "\n"))) {
    if (character === "\n") {
      flush();
      tokens.push({ kind: "break", run, runIndex, text: "" });
      continue;
    }
    if (wideCharacterPattern.test(character)) {
      flush();
      tokens.push({ kind: "content", run, runIndex, text: character });
      continue;
    }
    const nextKind = /\s/u.test(character) ? "space" : "content";
    if (kind !== nextKind) flush();
    kind = nextKind;
    text += character;
  }
  flush();
  return tokens;
}

function trimTrailingWhitespace(
  fragments: readonly TextFragment[],
): readonly TextFragment[] {
  const next = [...fragments];
  while (next.length > 0) {
    const last = next.at(-1)!;
    const text = last.text.replace(/\s+$/u, "");
    if (text === last.text) break;
    if (text) {
      next[next.length - 1] = { ...last, text };
      break;
    }
    next.pop();
  }
  return next;
}

function wrappedParagraphLines(
  paragraph: TextParagraph,
  maximumWidth: number,
  measureText: CanvasTextMeasureV1,
): readonly TextParagraph[] {
  const lines: (readonly TextFragment[])[] = [];
  let fragments: TextFragment[] = [];
  let width = 0;
  let preserveLeadingWhitespace = true;
  let endedWithBreak = false;
  const appendedWidth = (
    run: CanvasTextRunV1,
    runIndex: number,
    text: string,
  ): number => {
    const previous = fragments.at(-1);
    return previous?.runIndex === runIndex
      ? width -
          measureText(previous.text, previous.run) +
          measureText(previous.text + text, run)
      : width + measureText(text, run);
  };
  const append = (
    run: CanvasTextRunV1,
    runIndex: number,
    text: string,
  ): void => {
    width = appendedWidth(run, runIndex, text);
    const previous = fragments.at(-1);
    if (previous?.runIndex === runIndex) {
      fragments[fragments.length - 1] = {
        ...previous,
        text: previous.text + text,
      };
    } else {
      fragments.push({ run, runIndex, text });
    }
    preserveLeadingWhitespace = false;
    endedWithBreak = false;
  };
  const finish = (force: boolean, keepLeadingWhitespace: boolean): void => {
    const line = trimTrailingWhitespace(fragments);
    if (force || line.length > 0) lines.push(line);
    fragments = [];
    width = 0;
    preserveLeadingWhitespace = keepLeadingWhitespace;
  };

  for (const [runIndex, run] of paragraph.runs.entries()) {
    for (const token of tokensForRun(run, runIndex)) {
      if (token.kind === "break") {
        finish(true, true);
        endedWithBreak = true;
        continue;
      }
      if (token.kind === "space") {
        if (fragments.length === 0 && !preserveLeadingWhitespace) continue;
        if (
          appendedWidth(token.run, token.runIndex, token.text) > maximumWidth &&
          fragments.length > 0
        ) {
          finish(false, false);
          continue;
        }
        append(token.run, token.runIndex, token.text);
        continue;
      }
      if (measureText(token.text, token.run) <= maximumWidth) {
        if (
          appendedWidth(token.run, token.runIndex, token.text) > maximumWidth &&
          fragments.length > 0
        ) {
          finish(false, false);
        }
        append(token.run, token.runIndex, token.text);
        continue;
      }
      for (const character of graphemes(token.text)) {
        if (
          appendedWidth(token.run, token.runIndex, character) > maximumWidth &&
          fragments.length > 0
        ) {
          finish(false, false);
        }
        append(token.run, token.runIndex, character);
      }
    }
  }
  finish(lines.length === 0 || fragments.length > 0 || endedWithBreak, true);

  const templateRun = paragraph.runs[0]!;
  return lines.map((line, index) => ({
    ...paragraph,
    spaceBefore: index === 0 ? paragraph.spaceBefore : 0,
    spaceAfter: index === lines.length - 1 ? paragraph.spaceAfter : 0,
    runs:
      line.length > 0
        ? line.map((fragment) => ({
            ...fragment.run,
            text: fragment.text,
          }))
        : [{ ...templateRun, text: "" }],
  }));
}

function paragraphHeight(paragraph: TextParagraph): number {
  return Math.max(
    ...paragraph.runs.map((run) => run.fontSize * paragraph.lineHeight),
  );
}

function visualParagraphs(
  node: EditorTextNodeV1,
  measureText: CanvasTextMeasureV1,
): readonly TextParagraph[] {
  const wrapsInsideBox =
    node.content.resizeMode !== "auto_width" &&
    !node.effects.some((candidate) => candidate.kind === "curve");
  const maximumWidth = wrapsInsideBox
    ? node.transform.width
    : Number.POSITIVE_INFINITY;
  return node.content.paragraphs.flatMap((paragraph) =>
    wrappedParagraphLines(paragraph, maximumWidth, measureText),
  );
}

export function canvasTextParagraphLayoutV1(
  node: EditorTextNodeV1,
  measureText: CanvasTextMeasureV1 = fallbackCanvasTextMeasureV1,
): readonly CanvasTextParagraphLayoutV1[] {
  const paragraphs = visualParagraphs(node, measureText);
  const heights = paragraphs.map(
    (paragraph) =>
      paragraphHeight(paragraph) + paragraph.spaceBefore + paragraph.spaceAfter,
  );
  const totalHeight = heights.reduce((total, height) => total + height, 0);
  const availableHeight = node.transform.height;
  let cursor = 0;
  if (node.content.verticalAlign === "middle") {
    cursor = Math.max(0, (availableHeight - totalHeight) / 2);
  } else if (node.content.verticalAlign === "bottom") {
    cursor = Math.max(0, availableHeight - totalHeight);
  }

  return paragraphs.map((paragraph): CanvasTextParagraphLayoutV1 => {
    cursor += paragraph.spaceBefore;
    const lineHeight = paragraphHeight(paragraph);
    const baseline =
      cursor + Math.max(...paragraph.runs.map((run) => run.fontSize));
    const layout = { paragraph, baseline, height: lineHeight };
    cursor += lineHeight + paragraph.spaceAfter;
    return layout;
  });
}

export function canvasTextEditorVerticalOffsetV1(
  node: EditorTextNodeV1,
  measureText: CanvasTextMeasureV1 = fallbackCanvasTextMeasureV1,
): number {
  const firstLayout = canvasTextParagraphLayoutV1(node, measureText)[0];
  if (!firstLayout) return 0;
  const maximumFontSize = Math.max(
    ...firstLayout.paragraph.runs.map((run) => run.fontSize),
  );
  return Math.max(0, firstLayout.baseline - maximumFontSize);
}
