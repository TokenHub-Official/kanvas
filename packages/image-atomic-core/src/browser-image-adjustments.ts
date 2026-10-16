/**
 * Deterministic image-adjustment contracts shared by browser execution and
 * offline evaluation. This module deliberately has no DOM dependency.
 */
export const browserImageDenoiseAdapterKey =
  "browser.image.denoise.median-blend.v1";
export const browserImageLightEnhanceAdapterKey =
  "browser.image.light-enhance.deterministic.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const maximumPixels = 16_000_000;

export interface BrowserDenoiseInput {
  readonly sourceArtifactId: string;
  readonly strength: number;
}

export interface BrowserLightEnhanceInput {
  readonly sourceArtifactId: string;
  readonly exposureStops: number;
  readonly shadows: number;
  readonly highlights: number;
  readonly temperature: number;
  readonly tint: number;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser image adjustment input must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | undefined {
  const candidate = value ?? fallback;
  return typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= minimum &&
    candidate <= maximum
    ? candidate
    : undefined;
}

export function parseBrowserDenoiseInput(value: unknown): BrowserDenoiseInput {
  const input = record(value);
  const sourceArtifactId = input.sourceArtifactId;
  const strength = boundedNumber(input.strength, 0.5, 0.1, 1);
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    strength === undefined ||
    Object.keys(input).some(
      (key) => key !== "sourceArtifactId" && key !== "strength",
    )
  ) {
    throw new TypeError(
      "Browser denoise input does not match kanvas.image-denoise-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    strength,
  });
}

export function parseBrowserLightEnhanceInput(
  value: unknown,
): BrowserLightEnhanceInput {
  const input = record(value);
  const sourceArtifactId = input.sourceArtifactId;
  const exposureStops = boundedNumber(input.exposureStops, 0, -2, 2);
  const shadows = boundedNumber(input.shadows, 0, -1, 1);
  const highlights = boundedNumber(input.highlights, 0, -1, 1);
  const temperature = boundedNumber(input.temperature, 0, -1, 1);
  const tint = boundedNumber(input.tint, 0, -1, 1);
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    exposureStops === undefined ||
    shadows === undefined ||
    highlights === undefined ||
    temperature === undefined ||
    tint === undefined ||
    Object.keys(input).some(
      (key) =>
        ![
          "sourceArtifactId",
          "exposureStops",
          "shadows",
          "highlights",
          "temperature",
          "tint",
        ].includes(key),
    )
  ) {
    throw new TypeError(
      "Browser light-enhance input does not match kanvas.image-light-enhance-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    exposureStops,
    shadows,
    highlights,
    temperature,
    tint,
  });
}

function assertPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > maximumPixels ||
    pixels.length !== width * height * 4
  ) {
    throw new RangeError("Browser image adjustment pixels are invalid.");
  }
}

function median(values: number[]): number {
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)]!;
}

export function denoiseBrowserPixels(options: {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly strength: number;
  readonly signal?: AbortSignal;
}): {
  readonly pixels: Uint8ClampedArray;
  readonly noiseEstimate: number;
} {
  assertPixels(options.pixels, options.width, options.height);
  if (
    !Number.isFinite(options.strength) ||
    options.strength < 0.1 ||
    options.strength > 1
  ) {
    throw new RangeError("Browser denoise strength is invalid.");
  }
  const output = new Uint8ClampedArray(options.pixels.length);
  let absoluteDifference = 0;
  let visibleSamples = 0;
  for (let y = 0; y < options.height; y += 1) {
    options.signal?.throwIfAborted();
    for (let x = 0; x < options.width; x += 1) {
      const offset = (y * options.width + x) * 4;
      const alpha = options.pixels[offset + 3]!;
      for (let channel = 0; channel < 3; channel += 1) {
        const neighborhood: number[] = [];
        for (
          let sampleY = Math.max(0, y - 1);
          sampleY <= Math.min(options.height - 1, y + 1);
          sampleY += 1
        ) {
          for (
            let sampleX = Math.max(0, x - 1);
            sampleX <= Math.min(options.width - 1, x + 1);
            sampleX += 1
          ) {
            neighborhood.push(
              options.pixels[
                (sampleY * options.width + sampleX) * 4 + channel
              ]!,
            );
          }
        }
        const original = options.pixels[offset + channel]!;
        const filtered = median(neighborhood);
        output[offset + channel] = Math.round(
          original + (filtered - original) * options.strength,
        );
        if (alpha > 0) {
          absoluteDifference += Math.abs(filtered - original);
          visibleSamples += 1;
        }
      }
      output[offset + 3] = alpha;
    }
  }
  return Object.freeze({
    pixels: output,
    noiseEstimate:
      visibleSamples === 0
        ? 0
        : Number((absoluteDifference / visibleSamples / 255).toFixed(6)),
  });
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function enhanceBrowserLightPixels(options: {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly parameters: Omit<BrowserLightEnhanceInput, "sourceArtifactId">;
  readonly signal?: AbortSignal;
}): {
  readonly pixels: Uint8ClampedArray;
  readonly clippedLowRatio: number;
  readonly clippedHighRatio: number;
} {
  assertPixels(options.pixels, options.width, options.height);
  const output = new Uint8ClampedArray(options.pixels.length);
  const exposureMultiplier = 2 ** options.parameters.exposureStops;
  let clippedLow = 0;
  let clippedHigh = 0;
  let visiblePixels = 0;
  for (let offset = 0; offset < options.pixels.length; offset += 4) {
    if (offset % (options.width * 4) === 0) {
      options.signal?.throwIfAborted();
    }
    const alpha = options.pixels[offset + 3]!;
    if (alpha === 0) {
      output.set(options.pixels.subarray(offset, offset + 4), offset);
      continue;
    }
    visiblePixels += 1;
    const red = options.pixels[offset]! / 255;
    const green = options.pixels[offset + 1]! / 255;
    const blue = options.pixels[offset + 2]! / 255;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const toneDelta =
      options.parameters.shadows * (1 - luminance) * (1 - luminance) * 0.35 +
      options.parameters.highlights * luminance * luminance * 0.25;
    const adjusted = [
      red * exposureMultiplier +
        toneDelta +
        options.parameters.temperature * 0.12 -
        options.parameters.tint * 0.04,
      green * exposureMultiplier + toneDelta + options.parameters.tint * 0.08,
      blue * exposureMultiplier +
        toneDelta -
        options.parameters.temperature * 0.12 -
        options.parameters.tint * 0.04,
    ];
    if (adjusted.some((channel) => channel <= 0)) {
      clippedLow += 1;
    }
    if (adjusted.some((channel) => channel >= 1)) {
      clippedHigh += 1;
    }
    output[offset] = clampByte(adjusted[0]! * 255);
    output[offset + 1] = clampByte(adjusted[1]! * 255);
    output[offset + 2] = clampByte(adjusted[2]! * 255);
    output[offset + 3] = alpha;
  }
  const ratio = (value: number): number =>
    visiblePixels === 0 ? 0 : Number((value / visiblePixels).toFixed(6));
  return Object.freeze({
    pixels: output,
    clippedLowRatio: ratio(clippedLow),
    clippedHighRatio: ratio(clippedHigh),
  });
}
