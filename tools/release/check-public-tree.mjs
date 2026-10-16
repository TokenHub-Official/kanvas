import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPublicPath } from "./public-files.mjs";

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../.."));
const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
if (!files.length)
  throw new Error(
    "No indexed files; stage the reviewed baseline before checking.",
  );
const failures = [];
for (const path of files) {
  if (!isPublicPath(path))
    failures.push(`${path}: excluded private/generated path`);
  const bytes = readFileSync(resolve(root, path));
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  // Deliberately limited checks: use a full secret scanner as a separate release gate.
  if (
    /https?:\/\/(?:[^\s/]+\.)?(?:duomai\.(?:cn|com)|sk8s\.cn)|\/Users\/[^/\s]+\//iu.test(
      text,
    )
  ) {
    failures.push(`${path}: private deployment or workstation reference`);
  }
  if (path.endsWith(".svg") && /koboyo/iu.test(text))
    failures.push(`${path}: restricted icon source`);
}
if (failures.length) throw new Error(failures.join("\n"));
process.stdout.write(
  `Public-tree boundary passed for ${files.length} indexed files.\n`,
);
