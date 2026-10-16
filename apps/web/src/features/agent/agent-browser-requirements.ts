import type { AgentThreadView } from "@kanvas/contracts/api";

export function agentBrowserCapabilitySignature(
  tasks: readonly Pick<
    AgentThreadView["tasks"][number],
    "lifecycleStatus" | "browserExecution"
  >[],
): string {
  return JSON.stringify(
    [
      ...new Set(
        tasks.flatMap((task) =>
          task.lifecycleStatus === "running"
            ? (task.browserExecution?.requiredCapabilityKeys ?? [])
            : [],
        ),
      ),
    ].sort(),
  );
}
