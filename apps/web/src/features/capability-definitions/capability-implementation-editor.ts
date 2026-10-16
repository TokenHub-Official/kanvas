import type {
  CapabilityAdminSummary,
  ModelResourceSummary,
  ProviderExecutionRouteSummary,
  PublishCapabilityImplementationRevisionBody,
  RuntimeAdapterSummary,
} from "@kanvas/contracts/api";
import type {
  CapabilityMappingDocumentV1,
  CapabilityMappingExpressionV1,
  CapabilityMappingJsonValue,
} from "@kanvas/contracts/capability";

export type CapabilityImplementationSource =
  | Readonly<{ kind: "model_resource"; id: string }>
  | Readonly<{ kind: "model_service"; id: string }>
  | Readonly<{ kind: "plugin"; id: string }>;

export interface InputFieldMappingDraft {
  readonly targetKey: string;
  readonly mode: "input" | "configuration" | "constant";
  readonly sourceKey: string;
  readonly constantValue: string;
}

export interface OutputFieldMappingDraft {
  readonly targetKey: string;
  readonly sourceKey: string;
}

export interface CapabilityImplementationDraft {
  readonly requestKey: string;
  readonly displayNameZh: string;
  readonly displayNameEn: string;
  readonly descriptionZh: string;
  readonly descriptionEn: string;
  readonly source?: CapabilityImplementationSource;
  readonly runtimeAdapterRevisionId: string;
  readonly configuration: Readonly<Record<string, CapabilityMappingJsonValue>>;
  readonly inputMappings: readonly InputFieldMappingDraft[];
  readonly outputMappings: readonly OutputFieldMappingDraft[];
  readonly priority: number;
  readonly fallbackOn: readonly (
    "not_applicable" | "unavailable" | "retry_exhausted"
  )[];
  readonly replaceBinding?: Readonly<{
    bindingId: string;
    expectedVersion: number;
  }>;
}

export type CapabilityImplementationDefinitionContext = Pick<
  CapabilityAdminSummary,
  "id" | "key" | "version" | "inputSchema" | "outputSchema" | "bindings"
>;

export type CapabilityImplementationDraftError =
  | "name"
  | "description"
  | "source"
  | "adapter"
  | "configuration"
  | "inputMapping"
  | "outputMapping"
  | "priority";

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function properties(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const value = record(schema.properties) ?? {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const property = record(item);
      return property ? [[key, property] as const] : [];
    }),
  );
}

function pointer(key: string): string {
  return `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function schemaExample(
  schema: Readonly<Record<string, unknown>>,
): CapabilityMappingJsonValue {
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0] as CapabilityMappingJsonValue;
  }
  if (schema.default !== undefined) {
    return schema.default as CapabilityMappingJsonValue;
  }
  if (schema.const !== undefined) {
    return schema.const as CapabilityMappingJsonValue;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0] as CapabilityMappingJsonValue;
  }
  if (schema.type === "string") {
    return schema.pattern === "^[0-7][0-9A-HJKMNP-TV-Z]{25}$"
      ? "01K00000000000000000000001"
      : "sample";
  }
  if (schema.type === "integer") {
    return typeof schema.minimum === "number" ? Math.ceil(schema.minimum) : 1;
  }
  if (schema.type === "number") {
    return typeof schema.minimum === "number" ? schema.minimum : 1;
  }
  if (schema.type === "boolean") return true;
  if (schema.type === "array") {
    const minimum =
      typeof schema.minItems === "number" ? Math.max(0, schema.minItems) : 0;
    const item = record(schema.items);
    return Array.from({ length: minimum }, () =>
      item ? schemaExample(item) : null,
    );
  }
  const objectProperties = properties(schema);
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  return Object.fromEntries(
    Object.entries(objectProperties)
      .filter(([key]) => required.has(key))
      .map(([key, property]) => [key, schemaExample(property)]),
  );
}

function schemaObjectExample(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, CapabilityMappingJsonValue>> {
  const value = schemaExample(schema);
  return record(value)
    ? (value as Readonly<Record<string, CapabilityMappingJsonValue>>)
    : {};
}

function semanticType(
  schema: Readonly<Record<string, unknown>>,
): string | undefined {
  return typeof schema["x-kanvas-semantic-type"] === "string"
    ? schema["x-kanvas-semantic-type"]
    : undefined;
}

function fieldCompatible(
  target: Readonly<Record<string, unknown>>,
  candidate: Readonly<Record<string, unknown>>,
): boolean {
  const targetType = target.type;
  const candidateType = candidate.type;
  const targetSemantic = semanticType(target);
  const deferredArtifactReference =
    candidate["x-kanvas-attempt-output-artifact"] === true &&
    targetType === "string" &&
    targetSemantic?.startsWith("artifact.") === true;
  const typeCompatible =
    deferredArtifactReference ||
    typeof targetType !== "string" ||
    typeof candidateType !== "string" ||
    targetType === candidateType ||
    (targetType === "number" && candidateType === "integer");
  const candidateSemantic = semanticType(candidate);
  const semanticCompatible =
    !targetSemantic ||
    targetSemantic === "value.any" ||
    targetSemantic === candidateSemantic;
  return typeCompatible && semanticCompatible;
}

function matchingSource(
  targetKey: string,
  target: Readonly<Record<string, unknown>>,
  candidates: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): string {
  const compatible = Object.entries(candidates).filter(([, candidate]) =>
    fieldCompatible(target, candidate),
  );
  if (
    targetKey in candidates &&
    fieldCompatible(target, candidates[targetKey]!)
  ) {
    return targetKey;
  }
  const targetSemantic = semanticType(target);
  if (targetSemantic) {
    const match = compatible.find(
      ([, candidate]) => semanticType(candidate) === targetSemantic,
    );
    if (match) return match[0];
  }
  return compatible[0]?.[0] ?? "";
}

export function emptyCapabilityImplementationDraft(
  definition: CapabilityImplementationDefinitionContext,
  replacement?: CapabilityAdminSummary["bindings"][number],
): CapabilityImplementationDraft {
  return Object.freeze({
    requestKey: crypto.randomUUID(),
    displayNameZh: "",
    displayNameEn: "",
    descriptionZh: "",
    descriptionEn: "",
    runtimeAdapterRevisionId: "",
    configuration: Object.freeze({}),
    inputMappings: Object.freeze([]),
    outputMappings: Object.freeze([]),
    priority:
      replacement?.order ??
      Math.max(0, ...definition.bindings.map((binding) => binding.order)) + 10,
    fallbackOn: Object.freeze(["unavailable"] as const),
    ...(replacement
      ? {
          replaceBinding: {
            bindingId: replacement.id,
            expectedVersion: replacement.version,
          },
        }
      : {}),
  });
}

export function selectCapabilityImplementationAdapter(
  draft: CapabilityImplementationDraft,
  definition: CapabilityImplementationDefinitionContext,
  adapter: RuntimeAdapterSummary,
): CapabilityImplementationDraft {
  const capabilityInputs = properties(definition.inputSchema);
  const adapterInputs = properties(adapter.invocationInputSchema);
  const adapterOutputs = properties(adapter.invocationOutputSchema);
  const capabilityOutputs = properties(definition.outputSchema);
  const requiredAdapterInputs = new Set(
    Array.isArray(adapter.invocationInputSchema.required)
      ? adapter.invocationInputSchema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  return Object.freeze({
    ...draft,
    runtimeAdapterRevisionId: adapter.id,
    configuration: Object.freeze(
      schemaObjectExample(adapter.configurationSchema),
    ),
    inputMappings: Object.freeze(
      Object.entries(adapterInputs)
        .filter(
          ([targetKey]) =>
            requiredAdapterInputs.has(targetKey) ||
            Object.hasOwn(capabilityInputs, targetKey),
        )
        .map(([targetKey, target]) => ({
          targetKey,
          mode: "input" as const,
          sourceKey: matchingSource(targetKey, target, capabilityInputs),
          constantValue: "",
        })),
    ),
    outputMappings: Object.freeze(
      Object.entries(capabilityOutputs).map(([targetKey, target]) => ({
        targetKey,
        sourceKey: matchingSource(targetKey, target, adapterOutputs),
      })),
    ),
  });
}

export function compatibleRuntimeAdapters(
  source: CapabilityImplementationSource | undefined,
  resources: readonly ModelResourceSummary[],
  providerRoutes: readonly ProviderExecutionRouteSummary[],
  adapters: readonly RuntimeAdapterSummary[],
  definition?: CapabilityImplementationDefinitionContext,
): readonly RuntimeAdapterSummary[] {
  if (!source) return [];
  const compatibleInterface = (adapter: RuntimeAdapterSummary): boolean => {
    if (!definition) return true;
    const capabilityInputs = properties(definition.inputSchema);
    const capabilityOutputs = properties(definition.outputSchema);
    const adapterInputs = properties(adapter.invocationInputSchema);
    const adapterOutputs = properties(adapter.invocationOutputSchema);
    const requiredCapabilityInputs = Array.isArray(
      definition.inputSchema.required,
    )
      ? definition.inputSchema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const mappedCapabilityInputs = new Set(
      Object.entries(adapterInputs)
        .map(([key, target]) => matchingSource(key, target, capabilityInputs))
        .filter(Boolean),
    );
    return (
      Object.entries(adapterInputs).every(
        ([key, target]) =>
          !Array.isArray(adapter.invocationInputSchema.required) ||
          !adapter.invocationInputSchema.required.includes(key) ||
          Boolean(matchingSource(key, target, capabilityInputs)),
      ) &&
      requiredCapabilityInputs.every((key) =>
        mappedCapabilityInputs.has(key),
      ) &&
      Object.entries(capabilityOutputs).every(([key, target]) =>
        Boolean(matchingSource(key, target, adapterOutputs)),
      )
    );
  };
  if (source.kind === "plugin") {
    const adapter = adapters.find((item) => item.id === source.id);
    return adapter?.sourceKinds.includes("plugin") &&
      compatibleInterface(adapter)
      ? [adapter]
      : [];
  }
  if (source.kind === "model_service") {
    const route = providerRoutes.find(
      (item) => item.routePolicyRevisionId === source.id,
    );
    if (!route?.modelOperation) return [];
    return adapters.filter((adapter) => {
      const selector = adapter.modelServiceSelector;
      if (!selector) return false;
      return (
        adapter.sourceKinds.includes("model_service") &&
        selector.operation === route.modelOperation &&
        (selector.apiSurface === undefined ||
          selector.apiSurface === route.apiSurface) &&
        (selector.providerPreset === undefined ||
          selector.providerPreset === route.providerPreset) &&
        compatibleInterface(adapter)
      );
    });
  }
  const resource = resources.find((item) => item.revisionId === source.id);
  return resource
    ? adapters.filter(
        (adapter) =>
          adapter.sourceKinds.includes("model_resource") &&
          adapter.supportedModelFormats.includes(resource.manifest.format) &&
          adapter.modelResourceInterfaceDigest !== undefined &&
          adapter.modelResourceInterfaceDigest ===
            resource.nativeInterfaceDigest &&
          adapter.executionTarget !== "provider" &&
          resource.manifest.executionTargets.includes(
            adapter.executionTarget,
          ) &&
          compatibleInterface(adapter),
      )
    : [];
}

export function capabilityImplementationDraftError(
  draft: CapabilityImplementationDraft,
): CapabilityImplementationDraftError | undefined {
  if (!draft.source) return "source";
  if (!draft.runtimeAdapterRevisionId) return "adapter";
  if (!draft.displayNameZh.trim() || !draft.displayNameEn.trim()) return "name";
  if (
    Boolean(draft.descriptionZh.trim()) !== Boolean(draft.descriptionEn.trim())
  ) {
    return "description";
  }
  if (
    !Number.isSafeInteger(draft.priority) ||
    draft.priority < 1 ||
    draft.priority > 4_294_967_295
  ) {
    return "priority";
  }
  if (
    draft.inputMappings.some(
      (mapping) =>
        (mapping.mode !== "constant" && !mapping.sourceKey) ||
        (mapping.mode === "constant" && !mapping.constantValue.trim()),
    )
  ) {
    return "inputMapping";
  }
  if (draft.outputMappings.some((mapping) => !mapping.sourceKey)) {
    return "outputMapping";
  }
  return undefined;
}

function constant(value: string): CapabilityMappingJsonValue {
  try {
    return JSON.parse(value) as CapabilityMappingJsonValue;
  } catch {
    return value;
  }
}

function inputExpression(
  mapping: InputFieldMappingDraft,
): CapabilityMappingExpressionV1 {
  if (mapping.mode === "constant") {
    return { op: "constant", value: constant(mapping.constantValue) };
  }
  return {
    op: "source",
    root: mapping.mode,
    pointer: pointer(mapping.sourceKey),
  };
}

function inputMapping(
  draft: CapabilityImplementationDraft,
): CapabilityMappingDocumentV1 {
  return {
    schemaVersion: "kanvas.capability-mapping/v1",
    direction: "input",
    expression: {
      op: "object",
      properties: Object.fromEntries(
        draft.inputMappings.map((mapping) => [
          mapping.targetKey,
          inputExpression(mapping),
        ]),
      ),
    },
  };
}

function outputMapping(
  draft: CapabilityImplementationDraft,
): CapabilityMappingDocumentV1 {
  return {
    schemaVersion: "kanvas.capability-mapping/v1",
    direction: "output",
    expression: {
      op: "object",
      properties: Object.fromEntries(
        draft.outputMappings.map((mapping) => [
          mapping.targetKey,
          {
            op: "source",
            root: "result",
            pointer: pointer(mapping.sourceKey),
          },
        ]),
      ),
    },
  };
}

export function capabilityImplementationBody(
  draft: CapabilityImplementationDraft,
  definition: CapabilityImplementationDefinitionContext,
  adapter: RuntimeAdapterSummary,
  resources: readonly ModelResourceSummary[],
  providerRoutes: readonly ProviderExecutionRouteSummary[],
): PublishCapabilityImplementationRevisionBody {
  const error = capabilityImplementationDraftError(draft);
  if (error || !draft.source) throw new TypeError(error ?? "source");
  let source: PublishCapabilityImplementationRevisionBody["source"];
  if (draft.source.kind === "model_resource") {
    source = {
      kind: "model_resource",
      modelResourceRevisionId: draft.source.id,
    };
  } else if (draft.source.kind === "model_service") {
    source = {
      kind: "model_service",
      routePolicyRevisionId: draft.source.id,
    };
  } else {
    source = { kind: "plugin" };
  }
  if (
    source.kind === "model_resource" &&
    !resources.some(
      (resource) => resource.revisionId === source.modelResourceRevisionId,
    )
  ) {
    throw new TypeError("source");
  }
  if (
    source.kind === "plugin" &&
    (!adapter.sourceKinds.includes("plugin") || draft.source.id !== adapter.id)
  ) {
    throw new TypeError("source");
  }
  if (
    source.kind === "model_service" &&
    !providerRoutes.some(
      (route) => route.routePolicyRevisionId === source.routePolicyRevisionId,
    )
  ) {
    throw new TypeError("source");
  }
  return {
    expectedDefinitionVersion: definition.version,
    displayName: {
      defaultLocale: "zh-CN",
      values: {
        "zh-CN": draft.displayNameZh.trim(),
        "en-US": draft.displayNameEn.trim(),
      },
    },
    ...(draft.descriptionZh.trim()
      ? {
          description: {
            defaultLocale: "zh-CN",
            values: {
              "zh-CN": draft.descriptionZh.trim(),
              "en-US": draft.descriptionEn.trim(),
            },
          },
        }
      : {}),
    source,
    runtimeAdapterRevisionId: adapter.id,
    configuration: draft.configuration,
    inputMapping: inputMapping(draft),
    outputMapping: outputMapping(draft),
    sampleCapabilityInput: schemaExample(definition.inputSchema),
    sampleAdapterResult: schemaExample(adapter.invocationOutputSchema),
    priority: draft.priority,
    eligibility: {},
    fallbackOn: [...draft.fallbackOn],
    ...(draft.replaceBinding ? { replaceBinding: draft.replaceBinding } : {}),
  };
}

export function capabilityImplementationBodyFromSource(
  source: CapabilityImplementationSource,
  displayName: Readonly<{ zh: string; en: string }>,
  definition: CapabilityImplementationDefinitionContext,
  adapter: RuntimeAdapterSummary,
  resources: readonly ModelResourceSummary[],
  providerRoutes: readonly ProviderExecutionRouteSummary[],
): PublishCapabilityImplementationRevisionBody {
  const selected = selectCapabilityImplementationAdapter(
    {
      ...emptyCapabilityImplementationDraft(definition),
      source,
      displayNameZh: displayName.zh,
      displayNameEn: displayName.en,
    },
    definition,
    adapter,
  );
  const requiredInputs = Array.isArray(adapter.invocationInputSchema.required)
    ? adapter.invocationInputSchema.required
    : [];
  const publicInputs = properties(definition.inputSchema);
  return capabilityImplementationBody(
    {
      ...selected,
      inputMappings: selected.inputMappings.filter(
        (mapping) =>
          Object.hasOwn(publicInputs, mapping.targetKey) ||
          requiredInputs.includes(mapping.targetKey),
      ),
    },
    definition,
    adapter,
    resources,
    providerRoutes,
  );
}
