import { Controller, Inject } from "@nestjs/common";
import {
  liveHealthRoute,
  readyHealthRoute,
  startupHealthRoute,
  type HealthResponse,
} from "@kanvas/contracts/api";

import { ContractRoute } from "../http/contract-route.decorator.js";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  public constructor(
    @Inject(HealthService) private readonly health: HealthService,
  ) {}

  @ContractRoute(liveHealthRoute)
  public live(): HealthResponse {
    return this.health.live();
  }

  @ContractRoute(startupHealthRoute)
  public startup(): HealthResponse {
    return this.health.startup();
  }

  @ContractRoute(readyHealthRoute)
  public ready(): Promise<HealthResponse> {
    return this.health.ready();
  }
}
