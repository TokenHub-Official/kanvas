import { describe, expect, it } from "vitest";
import {
  canvasInspectorTitleKeyV1,
  canvasSaveStatusMessageKeyV1,
  effectiveCanvasSaveStatusV1,
  preferredCanvasOutputDispositionV1,
} from "./canvas-workspace-view-model-v1.js";

describe("canvas workspace view model", () => {
  it("derives upload and saved states from pending work", () => {
    expect(
      effectiveCanvasSaveStatusV1({
        fingerprintMatchesSaved: false,
        pendingUploadCount: 1,
        status: "idle",
      }),
    ).toBe("uploading");
    expect(
      effectiveCanvasSaveStatusV1({
        fingerprintMatchesSaved: true,
        pendingUploadCount: 0,
        status: "uploading",
      }),
    ).toBe("saved");
  });

  it("preserves error and saving states while uploads are pending", () => {
    expect(
      effectiveCanvasSaveStatusV1({
        fingerprintMatchesSaved: false,
        pendingUploadCount: 1,
        status: "error",
      }),
    ).toBe("error");
    expect(
      effectiveCanvasSaveStatusV1({
        fingerprintMatchesSaved: false,
        pendingUploadCount: 1,
        status: "saving",
      }),
    ).toBe("saving");
  });

  it("selects the first supported output mode by product preference", () => {
    expect(
      preferredCanvasOutputDispositionV1(undefined, ["asset_only", "add_node"]),
    ).toBe("add_node");
    expect(
      preferredCanvasOutputDispositionV1("set_background", ["replace_content"]),
    ).toBe("set_background");
  });

  it("maps status and inspector modes to translation keys", () => {
    expect(canvasSaveStatusMessageKeyV1(false, "saving")).toBe(
      "canvas.shell.readOnly",
    );
    expect(canvasSaveStatusMessageKeyV1(true, "saving")).toBe(
      "canvas.shell.saving",
    );
    expect(canvasInspectorTitleKeyV1("text-effects")).toBe(
      "canvas.text.effectsTitle",
    );
  });
});
