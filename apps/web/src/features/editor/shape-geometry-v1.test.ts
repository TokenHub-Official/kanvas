import { describe, expect, it } from "vitest";

import {
  canvasShapeCatalogV1,
  canvasShapeDefinitionV1,
} from "./shape-catalog-v1.js";
import { materializeCanvasShapePathV1 } from "./shape-geometry-v1.js";

function definition(definitionId: string) {
  return canvasShapeDefinitionV1({
    catalogId: "kanvas.core.shapes",
    definitionId,
    revision: "2026-07-31",
  });
}

describe("Canvas Core V1 shape geometry", () => {
  it("materializes every built-in definition into shared path data", () => {
    for (const shape of canvasShapeCatalogV1) {
      const path = materializeCanvasShapePathV1(shape);

      expect(path.viewBox).toBe("0 0 100 100");
      expect(path.d.length).toBeGreaterThan(4);
      expect(path.d).not.toContain("NaN");
      expect(path.d).not.toContain("Infinity");
    }
  });

  it("applies and bounds rounded-rectangle parameters", () => {
    const shape = definition("basic.rounded-rectangle");

    expect(
      materializeCanvasShapePathV1(shape, {
        cornerRadius: 0,
      }).d,
    ).toBe("M0 0 H100 V100 H0 Z");
    expect(
      materializeCanvasShapePathV1(shape, {
        cornerRadius: 9,
      }).d,
    ).toContain("M50 0");
  });

  it("changes ring geometry through the declared inner-radius parameter", () => {
    const shape = definition("basic.ring");
    const compact = materializeCanvasShapePathV1(shape, {
      innerRadius: 0.2,
    });
    const open = materializeCanvasShapePathV1(shape, {
      innerRadius: 0.9,
    });

    expect(compact.fillRule).toBe("evenodd");
    expect(open.fillRule).toBe("evenodd");
    expect(compact.d).not.toBe(open.d);
  });

  it("changes cross and speech geometry through catalog parameters", () => {
    expect(
      materializeCanvasShapePathV1(definition("basic.cross"), {
        armWidth: 0.12,
      }).d,
    ).not.toBe(
      materializeCanvasShapePathV1(definition("basic.cross"), {
        armWidth: 0.42,
      }).d,
    );

    expect(
      materializeCanvasShapePathV1(definition("callout.speech-rounded"), {
        tailPosition: 0.2,
      }).d,
    ).not.toBe(
      materializeCanvasShapePathV1(definition("callout.speech-rounded"), {
        tailPosition: 0.8,
      }).d,
    );
  });
});
