import { describe, expect, it } from "vitest";

import {
  canvasShapeCatalogV1,
  canvasShapeDefinitionV1,
  findCanvasShapeDefinitionV1,
} from "./shape-catalog-v1.js";

describe("Canvas Core V1 shape catalog", () => {
  it("ships a broad built-in catalog across the required design categories", () => {
    expect(canvasShapeCatalogV1.length).toBeGreaterThanOrEqual(45);
    expect(
      new Set(canvasShapeCatalogV1.map((shape) => shape.category)),
    ).toEqual(
      new Set(["basic", "arrows", "decorative", "callouts", "flowchart"]),
    );
  });

  it("uses unique versioned definition identities", () => {
    const identities = canvasShapeCatalogV1.map(
      (shape) => `${shape.definitionId}@${shape.revision}`,
    );
    expect(new Set(identities).size).toBe(identities.length);
    expect(
      canvasShapeCatalogV1.every(
        (shape) =>
          shape.definitionId.includes(".") && shape.revision.length > 0,
      ),
    ).toBe(true);
  });

  it("provides searchable labels and bounded geometry for every definition", () => {
    for (const shape of canvasShapeCatalogV1) {
      expect(shape.label).not.toBe("");
      expect(shape.defaultAspectRatio).toBeGreaterThan(0);
      expect(shape.textArea.top).toBeGreaterThanOrEqual(0);
      expect(shape.textArea.right).toBeGreaterThanOrEqual(0);
      expect(shape.textArea.bottom).toBeGreaterThanOrEqual(0);
      expect(shape.textArea.left).toBeGreaterThanOrEqual(0);

      if (shape.geometry.kind === "polygon") {
        expect(shape.geometry.points.length).toBeGreaterThanOrEqual(3);
        for (const point of shape.geometry.points) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(1);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keeps parameter identities unique inside each definition", () => {
    for (const shape of canvasShapeCatalogV1) {
      const ids = shape.parameters.map((parameter) => parameter.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const parameter of shape.parameters) {
        expect(parameter.minimum).toBeLessThanOrEqual(parameter.defaultValue);
        expect(parameter.defaultValue).toBeLessThanOrEqual(parameter.maximum);
      }
    }
  });

  it("resolves exact revisions and never silently falls back to a rectangle", () => {
    expect(
      canvasShapeDefinitionV1({
        catalogId: "kanvas.core.shapes",
        definitionId: "flowchart.database",
        revision: "2026-07-31",
      }).label,
    ).toBe("数据库");

    expect(
      findCanvasShapeDefinitionV1("flowchart.database", "missing-revision"),
    ).toBeUndefined();
    expect(() =>
      canvasShapeDefinitionV1({
        catalogId: "kanvas.core.shapes",
        definitionId: "missing-shape",
        revision: "2026-07-31",
      }),
    ).toThrow("is not loaded");
  });
});
