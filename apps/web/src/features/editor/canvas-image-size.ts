export function readCanvasImageUrlSize(url: string): Promise<{
  readonly height: number;
  readonly width: number;
}> {
  return new Promise((resolve, reject) => {
    const image = new globalThis.Image();
    image.addEventListener("load", () => {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(new Error("无法读取图片尺寸。"));
        return;
      }
      resolve({
        height: image.naturalHeight,
        width: image.naturalWidth,
      });
    });
    image.addEventListener("error", () => {
      reject(new Error("无法读取图片尺寸。"));
    });
    image.src = url;
  });
}

export async function readCanvasImageFileSize(file: File): Promise<{
  readonly height: number;
  readonly width: number;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width < 1 || bitmap.height < 1) {
        throw new Error("无法读取图片尺寸。");
      }
      return {
        height: bitmap.height,
        width: bitmap.width,
      };
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await readCanvasImageUrlSize(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
