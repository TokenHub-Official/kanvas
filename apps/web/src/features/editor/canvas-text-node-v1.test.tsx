import type { EditorTextNodeV1 } from "@kanvas/contracts/editor";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CanvasTextNodeV1,
  canvasTextEditorVerticalOffsetV1,
  canvasTextFontLoadRequestsV1,
  canvasTextFontShorthandV1,
  canvasTextMeasureFromContextV1,
  canvasTextParagraphLayoutV1,
  watchCanvasTextFontsV1,
  type CanvasTextMeasureV1,
} from "./canvas-text-node-v1.js";

function testCanvasTextMeasure(): CanvasTextMeasureV1 {
  return (text, run) =>
    [...text].reduce(
      (width, character) =>
        width +
        (/[\p{Script=Han}\p{Punctuation}]/u.test(character)
          ? run.fontSize
          : run.fontSize * 0.6),
      0,
    ) +
    Math.max(0, [...text].length - 1) * run.letterSpacing;
}

const node: EditorTextNodeV1 = {
  id: "text:hero",
  name: "艺术标题",
  kind: "text",
  transform: {
    x: 120,
    y: 200,
    width: 720,
    height: 240,
    rotation: -4,
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
        align: "center",
        direction: "auto",
        lineHeight: 1.1,
        spaceBefore: 0,
        spaceAfter: 0,
        runs: [
          {
            text: "夏日",
            font: {
              source: "builtin",
              fontId: "noto-sans-sc",
              family: "Noto Sans SC",
              revision: "google-fonts-2026-07-31",
            },
            fontSize: 88,
            fontWeight: 900,
            fontStyle: "normal",
            letterSpacing: 2,
            fill: {
              kind: "linear_gradient",
              angle: 0,
              stops: [
                {
                  color: "#ff2f70",
                  offset: 0,
                },
                {
                  color: "#ffb52f",
                  offset: 1,
                },
              ],
            },
            decoration: {
              underline: false,
              strikeThrough: false,
            },
          },
          {
            text: "上新",
            font: {
              source: "builtin",
              fontId: "zcool-kuaile",
              family: "ZCOOL KuaiLe",
              revision: "google-fonts-2026-07-31",
            },
            fontSize: 88,
            fontWeight: 400,
            fontStyle: "normal",
            letterSpacing: 2,
            fill: {
              kind: "solid",
              color: "#ffffff",
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
    resizeMode: "auto_height",
  },
  effects: [
    {
      kind: "outline",
      color: "#151515",
      width: 6,
    },
    {
      kind: "glow",
      color: "#ff2f70",
      blur: 24,
      opacity: 0.8,
    },
    {
      kind: "offset_layers",
      layers: [
        {
          color: "#24d7ff",
          offsetX: 8,
          offsetY: 8,
          opacity: 0.8,
        },
      ],
    },
    {
      kind: "curve",
      amount: 0.35,
    },
    {
      kind: "skew",
      x: -8,
      y: 0,
    },
  ],
};

describe("CanvasTextNodeV1", () => {
  it("uses the full text box as a pointer hit target for inline editing", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasTextNodeV1 node={node} />
      </svg>,
    );

    expect(markup).toContain('class="canvas-v1-text-hit-target"');
    expect(markup).toContain('pointer-events="all"');
  });

  it("lays out paragraphs using the text box vertical alignment", () => {
    const [layout] = canvasTextParagraphLayoutV1(node);

    expect(layout?.baseline).toBeGreaterThan(88);
    expect(layout?.baseline).toBeLessThan(node.transform.height);
  });

  it("preserves explicit breaks and wraps long copy inside the text box", () => {
    const text =
      "各位小伙伴：\n正如蓝蝶破茧展翅，我们的团队也一直在蜕变中积蓄力量。";
    const wrapped: EditorTextNodeV1 = {
      ...node,
      effects: [],
      transform: { ...node.transform, width: 168, height: 480 },
      content: {
        ...node.content,
        resizeMode: "fixed",
        verticalAlign: "top",
        paragraphs: [
          {
            ...node.content.paragraphs[0]!,
            align: "left",
            runs: [
              {
                ...node.content.paragraphs[0]!.runs[0]!,
                fontSize: 24,
                letterSpacing: 0,
                text,
              },
            ],
          },
        ],
      },
    };

    const layouts = canvasTextParagraphLayoutV1(
      wrapped,
      testCanvasTextMeasure(),
    );
    expect(layouts.length).toBeGreaterThan(4);
    expect(
      layouts
        .flatMap((layout) => layout.paragraph.runs)
        .map((run) => run.text)
        .join(""),
    ).toBe(text.replace("\n", ""));
    expect(layouts[0]?.baseline).toBe(24);
    for (let index = 1; index < layouts.length; index += 1) {
      expect(
        layouts[index]!.baseline - layouts[index - 1]!.baseline,
      ).toBeCloseTo(26.4);
    }

    const markup = renderToStaticMarkup(
      <svg>
        <CanvasTextNodeV1 node={wrapped} />
      </svg>,
    );
    expect(markup.match(/<text /gu)).toHaveLength(layouts.length);
    expect(markup).not.toContain(text);

    const withTrailingBreak = {
      ...wrapped,
      content: {
        ...wrapped.content,
        paragraphs: [
          {
            ...wrapped.content.paragraphs[0]!,
            runs: [
              { ...wrapped.content.paragraphs[0]!.runs[0]!, text: "第一行\n" },
            ],
          },
        ],
      },
    };
    expect(
      canvasTextParagraphLayoutV1(
        withTrailingBreak,
        testCanvasTextMeasure(),
      ).map((layout) => layout.paragraph.runs[0]?.text),
    ).toEqual(["第一行", ""]);
  });

  it.each([
    {
      fontSize: 24,
      height: 180,
      text: "各位小伙伴：\n正如蓝蝶破茧展翅、焕发纯粹而明亮的光芒，我们的团队也一直在蜕变中积蓄力量。本次内部开放日诚挚邀请大家走出日常工位，一起近距离感受团队的创新成果与日常背后的专注沉淀。现场将设置【具体活动安排】，期待与每一位并肩作战的你相聚，共同开启一段清晰、充满生机的美好时光！",
    },
    {
      fontSize: 22,
      height: 280,
      text: "【活动信息与报名】\n• 活动时间：【日期待定】\n• 活动地点：【地点待定】\n• 报名信息：\n  1. 姓名及工号：[请填写姓名 / 工号]\n  2. 所属部门：[请填写所属团队 / 部门]\n  3. 活动意向与场次：[活动日期与时间待定 / 具体地点待定]",
    },
  ])(
    "fits Agent-authored multiline copy inside a 960 × $height text box",
    ({ fontSize, height, text }) => {
      const paragraph = node.content.paragraphs[0]!;
      const copy: EditorTextNodeV1 = {
        ...node,
        effects: [],
        transform: { ...node.transform, width: 960, height },
        content: {
          ...node.content,
          resizeMode: "fixed",
          verticalAlign: "top",
          paragraphs: [
            {
              ...paragraph,
              align: "left",
              lineHeight: 1.2,
              runs: [
                {
                  ...paragraph.runs[0]!,
                  fontSize,
                  letterSpacing: 0,
                  text,
                },
              ],
            },
          ],
        },
      };

      const layouts = canvasTextParagraphLayoutV1(
        copy,
        testCanvasTextMeasure(),
      );
      expect(layouts.length).toBeGreaterThanOrEqual(text.split("\n").length);
      const finalLine = layouts.at(-1)!;
      expect(
        finalLine.baseline + finalLine.height - fontSize,
      ).toBeLessThanOrEqual(height);
    },
  );

  it("uses measured full-width punctuation and bold Latin advances at wrap boundaries", () => {
    const measuredFonts: string[] = [];
    const context = {
      font: "",
      measureText: vi.fn((text: string) => {
        measuredFonts.push(context.font);
        const bold = context.font.includes(" 700 ");
        return {
          width: [...text].reduce((width, character) => {
            let advance = bold ? 11 : 9;
            if (character === "【" || character === "】") advance = 12;
            return width + advance;
          }, 0),
        };
      }),
    };
    const measure = canvasTextMeasureFromContextV1(context);
    const paragraph = node.content.paragraphs[0]!;
    const run = {
      ...paragraph.runs[0]!,
      fontSize: 24,
      fontWeight: 400,
      letterSpacing: 0,
    };
    const textNode = (text: string, fontWeight: number, width: number) => ({
      ...node,
      effects: [],
      transform: { ...node.transform, width },
      content: {
        ...node.content,
        resizeMode: "fixed" as const,
        verticalAlign: "top" as const,
        paragraphs: [
          {
            ...paragraph,
            align: "left" as const,
            runs: [{ ...run, fontWeight, text }],
          },
        ],
      },
    });

    const punctuationLines = canvasTextParagraphLayoutV1(
      textNode("A【B】", 400, 36),
      measure,
    );
    expect(
      punctuationLines.map((layout) =>
        layout.paragraph.runs.map((candidate) => candidate.text).join(""),
      ),
    ).toEqual(["A【B", "】"]);

    expect(
      canvasTextParagraphLayoutV1(textNode("WIDE", 400, 40), measure),
    ).toHaveLength(1);
    expect(
      canvasTextParagraphLayoutV1(textNode("WIDE", 700, 40), measure),
    ).toHaveLength(2);
    expect(canvasTextFontShorthandV1({ ...run, fontWeight: 700 })).toBe(
      'normal 700 24px "Noto Sans SC"',
    );
    expect(measuredFonts).toContain('normal 700 24px "Noto Sans SC"');
  });

  it("requests its exact fonts and refreshes layout when metrics settle", async () => {
    const requests = canvasTextFontLoadRequestsV1(node);
    expect(requests).toEqual([
      {
        font: 'normal 900 88px "Noto Sans SC"',
        text: "夏日",
      },
      {
        font: 'normal 400 88px "ZCOOL KuaiLe"',
        text: "上新",
      },
    ]);

    const listeners = new Map<string, EventListenerOrEventListenerObject>();
    const fontSet = {
      addEventListener: vi.fn(
        (type: string, listener: EventListenerOrEventListenerObject) => {
          listeners.set(type, listener);
        },
      ),
      load: vi.fn(() => Promise.resolve([])),
      removeEventListener: vi.fn(),
    } as unknown as Pick<
      FontFaceSet,
      "addEventListener" | "load" | "removeEventListener"
    >;
    const refresh = vi.fn();
    const stop = watchCanvasTextFontsV1(fontSet, requests, refresh);

    await Promise.resolve();
    await Promise.resolve();
    expect(fontSet.load).toHaveBeenCalledWith(
      'normal 900 88px "Noto Sans SC"',
      "夏日",
    );
    expect(refresh).toHaveBeenCalledOnce();

    const loadingDone = listeners.get("loadingdone");
    if (typeof loadingDone === "function")
      loadingDone(new Event("loadingdone"));
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    if (typeof loadingDone === "function")
      loadingDone(new Event("loadingdone"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("shares the SVG vertical offset with the inline text editor", () => {
    expect(canvasTextEditorVerticalOffsetV1(node)).toBeCloseTo(71.6);
    expect(
      canvasTextEditorVerticalOffsetV1({
        ...node,
        content: {
          ...node.content,
          verticalAlign: "top",
        },
      }),
    ).toBe(0);
  });

  it("renders editable rich text and artistic effects as SVG", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasTextNodeV1 node={node} />
      </svg>,
    );

    expect(markup).toContain('data-node-id="text:hero"');
    expect(markup).toContain("Noto Sans SC");
    expect(markup).toContain("ZCOOL KuaiLe");
    expect(markup).toContain("<linearGradient");
    expect(markup).toContain("<textPath");
    expect(markup).toContain("<feDropShadow");
    expect(markup).toContain('stroke="#151515"');
    expect(markup).toContain("skewX(-8)");
    expect(markup).toContain(">夏日</tspan>");
    expect(markup).toContain(">上新</tspan>");
  });

  it("does not rasterize text into an image", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasTextNodeV1 node={node} />
      </svg>,
    );

    expect(markup).not.toContain("<image");
    expect(markup).not.toContain("data:image");
  });

  it("hides SVG text visuals while the native editor owns the caret", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasTextNodeV1 editing node={node} />
      </svg>,
    );

    expect(markup).toContain('data-text-visuals="" opacity="0"');
    expect(markup).toContain('class="canvas-v1-text-hit-target"');
  });
});
