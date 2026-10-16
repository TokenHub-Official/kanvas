#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { readMigrationInventory } from "../dist/migrator/migration-inventory.js";
import { runMigrations } from "../dist/migrator/run-migrations.js";

// Resolve fixtures against this package even when invoked from the workspace root.
process.chdir(resolve(import.meta.dirname, ".."));

const requireFromDatabase = createRequire(
  new URL("../package.json", import.meta.url),
);
const { createPool } = requireFromDatabase("mysql2/promise");
const databaseName = `kanvas_integration_${String(process.pid)}_${randomBytes(6).toString("hex")}`;
if (!/^[a-z0-9_]{1,64}$/u.test(databaseName)) {
  throw new Error("Generated disposable integration database name is unsafe.");
}
const socketPath =
  process.env.KANVAS_INTEGRATION_DATABASE_SOCKET?.trim() ||
  process.env.KANVAS_DATABASE_SOCKET?.trim();
const adminUser =
  process.env.KANVAS_INTEGRATION_DATABASE_ADMIN_USER?.trim() || "root";
const adminPassword =
  process.env.KANVAS_INTEGRATION_DATABASE_ADMIN_PASSWORD ?? "";
const accountHostSql = socketPath ? "'localhost'" : "'%'";
const databaseHost = process.env.KANVAS_DATABASE_HOST?.trim() || "127.0.0.1";
const databasePort = Number(process.env.KANVAS_DATABASE_PORT ?? "3306");
if (
  !Number.isSafeInteger(databasePort) ||
  databasePort < 1 ||
  databasePort > 65_535
) {
  throw new Error("KANVAS_DATABASE_PORT must be a valid TCP port.");
}
const migrationUser = `kanvas_it_${String(process.pid)}_${randomBytes(4).toString("hex")}`;
const migrationPassword = randomBytes(24).toString("base64url");
const harnessUser = `kanvas_test_${String(process.pid)}_${randomBytes(4).toString("hex")}`;
const harnessPassword = randomBytes(24).toString("base64url");
const adminPool = createPool({
  ...(socketPath ? { socketPath } : { host: databaseHost, port: databasePort }),
  user: adminUser,
  password: adminPassword,
  connectionLimit: 2,
  multipleStatements: true,
  timezone: "Z",
  decimalNumbers: false,
});

function runVitest(files, vitestArguments) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        resolve("node_modules/vitest/vitest.mjs"),
        "run",
        "--no-file-parallelism",
        ...files,
        ...vitestArguments,
      ],
      {
        cwd: resolve("."),
        env: {
          ...process.env,
          KANVAS_DATABASE_INTEGRATION: "1",
          KANVAS_DATABASE_DISPOSABLE_INTEGRATION: "1",
          KANVAS_DATABASE_SOCKET: socketPath ?? "",
          KANVAS_DATABASE_HOST: databaseHost,
          KANVAS_DATABASE_PORT: String(databasePort),
          // The outer migration proves the scoped database-user path. Some
          // integration files create derived disposable databases, so the
          // child suite receives a separate ephemeral harness identity rather
          // than the configured root or administrator credential.
          KANVAS_DATABASE_USER: harnessUser,
          KANVAS_DATABASE_PASSWORD: harnessPassword,
          KANVAS_DATABASE_NAME: databaseName,
        },
        stdio: "inherit",
      },
    );
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(
          new Error(`Database integration tests exited on signal ${signal}.`),
        );
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

let exitCode;
let migrationUserCreated = false;
let harnessUserCreated = false;
try {
  await adminPool.query(
    `CREATE DATABASE \`${databaseName}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await adminPool.query(`CREATE USER ?@${accountHostSql} IDENTIFIED BY ?`, [
    migrationUser,
    migrationPassword,
  ]);
  migrationUserCreated = true;
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
     ON \`${databaseName}\`.* TO ?@${accountHostSql}`,
    [migrationUser],
  );
  await adminPool.query(`CREATE USER ?@${accountHostSql} IDENTIFIED BY ?`, [
    harnessUser,
    harnessPassword,
  ]);
  harnessUserCreated = true;
  await adminPool.query(
    `GRANT ALL PRIVILEGES ON \`kanvas\\_%\`.* TO ?@${accountHostSql}`,
    [harnessUser],
  );
  const inventory = await readMigrationInventory(resolve("migrations"));
  await runMigrations({
    connection: {
      host: databaseHost,
      port: databasePort,
      database: databaseName,
      user: migrationUser,
      password: migrationPassword,
      connectionLimit: 1,
    },
    instanceId: `disposable-integration-${String(process.pid)}`,
    migrations: inventory,
  });
  const argumentsAfterScript = process.argv.slice(2);
  const separatorIndex = argumentsAfterScript.indexOf("--");
  const requested =
    separatorIndex === -1
      ? argumentsAfterScript
      : argumentsAfterScript.slice(0, separatorIndex);
  const vitestArguments =
    separatorIndex === -1 ? [] : argumentsAfterScript.slice(separatorIndex + 1);
  const files =
    requested.length > 0
      ? requested
      : (await readdir(resolve("test")))
          .filter((name) => name.endsWith(".integration.test.ts"))
          .sort()
          .map((name) => `test/${name}`);
  if (files.length === 0) {
    throw new Error("No database integration test files were selected.");
  }
  exitCode = await runVitest(files, vitestArguments);
} finally {
  await adminPool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  if (harnessUserCreated) {
    await adminPool.query(`DROP USER IF EXISTS ?@${accountHostSql}`, [
      harnessUser,
    ]);
  }
  if (migrationUserCreated) {
    await adminPool.query(`DROP USER IF EXISTS ?@${accountHostSql}`, [
      migrationUser,
    ]);
  }
  await adminPool.end();
}

process.exitCode = exitCode;
