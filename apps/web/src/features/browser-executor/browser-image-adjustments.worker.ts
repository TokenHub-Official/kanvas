/// <reference lib="webworker" />

import {
  denoiseBrowserPixels,
  enhanceBrowserLightPixels,
  type BrowserDenoiseInput,
  type BrowserLightEnhanceInput,
} from "./browser-image-adjustments.js";

type AdjustmentRequest =
  | {
      readonly operation: "denoise";
      readonly width: number;
      readonly height: number;
      readonly pixels: ArrayBuffer;
      readonly input: BrowserDenoiseInput;
    }
  | {
      readonly operation: "light_enhance";
      readonly width: number;
      readonly height: number;
      readonly pixels: ArrayBuffer;
      readonly input: BrowserLightEnhanceInput;
    };

function respond(
  value: Readonly<Record<string, unknown>>,
  transfer?: Transferable[],
): void {
  globalThis.postMessage(value, {
    transfer: transfer ?? [],
  });
}

globalThis.addEventListener(
  "message",
  (event: MessageEvent<AdjustmentRequest>) => {
    try {
      const request = event.data;
      const pixels = new Uint8ClampedArray(request.pixels);
      if (request.operation === "denoise") {
        const result = denoiseBrowserPixels({
          pixels,
          width: request.width,
          height: request.height,
          strength: request.input.strength,
        });
        respond(
          {
            ok: true,
            operation: request.operation,
            pixels: result.pixels.buffer,
            noiseEstimate: result.noiseEstimate,
          },
          [result.pixels.buffer],
        );
        return;
      }
      const result = enhanceBrowserLightPixels({
        pixels,
        width: request.width,
        height: request.height,
        parameters: {
          exposureStops: request.input.exposureStops,
          shadows: request.input.shadows,
          highlights: request.input.highlights,
          temperature: request.input.temperature,
          tint: request.input.tint,
        },
      });
      respond(
        {
          ok: true,
          operation: request.operation,
          pixels: result.pixels.buffer,
          clippedLowRatio: result.clippedLowRatio,
          clippedHighRatio: result.clippedHighRatio,
        },
        [result.pixels.buffer],
      );
    } catch (error) {
      respond({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Browser image adjustment failed.",
      });
    }
  },
);

export {};
