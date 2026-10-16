import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";
import {
  canvasExportFilenameV1,
  downloadCanvasBlobV1,
  inlineCanvasExportImageSourcesV1,
  renderSvgPageBlobV1,
} from "./canvas-export-v1.js";

class FakeImage {
  public addEventListener(type: string, listener: () => void): void {
    if (type === "load") {
      queueMicrotask(listener);
    }
  }

  public removeEventListener(): void {}

  public set src(_value: string) {}
}

const page: EditorRuntimePageV1 = {
  id: "page-1",
  name: "页面 1",
  width: 1080,
  height: 1440,
  background: {
    kind: "transparent",
  },
  nodes: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Canvas V1 export", () => {
  it("inlines runtime Object URLs before serializing the export SVG", async () => {
    const setAttribute = vi.fn();
    const image = {
      getAttribute: vi.fn(() => "blob:https://kanvas.invalid/image-1"),
      setAttribute,
    };
    const svg = {
      querySelectorAll: vi.fn(() => [image]),
    } as unknown as SVGSVGElement;
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(new Blob(["image"], { type: "image/png" }))),
    ) as unknown as typeof fetch;
    const encodeBlob = vi.fn(() =>
      Promise.resolve("data:image/png;base64,aW1hZ2U="),
    );

    await inlineCanvasExportImageSourcesV1(svg, {
      encodeBlob,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "blob:https://kanvas.invalid/image-1",
      undefined,
    );
    expect(setAttribute).toHaveBeenCalledWith(
      "href",
      "data:image/png;base64,aW1hZ2U=",
    );
  });

  it("serializes the clipped page at its durable output size", async () => {
    const setAttribute = vi.fn();
    const clone = { setAttribute };
    const svg = {
      cloneNode: vi.fn(() => clone),
    } as unknown as SVGSVGElement;
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(["rendered"], { type: "image/png" }));
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage,
        fillRect,
        fillStyle: "",
      })),
      toBlob,
    };
    const createObjectURL = vi.fn(() => "blob:export-source");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal(
      "XMLSerializer",
      class {
        public serializeToString(): string {
          return "<svg />";
        }
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal("document", {
      fonts: { ready: Promise.resolve() },
      createElement: vi.fn(() => canvas),
    });

    const result = await renderSvgPageBlobV1(svg, page, "png");

    expect(result.type).toBe("image/png");
    expect(canvas).toMatchObject({
      width: 1080,
      height: 1440,
    });
    expect(setAttribute).toHaveBeenCalledWith("width", "1080");
    expect(setAttribute).toHaveBeenCalledWith("height", "1440");
    expect(setAttribute).toHaveBeenCalledWith("viewBox", "0 0 1080 1440");
    expect(drawImage).toHaveBeenCalledWith(
      expect.any(FakeImage),
      0,
      0,
      1080,
      1440,
    );
    expect(fillRect).not.toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
      0.92,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export-source");
  });

  it("uses a white JPEG fallback and a normalized extension", async () => {
    const svg = {
      cloneNode: vi.fn(() => ({ setAttribute: vi.fn() })),
    } as unknown as SVGSVGElement;
    const fillRect = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
        fillRect,
        fillStyle: "",
      })),
      toBlob: vi.fn((callback: BlobCallback) => {
        callback(new Blob(["rendered"], { type: "image/jpeg" }));
      }),
    };

    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal(
      "XMLSerializer",
      class {
        public serializeToString(): string {
          return "<svg />";
        }
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:jpeg"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("document", {
      fonts: { ready: Promise.resolve() },
      createElement: vi.fn(() => canvas),
    });

    const result = await renderSvgPageBlobV1(svg, page, "jpeg");

    expect(result.type).toBe("image/jpeg");
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1080, 1440);
    expect(canvasExportFilenameV1("商品主视觉", "页面 1", "jpeg")).toBe(
      "商品主视觉-页面 1.jpg",
    );
    expect(canvasExportFilenameV1("活动/主视觉", "桌面:首页?", "png")).toBe(
      "活动-主视觉-桌面-首页.png",
    );
  });

  it("stops before rendering when the export signal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderSvgPageBlobV1({} as SVGSVGElement, page, "png", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("renders a bounded custom size, quality, and opaque PNG background", async () => {
    const setAttribute = vi.fn();
    const svg = {
      cloneNode: vi.fn(() => ({ setAttribute })),
    } as unknown as SVGSVGElement;
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(["rendered"], { type: "image/png" }));
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage,
        fillRect,
        fillStyle: "",
      })),
      toBlob,
    };

    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal(
      "XMLSerializer",
      class {
        public serializeToString(): string {
          return "<svg />";
        }
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:custom"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("document", {
      fonts: { ready: Promise.resolve() },
      createElement: vi.fn(() => canvas),
    });

    await renderSvgPageBlobV1(svg, page, "png", {
      width: 2160,
      height: 2880,
      quality: 0.76,
      transparentBackground: false,
    });

    expect(canvas).toMatchObject({
      width: 2160,
      height: 2880,
    });
    expect(setAttribute).toHaveBeenCalledWith("width", "2160");
    expect(setAttribute).toHaveBeenCalledWith("height", "2880");
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2160, 2880);
    expect(drawImage).toHaveBeenCalledWith(
      expect.any(FakeImage),
      0,
      0,
      2160,
      2880,
    );
    expect(toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
      0.76,
    );
  });

  it("starts a browser download and revokes its object URL", () => {
    const click = vi.fn();
    const anchor = {
      click,
      download: "",
      href: "",
    };
    const createObjectURL = vi.fn(() => "blob:download");
    const revokeObjectURL = vi.fn();
    const setTimeout = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });

    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
    });
    vi.stubGlobal("window", { setTimeout });

    downloadCanvasBlobV1(
      new Blob(["download"], { type: "image/webp" }),
      "画板.webp",
    );

    expect(anchor).toMatchObject({
      download: "画板.webp",
      href: "blob:download",
    });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });
});
