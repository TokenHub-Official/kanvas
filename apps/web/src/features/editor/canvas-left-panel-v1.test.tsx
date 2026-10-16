import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import {
  CanvasLeftPanelV1,
  canvasArtTextInsertionOptionsV1,
  canvasShapeCategoryLabelV1,
  canvasShapeCategoriesV1,
  canvasShapesForCategoryV1,
  searchCanvasMaterialsV1,
  searchCanvasTextCatalogV1,
} from "./canvas-left-panel-v1.js";

const callbacks = {
  onActiveChange: vi.fn(),
  onBackgroundColor: vi.fn(),
  onBackgroundColorPreview: vi.fn(),
  onBackgroundGradient: vi.fn(),
  onBackgroundGradientPreview: vi.fn(),
  onBackgroundImageFocalPointPreview: vi.fn(),
  onBackgroundImageFit: vi.fn(),
  onBackgroundImageOpacityPreview: vi.fn(),
  onBackgroundPreviewCommit: vi.fn(),
  onBackgroundTransparent: vi.fn(),
  onBrushSettingsChange: vi.fn(),
  onBrowseBackgroundImages: vi.fn(),
  onConvertBackgroundImage: vi.fn(),
  onInsertFrame: vi.fn(),
  onInsertGraphic: vi.fn(),
  onInsertGrid: vi.fn(),
  onInsertLine: vi.fn(),
  onInsertNote: vi.fn(),
  onInsertShape: vi.fn(),
  onInsertText: vi.fn(),
  onCatalogDragEnd: vi.fn(),
  onCatalogDragStart: vi.fn(),
  onAssetDragEnd: vi.fn(),
  onAssetDragStart: vi.fn(),
  onCancelUpload: vi.fn(),
  onOperation: vi.fn(),
  onPickAssets: vi.fn(() =>
    Promise.resolve({
      failed: [],
      succeededIds: [],
    }),
  ),
  onResizePage: vi.fn(),
  onRenamePage: vi.fn(),
  onQuickToolChange: vi.fn(),
  onRetryUpload: vi.fn(),
  onSelectUpload: vi.fn(),
  onUploadFiles: vi.fn(),
  onUseSelectedImageAsBackground: vi.fn(),
};

function renderPanel(
  active: "design" | "materials" | "text" | "tools",
  options?: {
    readonly imageBackground?: {
      readonly fit: "contain" | "cover" | "fill";
      readonly focalPoint: {
        readonly x: number;
        readonly y: number;
      };
      readonly opacity: number;
    };
  },
): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <CanvasLeftPanelV1
          active={active}
          activeQuickTool="select"
          backgroundTransparent
          canEdit
          brushSettings={{
            color: "#3048f5",
            opacity: 1,
            presetId: "fine",
            width: 3,
          }}
          documentColors={["#3048f5"]}
          documentTextStyles={[]}
          height={1080}
          importing={false}
          {...callbacks}
          {...(options?.imageBackground
            ? { imageBackground: options.imageBackground }
            : {})}
          selectedImageAvailable={false}
          uploadItems={[]}
          pageName="页面 1"
          width={1080}
          workspaceId="01K00000000000000000000000"
        />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

function renderImageEditorPanel(): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <CanvasLeftPanelV1
          activeQuickTool="select"
          backgroundTransparent
          canEdit
          brushSettings={{
            color: "#3048f5",
            opacity: 1,
            presetId: "fine",
            width: 3,
          }}
          documentColors={["#3048f5"]}
          documentTextStyles={[]}
          height={1080}
          taskPanel={{
            accessibleLabel: "图片编辑任务",
            content: <div>图片工具首页</div>,
            onBack: vi.fn(),
            onClose: vi.fn(),
            title: "编辑图片",
          }}
          importing={false}
          {...callbacks}
          selectedImageAvailable={false}
          uploadItems={[]}
          pageName="页面 1"
          width={1080}
          workspaceId="01K00000000000000000000000"
        />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe("CanvasLeftPanelV1", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("searches every material catalog instead of leaving unfiltered sections", () => {
    const arrow = searchCanvasMaterialsV1("箭头");
    expect(arrow.lines.map((item) => item.label)).toContain("箭头");
    expect(arrow.shapes.some((item) => item.label.includes("箭头"))).toBe(true);
    expect(arrow.frames).toHaveLength(0);
    expect(arrow.grids).toHaveLength(0);
  });

  it("uses every catalog shape category and defaults category filtering without weakening search", () => {
    expect(canvasShapeCategoriesV1.map(([id]) => id)).toEqual([
      "basic",
      "arrows",
      "decorative",
      "callouts",
      "flowchart",
    ]);
    expect(
      canvasShapesForCategoryV1("basic", "").every(
        (shape) => shape.category === "basic",
      ),
    ).toBe(true);
    expect(
      new Set(
        canvasShapesForCategoryV1("basic", "箭头").map(
          (shape) => shape.category,
        ),
      ),
    ).toContain("arrows");
    expect(canvasShapeCategoryLabelV1("flowchart")).toBe("流程图");
  });

  it("returns both art text and font results from one text search", () => {
    expect(
      searchCanvasTextCatalogV1("思源").fonts.map((font) => font.label),
    ).toEqual(["思源黑体", "思源宋体"]);
    expect(
      searchCanvasTextCatalogV1("描边").presets.map((preset) => preset.label),
    ).toContain("醒目描边");
  });

  it("keeps the fixed capability order and opens materials on reusable images", () => {
    const markup = renderPanel("materials");
    const labels = ["页面", "素材", "文字", "品牌", "绘制"];

    for (const [index, label] of labels.entries()) {
      const position = markup.indexOf(`>${label}</span>`);
      expect(position).toBeGreaterThan(
        index === 0 ? -1 : markup.indexOf(`>${labels[index - 1]}</span>`),
      );
    }
    expect(markup).toContain('aria-label="素材类型"');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab" aria-selected="true"');
    expect(markup).toContain('aria-label="图片来源"');
    expect(markup).toContain('aria-label="素材范围"');
    expect(markup).toContain("ant-tabs");
    expect(markup).toContain("ant-select-filled");
    expect(markup).not.toContain('class="flex justify-start"');
    expect(markup).toContain("ant-input-filled");
    expect(markup).toContain("资产库");
    expect(markup).not.toContain("点击素材时");
    expect(markup).not.toContain("拖入图片，立即放到画板");
    expect(markup).toContain("形状");
    expect(markup).toContain("相框");
    expect(markup).toContain("网格");
    expect(markup).not.toContain('draggable="true"');
  });

  it("opens tools as a compact quick palette instead of a full sidebar panel", () => {
    const markup = renderPanel("tools");

    expect(markup).toContain('aria-label="快速工具"');
    for (const label of ["选择", "画笔", "形状", "线条", "便签", "文字"]) {
      expect(markup).toContain(`>${label}</span>`);
    }
    expect(markup).toContain('aria-label="绘制"');
    expect(markup).not.toContain('class="canvas-v1-panel"');
    expect(markup).not.toContain("画框");
    expect(markup).not.toContain("网格");
  });

  it("hosts image editing in the left task lane with back and close actions", () => {
    const markup = renderImageEditorPanel();

    expect(markup).toContain('aria-label="图片编辑任务"');
    expect(markup).toContain("图片工具首页");
    expect(markup).toContain('aria-label="返回图片编辑"');
    expect(markup).toContain('aria-label="关闭面板"');
    expect(markup).toContain("max-w-80");
    expect(markup).toContain("overflow-x-hidden");
    expect(markup).not.toContain("canvas-v1-inspector");
  });

  it("keeps text creation ahead of drill-in catalogs", () => {
    const markup = renderPanel("text");

    expect(markup).toContain("添加标题");
    expect(markup).toContain("添加副标题");
    expect(markup).toContain("添加正文");
    expect(markup).toContain("艺术字");
    expect(markup).toContain("字体");
    expect(markup).not.toContain("可编辑内容与效果");
    expect(
      canvasArtTextInsertionOptionsV1("text.outline-bold").editImmediately,
    ).toBe(true);
  });

  it("keeps upload and reusable-library entrypoints in one panel", () => {
    const markup = renderPanel("materials");

    expect(markup).toContain("上传");
    expect(markup).toContain("资产库");
    expect(markup.indexOf("资产库")).toBeGreaterThan(markup.indexOf("上传"));
  });

  it("renders the rail and material sources from English JSON", async () => {
    await i18n.changeLanguage("en-US");
    const markup = renderPanel("materials");

    expect(markup).toContain("Board tools");
    expect(markup).toContain("Assets");
    expect(markup).toContain("Asset library");
    expect(markup).toContain("Images");

    await i18n.changeLanguage("zh-CN");
  });

  it("uses a shared background color trigger instead of the browser picker", () => {
    const markup = renderPanel("design");

    expect(markup).toContain('aria-label="背景类型"');
    expect(markup).toContain("ant-tabs");
    expect(markup).toContain('data-node-key="color"');
    expect(markup).toContain("颜色");
    expect(markup).toContain("渐变");
    expect(markup).toContain("图片");
    expect(markup).toContain("添加自定义颜色");
    expect(markup).toContain('aria-label="透明背景"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup.indexOf('aria-label="透明背景"')).toBeLessThan(
      markup.indexOf('aria-label="背景颜色 #ffffff"'),
    );
    expect(markup).not.toContain('type="color"');
  });

  it("opens the image inspector when an image becomes the page background", () => {
    const markup = renderPanel("design", {
      imageBackground: {
        fit: "cover",
        focalPoint: {
          x: 0.5,
          y: 0.5,
        },
        opacity: 1,
      },
    });

    expect(markup).toContain('data-node-key="image"');
    expect(markup).toContain('aria-label="背景图片适配方式"');
    expect(markup).toContain("背景图片");
    expect(markup).toContain("当前图片背景");
    expect(markup).toContain("已同步到画板");
    expect(markup).toContain('aria-label="透明度"');
    expect(markup).toContain("图片焦点");
  });
});
