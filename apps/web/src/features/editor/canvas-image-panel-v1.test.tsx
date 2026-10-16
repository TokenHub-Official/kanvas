import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { CanvasImagePanelV1 } from "./canvas-image-panel-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const imageNode = {
  id: "image:1",
  kind: "image",
  name: "Image",
  opacity: 1,
  blendMode: "normal",
  locked: false,
  visible: true,
  transform: {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    flipX: false,
    flipY: false,
    rotation: 0,
  },
  cornerRadius: 0,
  image: {
    source: {
      kind: "local",
      localId: "local:1",
      mediaType: "image/png",
      name: "image.png",
      previewUrl: "blob:image",
      size: 100,
      uploadState: "uploading",
    },
    intrinsicWidth: 800,
    intrinsicHeight: 600,
    crop: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
    fit: "contain",
    focalPoint: { x: 0.5, y: 0.5 },
  },
} as const satisfies Extract<EditorRuntimeNodeV1, { kind: "image" }>;

function renderPanel(view: "adjust" | "crop" | "filters" | "home") {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <CanvasImagePanelV1
        cropMode="free"
        disabled={false}
        node={imageNode}
        onCancelCrop={vi.fn()}
        onCommit={vi.fn()}
        onConfirmCrop={vi.fn()}
        onCropModeChange={vi.fn()}
        onPreview={vi.fn()}
        onReplace={vi.fn()}
        onRestoreCrop={vi.fn()}
        onTool={vi.fn()}
        onViewChange={vi.fn()}
        previewUrl="https://example.com/image.png"
        tools={[
          {
            active: false,
            disabled: false,
            id: "remove-background",
            interactionBehavior: "direct",
            label: "去背景",
          },
        ]}
        view={view}
      />
    </I18nextProvider>,
  );
}

describe("CanvasImagePanelV1", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("starts from intent-led tools instead of a slider wall", () => {
    const markup = renderPanel("home");

    expect(markup).toContain("工具");
    expect(markup).toContain("调整");
    expect(markup).toContain("滤镜");
    expect(markup).toContain("风格");
    expect(markup).toContain("裁切");
    expect(markup).toContain("去背景");
    expect(markup).not.toContain('role="slider"');
    expect(markup).toContain("size-12");
    expect(markup).toContain("grid-cols-[repeat(4,minmax(0,1fr))]");
    expect(markup).toContain("查看全部");
    expect(markup).toContain("自然");
    expect(markup).toContain("复古");
    expect(markup).not.toContain('type="default"');
  });

  it("drills into grouped adjustments with named sliders and numeric fields", () => {
    const markup = renderPanel("adjust");

    expect(markup).toContain("光线");
    expect(markup).toContain("色彩");
    expect(markup).toContain("细节");
    expect(markup).toContain('aria-label="亮度"');
    expect(markup).toContain('role="slider"');
    expect(markup).toContain('role="spinbutton"');
    expect(markup).toContain("重置全部调整");
    expect(markup).not.toContain("AI 工具");
  });

  it("treats crop as one direct-manipulation task with confirm and cancel", () => {
    const markup = renderPanel("crop");

    expect(markup).toContain("拖动裁切框调整取景位置");
    expect(markup).toContain("裁切框比例");
    expect(markup).toContain("自由裁切");
    expect(markup).toContain("原图");
    expect(markup).toContain("1:1");
    expect(markup).not.toContain("内容缩放");
    expect(markup).not.toContain("水平位置");
    expect(markup).not.toContain("垂直位置");
    expect(markup).toContain("旋转");
    expect(markup).toContain("恢复进入裁切前");
    expect(markup).toContain("取 消");
    expect(markup).toContain("完成裁切");
    expect(markup).not.toContain("图片适配");
    expect(markup).not.toContain("扩图");
  });
});
