import { describe, expect, it } from "vitest";

import {
  canvasImportFileIssue,
  canvasImportMaximumBytes,
  isSupportedCanvasImportFile,
} from "./canvas-import-file-validation.js";

describe("canvas import file validation", () => {
  it("accepts the supported image types at the size boundary", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(
        isSupportedCanvasImportFile({
          size: canvasImportMaximumBytes,
          type,
        }),
      ).toBe(true);
    }
  });

  it("explains unsupported and oversized selections before navigation", () => {
    expect(canvasImportFileIssue([{ size: 128, type: "text/plain" }])).toBe(
      "type",
    );
    expect(
      canvasImportFileIssue([
        {
          size: canvasImportMaximumBytes + 1,
          type: "image/png",
        },
      ]),
    ).toBe("size");
    expect(
      canvasImportFileIssue([
        {
          size: canvasImportMaximumBytes + 1,
          type: "application/pdf",
        },
      ]),
    ).toBe("typeAndSize");
  });
});
