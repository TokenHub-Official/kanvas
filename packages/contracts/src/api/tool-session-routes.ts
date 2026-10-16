import { Type, type TSchema } from "@sinclair/typebox";
import { defineRoute, type RouteContract } from "./route.js";
import {
  ProblemDetailsSchema,
  WorkspaceScopeHeadersSchema,
  WorkspaceMutationHeadersSchema,
  BrowserMutationHeadersSchema,
  IdempotencyHeadersSchema,
} from "./schemas.js";
import {
  CapabilityRunAcceptedSchema,
  CapabilityRunDetailsSchema,
  CancelCapabilityRunBodySchema,
  UserCapabilityCatalogSchema,
} from "./capability-control-plane.js";
import {
  CreateToolSessionBodySchema,
  ToolSessionSchema,
  ToolPathSchema,
  ToolSessionPathSchema,
  ToolSessionRunPathSchema,
  InvokeToolCapabilityBodySchema,
} from "./site-tools.js";
import { SiteToolMutationHeadersSchema } from "./site-tool-routes.js";
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  403: ProblemDetailsSchema,
  404: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
};
const empty = Type.Object({}, { additionalProperties: false });
function route(
  operationId: string,
  method: "GET" | "POST",
  path: string,
  params: TSchema,
  response: TSchema,
  headers: TSchema,
  body?: TSchema,
  idempotency: RouteContract["idempotency"] = "none",
) {
  return defineRoute({
    operationId,
    method,
    path,
    summary: operationId,
    request: { path: params, headers, ...(body ? { body } : {}) },
    responses: { 200: response, ...errors },
    security: ["browserSession"],
    idempotency,
  } satisfies RouteContract);
}
export const createToolSessionRoute = route(
  "toolSessions.create",
  "POST",
  "/api/v1/tools/{toolId}/sessions",
  ToolPathSchema,
  ToolSessionSchema,
  IdempotencyHeadersSchema,
  CreateToolSessionBodySchema,
  "required",
);
export const getToolSessionRoute = route(
  "toolSessions.get",
  "GET",
  "/api/v1/tool-sessions/{sessionId}",
  ToolSessionPathSchema,
  ToolSessionSchema,
  WorkspaceScopeHeadersSchema,
);
export const closeToolSessionRoute = route(
  "toolSessions.close",
  "POST",
  "/api/v1/tool-sessions/{sessionId}/close",
  ToolSessionPathSchema,
  ToolSessionSchema,
  WorkspaceMutationHeadersSchema,
  empty,
);
export const listToolSessionCapabilitiesRoute = route(
  "toolSessions.listCapabilities",
  "GET",
  "/api/v1/tool-sessions/{sessionId}/capabilities",
  ToolSessionPathSchema,
  UserCapabilityCatalogSchema,
  WorkspaceScopeHeadersSchema,
);
export const startToolSessionRunRoute = route(
  "toolSessions.startRun",
  "POST",
  "/api/v1/tool-sessions/{sessionId}/runs",
  ToolSessionPathSchema,
  CapabilityRunAcceptedSchema,
  WorkspaceMutationHeadersSchema,
  InvokeToolCapabilityBodySchema,
);
export const getToolSessionRunRoute = route(
  "toolSessions.getRun",
  "GET",
  "/api/v1/tool-sessions/{sessionId}/runs/{runId}",
  ToolSessionRunPathSchema,
  CapabilityRunDetailsSchema,
  WorkspaceScopeHeadersSchema,
);
export const cancelToolSessionRunRoute = route(
  "toolSessions.cancelRun",
  "POST",
  "/api/v1/tool-sessions/{sessionId}/runs/{runId}/cancel",
  ToolSessionRunPathSchema,
  CapabilityRunDetailsSchema,
  WorkspaceMutationHeadersSchema,
  CancelCapabilityRunBodySchema,
);
export const createToolPreviewRoute = route(
  "toolPreviews.create",
  "POST",
  "/api/v1/instance/tools/{toolId}/previews",
  ToolPathSchema,
  ToolSessionSchema,
  SiteToolMutationHeadersSchema,
  CreateToolSessionBodySchema,
  "required",
);
export const getToolPreviewRoute = route(
  "toolPreviews.get",
  "GET",
  "/api/v1/instance/tool-previews/{sessionId}",
  ToolSessionPathSchema,
  ToolSessionSchema,
  Type.Object({}),
);
export const closeToolPreviewRoute = route(
  "toolPreviews.close",
  "POST",
  "/api/v1/instance/tool-previews/{sessionId}/close",
  ToolSessionPathSchema,
  ToolSessionSchema,
  BrowserMutationHeadersSchema,
  empty,
);
export const toolSessionRoutes: readonly RouteContract[] = [
  createToolSessionRoute,
  getToolSessionRoute,
  closeToolSessionRoute,
  listToolSessionCapabilitiesRoute,
  startToolSessionRunRoute,
  getToolSessionRunRoute,
  cancelToolSessionRunRoute,
  createToolPreviewRoute,
  getToolPreviewRoute,
  closeToolPreviewRoute,
];
