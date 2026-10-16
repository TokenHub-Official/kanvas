import type { EditorRuntimePageV1 } from "./editor-runtime-v1.js";

const MIN_PRINTABLE_CODE_POINT = 32;
export const CANVAS_EXPORT_MIN_DIMENSION = 64;
export const CANVAS_EXPORT_MAX_DIMENSION = 32_768;
export const CANVAS_EXPORT_MIN_QUALITY = 0.1;
export const CANVAS_EXPORT_DEFAULT_QUALITY = 0.92;

export type CanvasExportFormatV1 = "jpeg" | "png" | "webp";

export interface CanvasExportRenderOptionsV1 {
  readonly height?: number;
  readonly quality?: number;
  readonly signal?: AbortSignal;
  readonly transparentBackground?: boolean;
  readonly width?: number;
}

export function canvasExportBlobDataUrlV1(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Canvas export image could not be encoded."));
      }
    });
    reader.addEventListener("error", () => {
      reject(
        reader.error ?? new Error("Canvas export image could not be read."),
      );
    });
    reader.readAsDataURL(blob);
  });
}

export async function inlineCanvasExportImageSourcesV1(
  svg: SVGSVGElement,
  {
    encodeBlob = canvasExportBlobDataUrlV1,
    fetcher = fetch,
    signal,
  }: {
    readonly encodeBlob?: (blob: Blob) => Promise<string>;
    readonly fetcher?: typeof fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<void> {
  const images = Array.from(svg.querySelectorAll?.("image") ?? []);
  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute("href");
      if (!source || source.startsWith("data:")) return;
      signal?.throwIfAborted();
      const response = await fetcher(source, signal ? { signal } : undefined);
      if (!response.ok) {
        throw new Error("Canvas export image could not be loaded.");
      }
      const dataUrl = await encodeBlob(await response.blob());
      signal?.throwIfAborted();
      image.setAttribute("href", dataUrl);
    }),
  );
}

function safeFilenamePart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .split("")
    .map((character) =>
      character.charCodeAt(0) < MIN_PRINTABLE_CODE_POINT ? "-" : character,
    )
    .join("")
    .replaceAll(/[<>:"/\\|?*]/g, "-")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/[-. ]+$/g, "");
  return normalized || fallback;
}

export function canvasExportFilenameV1(
  title: string,
  pageName: string,
  format: CanvasExportFormatV1,
): string {
  const extension = format === "jpeg" ? "jpg" : format;
  return `${safeFilenamePart(title, "未命名画板")}-${safeFilenamePart(pageName, "页面")}.${extension}`;
}

export function downloadCanvasBlobV1(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

async function waitForCanvasTextLayoutPaintV1(): Promise<void> {
  if (typeof globalThis.requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => {
    globalThis.requestAnimationFrame(() => {
      resolve();
    });
  });
}

export async function renderSvgPageBlobV1(
  svg: SVGSVGElement,
  page: EditorRuntimePageV1,
  format: CanvasExportFormatV1,
  options: CanvasExportRenderOptionsV1 = {},
): Promise<Blob> {
  const signal = options.signal;
  signal?.throwIfAborted();
  await Promise.race([
    document.fonts.ready,
    signal
      ? new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                new DOMException("Canvas Export was cancelled.", "AbortError"),
              );
            },
            { once: true },
          );
        })
      : new Promise<never>(() => undefined),
  ]);
  signal?.throwIfAborted();
  await waitForCanvasTextLayoutPaintV1();
  signal?.throwIfAborted();
  const width = Math.max(
    CANVAS_EXPORT_MIN_DIMENSION,
    Math.min(
      CANVAS_EXPORT_MAX_DIMENSION,
      Math.round(options.width ?? page.width),
    ),
  );
  const height = Math.max(
    CANVAS_EXPORT_MIN_DIMENSION,
    Math.min(
      CANVAS_EXPORT_MAX_DIMENSION,
      Math.round(options.height ?? page.height),
    ),
  );
  const quality = Math.max(
    CANVAS_EXPORT_MIN_QUALITY,
    Math.min(1, options.quality ?? CANVAS_EXPORT_DEFAULT_QUALITY),
  );
  const transparentBackground =
    options.transparentBackground ?? page.background.kind === "transparent";
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute(
    "viewBox",
    `0 0 ${String(page.width)} ${String(page.height)}`,
  );
  await inlineCanvasExportImageSourcesV1(clone, signal ? { signal } : {});
  const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const sourceUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new globalThis.Image();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
        signal?.removeEventListener("abort", handleAbort);
      };
      const handleLoad = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("当前页面无法导出。"));
      };
      const handleAbort = () => {
        cleanup();
        image.src = "";
        reject(new DOMException("Canvas Export was cancelled.", "AbortError"));
      };
      image.addEventListener("load", handleLoad);
      image.addEventListener("error", handleError);
      signal?.addEventListener("abort", handleAbort, {
        once: true,
      });
      image.src = sourceUrl;
    });
    signal?.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器无法创建导出画布。");
    }
    if (format === "jpeg" || !transparentBackground) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      const handleAbort = () => {
        reject(new DOMException("Canvas Export was cancelled.", "AbortError"));
      };
      signal?.addEventListener("abort", handleAbort, {
        once: true,
      });
      canvas.toBlob(
        (value) => {
          signal?.removeEventListener("abort", handleAbort);
          if (signal?.aborted) {
            reject(
              new DOMException("Canvas Export was cancelled.", "AbortError"),
            );
            return;
          }
          if (value) {
            resolve(value);
          } else {
            reject(new Error("当前页面无法导出。"));
          }
        },
        `image/${format}`,
        quality,
      );
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function exportSvgPageV1(
  svg: SVGSVGElement,
  page: EditorRuntimePageV1,
  title: string,
  format: CanvasExportFormatV1,
): Promise<void> {
  const blob = await renderSvgPageBlobV1(svg, page, format);
  downloadCanvasBlobV1(blob, canvasExportFilenameV1(title, page.name, format));
}
