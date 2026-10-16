import { assertRgbaImage } from "./inputs.js";
import type {
  BackgroundComposeInput,
  PixelBounds,
  RgbaImage,
} from "./types.js";

interface RenderGeometry {
  readonly draw: PixelBounds;
  readonly map: (
    destinationX: number,
    destinationY: number,
  ) => readonly [number, number];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function geometry(
  source: RgbaImage,
  box: PixelBounds,
  fit: "contain" | "cover" | "stretch",
): RenderGeometry {
  if (fit === "stretch") {
    return {
      draw: box,
      map(x, y) {
        return [
          ((x - box.x + 0.5) / box.width) * source.width - 0.5,
          ((y - box.y + 0.5) / box.height) * source.height - 0.5,
        ];
      },
    };
  }
  const scale =
    fit === "contain"
      ? Math.min(box.width / source.width, box.height / source.height)
      : Math.max(box.width / source.width, box.height / source.height);
  const scaledWidth = source.width * scale;
  const scaledHeight = source.height * scale;
  if (fit === "contain") {
    const width = Math.max(1, Math.min(box.width, Math.round(scaledWidth)));
    const height = Math.max(1, Math.min(box.height, Math.round(scaledHeight)));
    const draw = Object.freeze({
      x: box.x + Math.floor((box.width - width) / 2),
      y: box.y + Math.floor((box.height - height) / 2),
      width,
      height,
    });
    return {
      draw,
      map(x, y) {
        return [
          ((x - draw.x + 0.5) / width) * source.width - 0.5,
          ((y - draw.y + 0.5) / height) * source.height - 0.5,
        ];
      },
    };
  }
  const cropX = (scaledWidth - box.width) / 2;
  const cropY = (scaledHeight - box.height) / 2;
  return {
    draw: box,
    map(x, y) {
      return [
        (x - box.x + 0.5 + cropX) / scale - 0.5,
        (y - box.y + 0.5 + cropY) / scale - 0.5,
      ];
    },
  };
}

function sample(
  image: RgbaImage,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const left = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const top = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const right = Math.min(image.width - 1, left + 1);
  const bottom = Math.min(image.height - 1, top + 1);
  const fx = Math.max(0, Math.min(1, x - left));
  const fy = Math.max(0, Math.min(1, y - top));
  const weights = [
    [(top * image.width + left) * 4, (1 - fx) * (1 - fy)],
    [(top * image.width + right) * 4, fx * (1 - fy)],
    [(bottom * image.width + left) * 4, (1 - fx) * fy],
    [(bottom * image.width + right) * 4, fx * fy],
  ] as const;
  const channels = [0, 0, 0, 0];
  for (const [offset, weight] of weights) {
    for (let channel = 0; channel < 4; channel += 1) {
      channels[channel] =
        channels[channel]! + image.data[offset + channel]! * weight;
    }
  }
  return [channels[0]!, channels[1]!, channels[2]!, channels[3]!];
}

function sourceOver(
  destination: Uint8ClampedArray,
  offset: number,
  source: readonly [number, number, number, number],
  alphaMultiplier: number,
): void {
  const sourceAlpha = (source[3] / 255) * alphaMultiplier;
  const destinationAlpha = destination[offset + 3]! / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) {
    destination[offset] = 0;
    destination[offset + 1] = 0;
    destination[offset + 2] = 0;
    destination[offset + 3] = 0;
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    destination[offset + channel] = clampByte(
      (source[channel]! * sourceAlpha +
        destination[offset + channel]! * destinationAlpha * (1 - sourceAlpha)) /
        outputAlpha,
    );
  }
  destination[offset + 3] = clampByte(outputAlpha * 255);
}

function render(
  destination: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  source: RgbaImage,
  box: PixelBounds,
  fit: "contain" | "cover" | "stretch",
  opacity: number,
  mask?: RgbaImage,
  compositionMask?: Uint8ClampedArray,
): PixelBounds {
  assertRgbaImage(source, 67_108_864);
  if (mask) {
    assertRgbaImage(mask, 67_108_864);
    if (mask.width !== source.width || mask.height !== source.height) {
      throw new TypeError(
        "Composition Mask dimensions must match the foreground.",
      );
    }
  }
  const mapping = geometry(source, box, fit);
  for (
    let y = mapping.draw.y;
    y < mapping.draw.y + mapping.draw.height;
    y += 1
  ) {
    if (y < 0 || y >= canvasHeight) {
      continue;
    }
    for (
      let x = mapping.draw.x;
      x < mapping.draw.x + mapping.draw.width;
      x += 1
    ) {
      if (x < 0 || x >= canvasWidth) {
        continue;
      }
      const [sourceX, sourceY] = mapping.map(x, y);
      const sampled = sample(source, sourceX, sourceY);
      const maskAlpha = mask ? sample(mask, sourceX, sourceY)[0] / 255 : 1;
      const alphaMultiplier = opacity * maskAlpha;
      const offset = (y * canvasWidth + x) * 4;
      sourceOver(destination, offset, sampled, alphaMultiplier);
      if (compositionMask) {
        const contribution = clampByte(sampled[3] * alphaMultiplier);
        compositionMask[offset] = contribution;
        compositionMask[offset + 1] = contribution;
        compositionMask[offset + 2] = contribution;
        compositionMask[offset + 3] = 255;
      }
    }
  }
  return mapping.draw;
}

function parseColor(value: string): readonly [number, number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    Number.parseInt(value.slice(7, 9), 16),
  ];
}

export function composeBackground(options: {
  readonly background?: RgbaImage;
  readonly foreground: RgbaImage;
  readonly input: BackgroundComposeInput;
  readonly mask?: RgbaImage;
}) {
  assertRgbaImage(options.foreground, 67_108_864);
  const pixelCount = options.input.canvas.width * options.input.canvas.height;
  if (pixelCount > 32_000_000) {
    throw new RangeError("Background compose canvas exceeds the pixel limit.");
  }
  const output = new Uint8ClampedArray(pixelCount * 4);
  const compositionMask = new Uint8ClampedArray(pixelCount * 4);
  if (options.input.background.kind === "color") {
    const color = parseColor(options.input.background.color);
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = color[0];
      output[offset + 1] = color[1];
      output[offset + 2] = color[2];
      output[offset + 3] = color[3];
      compositionMask[offset + 3] = 255;
    }
  } else {
    if (!options.background) {
      throw new TypeError("Artifact background bytes are required.");
    }
    render(
      output,
      options.input.canvas.width,
      options.input.canvas.height,
      options.background,
      {
        x: 0,
        y: 0,
        width: options.input.canvas.width,
        height: options.input.canvas.height,
      },
      options.input.background.fit,
      1,
    );
    for (let offset = 3; offset < compositionMask.length; offset += 4) {
      compositionMask[offset] = 255;
    }
  }
  const resolvedPlacement = render(
    output,
    options.input.canvas.width,
    options.input.canvas.height,
    options.foreground,
    options.input.placement,
    options.input.placement.fit,
    options.input.placement.opacity,
    options.mask,
    compositionMask,
  );
  return Object.freeze({
    image: Object.freeze({
      data: output,
      width: options.input.canvas.width,
      height: options.input.canvas.height,
    }),
    mask: Object.freeze({
      data: compositionMask,
      width: options.input.canvas.width,
      height: options.input.canvas.height,
    }),
    resolvedPlacement,
  });
}
