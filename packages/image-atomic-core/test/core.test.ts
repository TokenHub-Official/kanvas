import { describe, expect, it } from "vitest";

import {
  assessQuality,
  composeBackground,
  extractPalette,
  parseBackgroundComposeInput,
  parseCropSuggestInput,
  parsePaletteExtractInput,
  parseQualityAssessInput,
  suggestCrops,
  type RgbaImage,
} from "../src/index.js";

const artifact = "01K00000000000000000000000";

function image(
  width: number,
  height: number,
  pixels: readonly number[],
): RgbaImage {
  return {
    width,
    height,
    data: Uint8Array.from(pixels),
  };
}

function solid(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): RgbaImage {
  return image(
    width,
    height,
    Array.from({ length: width * height }, () => rgba).flat(),
  );
}

describe("Batch C deterministic image core", () => {
  it("orders bounded crop suggestions per requested ratio", () => {
    const input = parseCropSuggestInput({
      sourceArtifactId: artifact,
      aspectRatios: ["1:1", "16:9"],
      maxSuggestionsPerRatio: 2,
      subjectBounds: [
        {
          x: 4,
          y: 1,
          width: 2,
          height: 2,
        },
      ],
    });
    const result = suggestCrops(solid(8, 4, [120, 120, 120, 255]), input);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toMatchObject({
      aspectRatio: "1:1",
      rank: 1,
      subjectRetention: 1,
      method: "deterministic_saliency_projection",
    });
    for (const suggestion of result) {
      expect(suggestion.bounds.x + suggestion.bounds.width).toBeLessThanOrEqual(
        8,
      );
      expect(
        suggestion.bounds.y + suggestion.bounds.height,
      ).toBeLessThanOrEqual(4);
    }
  });

  it("extracts a stable alpha-aware sRGB palette", () => {
    const input = parsePaletteExtractInput({
      sourceArtifactId: artifact,
      colorCount: 2,
      alphaThreshold: 16,
      sampleSize: 32,
    });
    const result = extractPalette(
      image(3, 1, [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 0]),
      input,
    );

    expect(result.colors).toEqual([
      {
        rank: 1,
        hex: "#FF0000",
        red: 255,
        green: 0,
        blue: 0,
        proportion: 1,
        luminance: 0.2126,
        role: "dominant",
      },
    ]);
    expect(result.transparentRatio).toBe(0.333333);
  });

  it("clusters nearby background bins without losing a vivid subject color", () => {
    const pixels: number[] = [];
    const add = (
      color: readonly [number, number, number, number],
      count: number,
    ) => {
      for (let index = 0; index < count; index += 1) pixels.push(...color);
    };
    const backgroundColors: readonly (readonly [
      number,
      number,
      number,
      number,
    ])[] = [
      [244, 232, 216, 255],
      [236, 220, 200, 255],
      [228, 210, 190, 255],
      [250, 240, 228, 255],
      [220, 200, 176, 255],
      [240, 226, 208, 255],
    ];
    backgroundColors.forEach((color) => add(color, 10));
    const subjectColors: readonly (readonly [
      number,
      number,
      number,
      number,
    ])[] = [
      [20, 70, 220, 255],
      [30, 100, 240, 255],
      [60, 40, 200, 255],
      [10, 140, 235, 255],
      [80, 80, 220, 255],
    ];
    subjectColors.forEach((color) => add(color, 8));
    const input = parsePaletteExtractInput({
      sourceArtifactId: artifact,
      colorCount: 2,
      alphaThreshold: 16,
      sampleSize: 128,
    });

    const result = extractPalette(image(100, 1, pixels), input);
    const blue = result.colors.find(
      (color) => color.blue > color.red + 100 && color.blue > color.green + 80,
    );
    const background = result.colors.find(
      (color) => color.red > color.blue && color.green > color.blue,
    );

    expect(blue?.proportion).toBeCloseTo(0.4, 6);
    expect(background?.proportion).toBeCloseTo(0.6, 6);
    expect(
      result.colors.reduce((sum, color) => sum + color.proportion, 0),
    ).toBe(1);
    expect(result.visibleWeight).toBe(100);
  });

  it("keeps quality facts separate from repair recommendations", () => {
    const input = parseQualityAssessInput({
      sourceArtifactId: artifact,
      subjectBounds: [
        {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
      ],
    });
    const result = assessQuality(solid(16, 16, [0, 0, 0, 255]), input);

    expect(result.underExposureRatio).toBe(1);
    expect(result.findings).toContain("under_exposed");
    expect(result.subjectScaleRatio).toBe(0.003906);
    expect(result.findings).toContain("subject_too_small");
  });

  it("composites alpha deterministically and emits foreground contribution mask", () => {
    const input = parseBackgroundComposeInput({
      foregroundArtifactId: artifact,
      background: {
        kind: "color",
        color: "#0000FFFF",
      },
      canvas: {
        width: 2,
        height: 1,
      },
      placement: {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        fit: "stretch",
        opacity: 0.5,
      },
    });
    const result = composeBackground({
      input,
      foreground: solid(1, 1, [255, 0, 0, 255]),
    });

    expect([...result.image.data]).toEqual([
      128, 0, 128, 255, 128, 0, 128, 255,
    ]);
    expect([...result.mask.data]).toEqual([
      128, 128, 128, 255, 128, 128, 128, 255,
    ]);
  });

  it("rejects placement outside the requested canvas", () => {
    expect(() =>
      parseBackgroundComposeInput({
        foregroundArtifactId: artifact,
        background: {
          kind: "color",
          color: "#FFFFFFFF",
        },
        canvas: {
          width: 100,
          height: 100,
        },
        placement: {
          x: 90,
          y: 0,
          width: 20,
          height: 20,
          fit: "contain",
        },
      }),
    ).toThrow(/exceeds the canvas/u);
  });
});
