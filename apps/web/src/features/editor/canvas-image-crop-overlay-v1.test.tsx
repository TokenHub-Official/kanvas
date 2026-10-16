import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  canvasImageCropMaskRectsV1,
  CanvasImageCropOverlayV1,
} from "./canvas-image-crop-overlay-v1.js";
import type { EditorRuntimeNodeV1 } from "./editor-runtime-v1.js";

const node = {
  id: "image-1",
  kind: "image",
  name: "Image",
  opacity: 1,
  blendMode: "normal",
  visible: true,
  locked: false,
  transform: {
    x: 100,
    y: 120,
    width: 400,
    height: 300,
    rotation: 15,
    flipX: false,
    flipY: false,
  },
  image: {
    source: { kind: "artifact", artifactId: "artifact-1" },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    fit: "cover",
    focalPoint: { x: 0.5, y: 0.5 },
  },
  cornerRadius: 0,
} as const satisfies EditorRuntimeNodeV1;

describe("CanvasImageCropOverlayV1", () => {
  it("renders one direct manipulation surface and rule-of-thirds guides", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <CanvasImageCropOverlayV1
          freeCrop
          node={node}
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onResizePointerDown={vi.fn()}
          onResizePointerMove={vi.fn()}
          onResizePointerUp={vi.fn()}
          sourceNode={node}
          zoom={2}
        />
      </svg>,
    );

    expect(markup).toContain('data-image-crop-overlay="true"');
    expect(markup).toContain('aria-label="Move image crop frame"');
    expect(markup.match(/aria-label="Resize crop/g)).toHaveLength(8);
    expect(markup.match(/<line/g)).toHaveLength(4);
    expect(markup).toContain("rotate(15 200 150)");
  });

  it("covers exactly the four source regions outside the crop frame", () => {
    const sourceNode = {
      ...node,
      transform: { ...node.transform, width: 800, height: 600 },
    };
    const croppedNode = {
      ...node,
      image: {
        ...node.image,
        crop: { x: 0.25, y: 0.2, width: 0.5, height: 0.5 },
      },
    };

    expect(canvasImageCropMaskRectsV1(croppedNode, sourceNode)).toEqual([
      { id: "top", x: 0, y: 0, width: 800, height: 120 },
      { id: "bottom", x: 0, y: 420, width: 800, height: 180 },
      { id: "left", x: 0, y: 120, width: 200, height: 300 },
      { id: "right", x: 600, y: 120, width: 200, height: 300 },
    ]);
  });

  it("mirrors mask placement with the source image flip", () => {
    const sourceNode = {
      ...node,
      transform: {
        ...node.transform,
        width: 800,
        height: 600,
        flipX: true,
      },
    };
    const croppedNode = {
      ...node,
      image: {
        ...node.image,
        crop: { x: 0.1, y: 0, width: 0.25, height: 1 },
      },
    };

    expect(canvasImageCropMaskRectsV1(croppedNode, sourceNode)).toEqual([
      { id: "left", x: 0, y: 0, width: 520, height: 600 },
      { id: "right", x: 720, y: 0, width: 80, height: 600 },
    ]);
  });
});
