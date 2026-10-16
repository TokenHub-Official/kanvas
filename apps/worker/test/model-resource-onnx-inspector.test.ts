import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { inspectOnnxNativeInterface } from "../src/model-resource/model-resource-onnx-inspector.js";

describe("ONNX model resource interface inspection", () => {
  it("reads the actual graph input and output signature", async () => {
    const bytes = await readFile(
      resolve(import.meta.dirname, "../../../.tmp/test-models/u2netp.onnx"),
    );
    const result = await inspectOnnxNativeInterface(bytes);

    expect(result.protocol).toBe("tensor");
    expect(result.inputSchema).toMatchObject({
      required: ["input.1"],
      properties: {
        "input.1": {
          minItems: 307_200,
          maxItems: 307_200,
          "x-kanvas-tensor": {
            dataType: "float32",
            shape: [1, 3, 320, 320],
          },
        },
      },
    });
    expect(result.outputSchema).toMatchObject({
      required: ["1959", "1960", "1961", "1962", "1963", "1964", "1965"],
      properties: {
        "1959": {
          minItems: 102_400,
          maxItems: 102_400,
          "x-kanvas-tensor": {
            dataType: "float32",
            shape: [1, 1, 320, 320],
          },
        },
      },
    });
  });

  it("matches the trusted ISNet Catalog interface to the pinned test model bytes", async () => {
    const [bytes, catalogText] = await Promise.all([
      readFile(
        resolve(
          import.meta.dirname,
          "../../../.tmp/test-models/isnet-general-fp16.onnx",
        ),
      ),
      readFile(
        resolve(
          import.meta.dirname,
          "../../../catalog-packages/kanvas-default/model-resources/isnet-isnet-general-fp16-r2.json",
        ),
        "utf8",
      ),
    ]);
    const catalog = JSON.parse(catalogText) as {
      readonly nativeInterface: unknown;
    };

    await expect(inspectOnnxNativeInterface(bytes)).resolves.toEqual(
      catalog.nativeInterface,
    );
  });
});
