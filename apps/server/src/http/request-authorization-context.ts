import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";

import type { AuthenticatedHuman } from "../auth/authentication-gateway.js";

export interface AuthorizedRequestContext {
  readonly authentication:
    | AuthenticatedHuman
    | {
        readonly authSubjectId: "development-demo";
        readonly sessionId: "development-demo";
        readonly authenticationStrength: "development_demo";
      }
    | {
        readonly tokenHash: string;
        readonly authenticationStrength: "service_token";
      };
  readonly scope: TrustedWorkspaceScope;
}

@Injectable()
export class RequestAuthorizationContextStore {
  readonly #contexts = new WeakMap<object, AuthorizedRequestContext>();

  public set(request: object, context: AuthorizedRequestContext): void {
    this.#contexts.set(request, Object.freeze(context));
  }

  public require(request: object): AuthorizedRequestContext {
    const context = this.#contexts.get(request);
    if (!context) {
      throw new InternalServerErrorException(
        "Trusted request authorization context is missing.",
      );
    }
    return context;
  }
}
