import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanvasSaveStatusIndicatorV1 } from "./canvas-save-status-indicator-v1.js";

describe("CanvasSaveStatusIndicatorV1", () => {
  it("keeps the stable saved state quiet and attached to the title lane", () => {
    const markup = renderToStaticMarkup(
      <CanvasSaveStatusIndicatorV1 canEdit message="已保存" status="saved" />,
    );

    expect(markup).toContain('data-save-status="saved"');
    expect(markup).toContain("text-white/65");
    expect(markup).not.toContain("bg-white/10");
    expect(markup).toContain("已保存");
  });

  it("raises busy and unsaved states without moving them to the header center", () => {
    const saving = renderToStaticMarkup(
      <CanvasSaveStatusIndicatorV1 canEdit message="保存中" status="saving" />,
    );
    const error = renderToStaticMarkup(
      <CanvasSaveStatusIndicatorV1 canEdit message="未保存" status="error" />,
    );

    expect(saving).toContain("bg-white/10");
    expect(error).toContain("bg-white/15");
  });

  it("does not show the saved check for a read-only board", () => {
    const markup = renderToStaticMarkup(
      <CanvasSaveStatusIndicatorV1
        canEdit={false}
        message="只读"
        status="saved"
      />,
    );

    expect(markup).toContain('data-save-status="read-only"');
    expect(markup).not.toContain("canvas-ant-icon");
  });
});
