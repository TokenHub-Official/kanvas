import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { isPublicPath } from "./public-files.mjs";

const root = resolve(import.meta.dirname, "../..");
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || destination === root || existsSync(destination)) {
  throw new Error(
    "Supply a new, empty destination path; existing paths are never overwritten.",
  );
}
// Export only Git-tracked source and explicitly visible, non-ignored additions.
// No Git object, parent commit, remote, local environment or ignored file is copied.
const paths = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
].sort();
const files = paths.filter(
  (path) => isPublicPath(path) && existsSync(resolve(root, path)),
);
for (const path of files) {
  const source = resolve(root, path);
  if (relative(root, source).startsWith("..") || !lstatSync(source).isFile()) {
    throw new Error(`Public exports require regular source files: ${path}`);
  }
}
mkdirSync(destination, { recursive: true });
for (const path of files) {
  const source = resolve(root, path);
  const target = resolve(destination, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, lstatSync(source).mode & 0o777);
}
process.stdout.write(
  `Exported ${files.length} files. Initialize a new Git repository only after reviewing this tree.\n`,
);
