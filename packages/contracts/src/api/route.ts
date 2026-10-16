import type { TSchema } from "@sinclair/typebox";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteContract {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly request?: {
    readonly headers?: TSchema;
    readonly path?: TSchema;
    readonly query?: TSchema;
    readonly body?: TSchema;
    readonly rawBody?: {
      readonly contentTypes: readonly string[];
      readonly maximumBytes: number;
    };
  };
  readonly responses: Readonly<Record<number, TSchema>>;
  readonly responseContentTypes?: Readonly<Record<number, string>>;
  readonly security: readonly (
    | "public"
    | "browserSession"
    | "browserAttemptGrant"
    | "sessionOrServiceToken"
  )[];
  readonly idempotency: "none" | "optional" | "required";
}

export function defineRoute<const TRoute extends RouteContract>(
  route: TRoute,
): TRoute {
  return Object.freeze(route);
}
