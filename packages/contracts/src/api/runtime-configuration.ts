import { Value } from "@sinclair/typebox/value";
import { Type, type Static } from "@sinclair/typebox";

const id = Type.String({ pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$" });
export const AgentExecutionLimitsSchema = Type.Object(
  {
    maximumModelCalls: Type.Integer({ minimum: 1, maximum: 64 }),
    maximumToolCalls: Type.Integer({ minimum: 0, maximum: 128 }),
    timeoutSeconds: Type.Integer({ minimum: 5, maximum: 1800 }),
  },
  { additionalProperties: false },
);
export const ResultDownloadRuleSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    allowedOrigins: Type.Union([
      Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
        maxItems: 100,
        uniqueItems: true,
      }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const RuntimeConfigurationDocumentSchema = Type.Object(
  {
    activated: Type.Boolean(),
    agent: AgentExecutionLimitsSchema,
    downloads: Type.Object(
      {
        defaults: ResultDownloadRuleSchema,
        providers: Type.Array(
          Type.Object(
            {
              workspaceId: id,
              providerEndpointId: id,
              rule: ResultDownloadRuleSchema,
            },
            { additionalProperties: false },
          ),
          { maxItems: 200 },
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.runtime-configuration-document.v1",
  },
);
export const RuntimeConfigurationRevisionSchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    document: RuntimeConfigurationDocumentSchema,
    reason: Type.String({ minLength: 1, maxLength: 500 }),
    publishedBy: id,
    publishedAt: Type.String({ format: "date-time" }),
    restoredFromVersion: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null(),
    ]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.runtime-configuration-revision.v1",
  },
);
export const PublishRuntimeConfigurationSchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 0 }),
    document: RuntimeConfigurationDocumentSchema,
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.publish-runtime-configuration.v1",
  },
);
export const RestoreRuntimeConfigurationSchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    sourceVersion: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.restore-runtime-configuration.v1",
  },
);
export type AgentExecutionLimits = Static<typeof AgentExecutionLimitsSchema>;
export type ResultDownloadRule = Static<typeof ResultDownloadRuleSchema>;
export type RuntimeConfigurationDocument = Static<
  typeof RuntimeConfigurationDocumentSchema
>;
export type RuntimeConfigurationRevision = Static<
  typeof RuntimeConfigurationRevisionSchema
>;
export type PublishRuntimeConfiguration = Static<
  typeof PublishRuntimeConfigurationSchema
>;
export type RestoreRuntimeConfiguration = Static<
  typeof RestoreRuntimeConfigurationSchema
>;

export function isRuntimeConfigurationDocument(
  value: unknown,
): value is RuntimeConfigurationDocument {
  return Value.Check(RuntimeConfigurationDocumentSchema, value);
}

export const RuntimeConfigurationWorkerSchema = Type.Object(
  {
    workerId: Type.String({ minLength: 1, maxLength: 120 }),
    deployment: Type.Object(
      {
        source: Type.Union([
          Type.Literal("environment"),
          Type.Literal("instance"),
        ]),
        downloadsEnabled: Type.Boolean(),
        allowedOrigins: ResultDownloadRuleSchema.properties.allowedOrigins,
        serviceVersion: Type.String({ maxLength: 160 }),
      },
      { additionalProperties: false },
    ),
    configurationVersion: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null(),
    ]),
    observedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export const RuntimeConfigurationOverviewSchema = Type.Object(
  {
    current: Type.Union([RuntimeConfigurationRevisionSchema, Type.Null()]),
    workers: Type.Array(RuntimeConfigurationWorkerSchema, { maxItems: 100 }),
    services: Type.Array(
      Type.Object(
        {
          workspaceId: id,
          providerEndpointId: id,
          name: Type.String(),
          workspaceName: Type.String(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1000 },
    ),
    servicesTruncated: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.runtime-configuration-overview.v1",
  },
);
export type RuntimeConfigurationWorker = Static<
  typeof RuntimeConfigurationWorkerSchema
>;
export type RuntimeConfigurationOverview = Static<
  typeof RuntimeConfigurationOverviewSchema
>;
