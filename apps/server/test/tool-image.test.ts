import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeToolImage } from "../src/tools/tool-image.js";

describe("tool presentation image ingestion", () => {
  it("normalizes a raster image and drops metadata and trailing active bytes", async () => {
    const source = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#3048f5" },
    })
      .withMetadata({ exif: { IFD0: { Artist: "private metadata" } } })
      .jpeg()
      .toBuffer();
    const result = await normalizeToolImage(
      Buffer.concat([source, Buffer.from("<script>alert(1)</script>")]),
    );
    expect(result).toMatchObject({
      width: 1600,
      height: 800,
      mimeType: "image/png",
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bytes.includes(Buffer.from("<script>"))).toBe(false);
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });
  it("automatically fits a detailed JPEG cover into the stored-image budget", async () => {
    const pixels = Buffer.alloc(1400 * 900 * 3);
    let seed = 17;
    for (let index = 0; index < pixels.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    const source = await sharp(pixels, {
      raw: { width: 1400, height: 900, channels: 3 },
    })
      .jpeg({ quality: 85 })
      .toBuffer();
    expect(source.length).toBeLessThan(2 * 1024 * 1024);
    const result = await normalizeToolImage(source);
    expect(result.bytes.length).toBeLessThanOrEqual(512 * 1024);
    expect(result.width).toBeGreaterThanOrEqual(320);
    expect(result.width / result.height).toBeCloseTo(1400 / 900, 2);
    expect((await sharp(result.bytes).metadata()).format).toBe("png");
  });
  it("rejects SVG, HTML, corrupt raster bytes and oversized input", async () => {
    for (const bytes of [
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      Buffer.from("<html/>"),
    ]) {
      await expect(normalizeToolImage(bytes)).rejects.toMatchObject({
        code: "image_format",
      });
    }
    await expect(
      normalizeToolImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    ).rejects.toMatchObject({ code: "image_decode" });
    await expect(
      normalizeToolImage(new Uint8Array(2 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: "image_size" });
  });
});
