import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CanvasSelectionOverlayV1 } from "./canvas-selection-overlay-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const line: Extract<EditorRuntimeNodeV1, { kind: "line" }> = {
  id: "line-1",
  name: "Curve",
  kind: "line",
  transform: {
    x: 100,
    y: 80,
    width: 240,
    height: 120,
    rotation: 0,
    flipX: false,
    flipY: false,
  },
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  pathKind: "curve",
  points: [
    { x: 0, y: 1 },
    { x: 0.5, y: 0 },
    { x: 1, y: 1 },
  ],
  stroke: {
    paint: { kind: "solid", color: "#151515" },
    width: 4,
    alignment: "center",
  },
  startCap: "none",
  endCap: "arrow",
  role: "design",
  capStyle: "round",
  joinStyle: "round",
};

describe("CanvasSelectionOverlayV1", () => {
  it("renders editable line points instead of a rectangular resize box", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasSelectionOverlayV1
          nodes={[line]}
          onHandlePointerDown={vi.fn()}
          onLinePointPointerDown={vi.fn()}
          zoom={1}
        />
      </svg>,
    );

    expect(markup).toContain('data-selection-overlay="line"');
    expect(markup).toContain('aria-label="Line point 1"');
    expect(markup).toContain('aria-label="Line point 2"');
    expect(markup).toContain('aria-label="Line point 3"');
    expect(markup).not.toContain("cursor-nwse-resize");
    expect(markup).toContain("canvas-v1-handle-rotate");
    expect(markup).toContain('data-line-selection-halo=""');
    expect(markup).toContain('data-line-selection-restore=""');
  });

  it("shows Shape anchors only while an endpoint connection gesture is active", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasSelectionOverlayV1
          connectionAnchors={[
            {
              anchor: "right",
              binding: { nodeId: "shape-1", anchor: "right" },
              point: { x: 400, y: 220 },
            },
          ]}
          nodes={[line]}
          onHandlePointerDown={vi.fn()}
          onLinePointPointerDown={vi.fn()}
          zoom={1}
        />
      </svg>,
    );

    expect(markup).toContain('data-connection-node-id="shape-1"');
    expect(markup).toContain('data-connection-anchor="right"');
  });

  it("keeps freehand strokes on the bounded transform overlay", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasSelectionOverlayV1
          nodes={[{ ...line, role: "freehand", pathKind: "polyline" }]}
          onHandlePointerDown={vi.fn()}
          zoom={1}
        />
      </svg>,
    );

    expect(markup).toContain('data-selection-overlay="true"');
    expect(markup).toContain("cursor-nwse-resize");
    expect(markup).not.toContain('data-selection-overlay="line"');
  });

  it("fails legacy lines closed instead of exposing every sampled point", () => {
    const { role: ignoredRole, ...legacyLine } = line;
    void ignoredRole;
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasSelectionOverlayV1
          nodes={[{ ...legacyLine, pathKind: "polyline" }]}
          onHandlePointerDown={vi.fn()}
          onLinePointPointerDown={vi.fn()}
          zoom={1}
        />
      </svg>,
    );

    expect(markup).toContain('data-selection-overlay="true"');
    expect(markup).not.toContain("canvas-v1-line-point-handle");
  });

  it("keeps locked or read-only line handles visibly non-actionable", () => {
    const lockedMarkup = renderToStaticMarkup(
      <svg>
        <CanvasSelectionOverlayV1
          nodes={[{ ...line, locked: true }]}
          onHandlePointerDown={vi.fn()}
          onLinePointPointerDown={vi.fn()}
          zoom={1}
        />
      </svg>,
    );
    const readonlyMarkup = renderToStaticMarkup(
      <svg>
        <CanvasSelectionOverlayV1
          editable={false}
          nodes={[line]}
          onHandlePointerDown={vi.fn()}
          onLinePointPointerDown={vi.fn()}
          zoom={1}
        />
      </svg>,
    );

    expect(lockedMarkup).toContain('data-selection-overlay="line"');
    expect(lockedMarkup).not.toContain("canvas-v1-line-point-handle");
    expect(readonlyMarkup).not.toContain("canvas-v1-line-point-handle");
    expect(readonlyMarkup).not.toContain("canvas-v1-handle-rotate");
  });
});
