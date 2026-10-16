import { describe, expect, it } from "vitest";

import {
  evaluateBackgroundCompose,
  evaluateCropSuggest,
  evaluatePaletteExtract,
  evaluateQualityAssess,
} from "../src/batch-c-eval.js";

describe("Batch C image atomic Eval", () => {
  it("scores ordered crop choice and subject retention", () => {
    expect(
      evaluateCropSuggest(
        {
          suggestions: [
            {
              aspectRatio: "1:1",
              rank: 1,
              bounds: {
                x: 10,
                y: 10,
                width: 50,
                height: 50,
              },
              subjectRetention: 1,
            },
          ],
        },
        {
          preferred: [
            {
              aspectRatio: "1:1",
              bounds: {
                x: 10,
                y: 10,
                width: 50,
                height: 50,
              },
            },
          ],
        },
      ),
    ).toEqual({
      meanTopOneIou: 1,
      topThreeHitRate: 1,
      meanSubjectRetention: 1,
    });
  });

  it("scores palette color and proportion independently", () => {
    const palette = {
      colors: [
        {
          red: 255,
          green: 0,
          blue: 0,
          proportion: 1,
        },
      ],
    };
    expect(evaluatePaletteExtract(palette, palette)).toEqual({
      weightedColorDistance: 0,
      weightedProportionError: 0,
      paletteCoverage: 1,
    });
  });

  it("scores diagnostic values, findings and usability independently", () => {
    const quality = {
      blurScore: 0.2,
      compressionScore: 0.1,
      noiseScore: 0.3,
      overExposureRatio: 0,
      underExposureRatio: 0.4,
      findings: ["under_exposed"],
      usability: "review" as const,
    };
    expect(evaluateQualityAssess(quality, quality)).toEqual({
      scoreMae: 0,
      findingPrecision: 1,
      findingRecall: 1,
      findingF1: 1,
      usabilityMatch: 1,
    });
  });

  it("scores composed pixels, alpha and Mask independently", () => {
    const image = {
      width: 1,
      height: 1,
      data: Uint8Array.from([10, 20, 30, 255]),
    };
    const mask = {
      width: 1,
      height: 1,
      data: Uint8Array.from([255, 255, 255, 255]),
    };
    expect(
      evaluateBackgroundCompose({
        candidate: image,
        expected: image,
        candidateMask: mask,
        expectedMask: mask,
      }),
    ).toEqual({
      pixelExactRatio: 1,
      channelMae: 0,
      alphaExactRatio: 1,
      compositionMaskIou: 1,
    });
  });
});
