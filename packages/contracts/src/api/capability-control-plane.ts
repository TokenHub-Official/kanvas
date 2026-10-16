import { Type, type Static } from "@sinclair/typebox";

import {
  BrowserExecutionRequirementSchema,
  CapabilityBindingSummarySchema,
  ProviderExecutionRouteSummarySchema,
  WorkflowCapabilityAuthoringDeclarationSchema,
  WorkflowCapabilityLocalizedTextSchema,
  WorkflowCapabilityOutputDeclarationSchema,
  WorkflowCapabilityParameterDeclarationSchema,
} from "./schemas.js";
import { IsoDateTimeSchema, UlidSchema } from "../primitives/index.js";
import { LocalizedTextV1Schema } from "../capability/localized-text.js";

const Sha256DigestSchema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });

export const CapabilityDefinitionPathSchema = Type.Object(
  {
    capabilityDefinitionId: UlidSchema,
  },
  { additionalProperties: false },
);

export const CapabilityCatalogEntryPathSchema = Type.Object(
  { catalogEntryId: UlidSchema },
  { additionalProperties: false },
);

export const CapabilityInvokerSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("workflow"),
  Type.Literal("agent"),
  Type.Literal("canvas"),
]);

export const CapabilityIdempotencyModeSchema = Type.Union([
  Type.Literal("intrinsic"),
  Type.Literal("keyed"),
  Type.Literal("non_idempotent"),
]);

const CapabilityMetadataProperties = {
  title: WorkflowCapabilityLocalizedTextSchema,
  description: Type.Optional(WorkflowCapabilityLocalizedTextSchema),
  category: WorkflowCapabilityLocalizedTextSchema,
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
    maxItems: 32,
    uniqueItems: true,
  }),
} as const;

const CapabilityDefinitionDraftProperties = {
  key: Type.String({
    minLength: 3,
    maxLength: 160,
    pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)+$",
  }),
  ...CapabilityMetadataProperties,
  sourceKind: Type.Union([
    Type.Literal("custom"),
    Type.Literal("built_in"),
    Type.Literal("plugin"),
    Type.Literal("workflow"),
    Type.Literal("api"),
    Type.Literal("mcp"),
  ]),
  surfaces: Type.Array(
    Type.Union([
      Type.Literal("workflow"),
      Type.Literal("agent"),
      Type.Literal("canvas"),
    ]),
    { minItems: 1, maxItems: 3, uniqueItems: true },
  ),
  inputSchema: Type.Record(Type.String(), Type.Unknown()),
  outputSchema: Type.Record(Type.String(), Type.Unknown()),
  parameters: Type.Array(WorkflowCapabilityParameterDeclarationSchema, {
    maxItems: 200,
  }),
  outputs: Type.Array(WorkflowCapabilityOutputDeclarationSchema, {
    maxItems: 200,
  }),
  canvas: Type.Optional(
    WorkflowCapabilityAuthoringDeclarationSchema.properties.canvas,
  ),
  idempotencyMode: CapabilityIdempotencyModeSchema,
  supportedInvokers: Type.Array(CapabilityInvokerSchema, {
    minItems: 1,
    maxItems: 4,
    uniqueItems: true,
  }),
} as const;

const CapabilityDefinitionDraftSchema = Type.Object(
  CapabilityDefinitionDraftProperties,
  {
    additionalProperties: false,
  },
);

export const UpdateCapabilityDefinitionBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    ...CapabilityMetadataProperties,
  },
  {
    additionalProperties: false,
    $id: "kanvas.update-capability-definition-body.v1",
  },
);

export const SetCapabilityDefinitionStatusBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.set-capability-definition-status-body.v1",
  },
);

export const PublishCapabilityImplementationRevisionBodySchema = Type.Object(
  {
    expectedDefinitionVersion: Type.Integer({
      minimum: 1,
      maximum: 4_294_967_295,
    }),
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    source: Type.Union([
      Type.Object(
        {
          kind: Type.Literal("model_resource"),
          modelResourceRevisionId: UlidSchema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("model_service"),
          routePolicyRevisionId: UlidSchema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("plugin"),
        },
        { additionalProperties: false },
      ),
    ]),
    runtimeAdapterRevisionId: UlidSchema,
    configuration: Type.Record(
      Type.String({ minLength: 1, maxLength: 160 }),
      Type.Unknown(),
      { maxProperties: 200 },
    ),
    inputMapping: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 16,
    }),
    outputMapping: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 16,
    }),
    sampleCapabilityInput: Type.Unknown(),
    sampleAdapterResult: Type.Unknown(),
    priority: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
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
    replaceBinding: Type.Optional(
      Type.Object(
        {
          bindingId: UlidSchema,
          expectedVersion: Type.Integer({
            minimum: 1,
            maximum: 4_294_967_295,
          }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.publish-capability-implementation-revision-body.v1",
  },
);

export const CreateCapabilityDefinitionBodySchema = Type.Object(
  {
    ...CapabilityDefinitionDraftSchema.properties,
    runMethod: Type.Omit(
      PublishCapabilityImplementationRevisionBodySchema,
      ["expectedDefinitionVersion", "replaceBinding"],
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-capability-definition-body.v1",
  },
);

export const InstallCapabilityRecommendationBodySchema = Type.Object(
  {
    expectedCatalogDigest: Sha256DigestSchema,
    confirmDependencies: Type.Literal(true),
    selectedRoutePolicyRevisionId: Type.Optional(UlidSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.install-capability-recommendation-body.v1",
  },
);

export const CapabilityInstallationSummarySchema = Type.Object(
  {
    id: UlidSchema,
    catalogEntryId: UlidSchema,
    status: Type.Union([
      Type.Literal("waiting_dependency"),
      Type.Literal("installing"),
      Type.Literal("installed"),
      Type.Literal("failed"),
    ]),
    requiredAction: Type.Union([
      Type.Literal("none"),
      Type.Literal("importing_model_resource"),
      Type.Literal("configure_model_service"),
      Type.Literal("retry"),
    ]),
    modelResourceImportId: Type.Optional(UlidSchema),
    installedDefinitionId: Type.Optional(UlidSchema),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-installation-summary.v1",
  },
);

export const CapabilityDefinitionSummarySchema = Type.Object(
  {
    id: UlidSchema,
    key: Type.String({ minLength: 1, maxLength: 160 }),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    contractRevisionId: UlidSchema,
    contractRevision: Type.Integer({ minimum: 1 }),
    contractDigest: Sha256DigestSchema,
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
    outputSchema: Type.Record(Type.String(), Type.Unknown()),
    idempotencyMode: CapabilityIdempotencyModeSchema,
    supportedInvokers: Type.Array(CapabilityInvokerSchema, {
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
    }),
    declarationRevisionId: Type.Optional(UlidSchema),
    declarationRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    declarationDigest: Type.Optional(Sha256DigestSchema),
    declaration: WorkflowCapabilityAuthoringDeclarationSchema,
    bindingCount: Type.Integer({ minimum: 0 }),
    activeBindingCount: Type.Integer({ minimum: 0 }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-definition-summary.v1",
  },
);

export const CapabilityAdminSummarySchema = Type.Object(
  {
    ...CapabilityDefinitionSummarySchema.properties,
    agentAvailability: Type.Optional(
      Type.Object(
        {
          status: Type.Union([
            Type.Literal("ready"),
            Type.Literal("unavailable"),
            Type.Literal("unknown"),
          ]),
          stage: Type.Union([
            Type.Literal("eligibility"),
            Type.Literal("binding"),
            Type.Literal("invocation"),
          ]),
          reason: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        },
        { additionalProperties: false },
      ),
    ),
    bindings: Type.Array(CapabilityBindingSummarySchema, {
      maxItems: 64,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-admin-summary.v1",
  },
);

export const RuntimeAdapterSummarySchema = Type.Object(
  {
    id: UlidSchema,
    key: Type.String({ minLength: 3, maxLength: 160 }),
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    digest: Sha256DigestSchema,
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    executionTarget: Type.Union([
      Type.Literal("browser"),
      Type.Literal("worker"),
      Type.Literal("provider"),
    ]),
    sourceKinds: Type.Array(
      Type.Union([
        Type.Literal("model_resource"),
        Type.Literal("model_service"),
        Type.Literal("plugin"),
      ]),
      { minItems: 1, maxItems: 3, uniqueItems: true },
    ),
    supportedModelFormats: Type.Array(
      Type.String({ minLength: 1, maxLength: 80 }),
      { maxItems: 32, uniqueItems: true },
    ),
    modelResourceInterfaceDigest: Type.Optional(Sha256DigestSchema),
    invocationInputSchema: Type.Record(Type.String(), Type.Unknown()),
    invocationOutputSchema: Type.Record(Type.String(), Type.Unknown()),
    configurationSchema: Type.Record(Type.String(), Type.Unknown()),
    modelServiceSelector: Type.Optional(
      Type.Object(
        {
          operation: Type.String({ minLength: 3, maxLength: 160 }),
          apiSurface: Type.Optional(
            Type.String({ minLength: 3, maxLength: 160 }),
          ),
          providerPreset: Type.Optional(
            Type.String({ minLength: 3, maxLength: 160 }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.runtime-adapter-summary.v1",
  },
);

export const CapabilityRecommendationSummarySchema = Type.Object(
  {
    id: UlidSchema,
    recommendationKey: Type.String({ minLength: 3, maxLength: 160 }),
    capabilityKey: Type.String({ minLength: 3, maxLength: 160 }),
    packageVersion: Type.String({ minLength: 1, maxLength: 80 }),
    canonicalDigest: Sha256DigestSchema,
    title: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    category: LocalizedTextV1Schema,
    sourceKind: Type.Union([
      Type.Literal("model_resource"),
      Type.Literal("model_service"),
      Type.Literal("plugin"),
    ]),
    compatibleModelRoutePolicyRevisionIds: Type.Array(UlidSchema, {
      maxItems: 512,
      uniqueItems: true,
    }),
    installedDefinitionId: Type.Optional(UlidSchema),
    installationStatus: Type.Optional(
      Type.Union([
        Type.Literal("waiting_dependency"),
        Type.Literal("installing"),
        Type.Literal("installed"),
        Type.Literal("failed"),
      ]),
    ),
    updateAvailable: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-recommendation-summary.v1",
  },
);

export const WorkspaceCapabilityDefinitionsSchema = Type.Object(
  {
    generatedAt: IsoDateTimeSchema,
    definitions: Type.Array(CapabilityAdminSummarySchema, {
      maxItems: 500,
    }),
    providerRoutes: Type.Array(ProviderExecutionRouteSummarySchema, {
      maxItems: 512,
    }),
    runtimeAdapters: Type.Array(RuntimeAdapterSummarySchema, {
      maxItems: 512,
    }),
    recommendations: Type.Array(CapabilityRecommendationSummarySchema, {
      maxItems: 500,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-capability-definitions.v1",
  },
);

export const CapabilityDefinitionMutationResultSchema = Type.Object(
  {
    definition: CapabilityDefinitionSummarySchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-definition-mutation-result.v1",
  },
);

export const CanvasCapabilityCatalogQuerySchema = Type.Object(
  {
    actionGroup: Type.String({
      minLength: 3,
      maxLength: 160,
      pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
    }),
    selectedSemanticType: Type.String({
      minLength: 3,
      maxLength: 160,
      pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
    }),
  },
  { additionalProperties: false },
);

export const CanvasCapabilitySummarySchema = Type.Object(
  {
    contractRevisionId: UlidSchema,
    capabilityKey: Type.String({ minLength: 3, maxLength: 160 }),
    displayName: Type.String({ minLength: 1, maxLength: 240 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    category: Type.String({ minLength: 1, maxLength: 120 }),
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
    parameters: Type.Array(WorkflowCapabilityParameterDeclarationSchema, {
      maxItems: 200,
    }),
    outputs: Type.Array(WorkflowCapabilityOutputDeclarationSchema, {
      maxItems: 200,
    }),
    canvas: Type.Required(
      Type.Pick(WorkflowCapabilityAuthoringDeclarationSchema, ["canvas"]),
    ).properties.canvas,
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-capability-summary.v1",
  },
);

export const CanvasCapabilityCatalogSchema = Type.Object(
  {
    items: Type.Array(CanvasCapabilitySummarySchema, { maxItems: 100 }),
    truncated: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.canvas-capability-catalog.v1",
  },
);

// Public discovery for direct user invocation; no provider or administration data.
export const UserCapabilitySummarySchema = Type.Omit(
  CanvasCapabilitySummarySchema,
  ["canvas"],
  { $id: "kanvas.user-capability-summary.v1" },
);
export const UserCapabilityCatalogSchema = Type.Object(
  {
    items: Type.Array(UserCapabilitySummarySchema, { maxItems: 100 }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false, $id: "kanvas.user-capability-catalog.v1" },
);
export type UserCapabilitySummary = Static<typeof UserCapabilitySummarySchema>;
export type UserCapabilityCatalog = Static<typeof UserCapabilityCatalogSchema>;

export const CreateCapabilityRunBodySchema = Type.Object(
  {
    contractRevisionId: UlidSchema,
    input: Type.Record(Type.String(), Type.Unknown()),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-capability-run-body.v1",
  },
);
export const CreateCanvasCapabilityRunBodySchema = Type.Object(
  { ...CreateCapabilityRunBodySchema.properties },
  {
    additionalProperties: false,
    $id: "kanvas.create-canvas-capability-run-body.v1",
  },
);

export const CancelCapabilityRunBodySchema = Type.Object(
  {},
  {
    additionalProperties: false,
    $id: "kanvas.cancel-capability-run-body.v1",
  },
);

export const CapabilityRunPathSchema = Type.Object(
  { capabilityRunId: UlidSchema },
  { additionalProperties: false },
);

export const CapabilityRunLifecycleStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const CapabilityRunDetailsSchema = Type.Object(
  {
    id: UlidSchema,
    contractRevisionId: UlidSchema,
    invocationKind: Type.Union([
      Type.Literal("user"),
      Type.Literal("agent"),
      Type.Literal("canvas"),
      Type.Literal("workflow"),
    ]),
    lifecycleStatus: CapabilityRunLifecycleStatusSchema,
    input: Type.Unknown(),
    output: Type.Optional(Type.Unknown()),
    externalResultUrls: Type.Optional(
      Type.Array(
        Type.String({ format: "uri", pattern: "^https://", maxLength: 8192 }),
        { maxItems: 16 },
      ),
    ),
    inputDeclarations: Type.Optional(
      Type.Array(WorkflowCapabilityParameterDeclarationSchema, {
        maxItems: 200,
      }),
    ),
    outputDeclarations: Type.Optional(
      Type.Array(WorkflowCapabilityOutputDeclarationSchema, {
        maxItems: 200,
      }),
    ),
    error: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    browserExecution: Type.Optional(BrowserExecutionRequirementSchema),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    executionDeadlineAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: Type.Optional(IsoDateTimeSchema),
    cancelRequestedAt: Type.Optional(IsoDateTimeSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-run-details.v1",
  },
);

export const CapabilityRunAcceptedSchema = Type.Object(
  {
    ...CapabilityRunDetailsSchema.properties,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-run-accepted.v1",
  },
);

export type CapabilityInvoker = Static<typeof CapabilityInvokerSchema>;
export type CapabilityIdempotencyMode = Static<
  typeof CapabilityIdempotencyModeSchema
>;
export type CreateCapabilityDefinitionBody = Static<
  typeof CreateCapabilityDefinitionBodySchema
>;
export type InstallCapabilityRecommendationBody = Static<
  typeof InstallCapabilityRecommendationBodySchema
>;
export type CapabilityInstallationSummary = Static<
  typeof CapabilityInstallationSummarySchema
>;
export type UpdateCapabilityDefinitionBody = Static<
  typeof UpdateCapabilityDefinitionBodySchema
>;
export type SetCapabilityDefinitionStatusBody = Static<
  typeof SetCapabilityDefinitionStatusBodySchema
>;
export type PublishCapabilityImplementationRevisionBody = Static<
  typeof PublishCapabilityImplementationRevisionBodySchema
>;
export type CapabilityDefinitionSummary = Static<
  typeof CapabilityDefinitionSummarySchema
>;
export type CapabilityAdminSummary = Static<
  typeof CapabilityAdminSummarySchema
>;
export type RuntimeAdapterSummary = Static<typeof RuntimeAdapterSummarySchema>;
export type CapabilityRecommendationSummary = Static<
  typeof CapabilityRecommendationSummarySchema
>;
export type WorkspaceCapabilityDefinitions = Static<
  typeof WorkspaceCapabilityDefinitionsSchema
>;
export type CapabilityDefinitionMutationResult = Static<
  typeof CapabilityDefinitionMutationResultSchema
>;
export type CanvasCapabilityCatalogQuery = Static<
  typeof CanvasCapabilityCatalogQuerySchema
>;
export type CanvasCapabilitySummary = Static<
  typeof CanvasCapabilitySummarySchema
>;
export type CanvasCapabilityCatalog = Static<
  typeof CanvasCapabilityCatalogSchema
>;
export type CreateCanvasCapabilityRunBody = Static<
  typeof CreateCanvasCapabilityRunBodySchema
>;
export type CreateCapabilityRunBody = Static<
  typeof CreateCapabilityRunBodySchema
>;
export type CancelCapabilityRunBody = Static<
  typeof CancelCapabilityRunBodySchema
>;
export type CapabilityRunDetails = Static<typeof CapabilityRunDetailsSchema>;
export type CapabilityRunAccepted = Static<typeof CapabilityRunAcceptedSchema>;
