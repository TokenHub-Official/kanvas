import { describe, expect, it } from "vitest";

import {
  canvasLineCatalogV1,
  canvasLineDefinitionV1,
} from "./line-catalog-v1.js";

describe("Canvas Core V1 line catalog", () => {
  it("contains straight, dashed, curved and connector variants", () => {
    expect(new Set(canvasLineCatalogV1.map((line) => line.pathKind))).toEqual(
      new Set(["straight", "curve", "polyline"]),
    );
    expect(
      canvasLineCatalogV1.some((line) => line.dash && line.dash.length > 0),
    ).toBe(true);
    expect(canvasLineCatalogV1.some((line) => line.endCap === "arrow")).toBe(
      true,
    );
  });

  it("resolves exact versions without fallback", () => {
    expect(
      canvasLineDefinitionV1({
        catalogId: "kanvas.core.lines",
        definitionId: "line.curve-arrow",
        revision: "2026-07-31",
      }).pathKind,
    ).toBe("curve");
    expect(() =>
      canvasLineDefinitionV1({
        catalogId: "kanvas.core.lines",
        definitionId: "line.curve-arrow",
        revision: "missing",
      }),
    ).toThrow("is not loaded");
  });
});
