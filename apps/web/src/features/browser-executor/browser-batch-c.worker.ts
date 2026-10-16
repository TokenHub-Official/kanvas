/// <reference lib="webworker" />

import {
  assessQuality,
  composeBackground,
  extractPalette,
  suggestCrops,
  type BackgroundComposeInput,
  type CropSuggestInput,
  type PaletteExtractInput,
  type QualityAssessInput,
} from "@kanvas/image-atomic-core";

type SerializedImage = {
  readonly data: ArrayBuffer;
  readonly height: number;
  readonly width: number;
};

type Request =
  | {
      readonly id: string;
      readonly operation: "crop_suggest";
      readonly image: SerializedImage;
      readonly input: CropSuggestInput;
    }
  | {
      readonly id: string;
      readonly operation: "palette_extract";
      readonly image: SerializedImage;
      readonly input: PaletteExtractInput;
    }
  | {
      readonly id: string;
      readonly operation: "quality_assess";
      readonly image: SerializedImage;
      readonly input: QualityAssessInput;
    }
  | {
      readonly id: string;
      readonly operation: "background_compose";
      readonly foreground: SerializedImage;
      readonly background?: SerializedImage;
      readonly mask?: SerializedImage;
      readonly input: BackgroundComposeInput;
    };

function image(value: SerializedImage) {
  return Object.freeze({
    data: new Uint8ClampedArray(value.data),
    width: value.width,
    height: value.height,
  });
}

function respond(value: unknown, transfer: Transferable[] = []): void {
  self.postMessage(value, {
    transfer,
  });
}

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.operation === "crop_suggest") {
      respond({
        id: request.id,
        ok: true,
        operation: request.operation,
        result: suggestCrops(image(request.image), request.input),
      });
      return;
    }
    if (request.operation === "palette_extract") {
      respond({
        id: request.id,
        ok: true,
        operation: request.operation,
        result: extractPalette(image(request.image), request.input),
      });
      return;
    }
    if (request.operation === "quality_assess") {
      respond({
        id: request.id,
        ok: true,
        operation: request.operation,
        result: assessQuality(image(request.image), request.input),
      });
      return;
    }
    const result = composeBackground({
      input: request.input,
      foreground: image(request.foreground),
      ...(request.background
        ? {
            background: image(request.background),
          }
        : {}),
      ...(request.mask
        ? {
            mask: image(request.mask),
          }
        : {}),
    });
    const composed = result.image.data.buffer;
    const mask = result.mask.data.buffer;
    respond(
      {
        id: request.id,
        ok: true,
        operation: request.operation,
        result: {
          image: {
            data: composed,
            width: result.image.width,
            height: result.image.height,
          },
          mask: {
            data: mask,
            width: result.mask.width,
            height: result.mask.height,
          },
          resolvedPlacement: result.resolvedPlacement,
        },
      },
      [composed, mask],
    );
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Browser Batch C execution failed.",
    });
  }
});

export {};
