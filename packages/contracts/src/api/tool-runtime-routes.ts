import { Type } from "@sinclair/typebox";
import { UlidSchema } from "../primitives/index.js";
import { defineRoute, type RouteContract } from "./route.js";
import { ProblemDetailsSchema } from "./schemas.js";
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  403: ProblemDetailsSchema,
  404: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
};
const headers = Type.Object(
  { "sec-fetch-dest": Type.Literal("iframe") },
  { additionalProperties: true },
);
function document(operationId: string, path: string, workspace: boolean) {
  return defineRoute({
    operationId,
    method: "GET",
    path,
    summary: "Load an authenticated isolated tool runtime document",
    request: {
      headers,
      path: Type.Object(
        {
          sessionId: UlidSchema,
          ...(workspace ? { workspaceId: UlidSchema } : {}),
        },
        { additionalProperties: false },
      ),
    },
    responses: { 200: Type.String(), ...errors },
    responseContentTypes: { 200: "text/html" },
    security: ["browserSession"],
    idempotency: "none",
  } satisfies RouteContract);
}
const userPath =
  "/api/v1/tool-runtime/workspaces/{workspaceId}/sessions/{sessionId}";
const previewPath = "/api/v1/instance/tool-runtime/{sessionId}";
export const getToolRuntimeHostRoute = document(
  "toolRuntime.getHost",
  `${userPath}/host`,
  true,
);
export const getToolRuntimeContentRoute = document(
  "toolRuntime.getContent",
  `${userPath}/document`,
  true,
);
export const getToolPreviewHostRoute = document(
  "toolRuntime.getPreviewHost",
  `${previewPath}/host`,
  false,
);
export const getToolPreviewContentRoute = document(
  "toolRuntime.getPreviewContent",
  `${previewPath}/document`,
  false,
);
export const toolRuntimeRoutes: readonly RouteContract[] = [
  getToolRuntimeHostRoute,
  getToolRuntimeContentRoute,
  getToolPreviewHostRoute,
  getToolPreviewContentRoute,
];
