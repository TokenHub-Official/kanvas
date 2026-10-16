import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createU2NetOnnxInference,
  imageSha256,
} from "../src/adapter/u2net-background-remove-adapter.js";

describe("local U2-Net model execution", () => {
  it("loads the pinned ONNX test resource and returns its declared mask tensor", async () => {
    const bytes = await readFile(
      resolve(import.meta.dirname, "../../../.tmp/test-models/u2netp.onnx"),
    );
    const inference = createU2NetOnnxInference(
      {
        inputSize: 320,
        license: "Apache-2.0",
        normalization: "imagenet",
        sha256: imageSha256(bytes),
        variant: "u2netp",
      },
      () => Promise.resolve(bytes),
    );

    const result = await inference.infer(
      new Float32Array(1 * 3 * 320 * 320),
      new AbortController().signal,
    );
    const mask = result instanceof Float32Array ? result : result.mask;

    expect(mask).toHaveLength(1 * 1 * 320 * 320);
    expect(Number.isFinite(mask[0])).toBe(true);
  }, 30_000);
});
