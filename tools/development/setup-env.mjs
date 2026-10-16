#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const components = [".", "apps/server", "apps/worker", "apps/web"];

export function environmentValues(contents) {
  return new Map(
    contents.split(/\r?\n/u).flatMap((line) => {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
}

export function applyLegacyEnvironment(template, legacy) {
  const values = environmentValues(legacy);
  let migrated = 0;
  const contents = template.replace(
    /^(\s*)(?:#\s*)?([A-Za-z_][A-Za-z0-9_]*)=.*$/gmu,
    (line, indentation, key) => {
      const value = values.get(key);
      if (value === undefined) return line;
      const replacement = `${indentation}${key}=${value}`;
      if (replacement === line) return line;
      migrated += 1;
      return replacement;
    },
  );
  return { contents, migrated };
}

export function shouldMigrateExisting(existing, template, projection) {
  return existing === template && projection !== template;
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function displayPath(component) {
  return component === "." ? ".env.local" : `${component}/.env.local`;
}

async function setupEnvironmentFiles() {
  const legacy = await readOptional(resolve(repositoryRoot, ".env"));

  for (const component of components) {
    const source = resolve(repositoryRoot, component, ".env.example");
    const destination = resolve(repositoryRoot, component, ".env.local");
    const template = await readFile(source, "utf8");
    const projection = legacy
      ? applyLegacyEnvironment(template, legacy)
      : { contents: template, migrated: 0 };
    const existing = await readOptional(destination);
    const path = displayPath(component);

    if (existing === undefined) {
      try {
        await writeFile(destination, projection.contents, {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if (error?.code === "EEXIST") {
          process.stdout.write(`[env] Kept existing ${path}\n`);
          continue;
        }
        throw error;
      }
      process.stdout.write(
        projection.migrated > 0
          ? `[env] Migrated ${path} from legacy .env\n`
          : `[env] Created ${path}\n`,
      );
      continue;
    }

    if (
      legacy &&
      shouldMigrateExisting(existing, template, projection.contents)
    ) {
      await writeFile(destination, projection.contents, "utf8");
      process.stdout.write(`[env] Migrated ${path} from legacy .env\n`);
      continue;
    }

    process.stdout.write(`[env] Kept existing ${path}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  await setupEnvironmentFiles();
}
