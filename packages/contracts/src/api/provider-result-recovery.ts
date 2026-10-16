import { CapabilityRunPathSchema } from "./capability-control-plane.js";
import { Type, type Static } from "@sinclair/typebox";
import { defineRoute } from "./route.js";
import {
  BrowserMutationHeadersSchema,
  WorkspaceScopeHeadersSchema,
  ProblemDetailsSchema,
} from "./schemas.js";
const id = Type.String({ pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$" });
export const ProviderResultRecoveryViewSchema = Type.Object(
  {
    canRecover: Type.Boolean(),
    canDownload: Type.Boolean(),
    unavailableReason: Type.Optional(Type.Literal("no_results")),
    resultCount: Type.Integer({ minimum: 0, maximum: 16 }),
    items: Type.Array(
      Type.Object(
        {
          id,
          resultIndex: Type.Integer({ minimum: 0, maximum: 15 }),
          state: Type.Union([
            Type.Literal("queued"),
            Type.Literal("running"),
            Type.Literal("succeeded"),
            Type.Literal("failed"),
          ]),
          errorCode: Type.Optional(Type.String({ maxLength: 160 })),
          artifactId: Type.Optional(id),
          createdAt: Type.String({ format: "date-time" }),
          initiatedByAdministrator: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
    truncated: Type.Boolean(),
  },
  {
    additionalProperties: false,
    $id: "kanvas.provider-result-recovery-view.v1",
  },
);
export type ProviderResultRecoveryView = Static<
  typeof ProviderResultRecoveryViewSchema
>;
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  403: ProblemDetailsSchema,
  404: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
  503: ProblemDetailsSchema,
};
export const getProviderResultRecoveryRoute = defineRoute({
  operationId: "providerResults.recovery",
  method: "GET",
  path: "/api/v1/capability-runs/{capabilityRunId}/result-recovery",
  summary:
    "Read task result recovery records as owner or workspace administrator",
  request: {
    headers: WorkspaceScopeHeadersSchema,
    path: CapabilityRunPathSchema,
  },
  responses: { 200: ProviderResultRecoveryViewSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
});
export const requestProviderResultRecoveryRoute = defineRoute({
  operationId: "providerResults.requestRecovery",
  method: "POST",
  path: "/api/v1/capability-runs/{capabilityRunId}/result-recovery",
  summary: "Fetch retained upstream results without regenerating",
  request: {
    headers: Type.Intersect([
      WorkspaceScopeHeadersSchema,
      BrowserMutationHeadersSchema,
    ]),
    path: CapabilityRunPathSchema,
  },
  responses: { 200: ProviderResultRecoveryViewSchema, ...errors },
  security: ["browserSession"],
  idempotency: "required",
});
export const providerResultRecoveryRoutes = [
  getProviderResultRecoveryRoute,
  requestProviderResultRecoveryRoute,
] as const;
