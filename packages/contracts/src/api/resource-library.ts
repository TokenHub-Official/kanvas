import { Type, type Static } from "@sinclair/typebox";
import { defineRoute } from "./route.js";
import {
  BrowserMutationHeadersSchema,
  ProblemDetailsSchema,
} from "./schemas.js";
const id = Type.String({ pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$" });
const path = Type.Object({ workspaceId: id, libraryId: id });
export const LibraryEntrySchema = Type.Object(
  {
    id,
    name: Type.String({ minLength: 1, maxLength: 240 }),
    purpose: Type.String({ maxLength: 1000 }),
    artifactId: id,
    sourceAssetId: Type.Optional(id),
  },
  { additionalProperties: false },
);
export const LibraryDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.String({ maxLength: 2000 }),
    entries: Type.Array(LibraryEntrySchema, { maxItems: 200 }),
  },
  { additionalProperties: false },
);
export const LibrarySummarySchema = Type.Object({
  id,
  name: Type.String(),
  description: Type.String(),
  lifecycleStatus: Type.Union([
    Type.Literal("active"),
    Type.Literal("archived"),
  ]),
  version: Type.Integer(),
  currentRevisionId: id,
  entryCount: Type.Integer(),
  updatedAt: Type.String({ format: "date-time" }),
});
export const LibraryRevisionSchema = Type.Object({
  id,
  libraryId: id,
  revisionNumber: Type.Integer(),
  document: LibraryDocumentSchema,
  contentDigest: Type.String(),
  createdAt: Type.String({ format: "date-time" }),
});
export const SaveLibraryBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 0 }),
    document: LibraryDocumentSchema,
  },
  { additionalProperties: false, $id: "kanvas.save-resource-library.v1" },
);
export const LibraryLifecycleBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    lifecycleStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("archived"),
    ]),
  },
  { additionalProperties: false, $id: "kanvas.resource-library-lifecycle.v1" },
);
export const LibraryListQuerySchema = Type.Object(
  {
    lifecycleStatus: Type.Optional(
      Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    ),
    query: Type.Optional(Type.String({ maxLength: 200 })),
    afterId: Type.Optional(id),
  },
  { additionalProperties: false },
);
export const LibraryUploadQuerySchema = Type.Object(
  {
    filename: Type.String({ minLength: 1, maxLength: 240 }),
    mediaType: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
      Type.Literal("text/plain"),
      Type.Literal("text/markdown"),
      Type.Literal("application/pdf"),
      Type.Literal(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ]),
    byteSize: Type.String({ pattern: "^[1-9][0-9]{0,8}$" }),
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
);
export type SaveLibraryBody = Static<typeof SaveLibraryBodySchema>;
export type LibraryLifecycleBody = Static<typeof LibraryLifecycleBodySchema>;
export type LibraryListQuery = Static<typeof LibraryListQuerySchema>;
export type LibraryUploadQuery = Static<typeof LibraryUploadQuerySchema>;
export type LibrarySummary = Static<typeof LibrarySummarySchema>;
export type LibraryRevision = Static<typeof LibraryRevisionSchema>;
export type LibraryDocument = Static<typeof LibraryDocumentSchema>;
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  403: ProblemDetailsSchema,
  404: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
  413: ProblemDetailsSchema,
  503: ProblemDetailsSchema,
};
const root = "/api/v1/workspaces/{workspaceId}/resource-libraries";
export const listLibrariesRoute = defineRoute({
  operationId: "resourceLibraries.list",
  method: "GET",
  path: root,
  summary: "List shared resource libraries",
  request: {
    path: Type.Object({ workspaceId: id }),
    query: LibraryListQuerySchema,
  },
  responses: {
    200: Type.Object({
      items: Type.Array(LibrarySummarySchema),
      nextCursor: Type.Optional(id),
    }),
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "none",
});
export const getLibraryRoute = defineRoute({
  operationId: "resourceLibraries.get",
  method: "GET",
  path: `${root}/{libraryId}`,
  summary: "Read current library and exact content revision",
  request: { path },
  responses: {
    200: Type.Object({
      library: LibrarySummarySchema,
      revision: LibraryRevisionSchema,
    }),
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "none",
});
export const saveLibraryRoute = defineRoute({
  operationId: "resourceLibraries.save",
  method: "PUT",
  path: `${root}/{libraryId}`,
  summary: "Save an immutable resource library revision",
  request: {
    path,
    headers: BrowserMutationHeadersSchema,
    body: SaveLibraryBodySchema,
  },
  responses: {
    200: Type.Object({
      revision: LibraryRevisionSchema,
      replayed: Type.Boolean(),
    }),
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "required",
});
export const setLibraryLifecycleRoute = defineRoute({
  operationId: "resourceLibraries.setLifecycle",
  method: "PATCH",
  path: `${root}/{libraryId}/lifecycle`,
  summary: "Archive or restore a resource library",
  request: {
    path,
    headers: BrowserMutationHeadersSchema,
    body: LibraryLifecycleBodySchema,
  },
  responses: { 200: Type.Object({ updated: Type.Literal(true) }), ...errors },
  security: ["browserSession"],
  idempotency: "none",
});
export const uploadLibraryFileRoute = defineRoute({
  operationId: "resourceLibraries.uploadFile",
  method: "POST",
  path: `${root}/{libraryId}/files`,
  summary: "Verify and commit a shared library file",
  request: {
    path,
    headers: BrowserMutationHeadersSchema,
    query: LibraryUploadQuerySchema,
    rawBody: {
      maximumBytes: 134217728,
      contentTypes: ["application/octet-stream"],
    },
  },
  responses: {
    200: Type.Object({
      artifactId: id,
      mediaType: Type.String(),
      byteSize: Type.String(),
      replayed: Type.Boolean(),
    }),
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "required",
});
export const getLibraryTextRoute = defineRoute({
  operationId: "resourceLibraries.text",
  method: "GET",
  path: `${root}/{libraryId}/files/{artifactId}/text`,
  summary:
    "Read immutable original or extracted document text with page locations",
  request: {
    path: Type.Object({ workspaceId: id, libraryId: id, artifactId: id }),
  },
  responses: {
    200: Type.Object({
      text: Type.String({ maxLength: 1000000 }),
      contentDigest: Type.String(),
      extractorVersion: Type.String(),
      pageRanges: Type.Array(
        Type.Object({
          page: Type.Integer({ minimum: 1 }),
          startOffset: Type.Integer({ minimum: 0 }),
          endOffset: Type.Integer({ minimum: 0 }),
        }),
      ),
    }),
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "none",
});
export const resourceLibraryRoutes = [
  getLibraryTextRoute,
  listLibrariesRoute,
  getLibraryRoute,
  saveLibraryRoute,
  setLibraryLifecycleRoute,
  uploadLibraryFileRoute,
];
