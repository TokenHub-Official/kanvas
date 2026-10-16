import { Type } from "@sinclair/typebox";
import { defineRoute } from "./route.js";
import {
  BrowserMutationHeadersSchema,
  ProblemDetailsSchema,
} from "./schemas.js";
import {
  RuntimeConfigurationRevisionSchema,
  RuntimeConfigurationOverviewSchema,
  PublishRuntimeConfigurationSchema,
  RestoreRuntimeConfigurationSchema,
} from "./runtime-configuration.js";
const errors = {
  400: ProblemDetailsSchema,
  401: ProblemDetailsSchema,
  403: ProblemDetailsSchema,
  409: ProblemDetailsSchema,
  503: ProblemDetailsSchema,
};
export const getRuntimeConfigurationRoute = defineRoute({
  operationId: "runtimeConfiguration.get",
  method: "GET",
  path: "/api/v1/instance/runtime-configuration",
  summary: "Read current runtime governance configuration",
  request: {},
  responses: {
    200: RuntimeConfigurationOverviewSchema,
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "none",
});
export const publishRuntimeConfigurationRoute = defineRoute({
  operationId: "runtimeConfiguration.publish",
  method: "PUT",
  path: "/api/v1/instance/runtime-configuration",
  summary: "Publish an audited runtime configuration revision",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: PublishRuntimeConfigurationSchema,
  },
  responses: { 200: RuntimeConfigurationRevisionSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
});
export const listRuntimeConfigurationHistoryRoute = defineRoute({
  operationId: "runtimeConfiguration.history",
  method: "GET",
  path: "/api/v1/instance/runtime-configuration/history",
  summary: "Read runtime configuration revision history",
  request: {},
  responses: {
    200: Type.Object(
      {
        items: Type.Array(RuntimeConfigurationRevisionSchema, {
          maxItems: 100,
        }),
        truncated: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    ...errors,
  },
  security: ["browserSession"],
  idempotency: "none",
});
export const restoreRuntimeConfigurationRoute = defineRoute({
  operationId: "runtimeConfiguration.restore",
  method: "POST",
  path: "/api/v1/instance/runtime-configuration/restore",
  summary: "Restore historical content as a new runtime configuration revision",
  request: {
    headers: BrowserMutationHeadersSchema,
    body: RestoreRuntimeConfigurationSchema,
  },
  responses: { 200: RuntimeConfigurationRevisionSchema, ...errors },
  security: ["browserSession"],
  idempotency: "none",
});
export const runtimeConfigurationRoutes = [
  getRuntimeConfigurationRoute,
  publishRuntimeConfigurationRoute,
  listRuntimeConfigurationHistoryRoute,
  restoreRuntimeConfigurationRoute,
] as const;
