import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface MigrationFile {
  readonly name: string;
  readonly absolutePath: string;
  readonly checksum: string;
  readonly sql: string;
  readonly compatibleChecksums?: readonly string[];
}

// A pre-release baseline replaced database triggers with application invariants.
// The original bytes are retained in migrations/legacy; existing installations
// keep their real applied checksum and optional historical triggers. This is an
// explicit compatibility pair, never a general checksum-drift bypass.
const portableBaselineChecksum =
  "487ede5ef1286e59b059ac32053b1cfc26722bcb8465d8dccb9d441414434449";
const legacyBaselineChecksum =
  "3361b657cf3cf5b3801d75a71122f55341df69f7f3a5309511c5bce308b76be3";

export async function readMigrationInventory(
  migrationsDirectory: string,
): Promise<readonly MigrationFile[]> {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();

  const migrations = await Promise.all(
    names.map(async (name): Promise<MigrationFile> => {
      const absolutePath = resolve(migrationsDirectory, name);
      const sql = await readFile(absolutePath, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      return Object.freeze({
        name,
        absolutePath,
        checksum,
        sql,
        ...(name === "0000_initial_schema.sql" &&
        checksum === portableBaselineChecksum
          ? { compatibleChecksums: Object.freeze([legacyBaselineChecksum]) }
          : {}),
      });
    }),
  );

  return Object.freeze(migrations);
}
