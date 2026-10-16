import { Type, type Static } from "@sinclair/typebox";

import {
  EditorPaintV1Schema,
  EditorTextEffectV1Schema,
} from "../editor/index.js";
import { IsoDateTimeSchema, UlidSchema } from "../primitives/index.js";

const DigestSchema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const HttpsUrlSchema = Type.String({
  minLength: 9,
  maxLength: 2_048,
  pattern: "^https://[^\\s]+$",
});
const StableIdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});
const BoundedLabelSchema = Type.String({ minLength: 1, maxLength: 240 });

export const ResourceSourceCapabilitySchema = Type.Union([
  Type.Literal("image.search"),
  Type.Literal("image.import"),
  Type.Literal("vector.search"),
  Type.Literal("vector.import"),
  Type.Literal("font.list"),
  Type.Literal("font.import"),
  Type.Literal("art_text.list"),
  Type.Literal("art_text.import"),
]);

export const ResourceSourceStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("validating"),
  Type.Literal("ready"),
  Type.Literal("published"),
  Type.Literal("failed"),
  Type.Literal("disabled"),
]);

export const ResourceSourceValidationStatusSchema = Type.Union([
  Type.Literal("not_checked"),
  Type.Literal("pending"),
  Type.Literal("passed"),
  Type.Literal("failed"),
]);

export const ResourceLicensePolicySchema = Type.Object(
  {
    requireCommercialUse: Type.Boolean(),
    allowAttribution: Type.Boolean(),
    allowShareAlike: Type.Boolean(),
    allowStandaloneRedistributionRestriction: Type.Boolean(),
    allowUnknownModelRelease: Type.Boolean(),
    allowUnknownPropertyRelease: Type.Boolean(),
    allowedLicenseIds: Type.Array(StableIdentifierSchema, {
      maxItems: 64,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const ResourceSourceInstanceSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: UlidSchema,
    workspaceId: UlidSchema,
    displayName: BoundedLabelSchema,
    adapterKind: StableIdentifierSchema,
    endpointOrigin: HttpsUrlSchema,
    status: ResourceSourceStatusSchema,
    validationStatus: ResourceSourceValidationStatusSchema,
    secretConfigured: Type.Boolean(),
    currentRevisionId: Type.Optional(UlidSchema),
    version: Type.Integer({ minimum: 1 }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-instance.v1",
  },
);

const ResourceSourceConfigurationSchema = Type.Record(
  Type.String({
    minLength: 1,
    maxLength: 120,
    pattern: "^[A-Za-z][A-Za-z0-9._-]*$",
  }),
  Type.Union([
    Type.Boolean(),
    Type.Integer(),
    Type.Number(),
    Type.String({ maxLength: 2_048 }),
    Type.Array(Type.String({ maxLength: 240 }), { maxItems: 128 }),
  ]),
  { maxProperties: 64 },
);

export const ResourceSourceRevisionSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: UlidSchema,
    sourceInstanceId: UlidSchema,
    adapterKind: StableIdentifierSchema,
    adapterVersion: Type.String({ minLength: 1, maxLength: 80 }),
    endpointOrigin: HttpsUrlSchema,
    configurationDigest: DigestSchema,
    capabilities: Type.Array(ResourceSourceCapabilitySchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
    licensePolicy: ResourceLicensePolicySchema,
    publishedAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-revision.v1",
  },
);

export const ResourceLicenseDescriptorSchema = Type.Object(
  {
    licenseId: StableIdentifierSchema,
    licenseUrl: HttpsUrlSchema,
    commercialUseAllowed: Type.Boolean(),
    modificationAllowed: Type.Boolean(),
    attributionRequired: Type.Boolean(),
    shareAlikeRequired: Type.Boolean(),
    standaloneRedistributionAllowed: Type.Boolean(),
    embeddingAllowed: Type.Optional(Type.Boolean()),
    creatorCredit: Type.Optional(Type.String({ maxLength: 500 })),
    sourceCredit: Type.Optional(Type.String({ maxLength: 500 })),
    modelReleaseStatus: Type.Union([
      Type.Literal("not_applicable"),
      Type.Literal("confirmed"),
      Type.Literal("unknown"),
    ]),
    propertyReleaseStatus: Type.Union([
      Type.Literal("not_applicable"),
      Type.Literal("confirmed"),
      Type.Literal("unknown"),
    ]),
    trademarkRisk: Type.Union([
      Type.Literal("none_declared"),
      Type.Literal("present"),
      Type.Literal("unknown"),
    ]),
    capturedAt: IsoDateTimeSchema,
    termsDigest: DigestSchema,
  },
  { additionalProperties: false },
);

export const ResourceProviderObligationsSchema = Type.Object(
  {
    displayCreditRequired: Type.Boolean(),
    hotlinkRequired: Type.Boolean(),
    downloadEventRequired: Type.Boolean(),
    brandingRequired: Type.Boolean(),
    coreReplicationRestricted: Type.Boolean(),
  },
  { additionalProperties: false },
);

const ResourceCandidateBase = {
  sourceInstanceId: UlidSchema,
  sourceRevisionId: UlidSchema,
  externalId: Type.String({ minLength: 1, maxLength: 500 }),
  title: BoundedLabelSchema,
  sourcePageUrl: HttpsUrlSchema,
  creatorName: Type.Optional(Type.String({ maxLength: 240 })),
  license: ResourceLicenseDescriptorSchema,
  providerObligations: ResourceProviderObligationsSchema,
} as const;

const ExternalMediaDescriptorSchema = Type.Object(
  {
    url: HttpsUrlSchema,
    mediaType: Type.Union([
      Type.Literal("image/jpeg"),
      Type.Literal("image/png"),
      Type.Literal("image/webp"),
      Type.Literal("image/svg+xml"),
    ]),
    width: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    height: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  },
  { additionalProperties: false },
);

export const ResourceImageCandidateSchema = Type.Object(
  {
    ...ResourceCandidateBase,
    kind: Type.Union([Type.Literal("image"), Type.Literal("vector")]),
    preview: ExternalMediaDescriptorSchema,
    original: ExternalMediaDescriptorSchema,
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-image-candidate.v1",
  },
);

const FontFileVariantSchema = Type.Object(
  {
    url: HttpsUrlSchema,
    format: Type.Union([
      Type.Literal("woff2"),
      Type.Literal("woff"),
      Type.Literal("ttf"),
      Type.Literal("otf"),
    ]),
    weight: Type.Integer({ minimum: 1, maximum: 1_000 }),
    style: Type.Union([Type.Literal("normal"), Type.Literal("italic")]),
    subset: Type.String({ minLength: 1, maxLength: 80 }),
    pinned: Type.Literal(true),
  },
  { additionalProperties: false },
);

export const ResourceFontCandidateSchema = Type.Object(
  {
    ...ResourceCandidateBase,
    kind: Type.Literal("font"),
    family: BoundedLabelSchema,
    upstreamVersion: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^(?!latest$).+$",
    }),
    category: Type.Union([
      Type.Literal("sans"),
      Type.Literal("serif"),
      Type.Literal("display"),
      Type.Literal("handwriting"),
      Type.Literal("monospace"),
      Type.Literal("other"),
    ]),
    scripts: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
    }),
    languages: Type.Array(Type.String({ minLength: 2, maxLength: 35 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    weights: Type.Array(Type.Integer({ minimum: 1, maximum: 1_000 }), {
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
    }),
    styles: Type.Array(
      Type.Union([Type.Literal("normal"), Type.Literal("italic")]),
      { minItems: 1, maxItems: 2, uniqueItems: true },
    ),
    fileVariants: Type.Array(FontFileVariantSchema, {
      minItems: 1,
      maxItems: 256,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-font-candidate.v1",
  },
);

export const ArtTextFontRequirementsSchema = Type.Object(
  {
    preferredFontRevisionId: Type.Optional(UlidSchema),
    requiredScripts: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 32,
      uniqueItems: true,
    }),
    fallbackCategory: Type.Union([
      Type.Literal("sans"),
      Type.Literal("serif"),
      Type.Literal("display"),
      Type.Literal("handwriting"),
      Type.Literal("monospace"),
    ]),
  },
  { additionalProperties: false },
);

export const ArtTextPresetManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: StableIdentifierSchema,
    revision: DigestSchema,
    labels: Type.Record(
      Type.String({ minLength: 2, maxLength: 35 }),
      Type.String({ minLength: 1, maxLength: 120 }),
      { minProperties: 1, maxProperties: 32 },
    ),
    fontRequirements: ArtTextFontRequirementsSchema,
    fill: EditorPaintV1Schema,
    effects: Type.Array(EditorTextEffectV1Schema, { maxItems: 32 }),
    letterSpacing: Type.Number({ minimum: -200, maximum: 2_000 }),
    lineHeight: Type.Number({ minimum: 0.5, maximum: 10 }),
    alignment: Type.Union([
      Type.Literal("left"),
      Type.Literal("center"),
      Type.Literal("right"),
    ]),
    editable: Type.Object(
      {
        text: Type.Literal(true),
        font: Type.Boolean(),
        colorSlots: Type.Array(StableIdentifierSchema, {
          maxItems: 32,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    license: ResourceLicenseDescriptorSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.art-text-preset-manifest.v1",
  },
);

export const ResourceArtTextCandidateSchema = Type.Object(
  {
    ...ResourceCandidateBase,
    kind: Type.Literal("art_text"),
    manifest: ArtTextPresetManifestSchema,
    previewUrl: Type.Optional(HttpsUrlSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-art-text-candidate.v1",
  },
);

export const ResourceCandidateSchema = Type.Union([
  ResourceImageCandidateSchema,
  ResourceFontCandidateSchema,
  ResourceArtTextCandidateSchema,
]);

export const ResourceAdoptionRequestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    sourceInstanceId: UlidSchema,
    sourceRevisionId: UlidSchema,
    candidateKind: Type.Union([
      Type.Literal("image"),
      Type.Literal("vector"),
      Type.Literal("font"),
      Type.Literal("art_text"),
    ]),
    externalId: Type.String({ minLength: 1, maxLength: 500 }),
    expectedTermsDigest: DigestSchema,
    displayName: BoundedLabelSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-adoption-request.v1",
  },
);

export const ResourceAdoptionResultSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("artifact"),
      artifactId: UlidSchema,
      assetId: Type.Optional(UlidSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("font_revision"),
      fontRevisionId: UlidSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("art_text_preset_revision"),
      artTextPresetRevisionId: UlidSchema,
    },
    { additionalProperties: false },
  ),
]);

export const ResourceSourcePathSchema = Type.Object(
  {
    resourceSourceId: UlidSchema,
  },
  { additionalProperties: false },
);

export const CreateResourceSourceBodySchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    adapterKind: StableIdentifierSchema,
    adapterVersion: Type.String({ minLength: 1, maxLength: 80 }),
    authMode: Type.Union([
      Type.Literal("none"),
      Type.Literal("api_key"),
      Type.Literal("client_credentials"),
    ]),
    endpointOrigin: HttpsUrlSchema,
    configuration: ResourceSourceConfigurationSchema,
    licensePolicy: ResourceLicensePolicySchema,
    credentialMaterial: Type.Optional(
      Type.String({ minLength: 1, maxLength: 65_536 }),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.create-resource-source-body.v1",
  },
);

export const ResourceSourceSummarySchema = Type.Object(
  {
    id: UlidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    adapterKind: StableIdentifierSchema,
    adapterVersion: Type.String({ minLength: 1, maxLength: 80 }),
    authMode: Type.Union([
      Type.Literal("none"),
      Type.Literal("api_key"),
      Type.Literal("client_credentials"),
    ]),
    endpointOrigin: HttpsUrlSchema,
    configuration: ResourceSourceConfigurationSchema,
    configurationDigest: DigestSchema,
    licensePolicy: ResourceLicensePolicySchema,
    lifecycleStatus: ResourceSourceStatusSchema,
    validationStatus: ResourceSourceValidationStatusSchema,
    validationReasonCode: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120 }),
    ),
    secretConfigured: Type.Boolean(),
    currentRevisionId: Type.Optional(UlidSchema),
    version: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    disabledAt: Type.Optional(IsoDateTimeSchema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-summary.v1",
  },
);

export const WorkspaceResourceSourcesSchema = Type.Object(
  {
    sources: Type.Array(ResourceSourceSummarySchema, { maxItems: 200 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-resource-sources.v1",
  },
);

export const ResourceSourceTypeSchema = Type.Object(
  {
    adapterKind: StableIdentifierSchema,
    adapterVersion: Type.String({ minLength: 1, maxLength: 80 }),
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 240 }),
    descriptions: Type.Optional(
      Type.Record(
        Type.String({ minLength: 2, maxLength: 35 }),
        Type.String({ minLength: 1, maxLength: 240 }),
        { maxProperties: 16 },
      ),
    ),
    iconPath: Type.String({
      pattern: "^/resource-source-icons/[a-z0-9-]+\\.svg$",
      maxLength: 160,
    }),
    resourceKinds: Type.Array(
      Type.Union([
        Type.Literal("image"),
        Type.Literal("vector"),
        Type.Literal("font"),
        Type.Literal("art_text"),
      ]),
      { minItems: 1, maxItems: 4, uniqueItems: true },
    ),
    capabilities: Type.Array(ResourceSourceCapabilitySchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
    authModes: Type.Array(
      Type.Union([
        Type.Literal("none"),
        Type.Literal("api_key"),
        Type.Literal("client_credentials"),
      ]),
      { minItems: 1, maxItems: 3, uniqueItems: true },
    ),
    defaultEndpointOrigin: Type.Optional(HttpsUrlSchema),
    credentialLabel: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120 }),
    ),
    credentialLabels: Type.Optional(
      Type.Record(
        Type.String({ minLength: 2, maxLength: 35 }),
        Type.String({ minLength: 1, maxLength: 120 }),
        { maxProperties: 16 },
      ),
    ),
    configurationFields: Type.Array(
      Type.Object(
        {
          key: StableIdentifierSchema,
          label: Type.String({ minLength: 1, maxLength: 120 }),
          labels: Type.Optional(
            Type.Record(
              Type.String({ minLength: 2, maxLength: 35 }),
              Type.String({ minLength: 1, maxLength: 120 }),
              { maxProperties: 16 },
            ),
          ),
          help: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
          helps: Type.Optional(
            Type.Record(
              Type.String({ minLength: 2, maxLength: 35 }),
              Type.String({ minLength: 1, maxLength: 240 }),
              { maxProperties: 16 },
            ),
          ),
          suggestions: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  value: Type.String({ minLength: 1, maxLength: 120 }),
                  label: Type.String({ minLength: 1, maxLength: 120 }),
                  labels: Type.Optional(
                    Type.Record(
                      Type.String({ minLength: 2, maxLength: 35 }),
                      Type.String({ minLength: 1, maxLength: 120 }),
                      { maxProperties: 16 },
                    ),
                  ),
                },
                { additionalProperties: false },
              ),
              { maxItems: 80 },
            ),
          ),
          inputKind: Type.Union([
            Type.Literal("text"),
            Type.Literal("boolean"),
            Type.Literal("integer"),
            Type.Literal("string_list"),
          ]),
          required: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 32 },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-type.v1",
  },
);

export const ResourceSourceTypeListSchema = Type.Object(
  {
    sourceTypes: Type.Array(ResourceSourceTypeSchema, { maxItems: 64 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-type-list.v1",
  },
);

export const ResourceSourceCreatedSchema = Type.Object(
  {
    source: ResourceSourceSummarySchema,
    replayed: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-created.v1",
  },
);

export const ResourceSourceVersionBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-version-body.v1",
  },
);

export const ValidateResourceSourceBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.validate-resource-source-body.v1",
  },
);

export const RotateResourceSourceCredentialBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    credentialMaterial: Type.String({ minLength: 1, maxLength: 65_536 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.rotate-resource-source-credential-body.v1",
  },
);

export const PublishResourceSourceBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1, maximum: 4_294_967_295 }),
    capabilities: Type.Array(ResourceSourceCapabilitySchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.publish-resource-source-body.v1",
  },
);

export const ResourceSourceMutationResultSchema = Type.Object(
  {
    source: ResourceSourceSummarySchema,
    replayed: Type.Boolean(),
    revision: Type.Optional(
      Type.Object(
        {
          id: UlidSchema,
          sourceId: UlidSchema,
          revisionNumber: Type.Integer({ minimum: 1 }),
          contentDigest: DigestSchema,
          capabilities: Type.Array(ResourceSourceCapabilitySchema, {
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          }),
          publishedAt: IsoDateTimeSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-source-mutation-result.v1",
  },
);

export const ResourceCatalogSourceSchema = Type.Object(
  {
    id: UlidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    adapterKind: StableIdentifierSchema,
    revisionId: UlidSchema,
    capabilities: Type.Array(ResourceSourceCapabilitySchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-catalog-source.v1",
  },
);

export const ResourceCatalogSourceListSchema = Type.Object(
  {
    sources: Type.Array(ResourceCatalogSourceSchema, { maxItems: 200 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-catalog-source-list.v1",
  },
);

export const ResourceCatalogSearchQuerySchema = Type.Object(
  {
    sourceId: UlidSchema,
    q: Type.String({ maxLength: 160 }),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-4][0-9]|50)$" })),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-catalog-search-query.v1",
  },
);

export const ResourceCatalogSearchResultSchema = Type.Object(
  {
    sourceId: UlidSchema,
    sourceRevisionId: UlidSchema,
    candidates: Type.Array(ResourceCandidateSchema, { maxItems: 50 }),
    nextCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  {
    additionalProperties: false,
    $id: "kanvas.resource-catalog-search-result.v1",
  },
);

export const WorkspaceFontRevisionSchema = Type.Object(
  {
    id: UlidSchema,
    family: Type.String({ minLength: 1, maxLength: 240 }),
    category: Type.Union([
      Type.Literal("sans"),
      Type.Literal("serif"),
      Type.Literal("display"),
      Type.Literal("handwriting"),
      Type.Literal("monospace"),
      Type.Literal("other"),
    ]),
    scripts: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
    }),
    languages: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    license: ResourceLicenseDescriptorSchema,
    files: Type.Array(
      Type.Object(
        {
          artifactId: UlidSchema,
          format: Type.Union([Type.Literal("ttf"), Type.Literal("otf")]),
          weight: Type.Integer({ minimum: 1, maximum: 1_000 }),
          style: Type.Union([Type.Literal("normal"), Type.Literal("italic")]),
          subset: Type.String({ minLength: 1, maxLength: 80 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 4 },
    ),
    createdAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-font-revision.v1",
  },
);

export const WorkspaceFontCatalogSchema = Type.Object(
  {
    fonts: Type.Array(WorkspaceFontRevisionSchema, { maxItems: 500 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-font-catalog.v1",
  },
);

export const WorkspaceArtTextPresetSchema = Type.Object(
  {
    id: UlidSchema,
    manifest: ArtTextPresetManifestSchema,
    createdAt: IsoDateTimeSchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-art-text-preset.v1",
  },
);

export const WorkspaceArtTextCatalogSchema = Type.Object(
  {
    presets: Type.Array(WorkspaceArtTextPresetSchema, { maxItems: 500 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workspace-art-text-catalog.v1",
  },
);

export type ResourceLicensePolicyReason =
  | "allowed"
  | "attribution_not_allowed"
  | "commercial_use_required"
  | "license_not_allowed"
  | "share_alike_not_allowed"
  | "standalone_restriction_not_allowed"
  | "unknown_model_release_not_allowed"
  | "unknown_property_release_not_allowed";

export function resourceLicensePolicyReason(
  policy: ResourceLicensePolicy,
  license: ResourceLicenseDescriptor,
): ResourceLicensePolicyReason {
  if (
    policy.allowedLicenseIds.length > 0 &&
    !policy.allowedLicenseIds.includes(license.licenseId)
  ) {
    return "license_not_allowed";
  }
  if (policy.requireCommercialUse && !license.commercialUseAllowed) {
    return "commercial_use_required";
  }
  if (!policy.allowAttribution && license.attributionRequired) {
    return "attribution_not_allowed";
  }
  if (!policy.allowShareAlike && license.shareAlikeRequired) {
    return "share_alike_not_allowed";
  }
  if (
    !policy.allowStandaloneRedistributionRestriction &&
    !license.standaloneRedistributionAllowed
  ) {
    return "standalone_restriction_not_allowed";
  }
  if (
    !policy.allowUnknownModelRelease &&
    license.modelReleaseStatus === "unknown"
  ) {
    return "unknown_model_release_not_allowed";
  }
  if (
    !policy.allowUnknownPropertyRelease &&
    license.propertyReleaseStatus === "unknown"
  ) {
    return "unknown_property_release_not_allowed";
  }
  return "allowed";
}

export type ResourceSourceCapability = Static<
  typeof ResourceSourceCapabilitySchema
>;
export type ResourceSourceInstance = Static<
  typeof ResourceSourceInstanceSchema
>;
export type ResourceSourceRevision = Static<
  typeof ResourceSourceRevisionSchema
>;
export type ResourceLicensePolicy = Static<typeof ResourceLicensePolicySchema>;
export type ResourceLicenseDescriptor = Static<
  typeof ResourceLicenseDescriptorSchema
>;
export type ResourceProviderObligations = Static<
  typeof ResourceProviderObligationsSchema
>;
export type ResourceImageCandidate = Static<
  typeof ResourceImageCandidateSchema
>;
export type ResourceFontCandidate = Static<typeof ResourceFontCandidateSchema>;
export type ArtTextPresetManifest = Static<typeof ArtTextPresetManifestSchema>;
export type ResourceArtTextCandidate = Static<
  typeof ResourceArtTextCandidateSchema
>;
export type ResourceCandidate = Static<typeof ResourceCandidateSchema>;
export type ResourceAdoptionRequest = Static<
  typeof ResourceAdoptionRequestSchema
>;
export type ResourceAdoptionResult = Static<
  typeof ResourceAdoptionResultSchema
>;
export type CreateResourceSourceBody = Static<
  typeof CreateResourceSourceBodySchema
>;
export type ResourceSourceSummary = Static<typeof ResourceSourceSummarySchema>;
export type WorkspaceResourceSources = Static<
  typeof WorkspaceResourceSourcesSchema
>;
export type ResourceSourceType = Static<typeof ResourceSourceTypeSchema>;
export type ResourceSourceTypeList = Static<
  typeof ResourceSourceTypeListSchema
>;
export type ResourceSourceCreated = Static<typeof ResourceSourceCreatedSchema>;
export type ResourceSourceVersionBody = Static<
  typeof ResourceSourceVersionBodySchema
>;
export type ValidateResourceSourceBody = Static<
  typeof ValidateResourceSourceBodySchema
>;
export type RotateResourceSourceCredentialBody = Static<
  typeof RotateResourceSourceCredentialBodySchema
>;
export type PublishResourceSourceBody = Static<
  typeof PublishResourceSourceBodySchema
>;
export type ResourceSourceMutationResult = Static<
  typeof ResourceSourceMutationResultSchema
>;
export type ResourceCatalogSource = Static<typeof ResourceCatalogSourceSchema>;
export type ResourceCatalogSourceList = Static<
  typeof ResourceCatalogSourceListSchema
>;
export type ResourceCatalogSearchQuery = Static<
  typeof ResourceCatalogSearchQuerySchema
>;
export type ResourceCatalogSearchResult = Static<
  typeof ResourceCatalogSearchResultSchema
>;
export type WorkspaceFontRevision = Static<typeof WorkspaceFontRevisionSchema>;
export type WorkspaceFontCatalog = Static<typeof WorkspaceFontCatalogSchema>;
export type WorkspaceArtTextPreset = Static<
  typeof WorkspaceArtTextPresetSchema
>;
export type WorkspaceArtTextCatalog = Static<
  typeof WorkspaceArtTextCatalogSchema
>;
