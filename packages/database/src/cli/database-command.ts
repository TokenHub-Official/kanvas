export type DatabaseCommand = "migrate" | "status" | "check" | "plan" | "help";

export function parseDatabaseCommand(
  arguments_: readonly string[],
): DatabaseCommand {
  if (arguments_.length === 0) return "migrate";
  if (arguments_.length !== 1)
    throw new Error(
      "Expected one database command: migrate, status, check, plan or --help.",
    );
  const command = arguments_[0];
  if (command === "--plan" || command === "plan") return "plan";
  if (command === "--help" || command === "help") return "help";
  if (command === "migrate" || command === "status" || command === "check")
    return command;
  throw new Error(
    "Unknown database command; use migrate, status, check, plan or --help.",
  );
}
