import { VisualIdentitySymbolSchema } from "./visual-identity.js";
import { Type, type Static } from "@sinclair/typebox";
import { IsoDateTimeSchema, UlidSchema } from "../primitives/index.js";

export const htmlToolMaximumBytes = 2 * 1024 * 1024;
export const htmlToolPolicyVersion = "kanvas.html-tool/self-contained-v1";
const Version = Type.Integer({ minimum: 1, maximum: 4_294_967_295 });
const Digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const OptionalImage = Type.Union([UlidSchema, Type.Null()]);

export const ToolPresentationSchema = Type.Object(
  {
    slug: Type.String({
      minLength: 3,
      maxLength: 80,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    }),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ maxLength: 600 }),
    descriptionMarkdown: Type.String({ maxLength: 32_768 }),
    logoImageId: OptionalImage,
    symbol: Type.Optional(
      Type.Union([VisualIdentitySymbolSchema, Type.Null()]),
    ),
    coverImageId: OptionalImage,
    category: Type.String({ maxLength: 80 }),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
      maxItems: 12,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false, $id: "kanvas.tool-presentation.v1" },
);

export const ToolCheckIssueSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    severity: Type.Union([Type.Literal("error"), Type.Literal("warning")]),
    message: Type.String({ minLength: 1, maxLength: 600 }),
    line: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export const ToolCheckReportSchema = Type.Object(
  {
    policyVersion: Type.String({ minLength: 1, maxLength: 80 }),
    checkedDigest: Digest,
    passed: Type.Boolean(),
    issues: Type.Array(ToolCheckIssueSchema, { maxItems: 100 }),
    checkedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: "kanvas.tool-check-report.v1" },
);

export const ToolRevisionSchema = Type.Object(
  {
    id: UlidSchema,
    toolId: UlidSchema,
    revisionNumber: Type.Union([Version, Type.Null()]),
    versionLabel: Type.String({ maxLength: 80 }),
    releaseNotes: Type.String({ maxLength: 8_000 }),
    filename: Type.String({ minLength: 1, maxLength: 160 }),
    byteSize: Type.Integer({ minimum: 1, maximum: htmlToolMaximumBytes }),
    digest: Digest,
    allowedContractRevisionIds: Type.Array(UlidSchema, {
      maxItems: 32,
      uniqueItems: true,
    }),
    checkStatus: Type.Union([
      Type.Literal("unchecked"),
      Type.Literal("passed"),
      Type.Literal("failed"),
    ]),
    check: Type.Union([ToolCheckReportSchema, Type.Null()]),
    lifecycleStatus: Type.Union([
      Type.Literal("draft"),
      Type.Literal("published"),
    ]),
    createdAt: IsoDateTimeSchema,
    publishedAt: Type.Union([IsoDateTimeSchema, Type.Null()]),
  },
  { additionalProperties: false, $id: "kanvas.tool-revision.v1" },
);

export const SiteToolSchema = Type.Object(
  {
    ...ToolPresentationSchema.properties,
    id: UlidSchema,
    createdByPrincipalId: UlidSchema,
    state: Type.Union([
      Type.Literal("draft"),
      Type.Literal("enabled"),
      Type.Literal("disabled"),
    ]),
    version: Version,
    draft: Type.Union([ToolRevisionSchema, Type.Null()]),
    publishedRevision: Type.Union([ToolRevisionSchema, Type.Null()]),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  },
  { additionalProperties: false, $id: "kanvas.site-tool.v1" },
);
export const SiteToolListSchema = Type.Object(
  {
    items: Type.Array(SiteToolSchema, { maxItems: 200 }),
  },
  { additionalProperties: false, $id: "kanvas.site-tool-list.v1" },
);
export const SiteToolDetailSchema = Type.Object(
  {
    tool: SiteToolSchema,
    revisions: Type.Array(ToolRevisionSchema, { maxItems: 100 }),
  },
  { additionalProperties: false, $id: "kanvas.site-tool-detail.v1" },
);
/** Consumer catalogue deliberately excludes draft, author, time and check metadata. */
export const ToolCatalogueItemSchema = Type.Object(
  {
    id: UlidSchema,
    slug: ToolPresentationSchema.properties.slug,
    displayName: ToolPresentationSchema.properties.displayName,
    logoImageId: OptionalImage,
    symbol: Type.Optional(
      Type.Union([VisualIdentitySymbolSchema, Type.Null()]),
    ),
    coverImageId: OptionalImage,
  },
  { additionalProperties: false, $id: "kanvas.tool-catalogue-item.v1" },
);
export const ToolCatalogueSchema = Type.Object(
  { items: Type.Array(ToolCatalogueItemSchema, { maxItems: 200 }) },
  { additionalProperties: false, $id: "kanvas.tool-catalogue.v1" },
);
export const ToolUsageDetailSchema = Type.Object(
  {
    ...ToolCatalogueItemSchema.properties,
    descriptionMarkdown: ToolPresentationSchema.properties.descriptionMarkdown,
    publishedRevisionId: UlidSchema,
  },
  { additionalProperties: false, $id: "kanvas.tool-usage-detail.v1" },
);

export const CreateSiteToolBodySchema = Type.Object(
  {
    ...ToolPresentationSchema.properties,
  },
  { additionalProperties: false, $id: "kanvas.create-site-tool-body.v1" },
);
export const UpdateSiteToolBodySchema = Type.Object(
  {
    expectedVersion: Version,
    ...ToolPresentationSchema.properties,
  },
  { additionalProperties: false, $id: "kanvas.update-site-tool-body.v1" },
);
export const ToolVersionBodySchema = Type.Object(
  { expectedVersion: Version },
  { additionalProperties: false },
);
export const UploadToolHtmlBodySchema = Type.Object(
  {
    expectedVersion: Version,
    filename: Type.String({ minLength: 1, maxLength: 160 }),
    contentBase64: Type.String({ minLength: 4, maxLength: 2_796_204 }),
  },
  { additionalProperties: false, $id: "kanvas.upload-tool-html-body.v1" },
);
export const ConfigureToolDraftBodySchema = Type.Object(
  {
    expectedVersion: Version,
    versionLabel: Type.String({ maxLength: 80 }),
    releaseNotes: Type.String({ maxLength: 8_000 }),
    allowedContractRevisionIds: Type.Array(UlidSchema, {
      maxItems: 32,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false, $id: "kanvas.configure-tool-draft-body.v1" },
);
export const SetToolAvailabilityBodySchema = Type.Object(
  {
    expectedVersion: Version,
    enabled: Type.Boolean(),
  },
  { additionalProperties: false, $id: "kanvas.set-tool-availability-body.v1" },
);
export const ToolPathSchema = Type.Object(
  { toolId: UlidSchema },
  { additionalProperties: false },
);
export const ToolSlugQuerySchema = Type.Object(
  { slug: Type.Optional(ToolPresentationSchema.properties.slug) },
  { additionalProperties: false },
);
export const CreateToolSessionBodySchema = Type.Object(
  {
    expectedRevisionId: UlidSchema,
  },
  { additionalProperties: false, $id: "kanvas.create-tool-session-body.v1" },
);
export const ToolSessionSchema = Type.Object(
  {
    id: UlidSchema,
    toolId: UlidSchema,
    revisionId: UlidSchema,
    revisionDigest: Digest,
    kind: Type.Union([Type.Literal("preview"), Type.Literal("use")]),
    available: Type.Boolean(),
    unavailableReason: Type.Union([
      Type.String({ maxLength: 100 }),
      Type.Null(),
    ]),
    expiresAt: IsoDateTimeSchema,
    allowedContractRevisionIds: Type.Array(UlidSchema, { maxItems: 32 }),
    maximumRuns: Type.Integer({ minimum: 0, maximum: 10 }),
    runIds: Type.Array(UlidSchema, { maxItems: 10 }),
  },
  { additionalProperties: false, $id: "kanvas.tool-session.v1" },
);
export const ToolSessionPathSchema = Type.Object(
  { sessionId: UlidSchema },
  { additionalProperties: false },
);
export const ToolSessionRunPathSchema = Type.Object(
  { sessionId: UlidSchema, runId: UlidSchema },
  { additionalProperties: false },
);
export const InvokeToolCapabilityBodySchema = Type.Object(
  {
    contractRevisionId: UlidSchema,
    input: Type.Record(Type.String(), Type.Unknown()),
    requestKey: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z0-9-]+$",
    }),
  },
  { additionalProperties: false, $id: "kanvas.invoke-tool-capability-body.v1" },
);

export type ToolPresentation = Static<typeof ToolPresentationSchema>;
export type ToolCheckIssue = Static<typeof ToolCheckIssueSchema>;
export type ToolCheckReport = Static<typeof ToolCheckReportSchema>;
export type ToolRevision = Static<typeof ToolRevisionSchema>;
export type SiteTool = Static<typeof SiteToolSchema>;
export type SiteToolList = Static<typeof SiteToolListSchema>;
export type SiteToolDetail = Static<typeof SiteToolDetailSchema>;
export type CreateSiteToolBody = Static<typeof CreateSiteToolBodySchema>;
export type UpdateSiteToolBody = Static<typeof UpdateSiteToolBodySchema>;
export type UploadToolHtmlBody = Static<typeof UploadToolHtmlBodySchema>;
export type ConfigureToolDraftBody = Static<
  typeof ConfigureToolDraftBodySchema
>;
export type SetToolAvailabilityBody = Static<
  typeof SetToolAvailabilityBodySchema
>;
export type CreateToolSessionBody = Static<typeof CreateToolSessionBodySchema>;
export type ToolSession = Static<typeof ToolSessionSchema>;
export type InvokeToolCapabilityBody = Static<
  typeof InvokeToolCapabilityBodySchema
>;

export type ToolCatalogueItem = Static<typeof ToolCatalogueItemSchema>;
export type ToolCatalogue = Static<typeof ToolCatalogueSchema>;
export type ToolUsageDetail = Static<typeof ToolUsageDetailSchema>;

export const UploadToolImageBodySchema = Type.Object(
  { contentBase64: Type.String({ minLength: 4, maxLength: 2_796_204 }) },
  { additionalProperties: false, $id: "kanvas.upload-tool-image-body.v1" },
);
export const ToolImageCreatedSchema = Type.Object(
  { imageId: UlidSchema },
  { additionalProperties: false, $id: "kanvas.tool-image-created.v1" },
);
export const ToolImagePathSchema = Type.Object(
  { imageId: UlidSchema },
  { additionalProperties: false },
);
export const ToolImageContentSchema = Type.Object(
  {
    id: UlidSchema,
    mimeType: Type.Literal("image/png"),
    contentBase64: Type.String({ minLength: 4, maxLength: 699052 }),
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    width: Type.Integer({ minimum: 1, maximum: 2048 }),
    height: Type.Integer({ minimum: 1, maximum: 2048 }),
  },
  { additionalProperties: false, $id: "kanvas.tool-image-content.v1" },
);
export type UploadToolImageBody = Static<typeof UploadToolImageBodySchema>;
export type ToolImageContent = Static<typeof ToolImageContentSchema>;

export const ToolIntegrationQuerySchema = Type.Object(
  {
    workspaceId: Type.Optional(UlidSchema),
    query: Type.Optional(Type.String({ maxLength: 120 })),
  },
  { additionalProperties: false },
);
export const ToolIntegrationCatalogSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          contractRevisionId: UlidSchema,
          workspaceId: UlidSchema,
          workspaceName: Type.String(),
          capabilityKey: Type.String(),
          displayName: Type.String(),
          contractKey: Type.String(),
          contractDigest: Digest,
          revision: Version,
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false, $id: "kanvas.tool-integration-catalog.v1" },
);
export type ToolIntegrationQuery = Static<typeof ToolIntegrationQuerySchema>;
export type ToolIntegrationCatalog = Static<
  typeof ToolIntegrationCatalogSchema
>;

/** Administrator-only source. Never included in consumer catalogue projections. */
export const ToolSourceQuerySchema = Type.Object(
  { revisionId: Type.Optional(UlidSchema) },
  { additionalProperties: false },
);
export const ToolSourceSchema = Type.Object(
  {
    revisionId: UlidSchema,
    filename: Type.String({ minLength: 1, maxLength: 160 }),
    content: Type.String({ maxLength: 2_097_152 }),
    version: Version,
  },
  { additionalProperties: false, $id: "kanvas.tool-source.v1" },
);
export type ToolSource = Static<typeof ToolSourceSchema>;
export type ToolSourceQuery = Static<typeof ToolSourceQuerySchema>;
