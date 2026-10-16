const CANVAS_IMPORT_MAX_MEBIBYTES = 40;
const BYTES_PER_KIBIBYTE = 1024;
export const canvasImportMaximumBytes =
  CANVAS_IMPORT_MAX_MEBIBYTES * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;

const canvasImportMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isSupportedCanvasImportFile(
  file: Pick<File, "size" | "type">,
): boolean {
  return (
    canvasImportMediaTypes.has(file.type) &&
    file.size <= canvasImportMaximumBytes
  );
}

export function canvasImportFileIssue(
  files: readonly Pick<File, "size" | "type">[],
): "size" | "type" | "typeAndSize" | undefined {
  const hasUnsupportedType = files.some(
    (file) => !canvasImportMediaTypes.has(file.type),
  );
  const hasOversizedFile = files.some(
    (file) => file.size > canvasImportMaximumBytes,
  );
  if (hasUnsupportedType && hasOversizedFile) {
    return "typeAndSize";
  }
  if (hasUnsupportedType) {
    return "type";
  }
  if (hasOversizedFile) {
    return "size";
  }
  return undefined;
}
