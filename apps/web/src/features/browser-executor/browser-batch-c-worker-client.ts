import type {
  BackgroundComposeInput,
  CropSuggestInput,
  PaletteExtractInput,
  QualityAssessInput,
} from "@kanvas/image-atomic-core";

export interface BrowserRgbaImage {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly height: number;
  readonly width: number;
}

type Request =
  | {
      readonly operation: "crop_suggest";
      readonly image: BrowserRgbaImage;
      readonly input: CropSuggestInput;
    }
  | {
      readonly operation: "palette_extract";
      readonly image: BrowserRgbaImage;
      readonly input: PaletteExtractInput;
    }
  | {
      readonly operation: "quality_assess";
      readonly image: BrowserRgbaImage;
      readonly input: QualityAssessInput;
    }
  | {
      readonly operation: "background_compose";
      readonly foreground: BrowserRgbaImage;
      readonly background?: BrowserRgbaImage;
      readonly mask?: BrowserRgbaImage;
      readonly input: BackgroundComposeInput;
    };

export function runBrowserBatchCOperation<T>(
  request: Request,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(
      new URL("./browser-batch-c.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    const id = crypto.randomUUID();
    const abort = (): void => {
      worker.terminate();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException(
              "Browser Batch C execution was aborted.",
              "AbortError",
            ),
      );
    };
    worker.addEventListener(
      "message",
      (
        event: MessageEvent<{
          readonly error?: string;
          readonly id: string;
          readonly ok: boolean;
          readonly result?: T;
        }>,
      ) => {
        if (event.data.id !== id) {
          return;
        }
        signal.removeEventListener("abort", abort);
        worker.terminate();
        if (event.data.ok && event.data.result !== undefined) {
          resolve(event.data.result);
        } else {
          reject(
            new Error(event.data.error ?? "Browser Batch C execution failed."),
          );
        }
      },
      { once: true },
    );
    worker.addEventListener(
      "error",
      (event) => {
        signal.removeEventListener("abort", abort);
        worker.terminate();
        reject(new Error(event.message || "Browser Batch C Worker crashed."));
      },
      { once: true },
    );
    signal.addEventListener("abort", abort, {
      once: true,
    });
    const transfer: ArrayBuffer[] = [];
    const payload =
      request.operation === "background_compose"
        ? {
            id,
            operation: request.operation,
            input: request.input,
            foreground: {
              ...request.foreground,
              data: request.foreground.data.buffer,
            },
            ...(request.background
              ? {
                  background: {
                    ...request.background,
                    data: request.background.data.buffer,
                  },
                }
              : {}),
            ...(request.mask
              ? {
                  mask: {
                    ...request.mask,
                    data: request.mask.data.buffer,
                  },
                }
              : {}),
          }
        : {
            id,
            operation: request.operation,
            input: request.input,
            image: {
              ...request.image,
              data: request.image.data.buffer,
            },
          };
    if (request.operation === "background_compose") {
      transfer.push(request.foreground.data.buffer);
      if (request.background) {
        transfer.push(request.background.data.buffer);
      }
      if (request.mask) {
        transfer.push(request.mask.data.buffer);
      }
    } else {
      transfer.push(request.image.data.buffer);
    }
    worker.postMessage(payload, transfer);
  });
}
