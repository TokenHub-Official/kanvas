export const supportedCanvasImageMediaTypes = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function firstSupportedCanvasImage<T extends { readonly type: string }>(
  files: ArrayLike<T>,
): T | undefined {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file && supportedCanvasImageMediaTypes.has(file.type)) {
      return file;
    }
  }
  return undefined;
}

export function supportedCanvasImages<T extends { readonly type: string }>(
  files: ArrayLike<T>,
): readonly T[] {
  const supported: T[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file && supportedCanvasImageMediaTypes.has(file.type)) {
      supported.push(file);
    }
  }
  return supported;
}
