import {
  Controller,
  Header,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  getBrowserSessionContextRoute,
  type BrowserSessionContext,
} from "@kanvas/contracts/api";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";

import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import { AUTHENTICATION_GATEWAY } from "../tokens.js";
import { CsrfTokenService } from "../security/csrf-token-service.js";
import { ContractRoute } from "./contract-route.decorator.js";

@Controller()
export class BrowserSessionContextController {
  public constructor(
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
    private readonly csrf: CsrfTokenService,
  ) {}

  @ContractRoute(getBrowserSessionContextRoute)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<BrowserSessionContext> {
    const authenticated = await this.authentication.resolveBrowserSession(
      fromNodeHeaders(request.raw.headers),
    );
    if (!authenticated) {
      throw new UnauthorizedException("A valid browser session is required.");
    }
    return {
      authenticated: true,
      csrfToken: this.csrf.issue(authenticated.sessionId),
    };
  }
}
