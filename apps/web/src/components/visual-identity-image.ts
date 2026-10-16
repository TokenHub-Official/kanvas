import type { CropPosition } from "./visual-identity-picker.js";

const avatarImageSize = 512;
const avatarImageQuality = 0.9;
function cropOffset(
  position: CropPosition,
  start: CropPosition,
  end: CropPosition,
): number {
  if (position === start) return 0;
  if (position === end) return 1;
  return 0.5;
}
export function centeredSquareCrop(
  width: number,
  height: number,
  position: CropPosition = "center",
) {
  const size = Math.min(width, height);
  return {
    x: Math.round((width - size) * cropOffset(position, "left", "right")),
    y: Math.round((height - size) * cropOffset(position, "top", "bottom")),
    size,
  };
}

export async function squareAvatarFile(
  file: File,
  position: CropPosition,
): Promise<File> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const crop = centeredSquareCrop(bitmap.width, bitmap.height, position);
    const canvas = document.createElement("canvas");
    canvas.width = avatarImageSize;
    canvas.height = avatarImageSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      avatarImageSize,
      avatarImageSize,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("Avatar crop failed.")),
        "image/webp",
        avatarImageQuality,
      );
    });
    return new File([blob], "agent-avatar.webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
