import { createRecoveryOperationStore } from "@kanvas/database";

import {
  digestBackupValue,
  parseBackupSetEnvelope,
  type BackupSetEnvelopeV1,
} from "../backup-set-manifest.js";
import {
  recoveryVerificationFailureCode,
  verifyRecoveryEvidence,
} from "../recovery-evidence-verifier.js";
import {
  loadCommandRuntime,
  newAuditContext,
  newIdentity,
  parseCommandFlags,
  readJsonFile,
  rejectUnknownFlags,
  requiredFlag,
  type CommandRuntime,
} from "./support.js";

const activationAcknowledgement = "I_ACKNOWLEDGE_VERIFIED_RECOVERY_ACTIVATION";

function assertManifestMatchesRuntime(
  backupSet: BackupSetEnvelopeV1,
  runtime: CommandRuntime,
): void {
  const manifest = backupSet.manifest;
  if (
    manifest.deploymentId !== runtime.deploymentId ||
    manifest.configuration.configManifestDigest !==
      runtime.configManifestDigest ||
    manifest.objects.storageProfileId !== runtime.storage.storageProfileId ||
    manifest.objects.storageKind !== runtime.storage.kind ||
    manifest.images.app !== runtime.imageDigests.app ||
    manifest.images.web !== runtime.imageDigests.web ||
    manifest.images.mysql !== runtime.imageDigests.mysql ||
    manifest.images.redis !== runtime.imageDigests.redis
  ) {
    throw new Error(
      "BackupSet does not match the isolated recovery deployment.",
    );
  }
}

async function selectedBackupSet(
  flags: Readonly<Record<string, string>>,
): Promise<BackupSetEnvelopeV1> {
  return parseBackupSetEnvelope(
    await readJsonFile(requiredFlag(flags, "manifest")),
  );
}

export async function runRecoveryCommand(
  action: string | undefined,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  writeOutput: (value: string) => void,
): Promise<void> {
  if (
    action !== "begin" &&
    action !== "verify" &&
    action !== "activate" &&
    action !== "abort"
  ) {
    throw new Error(
      "Usage: kanvas recovery <begin|verify|activate|abort> [flags]",
    );
  }
  const flags = parseCommandFlags(arguments_);
  let allowedFlags = ["operation-id", "reason-code"];
  if (action === "begin") {
    allowedFlags = ["manifest", "operation-id", "reason-code"];
  } else if (action === "verify") {
    allowedFlags = ["manifest", "operation-id"];
  } else if (action === "activate") {
    allowedFlags = ["operation-id", "ack"];
  }
  rejectUnknownFlags(flags, allowedFlags);
  const runtime = await loadCommandRuntime(environment);
  const store = createRecoveryOperationStore(runtime.pool, {
    instanceId: runtime.instanceId,
  });
  try {
    if (action === "begin") {
      const backupSet = await selectedBackupSet(flags);
      assertManifestMatchesRuntime(backupSet, runtime);
      const operation = await store.begin({
        recoveryOperationId: flags["operation-id"] ?? newIdentity(),
        backupSetId: backupSet.manifest.backupSetId,
        manifestDigest: backupSet.manifestDigest,
        reasonCode: flags["reason-code"] ?? "recovery.operator_requested",
        now: new Date(),
        ...newAuditContext(runtime),
      });
      writeOutput(
        `${JSON.stringify({
          status: operation.lifecycleStatus,
          recoveryOperationId: operation.id,
          backupSetId: operation.backupSetId,
          manifestDigest: operation.manifestDigest,
          executionGeneration: operation.fencedExecutionGeneration,
          replayed: operation.replayed,
        })}\n`,
      );
      return;
    }

    const recoveryOperationId = requiredFlag(flags, "operation-id");
    if (action === "verify") {
      const backupSet = await selectedBackupSet(flags);
      assertManifestMatchesRuntime(backupSet, runtime);
      const existing = await store.read(recoveryOperationId);
      if (
        existing.lifecycleStatus === "read_only" ||
        existing.lifecycleStatus === "active"
      ) {
        writeOutput(
          `${JSON.stringify({
            status: existing.lifecycleStatus,
            recoveryOperationId: existing.id,
            verificationResultDigest: existing.verificationResultDigest,
            verificationSummary: existing.verificationSummary,
            replayed: true,
          })}\n`,
        );
        return;
      }
      await store.startVerification({
        recoveryOperationId,
        expectedExecutionGeneration: existing.fencedExecutionGeneration,
        now: new Date(),
        ...newAuditContext(runtime),
      });
      try {
        const result = await verifyRecoveryEvidence({
          pool: runtime.pool,
          storage: runtime.storage,
          backupSet,
          expectedMigrations: runtime.migrations,
          deploymentId: runtime.deploymentId,
          configManifestDigest: runtime.configManifestDigest,
          imageDigests: runtime.imageDigests,
          instanceId: runtime.instanceId,
          recoveryOperationId,
          expectedExecutionGeneration: existing.fencedExecutionGeneration,
          ...runtime.secretVerification,
        });
        const completed = await store.completeVerification({
          recoveryOperationId,
          expectedExecutionGeneration: existing.fencedExecutionGeneration,
          verificationResultDigest: result.verificationResultDigest,
          verificationSummary: result.summary,
          now: new Date(),
          ...newAuditContext(runtime),
        });
        writeOutput(
          `${JSON.stringify({
            status: completed.lifecycleStatus,
            recoveryOperationId: completed.id,
            verificationResultDigest: result.verificationResultDigest,
            verificationSummary: result.summary,
            replayed: completed.replayed,
          })}\n`,
        );
      } catch (error) {
        await store.recordVerificationFailure({
          recoveryOperationId,
          expectedExecutionGeneration: existing.fencedExecutionGeneration,
          failureCode: recoveryVerificationFailureCode(error),
          now: new Date(),
          ...newAuditContext(runtime),
        });
        throw error;
      }
      return;
    }

    const existing = await store.read(recoveryOperationId);
    if (action === "activate") {
      if (
        flags.ack !== activationAcknowledgement ||
        !existing.verificationResultDigest
      ) {
        throw new Error(
          `--ack must equal ${activationAcknowledgement} and the recovery must be verified.`,
        );
      }
      const activationAckDigest = digestBackupValue(
        "kanvas:recovery-activation-ack:v1",
        {
          acknowledgement: activationAcknowledgement,
          operatorId: runtime.operatorId,
          recoveryOperationId,
          backupSetId: existing.backupSetId,
          verificationResultDigest: existing.verificationResultDigest,
        },
      );
      const activated = await store.activate({
        recoveryOperationId,
        expectedExecutionGeneration: existing.fencedExecutionGeneration,
        verificationResultDigest: existing.verificationResultDigest,
        activationAckDigest,
        now: new Date(),
        ...newAuditContext(runtime),
      });
      writeOutput(
        `${JSON.stringify({
          status: activated.lifecycleStatus,
          recoveryOperationId: activated.id,
          activationAckDigest,
          replayed: activated.replayed,
        })}\n`,
      );
      return;
    }

    const aborted = await store.abort({
      recoveryOperationId,
      expectedExecutionGeneration: existing.fencedExecutionGeneration,
      reasonCode: flags["reason-code"] ?? "recovery.operator_aborted",
      now: new Date(),
      ...newAuditContext(runtime),
    });
    writeOutput(
      `${JSON.stringify({
        status: aborted.lifecycleStatus,
        recoveryOperationId: aborted.id,
        fencedExecutionGeneration: aborted.fencedExecutionGeneration,
        replayed: aborted.replayed,
      })}\n`,
    );
  } finally {
    await runtime.close();
  }
}
