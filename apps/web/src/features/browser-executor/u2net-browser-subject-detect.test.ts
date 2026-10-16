import { describe, expect, it } from "vitest";

import {
  detectBrowserSubjects,
  parseBrowserSubjectDetectInput,
} from "./u2net-browser-background-remove.js";

function mask(): Uint8Array {
  const size = 20;
  const value = new Uint8Array(size * size);
  for (let y = 2; y < 10; y += 1) {
    for (let x = 1; x < 8; x += 1) {
      value[y * size + x] = 230;
    }
  }
  for (let y = 14; y < 18; y += 1) {
    for (let x = 15; x < 19; x += 1) {
      value[y * size + x] = 190;
    }
  }
  return value;
}

describe("Browser IS-Net subject detection", () => {
  it("returns deterministic multi-subject bounds without modifying the source", () => {
    const input = parseBrowserSubjectDetectInput({
      sourceArtifactId: "01K00000000000000000000001",
      maxSubjects: 4,
      minimumAreaRatio: 0.01,
      minimumConfidence: 0.5,
      includeMask: true,
    });

    expect(
      detectBrowserSubjects(
        {
          analysisMask: mask(),
          analysisSize: 20,
          width: 1000,
          height: 500,
        },
        input,
        new AbortController().signal,
      ),
    ).toEqual([
      expect.objectContaining({
        subjectId: "subject-1",
        rank: 1,
        category: "visual_subject",
        bounds: {
          x: 50,
          y: 50,
          width: 350,
          height: 200,
        },
      }),
      expect.objectContaining({
        subjectId: "subject-2",
        rank: 2,
        category: "visual_subject",
        bounds: {
          x: 750,
          y: 350,
          width: 200,
          height: 100,
        },
      }),
    ]);
  });

  it("rejects unsupported semantic or unbounded options", () => {
    expect(() =>
      parseBrowserSubjectDetectInput({
        sourceArtifactId: "01K00000000000000000000001",
        maxSubjects: 100,
      }),
    ).toThrow(/invalid/u);
    expect(() =>
      parseBrowserSubjectDetectInput({
        sourceArtifactId: "01K00000000000000000000001",
        category: "person",
      }),
    ).toThrow(/invalid/u);
  });
});
