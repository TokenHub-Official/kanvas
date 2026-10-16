import type {
  BackgroundComposeInput,
  CropSuggestInput,
  PaletteExtractInput,
  PixelBounds,
  QualityAssessInput,
  RgbaImage,
} from "./types.js";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const ratioPattern = /^[1-9][0-9]{0,3}:[1-9][0-9]{0,3}$/u;
const colorPattern = /^#[0-9A-Fa-f]{8}$/u;

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError(`${label} contains unknown fields.`);
  }
}

function artifactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !artifactIdPattern.test(value)) {
    throw new TypeError(`${label} must be an Artifact ID.`);
  }
  return value;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a bounded integer.`);
  }
  return value;
}

function finite(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be bounded.`);
  }
  return value;
}

function bounds(
  value: unknown,
  label: string,
  allowPlacementFields = false,
): PixelBounds {
  const item = record(value, label);
  exactKeys(
    item,
    allowPlacementFields
      ? ["x", "y", "width", "height", "fit", "opacity"]
      : ["x", "y", "width", "height"],
    label,
  );
  return Object.freeze({
    x: integer(item.x, 0, 1_000_000, `${label}.x`),
    y: integer(item.y, 0, 1_000_000, `${label}.y`),
    width: integer(item.width, 1, 1_000_000, `${label}.width`),
    height: integer(item.height, 1, 1_000_000, `${label}.height`),
  });
}

function subjectBounds(value: unknown): readonly PixelBounds[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError("subjectBounds must contain at most 16 bounds.");
  }
  return Object.freeze(
    value.map((item, index) => bounds(item, `subjectBounds[${String(index)}]`)),
  );
}

export function assertRgbaImage(
  image: RgbaImage,
  maximumPixels = 32_000_000,
): void {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width * image.height > maximumPixels ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new TypeError("Image must be bounded RGBA.");
  }
}

export function parseCropSuggestInput(value: unknown): CropSuggestInput {
  const input = record(value, "Crop suggest input");
  exactKeys(
    input,
    [
      "sourceArtifactId",
      "aspectRatios",
      "maxSuggestionsPerRatio",
      "safeMarginRatio",
      "subjectBounds",
    ],
    "Crop suggest input",
  );
  if (
    !Array.isArray(input.aspectRatios) ||
    input.aspectRatios.length < 1 ||
    input.aspectRatios.length > 8 ||
    input.aspectRatios.some(
      (ratio) => typeof ratio !== "string" || !ratioPattern.test(ratio),
    ) ||
    new Set(input.aspectRatios).size !== input.aspectRatios.length
  ) {
    throw new TypeError("Crop suggest aspectRatios are invalid.");
  }
  return Object.freeze({
    sourceArtifactId: artifactId(input.sourceArtifactId, "sourceArtifactId"),
    aspectRatios: Object.freeze([...(input.aspectRatios as string[])]),
    maxSuggestionsPerRatio: integer(
      input.maxSuggestionsPerRatio ?? 1,
      1,
      3,
      "maxSuggestionsPerRatio",
    ),
    safeMarginRatio: finite(
      input.safeMarginRatio ?? 0.05,
      0,
      0.25,
      "safeMarginRatio",
    ),
    subjectBounds: subjectBounds(input.subjectBounds),
  });
}

export function parsePaletteExtractInput(value: unknown): PaletteExtractInput {
  const input = record(value, "Palette extract input");
  exactKeys(
    input,
    ["sourceArtifactId", "colorCount", "alphaThreshold", "sampleSize"],
    "Palette extract input",
  );
  return Object.freeze({
    sourceArtifactId: artifactId(input.sourceArtifactId, "sourceArtifactId"),
    colorCount: integer(input.colorCount ?? 6, 2, 12, "colorCount"),
    alphaThreshold: integer(
      input.alphaThreshold ?? 16,
      0,
      255,
      "alphaThreshold",
    ),
    sampleSize: integer(input.sampleSize ?? 128, 32, 512, "sampleSize"),
  });
}

export function parseQualityAssessInput(value: unknown): QualityAssessInput {
  const input = record(value, "Quality assess input");
  exactKeys(
    input,
    ["sourceArtifactId", "subjectBounds", "sampleSize"],
    "Quality assess input",
  );
  return Object.freeze({
    sourceArtifactId: artifactId(input.sourceArtifactId, "sourceArtifactId"),
    subjectBounds: subjectBounds(input.subjectBounds),
    sampleSize: integer(input.sampleSize ?? 256, 64, 1024, "sampleSize"),
  });
}

export function parseBackgroundComposeInput(
  value: unknown,
): BackgroundComposeInput {
  const input = record(value, "Background compose input");
  exactKeys(
    input,
    [
      "foregroundArtifactId",
      "maskArtifactId",
      "background",
      "canvas",
      "placement",
    ],
    "Background compose input",
  );
  const background = record(input.background, "background");
  const canvas = record(input.canvas, "canvas");
  const placement = record(input.placement, "placement");
  const kind = background.kind;
  let backgroundValue:
    | {
        readonly color: string;
        readonly kind: "color";
      }
    | {
        readonly artifactId: string;
        readonly fit: "contain" | "cover" | "stretch";
        readonly kind: "artifact";
      }
    | undefined;
  if (kind === "color") {
    exactKeys(background, ["kind", "color"], "background");
    if (
      typeof background.color !== "string" ||
      !colorPattern.test(background.color)
    ) {
      throw new TypeError("Color background must use #RRGGBBAA.");
    }
    backgroundValue = Object.freeze({
      kind: "color",
      color: background.color.toUpperCase(),
    });
  } else if (kind === "artifact") {
    exactKeys(background, ["kind", "artifactId", "fit"], "background");
    if (
      background.fit !== "contain" &&
      background.fit !== "cover" &&
      background.fit !== "stretch"
    ) {
      throw new TypeError("Background fit is invalid.");
    }
    backgroundValue = Object.freeze({
      kind: "artifact",
      artifactId: artifactId(background.artifactId, "background.artifactId"),
      fit: background.fit,
    });
  }
  exactKeys(canvas, ["width", "height"], "canvas");
  exactKeys(
    placement,
    ["x", "y", "width", "height", "fit", "opacity"],
    "placement",
  );
  if (
    !backgroundValue ||
    (placement.fit !== "contain" &&
      placement.fit !== "cover" &&
      placement.fit !== "stretch")
  ) {
    throw new TypeError("Background compose fit or background is invalid.");
  }
  const parsedCanvas = Object.freeze({
    width: integer(canvas.width, 1, 8192, "canvas.width"),
    height: integer(canvas.height, 1, 8192, "canvas.height"),
  });
  const parsedPlacement = Object.freeze({
    ...bounds(placement, "placement", true),
    fit: placement.fit,
    opacity: finite(placement.opacity ?? 1, 0, 1, "placement.opacity"),
  });
  if (
    parsedPlacement.x + parsedPlacement.width > parsedCanvas.width ||
    parsedPlacement.y + parsedPlacement.height > parsedCanvas.height
  ) {
    throw new RangeError("Background compose placement exceeds the canvas.");
  }
  return Object.freeze({
    foregroundArtifactId: artifactId(
      input.foregroundArtifactId,
      "foregroundArtifactId",
    ),
    ...(input.maskArtifactId !== undefined
      ? {
          maskArtifactId: artifactId(input.maskArtifactId, "maskArtifactId"),
        }
      : {}),
    background: backgroundValue,
    canvas: parsedCanvas,
    placement: parsedPlacement,
  });
}
