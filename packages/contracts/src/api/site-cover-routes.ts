import { Type, type Static } from "@sinclair/typebox";
import { defineRoute } from "./route.js";
import {
  BrowserMutationHeadersSchema,
  ProblemDetailsSchema,
} from "./schemas.js";
import { ToolImageCreatedSchema } from "./site-tools.js";
export const AllocateSiteCoverSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    expectedSize: Type.Integer({ minimum: 1, maximum: 2097152 }),
    expectedMediaType: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
    ]),
  },
  { additionalProperties: false, $id: "kanvas.allocate-site-cover.v1" },
);
export type AllocateSiteCover = Static<typeof AllocateSiteCoverSchema>;
const session = Type.Object({
  uploadSessionId: Type.String(),
  state: Type.String(),
  expiresAt: Type.String(),
});
const path = Type.Object({
  uploadSessionId: Type.String({ pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$" }),
});
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  403: ProblemDetailsSchema,
  404: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
  413: ProblemDetailsSchema,
};
export const allocateSiteCoverRoute = defineRoute({
  operationId: "siteCovers.allocate",
  method: "POST",
  path: "/api/v1/instance/cover-upload-sessions",
  summary: "Allocate an instance-owned cover upload",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: AllocateSiteCoverSchema,
  },
  responses: { 201: session, ...errors },
  security: ["browserSession"],
  idempotency: "required",
});
export const uploadSiteCoverRoute = defineRoute({
  operationId: "siteCovers.upload",
  method: "PUT",
  path: "/api/v1/instance/cover-upload-sessions/{uploadSessionId}/content",
  summary: "Upload binary cover content",
  request: {
    path,
    headers: BrowserMutationHeadersSchema,
    rawBody: {
      maximumBytes: 2097152,
      contentTypes: ["image/png", "image/jpeg", "image/webp"],
    },
  },
  responses: { 200: Type.Object({ state: Type.String() }), ...errors },
  security: ["browserSession"],
  idempotency: "none",
});
export const commitSiteCoverRoute = defineRoute({
  operationId: "siteCovers.commit",
  method: "POST",
  path: "/api/v1/instance/cover-upload-sessions/{uploadSessionId}/commit",
  summary: "Commit verified cover to the instance library",
  request: { path, headers: BrowserMutationHeadersSchema },
  responses: { 200: ToolImageCreatedSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
});
export const listSiteCoversRoute = defineRoute({
  operationId: "siteCovers.list",
  method: "GET",
  path: "/api/v1/instance/covers",
  summary: "List instance cover images",
  responses: {
    200: Type.Object({
      items: Type.Array(
        Type.Object({ id: Type.String(), name: Type.String() }),
      ),
    }),
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "none",
});
export const siteCoverRoutes = [
  allocateSiteCoverRoute,
  uploadSiteCoverRoute,
  commitSiteCoverRoute,
  listSiteCoversRoute,
];
