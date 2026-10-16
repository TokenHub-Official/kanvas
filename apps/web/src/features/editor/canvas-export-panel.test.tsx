import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/i18n.js";
import { CanvasExportPanel } from "./canvas-export-panel.js";
import { canvasExportFailureMessageV1 } from "./canvas-export-feedback-v1.js";

const noop = () => undefined;
const props: ComponentProps<typeof CanvasExportPanel> = {
  activePageId: "page",
  canDownload: true,
  canExport: true,
  canViewAssets: true,
  onCancel: noop,
  onClose: noop,
  onDownload: noop,
  onExistingAssetChange: noop,
  onRetry: noop,
  onRun: noop,
  onSelectedPageIdsChange: noop,
  onSettingsChange: noop,
  onViewAssets: noop,
  pages: [
    {
      id: "page",
      name: "Page 1",
      width: 1080,
      height: 1440,
      transparentBackground: false,
    },
  ],
  phase: "idle",
  progress: 0,
  results: [],
  retryable: true,
  selectedPageIds: ["page"],
  settings: {
    destination: "download",
    format: "png",
    quality: 0.9,
    scale: 1,
    customWidth: 1080,
    transparentBackground: false,
  },
  workspaceId: "workspace",
};

afterEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("Canvas export language", () => {
  it("presents usable English export settings and actions", async () => {
    await i18n.changeLanguage("en-US");
    const markup = renderToStaticMarkup(<CanvasExportPanel {...props} />);
    expect(markup).toContain("Save destination");
    expect(markup).toContain("Export and download");
    expect(markup).toContain("Preserve transparent areas");
    expect(markup).not.toContain("保存方式");
    expect(markup).not.toContain("canvas.exportPanel.");
  });

  it("keeps export recovery instructions in the selected language", async () => {
    await i18n.changeLanguage("en-US");
    const error = canvasExportFailureMessageV1(
      new TypeError("Failed to fetch"),
    );
    const markup = renderToStaticMarkup(
      <CanvasExportPanel {...props} phase="error" error={error} />,
    );
    expect(markup).toContain("without creating a duplicate");
    expect(markup).toContain("Continue export");
  });
});
