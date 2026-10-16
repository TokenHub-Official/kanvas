import { describe, expect, it } from "vitest";

import {
  evaluateDenoise,
  evaluateLightEnhance,
  evaluateObjectRemove,
  evaluateTextExtract,
  evaluateThresholds,
  type OcrEvalDocument,
  type RgbaImage,
} from "../src/eval.js";

function image(
  width: number,
  height: number,
  pixels: readonly number[],
): RgbaImage {
  return Object.freeze({
    width,
    height,
    data: Uint8Array.from(pixels),
  });
}

function solid(
  width: number,
  height: number,
  value: number,
  alpha = 255,
): RgbaImage {
  return image(
    width,
    height,
    Array.from({ length: width * height }, () => [
      value,
      value,
      value,
      alpha,
    ]).flat(),
  );
}

describe("Batch B image atomic Eval", () => {
  it("measures object removal inside the mask while proving exact outside restoration", () => {
    const source = image(2, 1, [20, 30, 40, 255, 50, 60, 70, 128]);
    const expected = image(2, 1, [100, 110, 120, 255, 50, 60, 70, 128]);
    const mask = image(2, 1, [255, 255, 255, 255, 0, 0, 0, 255]);

    expect(
      evaluateObjectRemove({
        candidate: expected,
        expected,
        source,
        mask,
      }),
    ).toEqual({
      outsideMaskExactRatio: 1,
      insideMaskMae: 0,
      insideMaskPsnr: 99,
      seamMae: 0,
    });
  });

  it("reports denoise gain, edge retention and alpha fidelity separately", () => {
    const clean = solid(3, 3, 20, 128);
    const noisyPixels = [...clean.data];
    noisyPixels[4 * 4] = 240;
    noisyPixels[4 * 4 + 1] = 240;
    noisyPixels[4 * 4 + 2] = 240;
    const noisy = image(3, 3, noisyPixels);
    const metrics = evaluateDenoise({
      candidate: clean,
      clean,
      noisy,
    });

    expect(metrics.candidatePsnr).toBe(99);
    expect(metrics.psnrGain).toBeGreaterThan(0);
    expect(metrics.edgeRetention).toBe(1);
    expect(metrics.alphaExactRatio).toBe(1);
  });

  it("reports light correction error, clipping and alpha fidelity", () => {
    const source = solid(2, 2, 20, 64);
    const expected = solid(2, 2, 100, 64);
    const metrics = evaluateLightEnhance({
      candidate: expected,
      expected,
      source,
    });

    expect(metrics.candidateMae).toBe(0);
    expect(metrics.maeImprovement).toBe(80);
    expect(metrics.luminanceMae).toBe(0);
    expect(metrics.clippedRatio).toBe(0);
    expect(metrics.alphaExactRatio).toBe(1);
  });

  it("keeps OCR text, polygon and confidence calibration metrics independent", () => {
    const document: OcrEvalDocument = {
      text: "Kanvas 画板",
      language: "zh-CN",
      direction: "ltr",
      blocks: [
        {
          text: "Kanvas 画板",
          confidence: 0.9,
          polygon: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 20 },
            { x: 0, y: 20 },
          ],
        },
      ],
    };
    expect(
      evaluateTextExtract({
        candidate: document,
        expected: document,
      }),
    ).toEqual({
      characterErrorRate: 0,
      wordErrorRate: 0,
      meanPolygonIou: 1,
      confidenceBrierScore: 0.01,
      languageMatch: 1,
      directionMatch: 1,
    });
  });

  it("evaluates only explicitly approved per-metric thresholds", () => {
    expect(
      evaluateThresholds(
        {
          outsideMaskExactRatio: 1,
          seamMae: 2,
        },
        {
          outsideMaskExactRatio: {
            operator: "eq",
            value: 1,
          },
          seamMae: {
            operator: "lte",
            value: 3,
          },
        },
      ),
    ).toEqual({
      passed: true,
      failures: [],
    });
  });
});
