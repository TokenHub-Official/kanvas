import { afterEach, describe, expect, it, vi } from "vitest";

import { readCanvasImageFileSize } from "./canvas-image-size.js";

describe("canvas image size", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a File without creating a preview URL", async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(() =>
      Promise.resolve({
        close,
        height: 480,
        width: 640,
      }),
    );
    const createObjectURL = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    const file = new File(["image"], "source.png", {
      type: "image/png",
    });

    await expect(readCanvasImageFileSize(file)).resolves.toEqual({
      height: 480,
      width: 640,
    });
    expect(createImageBitmap).toHaveBeenCalledWith(file);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the decoded bitmap when dimensions are invalid", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() =>
        Promise.resolve({
          close,
          height: 0,
          width: 0,
        }),
      ),
    );
    const file = new File(["invalid"], "invalid.png", {
      type: "image/png",
    });

    await expect(readCanvasImageFileSize(file)).rejects.toThrow(
      "无法读取图片尺寸。",
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
