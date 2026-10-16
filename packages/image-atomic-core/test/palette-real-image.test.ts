import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  extractPalette,
  parsePaletteExtractInput,
  type RgbaImage,
} from "../src/index.js";

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbPng(source: URL): RgbaImage {
  const file = readFileSync(source);
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new Error("Fixture must be an 8-bit, non-interlaced RGB PNG.");
      }
    }
    if (type === "IDAT") compressed.push(data);
    offset += length + 12;
  }
  const encoded = inflateSync(Buffer.concat(compressed));
  const rowBytes = width * 3;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(rowBytes);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = encoded[sourceOffset++]!;
    const current = new Uint8Array(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const encodedByte = encoded[sourceOffset++]!;
      const left = index >= 3 ? current[index - 3]! : 0;
      const above = previous[index]!;
      const upperLeft = index >= 3 ? previous[index - 3]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0)
        throw new Error("Fixture PNG filter is unsupported.");
      current[index] = (encodedByte + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const rgbOffset = x * 3;
      const rgbaOffset = (y * width + x) * 4;
      rgba[rgbaOffset] = current[rgbOffset]!;
      rgba[rgbaOffset + 1] = current[rgbOffset + 1]!;
      rgba[rgbaOffset + 2] = current[rgbOffset + 2]!;
      rgba[rgbaOffset + 3] = 255;
    }
    previous = current;
  }
  return { width, height, data: rgba };
}

describe("real palette fixture", () => {
  it("retains the blue butterfly among the dominant colors", () => {
    const image = decodeRgbPng(
      new URL(
        "../../../apps/web/public/assets/canvas/image-tools/denoise.png",
        import.meta.url,
      ),
    );
    const result = extractPalette(
      image,
      parsePaletteExtractInput({
        sourceArtifactId: "01K00000000000000000000000",
        colorCount: 6,
        alphaThreshold: 16,
        sampleSize: 128,
      }),
    );
    const blue = result.colors.find(
      (color) => color.blue > color.red + 100 && color.blue > color.green + 80,
    );

    expect(image).toMatchObject({ width: 256, height: 256 });
    expect(result.colors).toHaveLength(6);
    expect(blue?.proportion).toBeGreaterThan(0.15);
    expect(
      result.colors.reduce((sum, color) => sum + color.proportion, 0),
    ).toBe(1);
  });
});
