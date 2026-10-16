#!/usr/bin/env node

import { resolve } from "node:path";

import { loadDefaultCatalogPackageV1 } from "./catalog-package-loader.js";
import { prepareCatalogPackageV1 } from "./catalog-package-installer.js";

import { loadDatabaseConnectionConfig } from "../configuration/database-config.js";
import { readMigrationInventory } from "../migrator/migration-inventory.js";
import { runMigrations } from "../migrator/run-migrations.js";
import {
  assertCurrentMigrationStatus,
  assertInstanceInitialized,
  readMigrationStatus,
} from "../migrator/migration-status.js";
import { parseDatabaseCommand } from "./database-command.js";

const command = parseDatabaseCommand(process.argv.slice(2));
if (command === "help") {
  process.stdout.write(
    "Usage: kanvas-db [migrate|status|check|plan|--help]\n\nRun in the target environment. The database must already exist.\n",
  );
  process.exit(0);
}
const migrationsDirectory = resolve(import.meta.dirname, "../../migrations");
const migrations = await readMigrationInventory(migrationsDirectory);

if (command === "plan") {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        migrations: migrations.map(({ name, checksum }) => ({
          name,
          checksum,
        })),
      },
      null,
      2,
    )}\n`,
  );
} else if (command === "status" || command === "check") {
  const status = await readMigrationStatus(
    loadDatabaseConnectionConfig(process.env),
    migrations,
  );
  if (command === "check") {
    assertCurrentMigrationStatus(status);
    await assertInstanceInitialized(
      loadDatabaseConnectionConfig(process.env),
      process.env.KANVAS_INSTANCE_ID?.trim() ?? "",
    );
    process.stdout.write("Database schema is current.\n");
  } else {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  }
} else {
  const instanceId = process.env.KANVAS_INSTANCE_ID?.trim();
  if (!instanceId) {
    throw new Error(
      "Missing required deployment configuration: KANVAS_INSTANCE_ID",
    );
  }
  const connection = loadDatabaseConnectionConfig(process.env);
  await runMigrations({
    connection,
    instanceId,
    migrations,
    initialCatalog: prepareCatalogPackageV1(
      await loadDefaultCatalogPackageV1(),
    ),
  });
  process.stdout.write(
    `Applied ${String(migrations.length)} known Kanvas migrations.\n`,
  );
}
