import { describe, expect, it } from "vitest";

import {
  canvasFrameCatalogV1,
  canvasFrameDefinitionV1,
  canvasGridCatalogV1,
  canvasGridDefinitionV1,
} from "./frame-grid-catalog-v1.js";

describe("Canvas Core V1 frame and grid catalogs", () => {
  it("provides practical frame masks and grid layouts", () => {
    expect(canvasFrameCatalogV1.length).toBeGreaterThanOrEqual(7);
    expect(canvasGridCatalogV1.length).toBeGreaterThanOrEqual(7);
    expect(canvasGridCatalogV1.map((grid) => grid.definitionId)).toEqual(
      expect.arrayContaining([
        "grid.two.columns",
        "grid.three.columns",
        "grid.hero-left",
        "grid.four",
        "grid.nine",
      ]),
    );
  });

  it("keeps every grid slot bounded and uniquely named", () => {
    for (const grid of canvasGridCatalogV1) {
      const ids = grid.slots.map((slot) => slot.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const slot of grid.slots) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.x + slot.width).toBeLessThanOrEqual(1);
        expect(slot.y + slot.height).toBeLessThanOrEqual(1);
      }
    }
  });

  it("resolves exact versioned definitions without fallback", () => {
    expect(
      canvasFrameDefinitionV1({
        catalogId: "kanvas.core.frames",
        definitionId: "frame.circle",
        revision: "2026-07-31",
      }).label,
    ).toBe("圆形画框");
    expect(
      canvasGridDefinitionV1({
        catalogId: "kanvas.core.grids",
        definitionId: "grid.nine",
        revision: "2026-07-31",
      }).slots,
    ).toHaveLength(9);
    expect(() =>
      canvasGridDefinitionV1({
        catalogId: "kanvas.core.grids",
        definitionId: "grid.nine",
        revision: "missing",
      }),
    ).toThrow("is not loaded");
  });
});
