#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && extname(entry.name) === ".md" ? [path] : [];
  });
}

export function localMarkdownTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/gu, "").split("#", 1)[0];
  if (
    !target ||
    target.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target)
  ) {
    return undefined;
  }
  return decodeURIComponent(target);
}

function checkMaintainedDocs() {
  const files = [
    "README.md",
    "PRODUCT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
  ].map((file) => resolve(repositoryRoot, file));
  files.push(...markdownFiles(resolve(repositoryRoot, "docs")));
  files.push(resolve(repositoryRoot, "deploy/README.md"));

  const failures = [];
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      const target = localMarkdownTarget(match[1]);
      if (!target) continue;
      const absoluteTarget = resolve(dirname(file), target);
      if (!existsSync(absoluteTarget)) {
        const line = contents.slice(0, match.index).split("\n").length;
        failures.push(
          `${file.slice(repositoryRoot.length + 1)}:${String(line)} -> ${target}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `Broken local Markdown links:\n${failures.join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Checked ${String(files.length)} maintained Markdown files.\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  checkMaintainedDocs();
}
