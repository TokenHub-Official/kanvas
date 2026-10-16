import type {
  RuntimeConfigurationDocument,
  RuntimeConfigurationWorker,
} from "@kanvas/contracts/api";
export const initialRuntimeConfiguration: RuntimeConfigurationDocument = {
  activated: false,
  agent: { maximumModelCalls: 50, maximumToolCalls: 100, timeoutSeconds: 600 },
  downloads: { defaults: { enabled: true, allowedOrigins: [] }, providers: [] },
};
export function deploymentImport(
  workers: readonly RuntimeConfigurationWorker[],
  now = Date.now(),
): RuntimeConfigurationDocument | undefined {
  const recent = recentConfigurationWorkers(workers, now);
  if (!recent.length) return undefined;
  const source = recent[0]!.deployment;
  const key = (deployment: RuntimeConfigurationWorker["deployment"]) =>
    JSON.stringify({
      enabled: deployment.downloadsEnabled,
      origins:
        deployment.allowedOrigins === null
          ? null
          : [...deployment.allowedOrigins].sort(),
    });
  if (recent.some((worker) => key(worker.deployment) !== key(source)))
    return undefined;
  return {
    ...initialRuntimeConfiguration,
    downloads: {
      defaults: {
        enabled: source.downloadsEnabled,
        allowedOrigins: source.allowedOrigins,
      },
      providers: [],
    },
  };
}
export function originLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function recentConfigurationWorkers(
  workers: readonly RuntimeConfigurationWorker[],
  now = Date.now(),
): RuntimeConfigurationWorker[] {
  return workers.filter((worker) => {
    const age = now - Date.parse(worker.observedAt);
    return age >= -5_000 && age <= 90_000;
  });
}

export function validResultOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      !url.hostname.includes("*")
    );
  } catch {
    return false;
  }
}
