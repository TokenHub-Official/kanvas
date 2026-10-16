import type {
  AgentExecutionLimits,
  ResultDownloadRule,
  RuntimeConfigurationRevision,
} from "@kanvas/contracts/api";
import {
  resolveGovernedDownloadRule,
  RuntimeConfigurationError,
} from "./runtime-configuration-policy.js";

export interface EffectiveRuntimeSetting<T> {
  readonly value: Readonly<T>;
  readonly source: "instance" | "environment" | "profile";
  readonly version: number | null;
}
export interface RuntimeConfigurationSnapshot {
  readonly version: number | null;
  readonly downloadSource: "instance" | "environment";
  agentLimits(
    fallback: AgentExecutionLimits,
  ): EffectiveRuntimeSetting<AgentExecutionLimits>;
  resultDownloads(
    context: { workspaceId: string; providerEndpointId: string },
    deployment: ResultDownloadRule,
  ): EffectiveRuntimeSetting<ResultDownloadRule>;
}

/** Bind the loader to a transaction when admission must share its consistency. */
export function createRuntimeConfigurationReader(
  load: () => Promise<RuntimeConfigurationRevision | null>,
) {
  return {
    async read(): Promise<RuntimeConfigurationSnapshot> {
      let revision: RuntimeConfigurationRevision | null;
      try {
        revision = await load();
      } catch {
        throw new RuntimeConfigurationError(
          "runtime_configuration.unavailable",
          "Runtime configuration could not be read. Retry when configuration storage is available.",
        );
      }
      const document = revision?.document.activated
        ? structuredClone(revision.document)
        : undefined;
      const version = document ? revision!.version : null;
      return Object.freeze({
        version,
        downloadSource: document
          ? ("instance" as const)
          : ("environment" as const),
        agentLimits(
          fallback: AgentExecutionLimits,
        ): EffectiveRuntimeSetting<AgentExecutionLimits> {
          return Object.freeze({
            value: Object.freeze({ ...(document?.agent ?? fallback) }),
            source: document ? "instance" : "profile",
            version,
          });
        },
        resultDownloads(
          context: { workspaceId: string; providerEndpointId: string },
          deployment: ResultDownloadRule,
        ): EffectiveRuntimeSetting<ResultDownloadRule> {
          const rule = document
            ? resolveGovernedDownloadRule(
                document,
                context.workspaceId,
                context.providerEndpointId,
              )
            : deployment;
          const origins =
            rule.allowedOrigins === null ? null : [...rule.allowedOrigins];
          if (origins) Object.freeze(origins);
          return Object.freeze({
            value: Object.freeze({
              enabled: deployment.enabled && rule.enabled,
              allowedOrigins: origins,
            }),
            source: document ? "instance" : "environment",
            version,
          });
        },
      });
    },
  };
}
