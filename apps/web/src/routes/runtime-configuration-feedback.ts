import type {
  RuntimeConfigurationOverview,
  RuntimeConfigurationWorker,
} from "@kanvas/contracts/api";
import { recentConfigurationWorkers } from "./runtime-configuration-model.js";

export function configurationFeedback(
  overview: RuntimeConfigurationOverview,
  now = Date.now(),
) {
  const recent = recentConfigurationWorkers(overview.workers, now);
  const latest = overview.workers
    .map((worker) => Date.parse(worker.observedAt))
    .filter((time) => Number.isFinite(time) && time <= now);
  const groups = new Map<
    string,
    {
      count: number;
      source: RuntimeConfigurationWorker["deployment"]["source"];
      version: number | null;
      enabled: boolean;
      observedAt: string;
    }
  >();
  for (const worker of recent) {
    // Reading a revision in environment mode does not mean the process uses it.
    const version =
      worker.deployment.source === "instance"
        ? worker.configurationVersion
        : null;
    const key = JSON.stringify([
      worker.deployment.source,
      version,
      worker.deployment.downloadsEnabled,
    ]);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (worker.observedAt > group.observedAt)
        group.observedAt = worker.observedAt;
    } else
      groups.set(key, {
        count: 1,
        source: worker.deployment.source,
        version,
        enabled: worker.deployment.downloadsEnabled,
        observedAt: worker.observedAt,
      });
  }
  let state:
    "unknown" | "deployment" | "mixed" | "inactive" | "older" | "current" =
    "unknown";
  const delegated = recent.filter(
    (worker) => worker.deployment.source === "instance",
  );
  if (recent.length) {
    if (!delegated.length) state = "deployment";
    else if (delegated.length !== recent.length) state = "mixed";
    else if (!overview.current?.document.activated) state = "inactive";
    else if (
      delegated.some(
        (worker) => worker.configurationVersion !== overview.current?.version,
      )
    )
      state = "older";
    else state = "current";
  }
  return {
    state,
    count: recent.length,
    lastReportedAt: latest.length
      ? new Date(Math.max(...latest)).toISOString()
      : undefined,
    emergencyDisabled: recent.some(
      (worker) => !worker.deployment.downloadsEnabled,
    ),
    groups: [...groups.values()],
  };
}
