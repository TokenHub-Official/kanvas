import { createHash } from "node:crypto";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const migrationChecksumPattern = /^[0-9a-f]{64}$/u;
const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/u;
const unsignedDecimalPattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,239}$/u;
const maximumUint32 = 4_294_967_295;

export interface BackupMigrationEntry {
  readonly name: string;
  readonly checksum: string;
}

export type BackupDatabasePosition =
  | Readonly<{
      readonly mode: "binlog";
      readonly file: string;
      readonly position: string;
    }>
  | Readonly<{
      readonly mode: "gtid";
      readonly gtidSetDigest: string;
    }>;

export interface BackupSetManifestV1 {
  readonly schemaVersion: 1;
  readonly backupSetId: string;
  readonly deploymentId: string;
  readonly createdAt: string;
  readonly runtime: Readonly<{
    readonly state: "MAINTENANCE";
    readonly executionGeneration: number;
    readonly stateVersion: number;
  }>;
  readonly database: Readonly<{
    readonly snapshotId: string;
    readonly snapshotSha256: string;
    readonly position: BackupDatabasePosition;
    readonly migrationInventoryDigest: string;
    readonly migrations: readonly BackupMigrationEntry[];
  }>;
  readonly objects: Readonly<{
    readonly storageProfileId: string;
    readonly storageKind: "local" | "s3";
    readonly coverageMode: "quiesced_local_snapshot" | "version_boundary";
    readonly checkpointId: string;
    readonly inventoryDigest: string;
    readonly storedObjectReferenceCount: string;
  }>;
  readonly keyReferences: Readonly<{
    readonly kekVersions: readonly string[];
    readonly deploymentSecretReferenceCount: string;
  }>;
  readonly configuration: Readonly<{
    readonly configManifestDigest: string;
  }>;
  readonly images: Readonly<{
    readonly app: string;
    readonly web: string;
    readonly mysql: string;
    readonly redis: string;
  }>;
  readonly declaredRpoClass: "named-backup-only" | "coordinated-pitr";
  readonly verification: Readonly<{
    readonly status: "created";
  }>;
}

export interface BackupSetEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly manifest: BackupSetManifestV1;
  readonly manifestDigest: string;
}

export type BackupSetManifestErrorCode =
  "backup_manifest.invalid" | "backup_manifest.digest_mismatch";

export class BackupSetManifestError extends Error {
  constructor(
    readonly code: BackupSetManifestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BackupSetManifestError";
  }
}

function fail(code: BackupSetManifestErrorCode, message: string): never {
  throw new BackupSetManifestError(code, message);
}

function invalid(message: string): never {
  return fail("backup_manifest.invalid", message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid(`${label} contains unsupported or missing fields.`);
  }
}

function text(value: unknown, label: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return invalid(`${label} must be bounded opaque text.`);
  }
  return value;
}

function reference(value: unknown, label: string): string {
  const parsed = text(value, label, 240);
  if (!referencePattern.test(parsed)) {
    invalid(`${label} has an unsupported reference format.`);
  }
  return parsed;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    return invalid(`${label} must be a canonical SHA-256 digest.`);
  }
  return value;
}

function ulid(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    return invalid(`${label} must be a canonical uppercase ULID.`);
  }
  return value;
}

function uint32(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumUint32
  ) {
    return invalid(`${label} must be a positive unsigned 32-bit integer.`);
  }
  return value;
}

function unsignedDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !unsignedDecimalPattern.test(value)) {
    return invalid(`${label} must be an unsigned decimal string.`);
  }
  return value;
}

function canonicalDate(value: unknown, label: string): string {
  const raw = text(value, label, 40);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== raw) {
    return invalid(`${label} must be a canonical UTC timestamp.`);
  }
  return raw;
}

function literal<TValue extends string | number>(
  value: unknown,
  expected: TValue,
  label: string,
): TValue {
  if (value !== expected) {
    return invalid(`${label} must equal ${String(expected)}.`);
  }
  return expected;
}

function parsePosition(value: unknown): BackupDatabasePosition {
  const source = record(value, "database.position");
  if (source.mode === "binlog") {
    exactKeys(source, ["mode", "file", "position"], "database.position");
    return Object.freeze({
      mode: "binlog",
      file: reference(source.file, "database.position.file"),
      position: unsignedDecimal(source.position, "database.position.position"),
    });
  }
  if (source.mode === "gtid") {
    exactKeys(source, ["mode", "gtidSetDigest"], "database.position");
    return Object.freeze({
      mode: "gtid",
      gtidSetDigest: digest(
        source.gtidSetDigest,
        "database.position.gtidSetDigest",
      ),
    });
  }
  return invalid("database.position.mode must be binlog or gtid.");
}

function parseMigrations(value: unknown): readonly BackupMigrationEntry[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 9999) {
    return invalid("database.migrations must be a bounded non-empty array.");
  }
  const result = value.map((item, index) => {
    const source = record(item, `database.migrations[${String(index)}]`);
    exactKeys(
      source,
      ["name", "checksum"],
      `database.migrations[${String(index)}]`,
    );
    const name = text(
      source.name,
      `database.migrations[${String(index)}].name`,
      255,
    );
    if (!migrationNamePattern.test(name)) {
      invalid("Migration name format is invalid.");
    }
    const checksum = source.checksum;
    if (
      typeof checksum !== "string" ||
      !migrationChecksumPattern.test(checksum)
    ) {
      invalid("Migration checksum format is invalid.");
    }
    return Object.freeze({ name, checksum });
  });
  for (let index = 0; index < result.length; index += 1) {
    if (index > 0 && result[index - 1]!.name >= result[index]!.name) {
      invalid("database.migrations must be unique and sorted by name.");
    }
  }
  return Object.freeze(result);
}

function parseReferences(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 1024) {
    return invalid(`${label} must be a bounded array.`);
  }
  const result = value.map((item, index) =>
    reference(item, `${label}[${String(index)}]`),
  );
  for (let index = 0; index < result.length; index += 1) {
    if (index > 0 && result[index - 1]! >= result[index]!) {
      invalid(`${label} must be unique and sorted.`);
    }
  }
  return Object.freeze(result);
}

function parseManifest(value: unknown): BackupSetManifestV1 {
  const source = record(value, "manifest");
  exactKeys(
    source,
    [
      "schemaVersion",
      "backupSetId",
      "deploymentId",
      "createdAt",
      "runtime",
      "database",
      "objects",
      "keyReferences",
      "configuration",
      "images",
      "declaredRpoClass",
      "verification",
    ],
    "manifest",
  );
  literal(source.schemaVersion, 1, "manifest.schemaVersion");

  const runtime = record(source.runtime, "manifest.runtime");
  exactKeys(
    runtime,
    ["state", "executionGeneration", "stateVersion"],
    "manifest.runtime",
  );
  literal(runtime.state, "MAINTENANCE", "manifest.runtime.state");

  const database = record(source.database, "manifest.database");
  exactKeys(
    database,
    [
      "snapshotId",
      "snapshotSha256",
      "position",
      "migrationInventoryDigest",
      "migrations",
    ],
    "manifest.database",
  );

  const objects = record(source.objects, "manifest.objects");
  exactKeys(
    objects,
    [
      "storageProfileId",
      "storageKind",
      "coverageMode",
      "checkpointId",
      "inventoryDigest",
      "storedObjectReferenceCount",
    ],
    "manifest.objects",
  );
  if (objects.storageKind !== "local" && objects.storageKind !== "s3") {
    invalid("manifest.objects.storageKind is unsupported.");
  }
  if (
    objects.coverageMode !== "quiesced_local_snapshot" &&
    objects.coverageMode !== "version_boundary"
  ) {
    invalid("manifest.objects.coverageMode is unsupported.");
  }
  if (
    (objects.storageKind === "local" &&
      objects.coverageMode !== "quiesced_local_snapshot") ||
    (objects.storageKind === "s3" &&
      objects.coverageMode !== "version_boundary")
  ) {
    invalid("Object storage kind and coverage mode conflict.");
  }

  const keyReferences = record(source.keyReferences, "manifest.keyReferences");
  exactKeys(
    keyReferences,
    ["kekVersions", "deploymentSecretReferenceCount"],
    "manifest.keyReferences",
  );

  const configuration = record(source.configuration, "manifest.configuration");
  exactKeys(configuration, ["configManifestDigest"], "manifest.configuration");

  const images = record(source.images, "manifest.images");
  exactKeys(images, ["app", "web", "mysql", "redis"], "manifest.images");

  const verification = record(source.verification, "manifest.verification");
  exactKeys(verification, ["status"], "manifest.verification");
  literal(verification.status, "created", "manifest.verification.status");

  if (
    source.declaredRpoClass !== "named-backup-only" &&
    source.declaredRpoClass !== "coordinated-pitr"
  ) {
    invalid("manifest.declaredRpoClass is unsupported.");
  }

  return Object.freeze({
    schemaVersion: 1,
    backupSetId: ulid(source.backupSetId, "manifest.backupSetId"),
    deploymentId: reference(source.deploymentId, "manifest.deploymentId"),
    createdAt: canonicalDate(source.createdAt, "manifest.createdAt"),
    runtime: Object.freeze({
      state: "MAINTENANCE",
      executionGeneration: uint32(
        runtime.executionGeneration,
        "manifest.runtime.executionGeneration",
      ),
      stateVersion: uint32(
        runtime.stateVersion,
        "manifest.runtime.stateVersion",
      ),
    }),
    database: Object.freeze({
      snapshotId: reference(
        database.snapshotId,
        "manifest.database.snapshotId",
      ),
      snapshotSha256: digest(
        database.snapshotSha256,
        "manifest.database.snapshotSha256",
      ),
      position: parsePosition(database.position),
      migrationInventoryDigest: digest(
        database.migrationInventoryDigest,
        "manifest.database.migrationInventoryDigest",
      ),
      migrations: parseMigrations(database.migrations),
    }),
    objects: Object.freeze({
      storageProfileId: ulid(
        objects.storageProfileId,
        "manifest.objects.storageProfileId",
      ),
      storageKind: objects.storageKind,
      coverageMode: objects.coverageMode,
      checkpointId: reference(
        objects.checkpointId,
        "manifest.objects.checkpointId",
      ),
      inventoryDigest: digest(
        objects.inventoryDigest,
        "manifest.objects.inventoryDigest",
      ),
      storedObjectReferenceCount: unsignedDecimal(
        objects.storedObjectReferenceCount,
        "manifest.objects.storedObjectReferenceCount",
      ),
    }),
    keyReferences: Object.freeze({
      kekVersions: parseReferences(
        keyReferences.kekVersions,
        "manifest.keyReferences.kekVersions",
      ),
      deploymentSecretReferenceCount: unsignedDecimal(
        keyReferences.deploymentSecretReferenceCount,
        "manifest.keyReferences.deploymentSecretReferenceCount",
      ),
    }),
    configuration: Object.freeze({
      configManifestDigest: digest(
        configuration.configManifestDigest,
        "manifest.configuration.configManifestDigest",
      ),
    }),
    images: Object.freeze({
      app: digest(images.app, "manifest.images.app"),
      web: digest(images.web, "manifest.images.web"),
      mysql: digest(images.mysql, "manifest.images.mysql"),
      redis: digest(images.redis, "manifest.images.redis"),
    }),
    declaredRpoClass: source.declaredRpoClass,
    verification: Object.freeze({ status: "created" }),
  });
}

function encodeCanonical(value: unknown, active: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return invalid("Canonical backup manifest contains a non-safe number.");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => encodeCanonical(item, active)).join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    return invalid("Canonical backup manifest contains an unsupported value.");
  }
  if (active.has(value)) {
    return invalid("Canonical backup manifest cannot contain cycles.");
  }
  active.add(value);
  try {
    const entries = Object.entries(value).sort(([left], [right]) => {
      if (left < right) {
        return -1;
      }
      return left > right ? 1 : 0;
    });
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${encodeCanonical(item, active)}`,
      )
      .join(",")}}`;
  } finally {
    active.delete(value);
  }
}

export function canonicalizeBackupValue(value: unknown): string {
  return encodeCanonical(value, new WeakSet<object>());
}

export function digestBackupValue(domain: string, value: unknown): string {
  if (!referencePattern.test(domain)) {
    invalid("Backup digest domain is invalid.");
  }
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalizeBackupValue(value), "utf8")
    .digest("hex")}`;
}

export function backupSetManifestDigest(manifest: BackupSetManifestV1): string {
  return digestBackupValue("kanvas:backup-set-manifest:v1", manifest);
}

export function createBackupSetEnvelope(
  manifest: BackupSetManifestV1,
): BackupSetEnvelopeV1 {
  const validated = parseManifest(manifest);
  return Object.freeze({
    schemaVersion: 1,
    manifest: validated,
    manifestDigest: backupSetManifestDigest(validated),
  });
}

export function parseBackupSetEnvelope(value: unknown): BackupSetEnvelopeV1 {
  const source = record(value, "backupSetEnvelope");
  exactKeys(
    source,
    ["schemaVersion", "manifest", "manifestDigest"],
    "backupSetEnvelope",
  );
  literal(source.schemaVersion, 1, "backupSetEnvelope.schemaVersion");
  const manifest = parseManifest(source.manifest);
  const manifestDigest = digest(
    source.manifestDigest,
    "backupSetEnvelope.manifestDigest",
  );
  const actual = backupSetManifestDigest(manifest);
  if (actual !== manifestDigest) {
    return fail(
      "backup_manifest.digest_mismatch",
      "BackupSet manifest digest does not match its canonical content.",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    manifest,
    manifestDigest,
  });
}
