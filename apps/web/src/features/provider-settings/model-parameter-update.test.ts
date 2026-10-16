import { describe, expect, it } from "vitest";
import {
  mergeImageModelParameters,
  type ImageModelOperations,
} from "./model-parameter-update.js";

const quality = (values: string[]) => ({
  key: "quality",
  label: "Quality",
  valueType: "enum" as const,
  values,
  required: false,
});
const ops = (values: string[]): ImageModelOperations => ({
  "image.generate": { parameters: [quality(values)] },
});

describe("image model parameter updates", () => {
  it("updates unchanged parameters without mutating the saved configuration", () => {
    const current = ops(["low"]);
    expect(
      mergeImageModelParameters(current, current, ops(["low", "high"])),
    ).toMatchObject({
      merged: ops(["low", "high"]),
      preserved: [],
      changed: true,
    });
    expect(current).toEqual(ops(["low"]));
  });
  it("preserves local overrides and imports new source fields", () => {
    const incoming: ImageModelOperations = {
      "image.generate": {
        parameters: [
          quality(["auto", "low", "high"]),
          {
            key: "outputFormat",
            label: "Format",
            valueType: "enum",
            required: false,
            values: ["png"],
          },
        ],
      },
    };
    const result = mergeImageModelParameters(
      ops(["low", "high"]),
      ops(["high"]),
      incoming,
    );
    expect(result.merged["image.generate"]?.parameters).toEqual([
      quality(["high"]),
      incoming["image.generate"]!.parameters[1],
    ]);
    expect(result.preserved).toEqual(["image.generate.quality"]);
  });
  it("removes an unchanged operation but retains a modified one", () => {
    expect(
      mergeImageModelParameters(ops(["low"]), ops(["low"]), {}).merged,
    ).toEqual({});
    expect(
      mergeImageModelParameters(ops(["low"]), ops(["high"]), {}),
    ).toMatchObject({ merged: ops(["high"]), preserved: ["image.generate"] });
  });
  it("preserves a local field deletion while accepting other upstream changes", () => {
    const current: ImageModelOperations = {
      "image.generate": { parameters: [] },
    };
    expect(
      mergeImageModelParameters(ops(["low"]), current, ops(["high"])),
    ).toMatchObject({ merged: current, preserved: ["image.generate.quality"] });
  });
});
