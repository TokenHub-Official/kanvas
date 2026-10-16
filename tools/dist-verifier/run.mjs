import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "../..");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

for (const directory of [
  "apps/server/dist",
  "apps/worker/dist",
  "packages/application/dist",
  "packages/contracts/dist",
  "packages/database/dist",
  "packages/recovery/dist",
  "packages/secrets/dist",
  "packages/storage/dist",
  "tools/scenario-validator/dist",
]) {
  const files = await listFiles(resolve(workspaceRoot, directory));
  for (const file of files) {
    if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
      throw new Error(`Runtime dist contains TypeScript source: ${file}`);
    }
    if (file.endsWith(".js")) {
      const contents = await readFile(file, "utf8");
      if (/from\s+["'][^"']*(?:\/src\/|\.ts["'])/u.test(contents)) {
        throw new Error(`Runtime dist references source paths: ${file}`);
      }
    }
  }
}

const checkEnvironment = {
  ...process.env,
  KANVAS_ENVIRONMENT: "test",
  KANVAS_INSTANCE_ID: "dist-verifier",
  KANVAS_DATABASE_HOST: "127.0.0.1",
  KANVAS_DATABASE_PORT: "3306",
  KANVAS_DATABASE_NAME: "kanvas",
  KANVAS_DATABASE_USER: "kanvas",
  KANVAS_DATABASE_PASSWORD: "dist-verifier-only",
  KANVAS_AUTH_SECRET: "dist-verifier-only-auth-secret-32-characters",
  KANVAS_REDIS_HOST: "127.0.0.1",
  KANVAS_REDIS_PORT: "6379",
  KANVAS_REDIS_PASSWORD: "dist-verifier-only",
};

const commands = [
  ["apps/server/dist/main.js", "--check-config"],
  ["apps/worker/dist/main.js", "--check-config"],
  ["packages/database/dist/cli/main.js", "--plan"],
  ["packages/recovery/dist/cli/main.js", "--help"],
];

for (const [entry, ...arguments_] of commands) {
  const result = spawnSync(
    process.execPath,
    [resolve(workspaceRoot, entry), ...arguments_],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: checkEnvironment,
      timeout: 10_000,
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Compiled entry failed to start: ${entry}`);
  }
}

for (const libraryEntry of [
  "packages/contracts/dist/api/index.js",
  "packages/application/dist/index.js",
  "packages/database/dist/index.js",
  "packages/recovery/dist/index.js",
  "packages/secrets/dist/index.js",
  "packages/storage/dist/index.js",
]) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(resolve(workspaceRoot, libraryEntry))})`,
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Pure library import failed or leaked a handle: ${libraryEntry}`,
    );
  }
}

process.stdout.write("Dist-only entry and pure-import verification passed.\n");
