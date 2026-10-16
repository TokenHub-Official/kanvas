#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import ts from "typescript";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const skippedDirectories = new Set([
  ".git",
  ".tmp",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "prototypes",
]);
const scriptExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const commentExtensions = new Set([...scriptExtensions, ".css", ".sql"]);
const hanPattern = /\p{Script=Han}/u;

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(path);
    return entry.isFile() ? [path] : [];
  });
}

function lineNumber(contents, index) {
  return contents.slice(0, index).split("\n").length;
}

export function hanLines(contents) {
  return contents
    .split("\n")
    .flatMap((line, index) => (hanPattern.test(line) ? [index + 1] : []));
}

function scriptComments(contents, extension) {
  const variant = extension.endsWith("x")
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    variant,
    contents,
  );
  const comments = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken;) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      comments.push({
        index: scanner.getTokenPos(),
        text: scanner.getTokenText(),
      });
    }
    token = scanner.scan();
  }
  return comments;
}

function matchedComments(contents, pattern) {
  return [...contents.matchAll(pattern)].map((match) => ({
    index: match.index,
    text: match[0],
  }));
}

export function commentsWithHan(contents, extension) {
  const comments = scriptExtensions.has(extension)
    ? scriptComments(contents, extension)
    : extension === ".css"
      ? matchedComments(contents, /\/\*[\s\S]*?\*\//gu)
      : extension === ".sql"
        ? matchedComments(contents, /--[^\r\n]*|\/\*[\s\S]*?\*\//gu)
        : [];
  return comments
    .filter((comment) => hanPattern.test(comment.text))
    .map((comment) => lineNumber(contents, comment.index));
}

function maintainerDocuments() {
  const explicit = [
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "DESIGN.md",
    "PRODUCT.md",
    "README.md",
    "SECURITY.md",
  ].map((file) => resolve(repositoryRoot, file));
  const readmes = filesBelow(repositoryRoot).filter(
    (file) => basename(file) === "README.md",
  );
  const currentFacts = readdirSync(resolve(repositoryRoot, "docs"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
    .map((entry) => resolve(repositoryRoot, "docs", entry.name));
  return [...new Set([...explicit, ...readmes, ...currentFacts])].sort();
}

function sourceFiles() {
  return ["apps", "deploy", "packages", "tools"]
    .flatMap((root) => filesBelow(resolve(repositoryRoot, root)))
    .filter((file) => commentExtensions.has(extname(file)));
}

function checkMaintainerLanguage({ docsOnly }) {
  const documents = maintainerDocuments();
  const failures = [];
  for (const file of documents) {
    const contents = readFileSync(file, "utf8");
    for (const line of hanLines(contents)) {
      failures.push(
        `${relative(repositoryRoot, file)}:${String(line)} contains Han text`,
      );
    }
    if (/^\s*(?:[-*]\s*)?Status:\s*Proposed\b/imu.test(contents)) {
      failures.push(
        `${relative(repositoryRoot, file)} contains a proposed design; use an issue or ADR`,
      );
    }
  }

  const sources = docsOnly ? [] : sourceFiles();
  for (const file of sources) {
    const contents = readFileSync(file, "utf8");
    for (const line of commentsWithHan(contents, extname(file))) {
      failures.push(
        `${relative(repositoryRoot, file)}:${String(line)} contains a non-English source comment`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `English-first maintainer language violations:\n${failures.join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const commentSummary = docsOnly
    ? ""
    : ` and ${String(sources.length)} source files`;
  process.stdout.write(
    `Checked ${String(documents.length)} English-first maintainer documents${commentSummary}.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  checkMaintainerLanguage({ docsOnly: process.argv.includes("--docs-only") });
}
