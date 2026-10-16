import { ToolSourceSchema, ToolSourceQuerySchema } from "./site-tools.js";
import {
  ToolIntegrationQuerySchema,
  ToolIntegrationCatalogSchema,
} from "./site-tools.js";
import {
  UploadToolImageBodySchema,
  ToolImageCreatedSchema,
  ToolImagePathSchema,
  ToolImageContentSchema,
} from "./site-tools.js";
import { Type, type TSchema } from "@sinclair/typebox";
import { defineRoute, type RouteContract } from "./route.js";
import {
  BrowserMutationHeadersSchema,
  ProblemDetailsSchema,
  WorkspaceScopeHeadersSchema,
} from "./schemas.js";
import {
  SiteToolListSchema,
  ToolCatalogueSchema,
  ToolUsageDetailSchema,
  ToolPresentationSchema,
  SiteToolDetailSchema,
  CreateSiteToolBodySchema,
  UpdateSiteToolBodySchema,
  ToolPathSchema,
  ToolVersionBodySchema,
  UploadToolHtmlBodySchema,
  ConfigureToolDraftBodySchema,
  SetToolAvailabilityBodySchema,
} from "./site-tools.js";
import { UlidSchema } from "../primitives/index.js";
export const SiteToolMutationHeadersSchema = Type.Object(
  {
    ...BrowserMutationHeadersSchema.properties,
    "idempotency-key": Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9:_-]+$",
    }),
  },
  { additionalProperties: true },
);
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  403: ProblemDetailsSchema,
  404: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
};
export const SiteToolMutationSchema = Type.Object(
  { toolId: UlidSchema, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false, $id: "kanvas.site-tool-mutation.v1" },
);
export const listSiteToolsRoute = defineRoute({
  operationId: "siteTools.list",
  method: "GET",
  path: "/api/v1/instance/tools",
  summary: "List tools for site administration",
  responses: { 200: SiteToolListSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const getSiteToolRoute = defineRoute({
  operationId: "siteTools.get",
  method: "GET",
  path: "/api/v1/instance/tools/{toolId}",
  summary: "Inspect tool maintenance details",
  request: { path: ToolPathSchema },
  responses: { 200: SiteToolDetailSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const getSiteToolSourceRoute = defineRoute({
  operationId: "siteTools.source",
  method: "GET",
  path: "/api/v1/instance/tools/{toolId}/source",
  summary: "Read the current draft or published HTML as administrator data",
  request: { path: ToolPathSchema, query: ToolSourceQuerySchema },
  responses: { 200: ToolSourceSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const createSiteToolRoute = defineRoute({
  operationId: "siteTools.create",
  method: "POST",
  path: "/api/v1/instance/tools",
  summary: "Create a site-managed tool",
  request: {
    headers: SiteToolMutationHeadersSchema,
    body: CreateSiteToolBodySchema,
  },
  responses: { 201: SiteToolMutationSchema, ...errors },
  security: ["browserSession"],
  idempotency: "required",
} satisfies RouteContract);
function mutation(operation: string, suffix: string, body: TSchema) {
  return defineRoute({
    operationId: `siteTools.${operation}`,
    method: "POST",
    path: `/api/v1/instance/tools/{toolId}${suffix}`,
    summary: `Site administrator: ${operation} tool`,
    request: {
      path: ToolPathSchema,
      headers: SiteToolMutationHeadersSchema,
      body,
    },
    responses: { 200: SiteToolMutationSchema, ...errors },
    security: ["browserSession"],
    idempotency: "required",
  } satisfies RouteContract);
}
export const updateSiteToolRoute = mutation(
  "update",
  "/presentation",
  UpdateSiteToolBodySchema,
);
export const uploadSiteToolHtmlRoute = mutation(
  "uploadHtml",
  "/html",
  UploadToolHtmlBodySchema,
);
export const configureSiteToolDraftRoute = mutation(
  "configureDraft",
  "/draft",
  ConfigureToolDraftBodySchema,
);
export const checkSiteToolRoute = mutation(
  "check",
  "/check",
  ToolVersionBodySchema,
);
export const discardSiteToolDraftRoute = mutation(
  "discardDraft",
  "/discard-draft",
  ToolVersionBodySchema,
);
export const publishSiteToolRoute = mutation(
  "publish",
  "/publish",
  ToolVersionBodySchema,
);
export const deleteSiteToolRoute = mutation(
  "delete",
  "/delete",
  ToolVersionBodySchema,
);
export const setSiteToolAvailabilityRoute = mutation(
  "setAvailability",
  "/availability",
  SetToolAvailabilityBodySchema,
);
export const siteToolRoutes: readonly RouteContract[] = [
  listSiteToolsRoute,
  getSiteToolSourceRoute,
  getSiteToolRoute,
  createSiteToolRoute,
  updateSiteToolRoute,
  uploadSiteToolHtmlRoute,
  configureSiteToolDraftRoute,
  checkSiteToolRoute,
  publishSiteToolRoute,
  discardSiteToolDraftRoute,
  setSiteToolAvailabilityRoute,
  deleteSiteToolRoute,
];

export const listToolsRoute = defineRoute({
  operationId: "tools.list",
  method: "GET",
  path: "/api/v1/tools",
  summary: "Discover available site-managed tools",
  request: { headers: WorkspaceScopeHeadersSchema },
  responses: { 200: ToolCatalogueSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const getToolUsageRoute = defineRoute({
  operationId: "tools.getUsage",
  method: "GET",
  path: "/api/v1/tools/{slug}",
  summary: "Read minimal tool usage presentation",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: Type.Object(
      { slug: ToolPresentationSchema.properties.slug },
      { additionalProperties: false },
    ),
  },
  responses: { 200: ToolUsageDetailSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const uploadSiteToolImageRoute = defineRoute({
  operationId: "siteTools.uploadImage",
  method: "POST",
  path: "/api/v1/instance/tool-images",
  summary: "Upload and normalize a tool Logo or cover",
  request: {
    headers: SiteToolMutationHeadersSchema,
    body: UploadToolImageBodySchema,
  },
  responses: { 201: ToolImageCreatedSchema, ...errors },
  security: ["browserSession"],
  idempotency: "required",
} satisfies RouteContract);
export const getSiteToolImageRoute = defineRoute({
  operationId: "siteTools.getImage",
  method: "GET",
  path: "/api/v1/instance/tool-images/{imageId}",
  summary: "Read artwork for tool administration",
  request: { path: ToolImagePathSchema },
  responses: { 200: ToolImageContentSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
export const getToolImageRoute = defineRoute({
  operationId: "tools.getImage",
  method: "GET",
  path: "/api/v1/tool-images/{imageId}",
  summary: "Read artwork used by an available tool",
  request: { headers: WorkspaceScopeHeadersSchema, path: ToolImagePathSchema },
  responses: { 200: ToolImageContentSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);

export const listToolIntegrationsRoute = defineRoute({
  operationId: "siteTools.listIntegrations",
  method: "GET",
  path: "/api/v1/instance/tool-integrations",
  summary: "Find published capability references for site-managed tools",
  request: { query: ToolIntegrationQuerySchema },
  responses: { 200: ToolIntegrationCatalogSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
} satisfies RouteContract);
