import { describe, expect, it } from "vitest";

import {
  firstSupportedCanvasImage,
  supportedCanvasImageMediaTypes,
  supportedCanvasImages,
} from "./image-import.js";

describe("canvas image import", () => {
  it("accepts only the browser image formats supported by the canvas", () => {
    expect([...supportedCanvasImageMediaTypes]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("selects the first supported image from a mixed desktop drop", () => {
    const image = {
      name: "product.webp",
      type: "image/webp",
    };

    expect(
      firstSupportedCanvasImage([
        {
          name: "notes.txt",
          type: "text/plain",
        },
        image,
        {
          name: "later.png",
          type: "image/png",
        },
      ]),
    ).toBe(image);
  });

  it("returns undefined when a drop contains no supported image", () => {
    expect(
      firstSupportedCanvasImage([
        {
          name: "animation.gif",
          type: "image/gif",
        },
      ]),
    ).toBeUndefined();
  });

  it("keeps every supported image in desktop selection order", () => {
    expect(
      supportedCanvasImages([
        { name: "first.png", type: "image/png" },
        { name: "skip.gif", type: "image/gif" },
        { name: "second.webp", type: "image/webp" },
      ]).map((file) => file.name),
    ).toEqual(["first.png", "second.webp"]);
  });
});
