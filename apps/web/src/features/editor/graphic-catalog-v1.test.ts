import { describe, expect, it } from "vitest";

import {
  canvasGraphicCatalogV1,
  canvasGraphicDefinitionV1,
} from "./graphic-catalog-v1.js";

describe("Canvas Core V1 graphic catalog", () => {
  it("provides a searchable, recolorable built-in vector range", () => {
    expect(canvasGraphicCatalogV1.length).toBeGreaterThanOrEqual(10);

    for (const graphic of canvasGraphicCatalogV1) {
      expect(graphic.catalogId).toBe("kanvas.core.graphics");
      expect(graphic.keywords.length).toBeGreaterThan(0);
      expect(graphic.paths.length).toBeGreaterThan(0);
      expect(graphic.defaultAspectRatio).toBeGreaterThan(0);
      expect(
        graphic.paths.every((path) =>
          ["primary", "secondary"].includes(path.colorSlot),
        ),
      ).toBe(true);
    }
  });

  it("resolves only an exact versioned resource", () => {
    const graphic = canvasGraphicCatalogV1[0];

    expect(
      canvasGraphicDefinitionV1(
        graphic.catalogId,
        graphic.resourceId,
        graphic.revision,
      ),
    ).toBe(graphic);
    expect(
      canvasGraphicDefinitionV1(
        graphic.catalogId,
        graphic.resourceId,
        "future",
      ),
    ).toBeUndefined();
  });
});
