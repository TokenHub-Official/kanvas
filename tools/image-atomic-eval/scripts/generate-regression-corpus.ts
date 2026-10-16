import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

import {
  assessQuality,
  composeBackground,
  denoiseBrowserPixels,
  enhanceBrowserLightPixels,
  extractPalette,
  suggestCrops,
  type RgbaImage,
} from "@kanvas/image-atomic-core";
import { defaultCatalogImplementationDigests } from "../src/default-catalog-implementation-digests.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const batchBRoot = resolve(
  workspaceRoot,
  "eval-data/image-atomic-batch-b/regression-v1",
);
const batchCRoot = resolve(
  workspaceRoot,
  "eval-data/image-atomic-batch-c/regression-v1",
);
const artifactId = "01K00000000000000000000000";

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), {
    recursive: true,
  });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function png(path: string, image: RgbaImage): Promise<void> {
  await mkdir(resolve(path, ".."), {
    recursive: true,
  });
  await sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: false,
    })
    .toFile(path);
}

function rgba(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return Object.freeze({
    data,
    width,
    height,
  });
}

async function batchB(): Promise<void> {
  const clean = rgba(5, 5, (x, y) => [
    60,
    60,
    60,
    (x + y) % 3 === 0 ? 128 : 255,
  ]);
  const noisyData = new Uint8ClampedArray(clean.data);
  noisyData.set([220, 220, 220], (2 * 5 + 2) * 4);
  const noisy = Object.freeze({
    data: noisyData,
    width: 5,
    height: 5,
  });
  const denoised = denoiseBrowserPixels({
    pixels: noisyData,
    width: 5,
    height: 5,
    strength: 1,
  });
  const denoiseCandidate = Object.freeze({
    data: denoised.pixels,
    width: 5,
    height: 5,
  });

  const dark = rgba(4, 4, (x, y) => [
    40,
    40,
    40,
    (x + y) % 4 === 0 ? 160 : 255,
  ]);
  const enhanced = enhanceBrowserLightPixels({
    pixels: new Uint8ClampedArray(dark.data),
    width: 4,
    height: 4,
    parameters: {
      exposureStops: 1,
      shadows: 0,
      highlights: 0,
      temperature: 0,
      tint: 0,
    },
  });
  const enhancedCandidate = Object.freeze({
    data: enhanced.pixels,
    width: 4,
    height: 4,
  });
  const enhancedTruth = rgba(4, 4, (x, y) => [
    80,
    80,
    80,
    (x + y) % 4 === 0 ? 160 : 255,
  ]);

  await Promise.all([
    png(resolve(batchBRoot, "denoise/noisy.png"), noisy),
    png(resolve(batchBRoot, "denoise/candidate.png"), denoiseCandidate),
    png(resolve(batchBRoot, "denoise/clean.png"), clean),
    png(resolve(batchBRoot, "light-enhance/source.png"), dark),
    png(resolve(batchBRoot, "light-enhance/candidate.png"), enhancedCandidate),
    png(resolve(batchBRoot, "light-enhance/ground-truth.png"), enhancedTruth),
  ]);

  await json(resolve(batchBRoot, "manifest.json"), {
    schemaVersion: "kanvas.image-atomic-batch-b-eval/v1",
    corpusId: "atom-batch-02-metric-regression-v1",
    evidenceClass: "metric_regression",
    anonymized: true,
    samples: [
      {
        id: "denoise-isolated-impulse",
        capability: "image.denoise",
        target: "browser",
        implementationDigest:
          defaultCatalogImplementationDigests.denoiseBrowser,
        categories: ["isolated-impulse", "alpha"],
        sourceFile: "denoise/noisy.png",
        candidateFile: "denoise/candidate.png",
        expectedFile: "denoise/clean.png",
        thresholds: {
          psnrGain: {
            operator: "gte",
            value: 20,
          },
          edgeRetention: {
            operator: "eq",
            value: 1,
          },
          alphaExactRatio: {
            operator: "eq",
            value: 1,
          },
        },
      },
      {
        id: "light-enhance-one-stop",
        capability: "image.light.enhance",
        target: "browser",
        implementationDigest:
          defaultCatalogImplementationDigests.lightEnhanceBrowser,
        categories: ["under-exposure", "alpha"],
        sourceFile: "light-enhance/source.png",
        candidateFile: "light-enhance/candidate.png",
        expectedFile: "light-enhance/ground-truth.png",
        thresholds: {
          maeImprovement: {
            operator: "gte",
            value: 40,
          },
          luminanceMae: {
            operator: "eq",
            value: 0,
          },
          clippedRatio: {
            operator: "eq",
            value: 0,
          },
          alphaExactRatio: {
            operator: "eq",
            value: 1,
          },
        },
      },
    ],
  });
}

async function batchC(): Promise<void> {
  const source = rgba(6, 4, (x, y) => {
    if (x < 2 && y >= 2) {
      return [20, 20, 20, 0];
    }
    return x < 3 ? [20, 20, 20, 255] : [220, 30, 30, 255];
  });
  const cropInput = {
    sourceArtifactId: artifactId,
    aspectRatios: ["1:1"],
    maxSuggestionsPerRatio: 3,
    safeMarginRatio: 0.05,
    subjectBounds: [
      {
        x: 3,
        y: 0,
        width: 3,
        height: 4,
      },
    ],
  };
  const cropSuggestions = suggestCrops(source, cropInput);
  const preferredCrop = cropSuggestions[0];
  if (!preferredCrop) {
    throw new Error("Crop regression fixture produced no suggestion.");
  }
  const palette = extractPalette(source, {
    sourceArtifactId: artifactId,
    colorCount: 2,
    alphaThreshold: 16,
    sampleSize: 32,
  });
  const quality = assessQuality(source, {
    sourceArtifactId: artifactId,
    subjectBounds: cropInput.subjectBounds,
    sampleSize: 64,
  });

  const foreground = rgba(2, 2, (x, y) => [
    240,
    x === y ? 40 : 100,
    20,
    x === 0 && y === 0 ? 128 : 255,
  ]);
  const compose = composeBackground({
    foreground,
    input: {
      foregroundArtifactId: artifactId,
      background: {
        kind: "color",
        color: "#203040FF",
      },
      canvas: {
        width: 4,
        height: 2,
      },
      placement: {
        x: 1,
        y: 0,
        width: 2,
        height: 2,
        fit: "contain",
        opacity: 1,
      },
    },
  });

  await Promise.all([
    json(resolve(batchCRoot, "crop/candidate.json"), {
      suggestions: cropSuggestions,
    }),
    json(resolve(batchCRoot, "crop/ground-truth.json"), {
      preferred: [
        {
          aspectRatio: preferredCrop.aspectRatio,
          bounds: preferredCrop.bounds,
        },
      ],
    }),
    json(resolve(batchCRoot, "palette/candidate.json"), {
      colors: palette.colors,
    }),
    json(resolve(batchCRoot, "palette/ground-truth.json"), {
      colors: palette.colors.map(({ red, green, blue, proportion }) => ({
        red,
        green,
        blue,
        proportion,
      })),
    }),
    json(resolve(batchCRoot, "quality/candidate.json"), quality),
    json(resolve(batchCRoot, "quality/ground-truth.json"), quality),
    png(resolve(batchCRoot, "compose/candidate.png"), compose.image),
    png(resolve(batchCRoot, "compose/ground-truth.png"), compose.image),
    png(resolve(batchCRoot, "compose/candidate-mask.png"), compose.mask),
    png(resolve(batchCRoot, "compose/ground-truth-mask.png"), compose.mask),
  ]);

  await json(resolve(batchCRoot, "manifest.json"), {
    schemaVersion: "kanvas.image-atomic-batch-c-eval/v1",
    corpusId: "atom-batch-03-metric-regression-v1",
    evidenceClass: "metric_regression",
    anonymized: true,
    samples: [
      {
        id: "crop-off-center-subject",
        capability: "image.crop.suggest",
        target: "browser",
        implementationDigest:
          "sha256:d28502069cb368e73e92600aca2dc86639fe36894c0a3b20cd765b2cc1e8c351",
        categories: ["off-center-subject", "square"],
        candidateFile: "crop/candidate.json",
        expectedFile: "crop/ground-truth.json",
        thresholds: {
          meanTopOneIou: {
            operator: "eq",
            value: 1,
          },
          topThreeHitRate: {
            operator: "eq",
            value: 1,
          },
          meanSubjectRetention: {
            operator: "eq",
            value: 1,
          },
        },
      },
      {
        id: "palette-alpha-and-accent",
        capability: "image.palette.extract",
        target: "browser",
        implementationDigest:
          "sha256:a7328b321ee171692c912b216754b9c8db4a151b3476f3edfc468c094073b614",
        categories: ["dominant-accent", "transparency"],
        candidateFile: "palette/candidate.json",
        expectedFile: "palette/ground-truth.json",
        thresholds: {
          weightedColorDistance: {
            operator: "eq",
            value: 0,
          },
          weightedProportionError: {
            operator: "eq",
            value: 0,
          },
          paletteCoverage: {
            operator: "eq",
            value: 1,
          },
        },
      },
      {
        id: "quality-controlled-source",
        capability: "image.quality.assess",
        target: "browser",
        implementationDigest:
          "sha256:1bb161eeaac77c23da04d3f67e2dd21238e88d83725909ebb6861ca4e91a8433",
        categories: ["controlled-source", "subject-scale"],
        candidateFile: "quality/candidate.json",
        expectedFile: "quality/ground-truth.json",
        thresholds: {
          scoreMae: {
            operator: "eq",
            value: 0,
          },
          findingF1: {
            operator: "eq",
            value: 1,
          },
          usabilityMatch: {
            operator: "eq",
            value: 1,
          },
        },
      },
      {
        id: "compose-partial-alpha",
        capability: "image.background.compose",
        target: "browser",
        implementationDigest:
          "sha256:13b7f5179254b8e9d888badf31bbae67d0e5ed8fa565fbc5bd45a1cc05f36abb",
        categories: ["partial-alpha", "contain"],
        candidateFile: "compose/candidate.png",
        expectedFile: "compose/ground-truth.png",
        candidateMaskFile: "compose/candidate-mask.png",
        expectedMaskFile: "compose/ground-truth-mask.png",
        thresholds: {
          pixelExactRatio: {
            operator: "eq",
            value: 1,
          },
          channelMae: {
            operator: "eq",
            value: 0,
          },
          alphaExactRatio: {
            operator: "eq",
            value: 1,
          },
          compositionMaskIou: {
            operator: "eq",
            value: 1,
          },
        },
      },
    ],
  });
}

await Promise.all([batchB(), batchC()]);

process.stdout.write(
  `${JSON.stringify({
    batchB: resolve(batchBRoot, "manifest.json"),
    batchC: resolve(batchCRoot, "manifest.json"),
  })}\n`,
);
