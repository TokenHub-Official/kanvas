import type { AgentDiscoveryDiagnostics } from "@kanvas/contracts/api";
import type {
  AgentActionReceiptRecord,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  CapabilityCatalogToolExecution,
  CapabilityCatalogToolExecutor,
  CapabilityCatalogToolInput,
} from "@kanvas/agent-runtime";
import type { CapabilityDefinitionAdminStore } from "@kanvas/database/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAgentCapabilityCatalogExecutor(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly catalog: CapabilityDefinitionAdminStore;
  readonly locale: "zh-CN" | "en-US";
  readonly now: () => Date;
  readonly prepareInvoke: (options: {
    readonly capabilityKey: string;
    readonly contractRevisionId: string;
    readonly title: string;
    readonly description: string;
    readonly input: Readonly<Record<string, unknown>>;
  }) => Promise<CapabilityCatalogToolExecution>;
  readonly executeWithReceipt: (
    toolKey: string,
    input: unknown,
    operation: (
      action: AgentActionReceiptRecord,
    ) => Promise<CapabilityCatalogToolExecution>,
    failureReason: (error: unknown) => string,
  ) => Promise<CapabilityCatalogToolExecution>;
}): CapabilityCatalogToolExecutor {
  return Object.freeze({
    search: (input: CapabilityCatalogToolInput) =>
      options.executeWithReceipt(
        "capability.search",
        input,
        async () => {
          const startedAt = options.now();
          const query = input.query?.trim();
          const searchInput = {
            ...(query ? { query } : {}),
            ...(input.afterKey ? { afterKey: input.afterKey } : {}),
          };
          let result = await options.catalog.discoverAgentCatalog(
            options.authority,
            searchInput,
            startedAt,
          );
          const fallback =
            Boolean(query) &&
            !input.afterKey &&
            result.complete &&
            result.items.length === 0;
          if (fallback)
            result = await options.catalog.discoverAgentCatalog(
              options.authority,
              {},
              options.now(),
            );
          const items = result.items
            .filter((item) => item.availability.status === "ready")
            .map((item) => item.capability);
          const exclusions = result.items
            .filter((item) => item.availability.status !== "ready")
            .map((item) => ({
              key: item.capability.key,
              name: item.capability.declaration.catalog.title[options.locale],
              ...item.availability,
            }));
          let catalogState: AgentDiscoveryDiagnostics["catalogState"] = "ready";
          if (!result.complete) catalogState = "partial";
          else if (exclusions.some((item) => item.status === "unknown"))
            catalogState = "error";
          else if (items.length === 0) {
            catalogState = exclusions.length > 0 ? "unavailable" : "empty";
            if (catalogState === "empty" && input.afterKey)
              catalogState = "no_match";
          }
          return Object.freeze({
            modelOutput: Object.freeze({
              ...(fallback
                ? { queryMatched: false, showingAvailableCapabilities: true }
                : {}),
              catalogState,
              catalogScope:
                !input.afterKey && (fallback || !query) ? "all" : "query",
              complete: result.complete,
              ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
              evaluatedAt: result.evaluatedAt,
              unavailableCapabilities: exclusions,
              ...(catalogState === "empty"
                ? {
                    responseGuidance:
                      "The complete Agent-eligible catalog is empty. Continue independent work; capability discovery can resume in a new turn after configuration changes.",
                  }
                : {}),
              capabilities: Object.freeze(
                items.map((item) =>
                  Object.freeze({
                    key: item.key,
                    name: item.declaration.catalog.title[options.locale],
                    ...(item.declaration.catalog.description
                      ? {
                          description:
                            item.declaration.catalog.description[
                              options.locale
                            ],
                        }
                      : {}),
                    category: item.declaration.catalog.category[options.locale],
                    tags: item.declaration.catalog.tags,
                    inputs: item.declaration.parameters
                      .filter(
                        (parameter) =>
                          !record(item.inputSchema.properties) ||
                          Object.hasOwn(
                            item.inputSchema.properties,
                            parameter.key,
                          ),
                      )
                      .map((parameter) =>
                        Object.freeze({
                          key: parameter.key,
                          label: parameter.label[options.locale],
                          semanticType: parameter.semanticType,
                          required: parameter.required,
                        }),
                      ),
                    outputs: item.declaration.outputs.map((output) =>
                      Object.freeze({
                        key: output.key,
                        label: output.label[options.locale],
                        semanticType: output.semanticType,
                        primary: output.primary,
                      }),
                    ),
                    inputSchema: item.inputSchema,
                  }),
                ),
              ),
            }),
            outcomeReference: {
              kind: "query" as const,
              resultCount: items.length,
              diagnostics: {
                catalogState,
                complete: result.complete,
                evaluatedAt: result.evaluatedAt,
                exclusions: exclusions.map(
                  ({ key, stage, reason, status }) => ({
                    key,
                    stage,
                    ...(reason ? { reason } : {}),
                    status:
                      status === "unknown"
                        ? ("unknown" as const)
                        : ("unavailable" as const),
                  }),
                ),
                durationMs: Math.max(
                  0,
                  options.now().getTime() - startedAt.getTime(),
                ),
              },
            },
          });
        },
        () => "agent.capability_catalog_unavailable",
      ),
    invoke: async (input: unknown) => {
      if (
        !record(input) ||
        typeof input.capabilityKey !== "string" ||
        !/^[a-z0-9]+(?:[._:-][a-z0-9]+)+$/u.test(input.capabilityKey) ||
        !record(input.input) ||
        Object.keys(input).some(
          (key) => key !== "capabilityKey" && key !== "input",
        )
      ) {
        throw new TypeError("Capability invocation input is invalid.");
      }
      const capabilityKey = input.capabilityKey;
      const capabilityInput = input.input;
      const assessment = await options.catalog.resolveAgentCapability(
        options.authority,
        capabilityKey,
        options.now(),
      );
      if (!assessment || assessment.availability.status !== "ready") {
        return {
          modelOutput: {
            status: "unavailable",
            capabilityKey,
            reason: assessment?.availability.reason ?? "not_found",
            stage: assessment?.availability.stage ?? "eligibility",
          },
        };
      }
      const capability = assessment.capability;
      const validator = new Ajv2020({
        allErrors: true,
        strict: false,
        validateFormats: false,
      }).compile(capability.inputSchema);
      if (!validator(capabilityInput)) {
        throw new TypeError(
          "Capability input does not match its published public interface.",
        );
      }
      return options.prepareInvoke({
        capabilityKey: capability.key,
        contractRevisionId: capability.contractRevisionId,
        title: capability.declaration.catalog.title[options.locale],
        description:
          capability.declaration.catalog.description?.[options.locale] ??
          capability.declaration.catalog.title[options.locale],
        input: capabilityInput,
      });
    },
  });
}
