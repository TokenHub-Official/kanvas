import { describe, expect, it, vi } from "vitest";

import {
  clearCanvasImportFiles,
  readCanvasImportFiles,
  stageCanvasImportFiles,
} from "./canvas-import-handoff.js";

describe("canvas import handoff", () => {
  it("keeps selected files until the board consumes them", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "import-token",
    });
    const file = new File(["image"], "source.png", {
      type: "image/png",
    });

    const token = stageCanvasImportFiles([file]);

    expect(readCanvasImportFiles(token)).toEqual([file]);
    clearCanvasImportFiles(token);
    expect(readCanvasImportFiles(token)).toEqual([]);
    vi.unstubAllGlobals();
  });
});
