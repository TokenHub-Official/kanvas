import type { SkillFileInput } from "@kanvas/contracts/api";
import type { SkillPublicationDocumentV1 } from "@kanvas/database/runtime";
const maximumFileBytes = 2 * 1024 * 1024;

export function validateEditableSkillPath(path: string): string {
  if (
    !path ||
    Buffer.byteLength(path, "utf8") > 500 ||
    path !== path.normalize("NFC") ||
    path.split("/").length > 12 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    /\p{Cc}/u.test(path) ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.endsWith(" ") ||
          part.endsWith("."),
      ) ||
    ["skill.md", "kanvas.yaml"].includes(path.split("/")[0]!.toLowerCase())
  )
    throw new TypeError(
      "Choose a relative resource path outside SKILL.md and kanvas.yaml.",
    );
  return path;
}
export function validateSkillFilePaths(paths: readonly string[]): void {
  const files = new Set<string>();
  for (const path of paths) {
    if (path !== "SKILL.md" && path !== "kanvas.yaml")
      validateEditableSkillPath(path);
    const key = path.toLowerCase();
    if (files.has(key)) throw new TypeError("Skill file paths must be unique.");
    files.add(key);
  }
  for (const path of files) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      if (files.has(parts.slice(0, depth).join("/")))
        throw new TypeError("A Skill path cannot be both a file and a folder.");
    }
  }
}
export function decodeSkillFile(file: SkillFileInput): {
  path: string;
  bytes: Buffer;
  mediaType: string;
} {
  const path = validateEditableSkillPath(file.path);
  const bytes =
    "text" in file
      ? Buffer.from(file.text, "utf8")
      : Buffer.from(file.base64, "base64");
  if (!bytes.length || bytes.length > maximumFileBytes)
    throw new TypeError("Skill files must be between 1 byte and 2 MiB.");
  if ("base64" in file && bytes.toString("base64") !== file.base64)
    throw new TypeError("Skill file encoding is invalid.");
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  const imageHeaders: Record<string, boolean> = {
    png: bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpg: bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    jpeg: bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    webp:
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP",
    gif: ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")),
  };
  if (imageHeaders[extension] === false)
    throw new TypeError("The image content does not match its file extension.");
  const types: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    py: "text/x-python",
    js: "text/javascript",
    ts: "text/typescript",
    json: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    html: "text/html",
    css: "text/css",
    csv: "text/csv",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
  };
  return {
    path,
    bytes,
    mediaType:
      types[extension] ??
      ("text" in file ? "text/plain" : "application/octet-stream"),
  };
}
export function mergeSkillFiles(
  document: SkillPublicationDocumentV1,
  replacements: SkillPublicationDocumentV1["resources"],
  removedPaths: readonly string[] = [],
): SkillPublicationDocumentV1 {
  const removals = new Set(removedPaths.map(validateEditableSkillPath));
  if (replacements.some((file) => removals.has(file.path)))
    throw new TypeError(
      "A file cannot be changed and removed in the same save.",
    );
  if (
    new Set(replacements.map((file) => file.path)).size !== replacements.length
  )
    throw new TypeError("Skill file paths must be unique.");
  const changed = new Map(replacements.map((file) => [file.path, file]));
  const resources = document.resources
    .filter((file) => !removals.has(file.path))
    .map((file) => {
      const next = changed.get(file.path) ?? file;
      changed.delete(file.path);
      return next;
    });
  resources.push(...changed.values());
  validateSkillFilePaths(resources.map((file) => file.path));
  return { ...document, resources };
}
