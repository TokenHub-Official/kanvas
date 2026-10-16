export interface RgbaImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly height: number;
  readonly width: number;
}

export interface PixelBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface NormalizedBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface CropSuggestInput {
  readonly aspectRatios: readonly string[];
  readonly maxSuggestionsPerRatio: number;
  readonly safeMarginRatio: number;
  readonly sourceArtifactId: string;
  readonly subjectBounds: readonly PixelBounds[];
}

export interface PaletteExtractInput {
  readonly alphaThreshold: number;
  readonly colorCount: number;
  readonly sampleSize: number;
  readonly sourceArtifactId: string;
}

export interface QualityAssessInput {
  readonly sampleSize: number;
  readonly sourceArtifactId: string;
  readonly subjectBounds: readonly PixelBounds[];
}

export interface BackgroundColorSpec {
  readonly color: string;
  readonly kind: "color";
}

export interface BackgroundArtifactSpec {
  readonly artifactId: string;
  readonly fit: "contain" | "cover" | "stretch";
  readonly kind: "artifact";
}

export interface BackgroundComposeInput {
  readonly background: BackgroundColorSpec | BackgroundArtifactSpec;
  readonly canvas: {
    readonly height: number;
    readonly width: number;
  };
  readonly foregroundArtifactId: string;
  readonly maskArtifactId?: string;
  readonly placement: PixelBounds & {
    readonly fit: "contain" | "cover" | "stretch";
    readonly opacity: number;
  };
}
