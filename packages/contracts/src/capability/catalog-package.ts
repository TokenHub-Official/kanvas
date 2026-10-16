import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  CapabilityMappingDocumentV1Schema,
  CapabilityMappingExpressionV1Schema,
  CapabilityMappingJsonValueSchema,
} from "./mapping.js";
import { LocalizedTextV1Schema } from "./localized-text.js";
import {
  ModelResourceExecutionTargetSchema,
  ModelResourceFormatSchema,
  ModelResourceNativeInterfaceSchema,
  ModelResourceSourceProvenanceSchema,
} from "../api/model-resource-control-plane.js";

const DigestSchema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const KeySchema = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: "^[a-z0-9]+(?:[._:-][a-z0-9]+)+$",
});
const RelativeJsonPathSchema = Type.String({
  minLength: 6,
  maxLength: 800,
  pattern: String.raw`^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[a-zA-Z0-9._/-]+\.json$`,
});
const RevisionReferenceProperties = {
  key: KeySchema,
  revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  canonicalDigest: DigestSchema,
} as const;

export const CapabilitySurfaceSchema = Type.Union([
  Type.Literal("workflow"),
  Type.Literal("agent"),
  Type.Literal("canvas"),
]);

export const CapabilityLocalizedTextV1Schema = LocalizedTextV1Schema;

const CapabilityExposureSchema = Type.Union([
  Type.Literal("installation"),
  Type.Literal("workflow_author"),
  Type.Literal("template_input"),
  Type.Literal("hidden_derived"),
]);
const CapabilitySourceModeSchema = Type.Union([
  Type.Literal("constant"),
  Type.Literal("canvas_selection"),
  Type.Literal("workflow_input"),
  Type.Literal("upstream"),
  Type.Literal("mixed_rich_text"),
  Type.Literal("derived"),
]);
const CapabilityEditorSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("rich_prompt"),
  Type.Literal("enum"),
  Type.Literal("number"),
  Type.Literal("toggle"),
  Type.Literal("artifact_picker"),
  Type.Literal("artifact_list_picker"),
  Type.Literal("canvas_size"),
  Type.Literal("placement"),
  Type.Literal("background_source"),
  Type.Literal("region_list"),
  Type.Literal("json"),
]);

export const CapabilityDeclarationV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.capability-declaration/v1"),
    catalog: Type.Object(
      {
        title: CapabilityLocalizedTextV1Schema,
        description: Type.Optional(CapabilityLocalizedTextV1Schema),
        category: CapabilityLocalizedTextV1Schema,
        sourceKind: Type.Union([
          Type.Literal("custom"),
          Type.Literal("built_in"),
          Type.Literal("plugin"),
          Type.Literal("workflow"),
          Type.Literal("api"),
          Type.Literal("mcp"),
        ]),
        tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
          maxItems: 32,
          uniqueItems: true,
        }),
        surfaces: Type.Array(CapabilitySurfaceSchema, {
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    parameters: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 160 }),
          label: CapabilityLocalizedTextV1Schema,
          description: Type.Optional(CapabilityLocalizedTextV1Schema),
          semanticType: Type.String({
            minLength: 3,
            maxLength: 160,
            pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
          }),
          required: Type.Boolean(),
          exposurePolicy: Type.Object(
            {
              allowed: Type.Array(CapabilityExposureSchema, {
                minItems: 1,
                maxItems: 4,
                uniqueItems: true,
              }),
              default: CapabilityExposureSchema,
            },
            { additionalProperties: false },
          ),
          sourcePolicy: Type.Object(
            {
              allowed: Type.Array(CapabilitySourceModeSchema, {
                minItems: 1,
                maxItems: 5,
                uniqueItems: true,
              }),
              default: CapabilitySourceModeSchema,
            },
            { additionalProperties: false },
          ),
          editor: CapabilityEditorSchema,
          defaultValue: Type.Optional(
            Type.Ref(CapabilityMappingJsonValueSchema),
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    outputs: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 160 }),
          label: CapabilityLocalizedTextV1Schema,
          description: Type.Optional(CapabilityLocalizedTextV1Schema),
          semanticType: Type.String({
            minLength: 3,
            maxLength: 160,
            pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
          }),
          primary: Type.Boolean(),
          visibility: Type.Union([
            Type.Literal("author"),
            Type.Literal("advanced"),
            Type.Literal("hidden"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    canvas: Type.Optional(
      Type.Object(
        {
          actionGroup: Type.String({
            minLength: 3,
            maxLength: 160,
            pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
          }),
          interactionBehavior: Type.Union([
            Type.Literal("direct"),
            Type.Literal("form"),
          ]),
          completionBehavior: Type.Union([
            Type.Literal("auto_replace_safe"),
            Type.Literal("review_required"),
          ]),
          outputModes: Type.Array(
            Type.Union([
              Type.Literal("add_node"),
              Type.Literal("asset_only"),
              Type.Literal("fill_container"),
              Type.Literal("replace_content"),
              Type.Literal("set_background"),
            ]),
            { minItems: 1, maxItems: 5, uniqueItems: true },
          ),
          order: Type.Integer({ minimum: 0, maximum: 10_000 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-declaration.v1",
  },
);

export const CapabilityContractAssetV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    contractKey: KeySchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    inputSchema: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 1_000,
    }),
    outputSchema: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 1_000,
    }),
    idempotencyMode: Type.Union([
      Type.Literal("intrinsic"),
      Type.Literal("keyed"),
      Type.Literal("non_idempotent"),
    ]),
    supportedInvokers: Type.Array(
      Type.Union([
        Type.Literal("user"),
        Type.Literal("workflow"),
        Type.Literal("agent"),
        Type.Literal("canvas"),
      ]),
      { minItems: 1, maxItems: 4, uniqueItems: true },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-contract-asset.v1",
  },
);

export const CapabilityDeclarationAssetV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.capability-declaration-asset/v1"),
    contract: Type.Object(RevisionReferenceProperties, {
      additionalProperties: false,
    }),
    declaration: CapabilityDeclarationV1Schema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-declaration-asset.v1",
  },
);

export const CapabilityImplementationSourceV1Schema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("model_resource"),
      resource: Type.Object(RevisionReferenceProperties, {
        additionalProperties: false,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("model_service"),
      selector: Type.Object(
        {
          operation: KeySchema,
          apiSurface: Type.Optional(KeySchema),
          providerPreset: Type.Optional(KeySchema),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("plugin"),
      plugin: Type.Object(RevisionReferenceProperties, {
        additionalProperties: false,
      }),
    },
    { additionalProperties: false },
  ),
]);

export const CapabilityImplementationFixtureV1Schema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    capabilityInput: Type.Ref(CapabilityMappingJsonValueSchema),
    configuration: Type.Record(
      Type.String(),
      Type.Ref(CapabilityMappingJsonValueSchema),
      {
        maxProperties: 200,
      },
    ),
    expectedAdapterInput: Type.Ref(CapabilityMappingJsonValueSchema),
    adapterResult: Type.Ref(CapabilityMappingJsonValueSchema),
    expectedCapabilityOutput: Type.Ref(CapabilityMappingJsonValueSchema),
  },
  { additionalProperties: false },
);

export const CapabilityImplementationDefinitionV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.capability-implementation/v1"),
    implementationKey: KeySchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    contract: Type.Object(RevisionReferenceProperties, {
      additionalProperties: false,
    }),
    adapter: Type.Object(
      {
        adapterKey: KeySchema,
        revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
        canonicalDigest: DigestSchema,
      },
      { additionalProperties: false },
    ),
    source: CapabilityImplementationSourceV1Schema,
    configuration: Type.Ref(CapabilityMappingJsonValueSchema),
    inputMapping: Type.Ref(CapabilityMappingDocumentV1Schema),
    outputMapping: Type.Ref(CapabilityMappingDocumentV1Schema),
    fixtures: Type.Array(CapabilityImplementationFixtureV1Schema, {
      minItems: 1,
      maxItems: 32,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-implementation-definition.v1",
  },
);

export const CapabilityBindingDefinitionV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.capability-binding/v1"),
    bindingKey: KeySchema,
    contract: Type.Object(RevisionReferenceProperties, {
      additionalProperties: false,
    }),
    implementation: Type.Object(RevisionReferenceProperties, {
      additionalProperties: false,
    }),
    priority: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    enabled: Type.Boolean(),
    eligibility: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 64,
    }),
    fallbackOn: Type.Array(
      Type.Union([
        Type.Literal("not_applicable"),
        Type.Literal("unavailable"),
        Type.Literal("retry_exhausted"),
      ]),
      { maxItems: 3, uniqueItems: true },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-binding-definition.v1",
  },
);

/**
 * A trusted Catalog recommendation. Installing it never fabricates a published
 * ModelResourceRevision: the declared bytes still pass through the normal
 * import, StoragePort, digest verification, analysis, and publication flow.
 */
export const ModelResourceCatalogAssetV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.model-resource-catalog-asset/v1"),
    resourceKey: KeySchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    family: Type.String({ minLength: 1, maxLength: 120 }),
    variant: Type.String({ minLength: 1, maxLength: 160 }),
    sourceUrl: Type.String({
      minLength: 8,
      maxLength: 2_048,
      pattern: "^https://",
    }),
    source: ModelResourceSourceProvenanceSchema,
    expectedSha256: DigestSchema,
    expectedByteSize: Type.Optional(
      Type.String({ pattern: "^[1-9][0-9]{0,19}$" }),
    ),
    format: ModelResourceFormatSchema,
    mediaType: Type.String({ minLength: 1, maxLength: 160 }),
    license: Type.Object(
      {
        spdxId: Type.String({ minLength: 1, maxLength: 80 }),
        sourceUrl: Type.Optional(
          Type.String({ minLength: 8, maxLength: 2_048, pattern: "^https://" }),
        ),
      },
      { additionalProperties: false },
    ),
    nativeInterface: ModelResourceNativeInterfaceSchema,
    executionTargets: Type.Array(ModelResourceExecutionTargetSchema, {
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    }),
    revisionDigest: DigestSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-catalog-asset.v1",
  },
);

export const WorkflowCatalogAssetV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.workflow-catalog-asset/v1"),
    workflowKey: KeySchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    category: Type.Optional(LocalizedTextV1Schema),
    topology: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 1_000,
    }),
    inputSchema: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 1_000,
    }),
    outputSchema: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 1_000,
    }),
    requiredCapabilities: Type.Array(
      Type.Object(RevisionReferenceProperties, { additionalProperties: false }),
      { minItems: 1, maxItems: 128 },
    ),
    canonicalDigest: DigestSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-catalog-asset.v1",
  },
);

export const SkillCatalogAssetV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.skill-catalog-asset/v1"),
    skillKey: KeySchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: LocalizedTextV1Schema,
    nonProduction: Type.Boolean(),
    entrypoints: Type.Array(
      Type.Object(
        {
          entrypointKey: Type.String({ minLength: 1, maxLength: 160 }),
          displayName: LocalizedTextV1Schema,
          description: Type.Optional(LocalizedTextV1Schema),
          category: Type.Optional(LocalizedTextV1Schema),
          outputPresentation: Type.Union([
            Type.Literal("board"),
            Type.Literal("single_review"),
            Type.Literal("batch_review"),
            Type.Literal("assets"),
          ]),
          inputUiSchema: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              maxProperties: 200,
            }),
          ),
          inputUiSchemaByLocale: Type.Optional(
            Type.Record(
              Type.String({ minLength: 2, maxLength: 35 }),
              Type.Record(Type.String(), Type.Unknown(), {
                maxProperties: 200,
              }),
              { maxProperties: 16 },
            ),
          ),
          workflow: Type.Object(RevisionReferenceProperties, {
            additionalProperties: false,
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.skill-catalog-asset.v1",
  },
);

export const CatalogPackageAssetKindSchema = Type.Union([
  Type.Literal("runtime_adapter"),
  Type.Literal("model_resource"),
  Type.Literal("capability_contract"),
  Type.Literal("capability_declaration"),
  Type.Literal("capability_implementation"),
  Type.Literal("capability_binding"),
  Type.Literal("workflow"),
  Type.Literal("skill"),
]);

export const CatalogPackageAssetDescriptorV1Schema = Type.Object(
  {
    assetKey: KeySchema,
    kind: CatalogPackageAssetKindSchema,
    path: RelativeJsonPathSchema,
    contentDigest: DigestSchema,
    dependsOn: Type.Array(KeySchema, {
      maxItems: 64,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const CatalogPackageV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.catalog-package/v1"),
    packageKey: KeySchema,
    version: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-z0-9.-]+)?$",
    }),
    displayName: LocalizedTextV1Schema,
    dependencies: Type.Array(
      Type.Object(
        {
          packageKey: KeySchema,
          version: Type.String({ minLength: 1, maxLength: 80 }),
          contentDigest: DigestSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
    recommendations: Type.Array(
      Type.Object(
        {
          recommendationKey: KeySchema,
          defaultBindingAssetKey: KeySchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    assets: Type.Array(CatalogPackageAssetDescriptorV1Schema, {
      minItems: 1,
      maxItems: 2_000,
    }),
    contentDigest: DigestSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.catalog-package.v1",
  },
);

export const CapabilityCatalogRecommendationV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.capability-catalog-recommendation/v1"),
    recommendationKey: KeySchema,
    package: Type.Object(
      {
        packageKey: KeySchema,
        version: Type.String({ minLength: 1, maxLength: 80 }),
        contentDigest: DigestSchema,
        displayName: LocalizedTextV1Schema,
        dependencies: Type.Array(
          Type.Object(
            {
              packageKey: KeySchema,
              version: Type.String({ minLength: 1, maxLength: 80 }),
              contentDigest: DigestSchema,
            },
            { additionalProperties: false },
          ),
          { maxItems: 64 },
        ),
      },
      { additionalProperties: false },
    ),
    defaultBindingAssetKey: KeySchema,
    assets: Type.Array(
      Type.Object(
        {
          descriptor: CatalogPackageAssetDescriptorV1Schema,
          document: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
      { minItems: 5, maxItems: 8 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-catalog-recommendation.v1",
  },
);

export type CapabilitySurface = Static<typeof CapabilitySurfaceSchema>;
export type CapabilityContractAssetV1 = Static<
  typeof CapabilityContractAssetV1Schema
>;
export type CapabilityDeclarationAssetV1 = Static<
  typeof CapabilityDeclarationAssetV1Schema
>;
export type CapabilityImplementationSourceV1 = Static<
  typeof CapabilityImplementationSourceV1Schema
>;
export type CapabilityImplementationDefinitionV1 = Static<
  typeof CapabilityImplementationDefinitionV1Schema
>;
export type CapabilityBindingDefinitionV1 = Static<
  typeof CapabilityBindingDefinitionV1Schema
>;
export type ModelResourceCatalogAssetV1 = Static<
  typeof ModelResourceCatalogAssetV1Schema
>;
export type WorkflowCatalogAssetV1 = Static<
  typeof WorkflowCatalogAssetV1Schema
>;
export type SkillCatalogAssetV1 = Static<typeof SkillCatalogAssetV1Schema>;
export type CatalogPackageV1 = Static<typeof CatalogPackageV1Schema>;
export type CapabilityCatalogRecommendationV1 = Static<
  typeof CapabilityCatalogRecommendationV1Schema
>;

export class CatalogPackageError extends Error {
  public constructor(
    readonly code:
      | "invalid_document"
      | "duplicate_asset"
      | "missing_dependency"
      | "dependency_cycle",
    message: string,
  ) {
    super(message);
    this.name = "CatalogPackageError";
  }
}

export function parseCatalogPackageV1(value: unknown): CatalogPackageV1 {
  if (!Value.Check(CatalogPackageV1Schema, value)) {
    throw new CatalogPackageError(
      "invalid_document",
      "Catalog Package manifest does not match kanvas.catalog-package/v1.",
    );
  }
  return value;
}

export function parseCapabilityCatalogRecommendationV1(
  value: unknown,
): CapabilityCatalogRecommendationV1 {
  if (!Value.Check(CapabilityCatalogRecommendationV1Schema, value)) {
    throw new CatalogPackageError(
      "invalid_document",
      "Capability Catalog recommendation does not match kanvas.capability-catalog-recommendation/v1.",
    );
  }
  return value;
}

function parseAsset<T>(
  schema: Parameters<typeof Value.Check>[0],
  value: unknown,
  label: string,
): T {
  if (!Value.Check(schema, value)) {
    throw new CatalogPackageError(
      "invalid_document",
      `${label} does not match its Catalog asset contract.`,
    );
  }
  return value as T;
}

export function parseCapabilityContractAssetV1(
  value: unknown,
): CapabilityContractAssetV1 {
  return parseAsset(
    CapabilityContractAssetV1Schema,
    value,
    "Capability Contract",
  );
}

export function parseCapabilityDeclarationAssetV1(
  value: unknown,
): CapabilityDeclarationAssetV1 {
  let valid: boolean;
  try {
    valid = Value.Check(
      CapabilityDeclarationAssetV1Schema,
      [CapabilityMappingJsonValueSchema],
      value,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new CatalogPackageError(
      "invalid_document",
      "Capability Declaration does not match its Catalog asset contract.",
    );
  }
  const document = value as CapabilityDeclarationAssetV1;
  const localized = [
    document.declaration.catalog.title,
    document.declaration.catalog.description,
    document.declaration.catalog.category,
    ...document.declaration.parameters.flatMap((parameter) => [
      parameter.label,
      parameter.description,
    ]),
    ...document.declaration.outputs.flatMap((output) => [
      output.label,
      output.description,
    ]),
  ].filter((entry) => entry !== undefined);
  if (
    localized.some((entry) => !Object.hasOwn(entry.values, entry.defaultLocale))
  ) {
    throw new CatalogPackageError(
      "invalid_document",
      "Capability Declaration localized text is missing its default locale.",
    );
  }
  return document;
}

export function parseCapabilityImplementationDefinitionV1(
  value: unknown,
): CapabilityImplementationDefinitionV1 {
  let valid: boolean;
  try {
    valid = Value.Check(
      CapabilityImplementationDefinitionV1Schema,
      [
        CapabilityMappingJsonValueSchema,
        CapabilityMappingExpressionV1Schema,
        CapabilityMappingDocumentV1Schema,
      ],
      value,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new CatalogPackageError(
      "invalid_document",
      "Capability Implementation does not match its Catalog asset contract.",
    );
  }
  return value as CapabilityImplementationDefinitionV1;
}

export function parseCapabilityBindingDefinitionV1(
  value: unknown,
): CapabilityBindingDefinitionV1 {
  return parseAsset(
    CapabilityBindingDefinitionV1Schema,
    value,
    "Capability Binding",
  );
}

export function parseModelResourceCatalogAssetV1(
  value: unknown,
): ModelResourceCatalogAssetV1 {
  const document = parseAsset<ModelResourceCatalogAssetV1>(
    ModelResourceCatalogAssetV1Schema,
    value,
    "Model Resource Catalog entry",
  );
  const localized = [document.displayName, document.description].filter(
    (entry) => entry !== undefined,
  );
  if (
    localized.some((entry) => !Object.hasOwn(entry.values, entry.defaultLocale))
  ) {
    throw new CatalogPackageError(
      "invalid_document",
      "Model Resource Catalog localized text is missing its default locale.",
    );
  }
  return document;
}

export function parseWorkflowCatalogAssetV1(
  value: unknown,
): WorkflowCatalogAssetV1 {
  return parseAsset(
    WorkflowCatalogAssetV1Schema,
    value,
    "Workflow Catalog entry",
  );
}

export function parseSkillCatalogAssetV1(value: unknown): SkillCatalogAssetV1 {
  return parseAsset(SkillCatalogAssetV1Schema, value, "Skill Catalog entry");
}

export function orderCatalogPackageAssetsV1(
  manifest: CatalogPackageV1,
): readonly CatalogPackageV1["assets"][number][] {
  const byKey = new Map<string, CatalogPackageV1["assets"][number]>();
  for (const asset of manifest.assets) {
    if (byKey.has(asset.assetKey)) {
      throw new CatalogPackageError(
        "duplicate_asset",
        `Catalog Package asset ${asset.assetKey} is duplicated.`,
      );
    }
    byKey.set(asset.assetKey, asset);
  }
  for (const asset of manifest.assets) {
    for (const dependency of asset.dependsOn) {
      if (!byKey.has(dependency)) {
        throw new CatalogPackageError(
          "missing_dependency",
          `Catalog Package asset ${asset.assetKey} depends on missing asset ${dependency}.`,
        );
      }
    }
  }
  const result: CatalogPackageV1["assets"][number][] = [];
  const permanent = new Set<string>();
  const temporary = new Set<string>();
  const visit = (assetKey: string): void => {
    if (permanent.has(assetKey)) return;
    if (temporary.has(assetKey)) {
      throw new CatalogPackageError(
        "dependency_cycle",
        `Catalog Package asset dependency cycle includes ${assetKey}.`,
      );
    }
    temporary.add(assetKey);
    const asset = byKey.get(assetKey)!;
    for (const dependency of [...asset.dependsOn].sort()) visit(dependency);
    temporary.delete(assetKey);
    permanent.add(assetKey);
    result.push(asset);
  };
  for (const assetKey of [...byKey.keys()].sort()) visit(assetKey);
  return Object.freeze(result);
}
