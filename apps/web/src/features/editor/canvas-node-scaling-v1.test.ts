import type { EditorTextNodeV1 } from "@kanvas/contracts/editor";
import { describe, expect, it } from "vitest";

import {
  canvasResizeScalesVisualMetricsV1,
  scaleCanvasNodeVisualsV1,
} from "./canvas-node-scaling-v1.js";

const textNode: EditorTextNodeV1 = {
  id: "text-1",
  name: "Text",
  kind: "text",
  transform: {
    x: 10,
    y: 20,
    width: 200,
    height: 80,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  content: {
    paragraphs: [
      {
        align: "left",
        direction: "auto",
        lineHeight: 1.2,
        spaceBefore: 4,
        spaceAfter: 6,
        runs: [
          {
            text: "Scale me",
            font: {
              source: "builtin",
              fontId: "noto-sans-sc",
              family: "Noto Sans SC",
              revision: "google-fonts-2026-07-31",
            },
            fontSize: 32,
            fontWeight: 600,
            fontStyle: "normal",
            letterSpacing: 2,
            fill: { kind: "solid", color: "#151515" },
            decoration: { underline: false, strikeThrough: false },
          },
        ],
      },
    ],
    verticalAlign: "middle",
    resizeMode: "fixed",
  },
  effects: [
    {
      kind: "shadow",
      color: "#151515",
      blur: 8,
      offsetX: 4,
      offsetY: 6,
      opacity: 0.5,
    },
  ],
};

describe("Canvas node visual scaling", () => {
  it("reserves visual-metric scaling for corner gestures", () => {
    expect(canvasResizeScalesVisualMetricsV1(2, 1)).toBe(false);
    expect(canvasResizeScalesVisualMetricsV1(1, 2)).toBe(false);
    expect(canvasResizeScalesVisualMetricsV1(2, 2)).toBe(true);
  });

  it("scales text metrics and effects with a corner resize", () => {
    const scaled = scaleCanvasNodeVisualsV1(textNode, 2, 2);

    expect(scaled).toMatchObject({
      kind: "text",
      content: {
        paragraphs: [
          {
            spaceBefore: 8,
            spaceAfter: 12,
            runs: [{ fontSize: 64, letterSpacing: 4 }],
          },
        ],
      },
      effects: [{ kind: "shadow", blur: 16, offsetX: 8, offsetY: 12 }],
    });
  });
});
