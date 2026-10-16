import { createHash } from "node:crypto";
import sharp from "sharp";

const maximumUploadBytes = 2 * 1024 * 1024;
const maximumStoredBytes = 512 * 1024;
const maximumInputPixels = 16_777_216;
const artworkSizes = [1600, 1200, 900, 675, 506, 380, 320] as const;

export class ToolImageError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolImageError";
  }
}

/** Decode and re-encode presentation artwork. Never serve original uploaded bytes. */
export async function normalizeToolImage(bytes: Uint8Array): Promise<{
  bytes: Buffer;
  mimeType: "image/png";
  sha256: string;
  width: number;
  height: number;
}> {
  if (!bytes.byteLength || bytes.byteLength > maximumUploadBytes) {
    throw new ToolImageError(
      "image_size",
      "Upload an image no larger than 2 MiB.",
    );
  }
  const input = Buffer.from(bytes);
  // Reject vector documents before decoding; SVG may contain links or active content.
  const png = input
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  const webp =
    input.toString("ascii", 0, 4) === "RIFF" &&
    input.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpeg && !webp) {
    throw new ToolImageError(
      "image_format",
      "Upload a PNG, JPEG or WebP image.",
    );
  }
  try {
    const decoder = sharp(input, {
      limitInputPixels: maximumInputPixels,
      failOn: "warning",
    });
    const metadata = await decoder.metadata();
    if ((metadata.pages ?? 1) > 1) {
      throw new ToolImageError(
        "image_animation",
        "Use a still image for the Logo or cover.",
      );
    }
    // Always resize from the decoded source, never from a previous smaller result.
    // 320px RGBA PNG fits the budget even for high-entropy, transparent artwork.
    for (const size of artworkSizes) {
      const { data, info } = await decoder
        .clone()
        .rotate()
        .resize({
          width: size,
          height: size,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength > maximumStoredBytes) continue;
      return {
        bytes: data,
        mimeType: "image/png",
        sha256: createHash("sha256").update(data).digest("hex"),
        width: info.width,
        height: info.height,
      };
    }
    throw new ToolImageError(
      "image_output_size",
      "The image could not be prepared for display.",
    );
  } catch (error) {
    if (error instanceof ToolImageError) throw error;
    throw new ToolImageError(
      "image_decode",
      "The image could not be decoded safely. Export it again as PNG, JPEG or WebP.",
    );
  }
}
