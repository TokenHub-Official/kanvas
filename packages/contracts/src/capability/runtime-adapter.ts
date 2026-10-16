import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { LocalizedTextV1Schema } from "./localized-text.js";

const DigestSchema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const KeySchema = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: "^[a-z0-9]+(?:[._:-][a-z0-9]+)+$",
});
const JsonSchemaSchema = Type.Record(Type.String(), Type.Unknown(), {
  maxProperties: 1_000,
});

export const RuntimeAdapterExecutionTargetSchema = Type.Union([
  Type.Literal("browser"),
  Type.Literal("worker"),
  Type.Literal("provider"),
]);

export const RuntimeAdapterSourceKindSchema = Type.Union([
  Type.Literal("model_resource"),
  Type.Literal("model_service"),
  Type.Literal("plugin"),
]);

export const RuntimeAdapterArtifactInputSchema = Type.Object(
  {
    role: Type.String({ minLength: 1, maxLength: 80 }),
    pointer: Type.String({
      maxLength: 2_048,
      pattern: "^(?:/(?:[^~/]|~[01])*)*$",
    }),
    required: Type.Boolean(),
    mediaTypes: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const RuntimeAdapterExecutableSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("built_in"), Type.Literal("plugin")]),
    packageKey: KeySchema,
    packageVersion: Type.String({ minLength: 1, maxLength: 80 }),
    entrypoint: KeySchema,
    releaseDigest: DigestSchema,
  },
  { additionalProperties: false },
);

export const RuntimeAdapterRuntimeProfileSchema = Type.Object(
  {
    kind: KeySchema,
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    settings: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1, maxLength: 80 }),
        Type.Unknown(),
        {
          maxProperties: 32,
        },
      ),
    ),
  },
  { additionalProperties: false },
);

export const RuntimeAdapterModelServiceSelectorSchema = Type.Object(
  {
    operation: KeySchema,
    apiSurface: Type.Optional(KeySchema),
    providerPreset: Type.Optional(KeySchema),
  },
  { additionalProperties: false },
);

export const RuntimeAdapterSelectionPolicySchema = Type.Union([
  Type.Object(
    { scope: Type.Literal("reusable") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      scope: Type.Literal("capability_private"),
      capabilityKey: KeySchema,
    },
    { additionalProperties: false },
  ),
]);

export const RuntimeAdapterUsageMetricSchema = Type.Object(
  {
    metricKey: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z][a-z0-9._-]*$",
    }),
    unitCode: Type.String({
      minLength: 1,
      maxLength: 40,
      pattern: "^[a-z][a-z0-9._-]*$",
    }),
  },
  { additionalProperties: false },
);

/**
 * Immutable description published by a trusted executable adapter package.
 * Capability and model keys deliberately do not appear in this contract.
 */
export const RuntimeAdapterDefinitionRevisionSchema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.runtime-adapter-definition/v1"),
    adapterKey: KeySchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    executionTarget: RuntimeAdapterExecutionTargetSchema,
    sourceKinds: Type.Array(RuntimeAdapterSourceKindSchema, {
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    }),
    supportedModelFormats: Type.Array(
      Type.String({ minLength: 1, maxLength: 80 }),
      { maxItems: 32, uniqueItems: true },
    ),
    modelResourceInterfaceDigest: Type.Optional(DigestSchema),
    invocationInputSchema: JsonSchemaSchema,
    invocationOutputSchema: JsonSchemaSchema,
    configurationSchema: JsonSchemaSchema,
    selectionPolicy: Type.Optional(RuntimeAdapterSelectionPolicySchema),
    modelServiceSelector: Type.Optional(
      RuntimeAdapterModelServiceSelectorSchema,
    ),
    usageMetrics: Type.Optional(
      Type.Array(RuntimeAdapterUsageMetricSchema, {
        maxItems: 64,
      }),
    ),
    runtimeProfile: Type.Optional(RuntimeAdapterRuntimeProfileSchema),
    artifactInputs: Type.Array(RuntimeAdapterArtifactInputSchema, {
      maxItems: 32,
    }),
    executable: RuntimeAdapterExecutableSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.runtime-adapter-definition-revision.v1",
  },
);

export type RuntimeAdapterExecutionTarget = Static<
  typeof RuntimeAdapterExecutionTargetSchema
>;
export type RuntimeAdapterSourceKind = Static<
  typeof RuntimeAdapterSourceKindSchema
>;
export type RuntimeAdapterSelectionPolicy = Static<
  typeof RuntimeAdapterSelectionPolicySchema
>;
export type RuntimeAdapterDefinitionRevision = Static<
  typeof RuntimeAdapterDefinitionRevisionSchema
>;

export function parseRuntimeAdapterDefinitionRevision(
  value: unknown,
): RuntimeAdapterDefinitionRevision {
  if (!Value.Check(RuntimeAdapterDefinitionRevisionSchema, value)) {
    throw new TypeError(
      "Runtime Adapter definition does not match kanvas.runtime-adapter-definition/v1.",
    );
  }
  return value;
}
