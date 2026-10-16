import {
  createQuiescedBackupSet,
  verifyQuiescedBackupSet,
} from "../quiesced-backup-set.js";
import type { BackupDatabasePosition } from "../backup-set-manifest.js";
import {
  createSnapshotStorage,
  loadCommandRuntime,
  parseCommandFlags,
  readJsonFile,
  rejectUnknownFlags,
  requiredFlag,
  writeJsonExclusive,
} from "./support.js";

const quiescedAcknowledgement =
  "I_ACKNOWLEDGE_QUIESCED_DATABASE_AND_OBJECT_SNAPSHOT";

function databasePosition(
  flags: Readonly<Record<string, string>>,
): BackupDatabasePosition {
  const binlogFile = flags["binlog-file"];
  const binlogPosition = flags["binlog-position"];
  const gtidSetDigest = flags["gtid-set-digest"];
  if (gtidSetDigest) {
    if (binlogFile || binlogPosition) {
      throw new Error("Use either GTID or binlog position flags, never both.");
    }
    return Object.freeze({
      mode: "gtid",
      gtidSetDigest,
    });
  }
  if (!binlogFile || !binlogPosition) {
    throw new Error(
      "Backup creation requires --binlog-file and --binlog-position, or --gtid-set-digest.",
    );
  }
  return Object.freeze({
    mode: "binlog",
    file: binlogFile,
    position: binlogPosition,
  });
}

function createdAt(flags: Readonly<Record<string, string>>): Date {
  const raw = flags["created-at"];
  if (!raw) {
    return new Date();
  }
  const value = new Date(raw);
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== raw) {
    throw new Error("--created-at must be a canonical UTC timestamp.");
  }
  return value;
}

export async function runBackupCommand(
  action: string | undefined,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  writeOutput: (value: string) => void,
): Promise<void> {
  if (action !== "create" && action !== "verify") {
    throw new Error("Usage: kanvas backup <create|verify> [flags]");
  }
  const flags = parseCommandFlags(arguments_);
  const commonFlags = ["database-snapshot", "object-checkpoint"] as const;
  rejectUnknownFlags(
    flags,
    action === "create"
      ? [
          ...commonFlags,
          "output",
          "backup-set-id",
          "database-snapshot-id",
          "object-checkpoint-id",
          "binlog-file",
          "binlog-position",
          "gtid-set-digest",
          "declared-rpo-class",
          "created-at",
          "ack-quiesced",
        ]
      : [...commonFlags, "manifest"],
  );

  const databaseSnapshotPath = requiredFlag(flags, "database-snapshot");
  const objectCheckpoint = requiredFlag(flags, "object-checkpoint");
  const runtime = await loadCommandRuntime(environment);
  let snapshotStorage;
  try {
    snapshotStorage = await createSnapshotStorage(
      environment,
      objectCheckpoint,
    );
    if (action === "create") {
      if (flags["ack-quiesced"] !== quiescedAcknowledgement) {
        throw new Error(
          `--ack-quiesced must equal ${quiescedAcknowledgement}.`,
        );
      }
      const declaredRpoClass =
        flags["declared-rpo-class"] ?? "named-backup-only";
      if (
        declaredRpoClass !== "named-backup-only" &&
        declaredRpoClass !== "coordinated-pitr"
      ) {
        throw new Error(
          "--declared-rpo-class must be named-backup-only or coordinated-pitr.",
        );
      }
      const result = await createQuiescedBackupSet({
        pool: runtime.pool,
        snapshotStorage,
        databaseSnapshotPath,
        expectedMigrations: runtime.migrations,
        deploymentId: runtime.deploymentId,
        configManifestDigest: runtime.configManifestDigest,
        imageDigests: runtime.imageDigests,
        instanceId: runtime.instanceId,
        backupSetId: requiredFlag(flags, "backup-set-id"),
        createdAt: createdAt(flags),
        databaseSnapshotId: requiredFlag(flags, "database-snapshot-id"),
        databasePosition: databasePosition(flags),
        objectCheckpointId: requiredFlag(flags, "object-checkpoint-id"),
        declaredRpoClass,
        ...runtime.secretVerification,
      });
      const output = requiredFlag(flags, "output");
      await writeJsonExclusive(output, result.backupSet);
      writeOutput(
        `${JSON.stringify({
          status: "created",
          backupSetId: result.backupSet.manifest.backupSetId,
          manifestDigest: result.backupSet.manifestDigest,
          manifestPath: output,
          storedObjectReferenceCount:
            result.evidence.objects.storedObjectReferenceCount,
          auditEventCount: result.evidence.audit.auditEventCount,
        })}\n`,
      );
      return;
    }

    const evidence = await verifyQuiescedBackupSet({
      pool: runtime.pool,
      snapshotStorage,
      databaseSnapshotPath,
      expectedMigrations: runtime.migrations,
      deploymentId: runtime.deploymentId,
      configManifestDigest: runtime.configManifestDigest,
      imageDigests: runtime.imageDigests,
      instanceId: runtime.instanceId,
      backupSet: await readJsonFile(requiredFlag(flags, "manifest")),
      ...runtime.secretVerification,
    });
    writeOutput(
      `${JSON.stringify({
        status: "verified_created_backup",
        ...evidence,
      })}\n`,
    );
  } finally {
    await snapshotStorage?.close?.();
    await runtime.close();
  }
}
