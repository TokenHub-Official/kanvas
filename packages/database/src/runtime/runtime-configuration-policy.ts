import { DomainError } from "@kanvas/application";
import {
  isRuntimeConfigurationDocument,
  type RuntimeConfigurationDocument,
  type ResultDownloadRule,
} from "@kanvas/contracts/api";

export const initialGovernedAgentLimits = Object.freeze({
  maximumModelCalls: 50,
  maximumToolCalls: 100,
  timeoutSeconds: 600,
});
export class RuntimeConfigurationError extends DomainError {
  constructor(
    code:
      | "runtime_configuration.invalid"
      | "runtime_configuration.conflict"
      | "runtime_configuration.unavailable",
    message: string,
  ) {
    super(code, message);
    this.name = "RuntimeConfigurationError";
  }
}
export function normalizeRuntimeConfiguration(
  value: unknown,
): RuntimeConfigurationDocument {
  if (!isRuntimeConfigurationDocument(value))
    throw new RuntimeConfigurationError(
      "runtime_configuration.invalid",
      "Runtime configuration is invalid.",
    );
  const normalizeRule = (rule: ResultDownloadRule): ResultDownloadRule => ({
    enabled: rule.enabled,
    allowedOrigins:
      rule.allowedOrigins === null
        ? null
        : [
            ...new Set(
              rule.allowedOrigins.map((origin) => {
                let url: URL;
                try {
                  url = new URL(origin);
                } catch {
                  throw new RuntimeConfigurationError(
                    "runtime_configuration.invalid",
                    "Use an exact HTTPS origin.",
                  );
                }
                if (
                  url.protocol !== "https:" ||
                  url.username ||
                  url.password ||
                  url.search ||
                  url.hash ||
                  (url.pathname !== "/" && url.pathname !== "") ||
                  url.hostname.includes("*")
                )
                  throw new RuntimeConfigurationError(
                    "runtime_configuration.invalid",
                    "Use an exact HTTPS origin without paths, credentials or wildcards.",
                  );
                return url.origin;
              }),
            ),
          ].sort(),
  });
  const identities = new Set<string>();
  const providers = value.downloads.providers
    .map((entry) => {
      const key = `${entry.workspaceId}:${entry.providerEndpointId}`;
      if (identities.has(key))
        throw new RuntimeConfigurationError(
          "runtime_configuration.invalid",
          "A model service has multiple download rules.",
        );
      identities.add(key);
      return { ...entry, rule: normalizeRule(entry.rule) };
    })
    .sort((a, b) =>
      `${a.workspaceId}:${a.providerEndpointId}`.localeCompare(
        `${b.workspaceId}:${b.providerEndpointId}`,
      ),
    );
  return {
    activated: value.activated,
    agent: { ...value.agent },
    downloads: { defaults: normalizeRule(value.downloads.defaults), providers },
  };
}
export function resolveGovernedDownloadRule(
  document: RuntimeConfigurationDocument,
  workspaceId: string,
  providerEndpointId: string,
): ResultDownloadRule {
  if (!document.activated)
    throw new RuntimeConfigurationError(
      "runtime_configuration.unavailable",
      "Runtime configuration has not been activated.",
    );
  const rule =
    document.downloads.providers.find(
      (entry) =>
        entry.workspaceId === workspaceId &&
        entry.providerEndpointId === providerEndpointId,
    )?.rule ?? document.downloads.defaults;
  return {
    ...rule,
    enabled: document.downloads.defaults.enabled && rule.enabled,
  };
}
