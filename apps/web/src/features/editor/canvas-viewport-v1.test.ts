import { describe, expect, it } from "vitest";

import {
  canvasViewportInsetFromCssV1,
  canvasViewportStorageKeyV1,
  fitCanvasViewportV1,
  panCanvasViewportV1,
  parseCanvasViewportV1,
  zoomCanvasViewportAtPointV1,
} from "./canvas-viewport-v1.js";

describe("Canvas Core V1 viewport", () => {
  it("fits a page inside the bounded professional zoom range", () => {
    const fitted = fitCanvasViewportV1(
      { width: 1600, height: 900 },
      { width: 1080, height: 1080 },
    );
    expect(fitted.zoom).toBeCloseTo(0.5796, 3);
    expect(fitted.panX).toBe(0);
    expect(fitted.panY).toBe(0);
    const largePage = fitCanvasViewportV1(
      { width: 300, height: 300 },
      { width: 4096, height: 4096 },
    );
    expect(largePage.zoom).toBeCloseTo(26 / 4096);
    expect(4096 * largePage.zoom).toBeLessThanOrEqual(26);
  });

  it("recomputes fit when the stage loses space to canvas chrome", () => {
    const page = { width: 1080, height: 1080 };
    const expanded = fitCanvasViewportV1({ width: 1600, height: 1200 }, page);
    const narrowed = fitCanvasViewportV1({ width: 1100, height: 1200 }, page);
    expect(narrowed.zoom).toBeLessThan(expanded.zoom);
    expect(page.width * narrowed.zoom).toBeLessThanOrEqual(1100 - 240);
    expect(page.height * narrowed.zoom).toBeLessThanOrEqual(1200 - 274);
    expect(narrowed.panX).toBe(0);
    expect(narrowed.panY).toBe(0);
  });

  it("derives the fit inset from the stage safe-area contract", () => {
    const properties = new Map([
      ["--canvas-v1-stage-safe-top", "80px"],
      ["--canvas-v1-stage-safe-inline", "96px"],
      ["--canvas-v1-stage-safe-bottom", "140px"],
    ]);
    expect(
      canvasViewportInsetFromCssV1({
        getPropertyValue(property) {
          return properties.get(property) ?? "";
        },
      }),
    ).toEqual({
      width: 192,
      height: 220,
    });
    expect(
      canvasViewportInsetFromCssV1({
        getPropertyValue() {
          return "";
        },
      }),
    ).toEqual({
      width: 240,
      height: 274,
    });
  });

  it("fits a tall page below the manual zoom floor when needed", () => {
    const fitted = fitCanvasViewportV1(
      { width: 1024 - 64, height: 768 - 56 },
      { width: 1080, height: 1920 },
    );
    expect(fitted.zoom).toBeCloseTo((768 - 56 - 274) / 1920);
    expect(fitted.zoom).toBeLessThan(0.25);
    expect(1080 * fitted.zoom).toBeLessThanOrEqual(1024 - 64 - 240);
    expect(1920 * fitted.zoom).toBeLessThanOrEqual(768 - 56 - 274);
  });

  it("keeps the page inside the safe area at the minimum editor width", () => {
    const stage = {
      width: 768 - 64,
      height: 720 - 56,
    };
    const page = { width: 1080, height: 1080 };
    const fitted = fitCanvasViewportV1(stage, page);

    expect(page.width * fitted.zoom).toBeLessThanOrEqual(stage.width - 240);
    expect(page.height * fitted.zoom).toBeLessThanOrEqual(stage.height - 274);
    expect(fitted.panX).toBe(0);
    expect(fitted.panY).toBe(0);
  });

  it("keeps the same page point under the pointer while zooming", () => {
    const viewport = {
      zoom: 0.5,
      panX: 40,
      panY: -20,
    };
    const stage = { width: 1200, height: 800 };
    const page = { width: 1000, height: 1000 };
    const anchor = { x: 820, y: 310 };
    const before = {
      x:
        page.width / 2 +
        (anchor.x - stage.width / 2 - viewport.panX) / viewport.zoom,
      y:
        page.height / 2 +
        (anchor.y - stage.height / 2 - viewport.panY) / viewport.zoom,
    };
    const next = zoomCanvasViewportAtPointV1(
      viewport,
      stage,
      page,
      anchor,
      1.25,
    );
    expect(
      page.width / 2 + (anchor.x - stage.width / 2 - next.panX) / next.zoom,
    ).toBeCloseTo(before.x);
    expect(
      page.height / 2 + (anchor.y - stage.height / 2 - next.panY) / next.zoom,
    ).toBeCloseTo(before.y);
  });

  it("pans without changing zoom and restores only valid state", () => {
    expect(
      panCanvasViewportV1({ zoom: 1, panX: 10, panY: 20 }, { x: -4, y: 8 }),
    ).toEqual({ zoom: 1, panX: 6, panY: 28 });
    expect(canvasViewportStorageKeyV1("w", "d", "p")).toBe(
      "kanvas:canvas-viewport:v1:w:d:p",
    );
  });

  it("persists fit intent separately from a manual viewport", () => {
    expect(canvasViewportStorageKeyV1("w", "d", "p")).toBe(
      "kanvas:canvas-viewport:v1:w:d:p",
    );
    expect(parseCanvasViewportV1(JSON.stringify({ mode: "fit" }))).toEqual({
      mode: "fit",
    });
    expect(
      parseCanvasViewportV1(
        JSON.stringify({
          mode: "manual",
          zoom: 4,
          panX: 12,
          panY: -8,
        }),
      ),
    ).toEqual({
      mode: "manual",
      zoom: 2,
      panX: 12,
      panY: -8,
    });
  });

  it("requires an explicit mode and valid coordinates", () => {
    expect(
      parseCanvasViewportV1(JSON.stringify({ zoom: 0.55, panX: 0, panY: 0 })),
    ).toBeUndefined();
    expect(
      parseCanvasViewportV1(
        JSON.stringify({
          mode: "manual",
          zoom: 1,
          panX: Number.NaN,
          panY: 0,
        }),
      ),
    ).toBeUndefined();
    expect(parseCanvasViewportV1("{")).toBeUndefined();
  });
});
