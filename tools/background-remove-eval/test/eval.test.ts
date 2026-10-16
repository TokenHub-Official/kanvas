import { describe, expect, it } from "vitest";

import {
  backgroundRemoveEvalCategories,
  measureBinaryMasks,
  parseBackgroundRemoveEvalCorpus,
} from "../src/eval.js";

function corpus(sampleCount = 30): unknown {
  return {
    schemaVersion: "kanvas.background-remove-eval-corpus/v1",
    corpusId: "designer-corpus-2026-08",
    anonymized: true,
    samples: Array.from({ length: sampleCount }, (_, index) => ({
      id: `sample-${String(index + 1).padStart(2, "0")}`,
      categories: [
        backgroundRemoveEvalCategories[
          index % backgroundRemoveEvalCategories.length
        ],
      ],
      sourceFile: `sources/sample-${String(index + 1)}.png`,
      groundTruthMaskFile: `masks/sample-${String(index + 1)}.png`,
      annotation: {
        decision: index % 3 === 0 ? "mask_repair" : "direct_use",
        currentTool: "designer-baseline",
        manualMinutes: index + 1,
        ...(index % 3 === 0 ? { reworkReason: "边缘需要修订" } : {}),
      },
    })),
  };
}

describe("background-removal Eval", () => {
  it("measures perfect and partial foreground overlap with boundary quality", () => {
    const expected = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(
      measureBinaryMasks({
        predicted: expected,
        expected,
        width: 3,
        height: 3,
        boundaryTolerance: 0,
      }),
    ).toEqual({
      foregroundIou: 1,
      boundaryF1: 1,
    });
    expect(
      measureBinaryMasks({
        predicted: Uint8Array.from([0, 0, 0, 0, 1, 1, 0, 0, 0]),
        expected,
        width: 3,
        height: 3,
        boundaryTolerance: 0,
      }),
    ).toEqual({
      foregroundIou: 0.5,
      boundaryF1: 2 / 3,
    });
  });

  it("requires 30-50 anonymized samples and every risk category", () => {
    expect(parseBackgroundRemoveEvalCorpus(corpus()).samples).toHaveLength(30);
    expect(() => parseBackgroundRemoveEvalCorpus(corpus(29))).toThrow(/30-50/u);
    const missingCategory = corpus() as {
      samples: {
        categories: string[];
      }[];
    };
    for (const sample of missingCategory.samples) {
      sample.categories = ["person"];
    }
    expect(() => parseBackgroundRemoveEvalCorpus(missingCategory)).toThrow(
      /missing required categories/u,
    );
  });

  it("does not invent production thresholds without designer approval", () => {
    const parsed = parseBackgroundRemoveEvalCorpus(corpus());
    expect(parsed.thresholds).toBeUndefined();
    expect(() =>
      parseBackgroundRemoveEvalCorpus({
        ...(corpus() as object),
        thresholds: {
          minimumMeanIou: 0.9,
        },
      }),
    ).toThrow(/thresholds/u);
  });
});
