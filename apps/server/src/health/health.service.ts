import { Inject, Injectable } from "@nestjs/common";
import type { HealthResponse } from "@kanvas/contracts/api";

import type { ServerDatabaseRuntime } from "../app.module.js";
import type { ServerConfig } from "../config.js";
import { DATABASE_RUNTIME, SERVER_CONFIG } from "../tokens.js";

@Injectable()
export class HealthService {
  public constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
  ) {}

  public live(): HealthResponse {
    return {
      status: "ok",
      serviceVersion: this.config.serviceVersion,
      processRole: "server",
    };
  }

  public startup(): HealthResponse {
    return this.live();
  }

  public async ready(): Promise<HealthResponse> {
    try {
      await this.database.verifyConnection();
      const runtimeState = await this.database.runtimeStateReader.read();
      return {
        status: runtimeState.state === "ACTIVE" ? "ok" : "not_ready",
        serviceVersion: this.config.serviceVersion,
        processRole: "server",
      };
    } catch {
      return {
        status: "not_ready",
        serviceVersion: this.config.serviceVersion,
        processRole: "server",
      };
    }
  }
}
