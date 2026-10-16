import {
  applyDecorators,
  HttpCode,
  RequestMapping,
  RequestMethod,
  SetMetadata,
} from "@nestjs/common";
import type { RouteContract } from "@kanvas/contracts/api";

export const ROUTE_CONTRACT_METADATA = "kanvas:route-contract";

const requestMethods: Readonly<Record<RouteContract["method"], RequestMethod>> =
  Object.freeze({
    GET: RequestMethod.GET,
    POST: RequestMethod.POST,
    PUT: RequestMethod.PUT,
    PATCH: RequestMethod.PATCH,
    DELETE: RequestMethod.DELETE,
  });

export function ContractRoute(route: RouteContract): MethodDecorator {
  const successStatus = Number(
    Object.keys(route.responses).find((status) => status.startsWith("2")) ??
      200,
  );
  return applyDecorators(
    RequestMapping({
      method: requestMethods[route.method],
      path: route.path.replace(/\{([^}]+)\}/gu, ":$1"),
    }),
    HttpCode(successStatus),
    SetMetadata(ROUTE_CONTRACT_METADATA, route),
  );
}
