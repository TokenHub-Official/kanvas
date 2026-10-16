#!/usr/bin/env node

import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { runBackupCommand } from "./backup-command.js";
import { runRecoveryCommand } from "./recovery-command.js";

export async function runCli(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  executableName: string,
  writeOutput: (value: string) => void,
): Promise<void> {
  const executable = basename(executableName);
  let normalized = [...arguments_];
  if (executable === "kanvas-backup") {
    normalized = ["backup", ...arguments_];
  } else if (executable === "kanvas-recovery") {
    normalized = ["recovery", ...arguments_];
  }
  if (
    normalized.length === 1 &&
    (normalized[0] === "--help" || normalized[0] === "help")
  ) {
    writeOutput(
      "Usage: kanvas <backup|recovery> <action> [flags]\n" +
        "  kanvas backup <create|verify>\n" +
        "  kanvas recovery <begin|verify|activate|abort>\n",
    );
    return;
  }
  const [command, action, ...rest] = normalized;
  if (command === "backup") {
    await runBackupCommand(action, rest, environment, writeOutput);
    return;
  }
  if (command === "recovery") {
    await runRecoveryCommand(action, rest, environment, writeOutput);
    return;
  }
  throw new Error("Usage: kanvas <backup|recovery> <action> [flags]");
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli(process.argv.slice(2), process.env, process.argv[1]!, (value) =>
    process.stdout.write(value),
  ).catch((error: unknown) => {
    const candidate =
      error !== null && typeof error === "object"
        ? (error as {
            readonly code?: unknown;
            readonly message?: unknown;
          })
        : undefined;
    const code =
      typeof candidate?.code === "string"
        ? candidate.code
        : "recovery_cli.failed";
    const message =
      typeof candidate?.message === "string"
        ? candidate.message
        : "Recovery command failed.";
    process.stderr.write(
      `${JSON.stringify({ status: "failed", code, message })}\n`,
    );
    process.exitCode = 1;
  });
}
