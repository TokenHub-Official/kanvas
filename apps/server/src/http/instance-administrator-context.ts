import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { TrustedInstanceAdministratorScope } from "@kanvas/application";

import type { AuthenticatedHuman } from "../auth/authentication-gateway.js";

export interface InstanceAdministratorRequestContext {
  readonly authentication: AuthenticatedHuman;
  readonly scope: TrustedInstanceAdministratorScope;
}

@Injectable()
export class InstanceAdministratorContextStore {
  readonly #contexts = new WeakMap<
    object,
    InstanceAdministratorRequestContext
  >();

  public set(
    request: object,
    context: InstanceAdministratorRequestContext,
  ): void {
    this.#contexts.set(request, Object.freeze(context));
  }

  public require(request: object): InstanceAdministratorRequestContext {
    const context = this.#contexts.get(request);
    if (!context) {
      throw new InternalServerErrorException(
        "Trusted Instance Administrator context is missing.",
      );
    }
    return context;
  }
}
