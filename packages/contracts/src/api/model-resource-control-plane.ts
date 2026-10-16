import { Type, type Static } from "@sinclair/typebox";

import { IsoDateTimeSchema, UlidSchema } from "../primitives/index.js";
import { LocalizedTextV1Schema } from "../capability/localized-text.js";

const Sha256DigestSchema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const ModelResourceKeySchema = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)+$",
});
const ModelResourceJsonSchema = Type.Record(Type.String(), Type.Unknown(), {
  maxProperties: 1_000,
});

export const ModelResourcePathSchema = Type.Object(
  {
    modelResourceId: UlidSchema,
  },
  { additionalProperties: false },
);

export const ModelResourceRevisionPathSchema = Type.Object(
  {
    modelResourceRevisionId: UlidSchema,
  },
  { additionalProperties: false },
);

export const ModelResourceImportPathSchema = Type.Object(
  {
    modelResourceImportId: UlidSchema,
  },
  { additionalProperties: false },
);

export const ModelResourceExecutionTargetSchema = Type.Union([
  Type.Literal("browser"),
  Type.Literal("worker"),
]);

export const ModelResourceFormatSchema = Type.Union([
  Type.Literal("onnx"),
  Type.Literal("safetensors"),
  Type.Literal("gguf"),
  Type.Literal("tflite"),
  Type.Literal("coreml"),
  Type.Literal("tesseract_data"),
  Type.Literal("wasm_bundle"),
  Type.Literal("other"),
]);

export const ModelResourceNativeInterfaceSchema = Type.Object(
  {
    protocol: Type.Union([
      Type.Literal("structured"),
      Type.Literal("tensor"),
      Type.Literal("multimodal"),
    ]),
    inputSchema: ModelResourceJsonSchema,
    outputSchema: ModelResourceJsonSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-native-interface.v1",
  },
);

export const ModelResourceLicenseSchema = Type.Object(
  {
    spdxId: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    sourceUrl: Type.Optional(
      Type.String({ minLength: 8, maxLength: 2_048, pattern: "^https://" }),
    ),
    confidence: Type.Union([
      Type.Literal("detected"),
      Type.Literal("declared"),
      Type.Literal("unknown"),
    ]),
  },
  { additionalProperties: false },
);

export const ModelResourceSourceProvenanceSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("hugging_face"),
      repository: Type.String({ minLength: 3, maxLength: 255 }),
      revision: Type.String({ minLength: 1, maxLength: 255 }),
      filePath: Type.String({ minLength: 1, maxLength: 800 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("https"),
      url: Type.String({
        minLength: 8,
        maxLength: 2_048,
        pattern: "^https://",
      }),
      etag: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
      lastModified: Type.Optional(
        Type.String({ minLength: 1, maxLength: 255 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("upload"),
      fileName: Type.String({ minLength: 1, maxLength: 255 }),
    },
    { additionalProperties: false },
  ),
]);

export const StartModelResourceImportBodySchema = Type.Object(
  {
    source: Type.Union([
      Type.Object(
        {
          kind: Type.Literal("url"),
          url: Type.String({
            minLength: 8,
            maxLength: 2_048,
            pattern: "^https://",
          }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("upload"),
          fileName: Type.String({ minLength: 1, maxLength: 255 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("catalog"),
          catalogEntryId: UlidSchema,
        },
        { additionalProperties: false },
      ),
    ]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.start-model-resource-import-body.v1",
  },
);

export const ModelResourceImportStatusSchema = Type.Union([
  Type.Literal("waiting_upload"),
  Type.Literal("fetching"),
  Type.Literal("analyzing"),
  Type.Literal("needs_input"),
  Type.Literal("ready"),
  Type.Literal("published"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const CancelModelResourceImportBodySchema = Type.Object(
  {},
  {
    additionalProperties: false,
    $id: "kanvas.cancel-model-resource-import-body.v1",
  },
);

export const ModelResourceImportSummarySchema = Type.Object(
  {
    id: UlidSchema,
    status: ModelResourceImportStatusSchema,
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    source: ModelResourceSourceProvenanceSchema,
    catalogEntryId: Type.Optional(UlidSchema),
    expectedByteSize: Type.Optional(
      Type.String({ pattern: "^[1-9][0-9]{0,19}$" }),
    ),
    downloadedBytes: Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$" }),
    cancelRequestedAt: Type.Optional(IsoDateTimeSchema),
    upload: Type.Optional(
      Type.Object(
        {
          maximumBytes: Type.String({ pattern: "^[1-9][0-9]{0,19}$" }),
          expiresAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
    ),
    suggestedKey: Type.Optional(ModelResourceKeySchema),
    suggestedDisplayName: Type.Optional(
      Type.String({ minLength: 1, maxLength: 160 }),
    ),
    format: Type.Optional(ModelResourceFormatSchema),
    files: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 800 }),
          mediaType: Type.String({ minLength: 1, maxLength: 160 }),
          byteSize: Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$" }),
          sha256: Sha256DigestSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 2_000 },
    ),
    license: Type.Optional(ModelResourceLicenseSchema),
    nativeInterface: Type.Optional(ModelResourceNativeInterfaceSchema),
    compatibleAdapters: Type.Array(
      Type.Object(
        {
          adapterKey: Type.String({ minLength: 3, maxLength: 160 }),
          displayName: LocalizedTextV1Schema,
          revision: Type.Integer({ minimum: 1 }),
          canonicalDigest: Sha256DigestSchema,
          executionTarget: Type.Union([
            Type.Literal("browser"),
            Type.Literal("worker"),
            Type.Literal("provider"),
          ]),
          confidence: Type.Union([
            Type.Literal("exact"),
            Type.Literal("probable"),
          ]),
          reasonCode: Type.String({
            minLength: 3,
            maxLength: 120,
            pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)+$",
          }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
    requiredUserInputs: Type.Array(
      Type.Union([Type.Literal("license"), Type.Literal("format")]),
      { maxItems: 2, uniqueItems: true },
    ),
    failure: Type.Optional(
      Type.Object(
        {
          code: Type.String({ minLength: 1, maxLength: 120 }),
          message: Type.String({ minLength: 1, maxLength: 500 }),
          recoverable: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-import-summary.v1",
  },
);

export const ModelResourceImportIngestionSchema = Type.Object(
  {
    id: UlidSchema,
    status: Type.Union([
      Type.Literal("analyzing"),
      Type.Literal("needs_input"),
      Type.Literal("ready"),
      Type.Literal("published"),
      Type.Literal("failed"),
    ]),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-import-ingestion.v1",
  },
);

export const PublishModelResourceImportBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    target: Type.Union([
      Type.Object(
        {
          kind: Type.Literal("new"),
          key: ModelResourceKeySchema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("new_revision"),
          modelResourceId: UlidSchema,
          expectedResourceVersion: Type.Integer({
            minimum: 1,
            maximum: 4_294_967_295,
          }),
        },
        { additionalProperties: false },
      ),
    ]),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
    format: ModelResourceFormatSchema,
    license: Type.Object(
      {
        spdxId: Type.String({ minLength: 1, maxLength: 80 }),
        sourceUrl: Type.Optional(
          Type.String({ minLength: 8, maxLength: 2_048 }),
        ),
      },
      { additionalProperties: false },
    ),
    nativeInterface: Type.Optional(ModelResourceNativeInterfaceSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.publish-model-resource-import-body.v1",
  },
);

export const ModelResourceManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.model-resource/v1"),
    family: Type.String({ minLength: 1, maxLength: 120 }),
    variant: Type.String({ minLength: 1, maxLength: 160 }),
    format: ModelResourceFormatSchema,
    executionTargets: Type.Array(ModelResourceExecutionTargetSchema, {
      maxItems: 2,
      uniqueItems: true,
    }),
    sha256: Sha256DigestSchema,
    byteSize: Type.Optional(Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$" })),
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
    source: ModelResourceSourceProvenanceSchema,
    nativeInterface: Type.Optional(ModelResourceNativeInterfaceSchema),
    runtime: Type.Record(
      Type.String({ minLength: 1, maxLength: 80 }),
      Type.String({ minLength: 1, maxLength: 255 }),
      { maxProperties: 32 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-manifest.v1",
  },
);

export const SetModelResourceStatusBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
  },
  {
    additionalProperties: false,
    $id: "kanvas.set-model-resource-status-body.v1",
  },
);

export const ModelResourceSummarySchema = Type.Object(
  {
    id: UlidSchema,
    key: Type.String({ minLength: 1, maxLength: 160 }),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    revisionId: UlidSchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    revisionDigest: Sha256DigestSchema,
    manifest: ModelResourceManifestSchema,
    nativeInterfaceDigest: Type.Optional(Sha256DigestSchema),
    implementationCount: Type.Integer({ minimum: 0 }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-summary.v1",
  },
);

export const ModelResourceCatalogCandidateSummarySchema = Type.Object(
  {
    id: UlidSchema,
    key: ModelResourceKeySchema,
    revision: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    displayName: LocalizedTextV1Schema,
    description: Type.Optional(LocalizedTextV1Schema),
    format: ModelResourceFormatSchema,
    expectedByteSize: Type.Optional(
      Type.String({ pattern: "^[1-9][0-9]{0,19}$" }),
    ),
    executionTargets: Type.Array(ModelResourceExecutionTargetSchema, {
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    }),
    sourceHost: Type.String({ minLength: 1, maxLength: 255 }),
    installed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-catalog-candidate-summary.v1",
  },
);

export const WorkspaceModelResourcesSchema = Type.Object(
  {
    generatedAt: IsoDateTimeSchema,
    resources: Type.Array(ModelResourceSummarySchema, { maxItems: 500 }),
    catalogCandidates: Type.Array(ModelResourceCatalogCandidateSummarySchema, {
      maxItems: 500,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-model-resources.v1",
  },
);

export const ModelResourceMutationResultSchema = Type.Object(
  {
    resource: ModelResourceSummarySchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.model-resource-mutation-result.v1",
  },
);

export const BrowserRuntimeCapabilitySchema = Type.Object(
  {
    capabilityKey: Type.String({ minLength: 1, maxLength: 160 }),
    implementationRevisionId: UlidSchema,
    implementationDigest: Sha256DigestSchema,
    runtimeAdapterRevisionId: UlidSchema,
    runtimeAdapterRevisionDigest: Sha256DigestSchema,
    adapterKey: Type.String({ minLength: 1, maxLength: 160 }),
    runtimeRole: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z][a-z0-9_]*$",
    }),
    runtimeProfileKind: Type.String({ minLength: 3, maxLength: 160 }),
    runtimeProfileVersion: Type.Integer({ minimum: 1 }),
    runtimeProfileSettings: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 32,
    }),
    implementationConfiguration: Type.Record(Type.String(), Type.Unknown(), {
      maxProperties: 200,
    }),
    modelResource: Type.Optional(
      Type.Object(
        {
          revisionId: UlidSchema,
          revisionDigest: Sha256DigestSchema,
          contentUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
          contentDigest: Sha256DigestSchema,
          format: ModelResourceFormatSchema,
          family: Type.String({ minLength: 1, maxLength: 160 }),
          variant: Type.String({ minLength: 1, maxLength: 160 }),
        },
        { additionalProperties: false },
      ),
    ),
    backend: Type.Union([
      Type.Literal("javascript"),
      Type.Literal("wasm"),
      Type.Literal("webgpu"),
    ]),
    probeProfileVersion: Type.Literal(1),
    probeResultDigest: Sha256DigestSchema,
  },
  { additionalProperties: false },
);

export const BrowserRuntimeManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.browser-runtime-manifest/v1"),
    runtimeReleaseId: UlidSchema,
    runtimeReleaseDigest: Sha256DigestSchema,
    capabilities: Type.Array(BrowserRuntimeCapabilitySchema, {
      maxItems: 64,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.browser-runtime-manifest.v1",
  },
);

export const ModelResourceBinaryContentSchema = Type.String({
  contentEncoding: "binary",
  description: "Authenticated immutable model resource byte stream.",
});

export const ModelResourceImportBinaryContentSchema = Type.String({
  contentEncoding: "binary",
  description: "Model resource bytes for one authenticated import.",
});

export type ModelResourceExecutionTarget = Static<
  typeof ModelResourceExecutionTargetSchema
>;
export type ModelResourceFormat = Static<typeof ModelResourceFormatSchema>;
export type ModelResourceNativeInterface = Static<
  typeof ModelResourceNativeInterfaceSchema
>;
export type ModelResourceLicense = Static<typeof ModelResourceLicenseSchema>;
export type ModelResourceSourceProvenance = Static<
  typeof ModelResourceSourceProvenanceSchema
>;
export type StartModelResourceImportBody = Static<
  typeof StartModelResourceImportBodySchema
>;
export type CancelModelResourceImportBody = Static<
  typeof CancelModelResourceImportBodySchema
>;
export type ModelResourceImportStatus = Static<
  typeof ModelResourceImportStatusSchema
>;
export type ModelResourceImportSummary = Static<
  typeof ModelResourceImportSummarySchema
>;
export type ModelResourceImportIngestion = Static<
  typeof ModelResourceImportIngestionSchema
>;
export type PublishModelResourceImportBody = Static<
  typeof PublishModelResourceImportBodySchema
>;
export type ModelResourceManifest = Static<typeof ModelResourceManifestSchema>;
export type SetModelResourceStatusBody = Static<
  typeof SetModelResourceStatusBodySchema
>;
export type ModelResourceSummary = Static<typeof ModelResourceSummarySchema>;
export type ModelResourceCatalogCandidateSummary = Static<
  typeof ModelResourceCatalogCandidateSummarySchema
>;
export type WorkspaceModelResources = Static<
  typeof WorkspaceModelResourcesSchema
>;
export type ModelResourceMutationResult = Static<
  typeof ModelResourceMutationResultSchema
>;
export type BrowserRuntimeCapability = Static<
  typeof BrowserRuntimeCapabilitySchema
>;
export type BrowserRuntimeManifest = Static<
  typeof BrowserRuntimeManifestSchema
>;
