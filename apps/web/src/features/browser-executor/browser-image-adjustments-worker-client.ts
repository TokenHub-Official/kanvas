import type {
  BrowserDenoiseInput,
  BrowserLightEnhanceInput,
} from "./browser-image-adjustments.js";

type AdjustmentInput =
  | {
      readonly operation: "denoise";
      readonly input: BrowserDenoiseInput;
    }
  | {
      readonly operation: "light_enhance";
      readonly input: BrowserLightEnhanceInput;
    };

export interface BrowserAdjustmentWorkerResult {
  readonly pixels: Uint8ClampedArray;
  readonly noiseEstimate?: number;
  readonly clippedLowRatio?: number;
  readonly clippedHighRatio?: number;
}

export function runBrowserImageAdjustment(options: {
  readonly adjustment: AdjustmentInput;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly signal: AbortSignal;
  readonly width: number;
}): Promise<BrowserAdjustmentWorkerResult> {
  options.signal.throwIfAborted();
  const worker = new Worker(
    new URL("./browser-image-adjustments.worker.ts", import.meta.url),
    {
      type: "module",
      name: "kanvas-browser-image-adjustments",
    },
  );
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      worker.terminate();
      reject(
        options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException(
              "Browser image adjustment was aborted.",
              "AbortError",
            ),
      );
    };
    const finish = (): void => {
      options.signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    worker.addEventListener(
      "error",
      (event) => {
        finish();
        reject(
          new Error(event.message || "Browser image adjustment Worker failed."),
        );
      },
      { once: true },
    );
    worker.addEventListener(
      "message",
      (event: MessageEvent<Readonly<Record<string, unknown>>>) => {
        finish();
        if (
          event.data.ok !== true ||
          !(event.data.pixels instanceof ArrayBuffer)
        ) {
          reject(
            new Error(
              typeof event.data.error === "string"
                ? event.data.error
                : "Browser image adjustment Worker returned an invalid result.",
            ),
          );
          return;
        }
        resolve(
          Object.freeze({
            pixels: new Uint8ClampedArray(event.data.pixels),
            ...(typeof event.data.noiseEstimate === "number"
              ? {
                  noiseEstimate: event.data.noiseEstimate,
                }
              : {}),
            ...(typeof event.data.clippedLowRatio === "number"
              ? {
                  clippedLowRatio: event.data.clippedLowRatio,
                }
              : {}),
            ...(typeof event.data.clippedHighRatio === "number"
              ? {
                  clippedHighRatio: event.data.clippedHighRatio,
                }
              : {}),
          }),
        );
      },
      { once: true },
    );
    options.signal.addEventListener("abort", abort, {
      once: true,
    });
    const pixels = new Uint8ClampedArray(options.pixels);
    worker.postMessage(
      {
        ...options.adjustment,
        width: options.width,
        height: options.height,
        pixels: pixels.buffer,
      },
      [pixels.buffer],
    );
  });
}
