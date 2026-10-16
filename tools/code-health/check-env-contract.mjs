#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const supportedExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const skippedDirectories = new Set([
  ".git",
  ".tmp",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "prototypes",
]);
const nonEnvironmentTokens = new Set([
  "KANVAS_CANVAS_SELECTION",
  "KANVAS_PROVIDER_TOKEN",
  "KANVAS_ULID_PATTERN",
  "KANVAS_WORKSPACE_PERMISSION",
]);
const variablePattern =
  /\b(?:(?:VITE_)?KANVAS|OTEL_EXPORTER|GENERATION_TASKS)_[A-Z0-9_]+\b/gu;

export function configurationNames(contents) {
  return new Set(contents.match(variablePattern) ?? []);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (skippedDirectories.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile()) return [];
    if (entry.name === ".env.example") return [path];
    if (entry.name.startsWith(".env")) return [];
    return supportedExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

export function undocumentedConfigurationNames(source, documentation) {
  const documented = configurationNames(documentation);
  return [...configurationNames(source)]
    .filter((name) => !documented.has(name) && !nonEnvironmentTokens.has(name))
    .sort();
}

function checkEnvironmentContract() {
  const roots = [".github", "apps", "deploy", "packages", "tools"];
  const files = roots.flatMap((root) =>
    sourceFiles(resolve(repositoryRoot, root)),
  );
  files.push(
    resolve(repositoryRoot, ".env.example"),
    resolve(repositoryRoot, "Dockerfile"),
    resolve(repositoryRoot, "package.json"),
  );
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const documentation = readFileSync(
    resolve(repositoryRoot, "docs/CONFIGURATION.md"),
    "utf8",
  );
  const missing = undocumentedConfigurationNames(source, documentation);
  if (missing.length > 0) {
    process.stderr.write(
      `Environment variables missing from docs/CONFIGURATION.md:\n${missing.join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const environmentCount = [...configurationNames(source)].filter(
    (name) => !nonEnvironmentTokens.has(name),
  ).length;
  process.stdout.write(
    `Checked ${String(environmentCount)} documented environment variables.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  checkEnvironmentContract();
}
