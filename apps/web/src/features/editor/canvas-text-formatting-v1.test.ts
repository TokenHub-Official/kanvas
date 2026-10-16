import { describe, expect, it } from "vitest";

import {
  canvasTextFormattingV1,
  canvasTextAlignmentOptionsV1,
  updateCanvasTextEffectV1,
  updateCanvasTextParagraphsV1,
  updateCanvasTextRunsV1,
  updateCanvasTextVerticalAlignV1,
  type CanvasTextNodeV1,
} from "./canvas-text-formatting-v1.js";

function textNode(): CanvasTextNodeV1 {
  return {
    id: "text-1",
    kind: "text",
    name: "Text",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: {
      x: 0,
      y: 0,
      width: 300,
      height: 120,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    content: {
      paragraphs: [
        {
          align: "left",
          direction: "auto",
          lineHeight: 1.2,
          spaceBefore: 0,
          spaceAfter: 0,
          runs: [
            {
              text: "First",
              font: {
                source: "builtin",
                fontId: "inter",
                family: "Inter",
              },
              fontSize: 32,
              fontWeight: 400,
              fontStyle: "normal",
              letterSpacing: 0,
              fill: { kind: "solid", color: "#151515" },
              decoration: {
                underline: false,
                strikeThrough: false,
              },
            },
          ],
        },
        {
          align: "left",
          direction: "auto",
          lineHeight: 1.2,
          spaceBefore: 0,
          spaceAfter: 0,
          runs: [
            {
              text: "Second",
              font: {
                source: "builtin",
                fontId: "inter",
                family: "Inter",
              },
              fontSize: 24,
              fontWeight: 400,
              fontStyle: "normal",
              letterSpacing: 0,
              fill: { kind: "solid", color: "#151515" },
              decoration: {
                underline: false,
                strikeThrough: false,
              },
            },
          ],
        },
      ],
      verticalAlign: "top",
      resizeMode: "auto_height",
    },
    effects: [],
  };
}

describe("Canvas text formatting", () => {
  it("offers every alignment as an explicit choice", () => {
    expect(canvasTextAlignmentOptionsV1.map(([value]) => value)).toEqual([
      "left",
      "center",
      "right",
      "justify",
    ]);
  });

  it("applies run formatting to every paragraph without changing content", () => {
    const updated = updateCanvasTextRunsV1(textNode(), {
      fontSize: 54,
      fontStyle: "italic",
      fontWeight: 700,
      letterSpacing: 12,
      underline: true,
      strikeThrough: true,
    });

    expect(
      updated.content.paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => ({
          text: run.text,
          fontSize: run.fontSize,
          fontStyle: run.fontStyle,
          fontWeight: run.fontWeight,
          letterSpacing: run.letterSpacing,
          decoration: run.decoration,
        })),
      ),
    ).toEqual([
      [
        {
          text: "First",
          fontSize: 54,
          fontStyle: "italic",
          fontWeight: 700,
          letterSpacing: 12,
          decoration: {
            underline: true,
            strikeThrough: true,
          },
        },
      ],
      [
        {
          text: "Second",
          fontSize: 54,
          fontStyle: "italic",
          fontWeight: 700,
          letterSpacing: 12,
          decoration: {
            underline: true,
            strikeThrough: true,
          },
        },
      ],
    ]);
  });

  it("clamps numeric run values to the editor contract", () => {
    const updated = updateCanvasTextRunsV1(textNode(), {
      fontSize: 8_000,
      fontWeight: 12,
      letterSpacing: -800,
    });
    const run = updated.content.paragraphs[0]!.runs[0]!;

    expect(run.fontSize).toBe(2_048);
    expect(run.fontWeight).toBe(100);
    expect(run.letterSpacing).toBe(-200);
  });

  it("applies paragraph spacing and alignment to every paragraph", () => {
    const updated = updateCanvasTextParagraphsV1(textNode(), {
      align: "center",
      lineHeight: 1.6,
      spaceBefore: 12,
      spaceAfter: 18,
    });

    expect(
      updated.content.paragraphs.map((paragraph) => ({
        align: paragraph.align,
        lineHeight: paragraph.lineHeight,
        spaceBefore: paragraph.spaceBefore,
        spaceAfter: paragraph.spaceAfter,
      })),
    ).toEqual([
      {
        align: "center",
        lineHeight: 1.6,
        spaceBefore: 12,
        spaceAfter: 18,
      },
      {
        align: "center",
        lineHeight: 1.6,
        spaceBefore: 12,
        spaceAfter: 18,
      },
    ]);
  });

  it("projects the current toolbar values and vertical alignment", () => {
    const updated = updateCanvasTextVerticalAlignV1(
      updateCanvasTextRunsV1(
        updateCanvasTextParagraphsV1(textNode(), {
          align: "right",
          lineHeight: 1.5,
        }),
        {
          fontSize: 48,
          underline: true,
        },
      ),
      "middle",
    );

    expect(canvasTextFormattingV1(updated)).toMatchObject({
      align: "right",
      fontSize: 48,
      lineHeight: 1.5,
      underline: true,
      verticalAlign: "middle",
    });
  });

  it("keeps independent text effects composable", () => {
    const withOutline = updateCanvasTextEffectV1(textNode(), "outline", {
      kind: "outline",
      color: "#151515",
      width: 4,
    });
    const withGlow = updateCanvasTextEffectV1(withOutline, "glow", {
      kind: "glow",
      color: "#3048f5",
      blur: 18,
      opacity: 0.65,
    });
    const withoutOutline = updateCanvasTextEffectV1(
      withGlow,
      "outline",
      undefined,
    );

    expect(withGlow.effects.map((effect) => effect.kind)).toEqual([
      "outline",
      "glow",
    ]);
    expect(withoutOutline.effects.map((effect) => effect.kind)).toEqual([
      "glow",
    ]);
  });
});
