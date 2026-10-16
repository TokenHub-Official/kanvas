import { createServer, type Server, type ServerResponse } from "node:http";

import type { HealthResponse } from "@kanvas/contracts/api";

import type { WorkerConfig } from "./config.js";
import { generationTasksImageProtocolRevision } from "./provider/generation-tasks-image-protocol.js";

export interface WorkerReadiness {
  isReady(): Promise<boolean>;
}

function respond(
  response: ServerResponse,
  statusCode: number,
  body: HealthResponse,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export async function startHealthServer(
  config: WorkerConfig,
  readiness: WorkerReadiness,
): Promise<Server> {
  const startedAt = new Date().toISOString();
  const server = createServer((request, response) => {
    const base = {
      serviceVersion: config.serviceVersion,
      processRole: "worker" as const,
    };
    if (request.url === "/health/live") {
      respond(response, 200, {
        ...base,
        status: "ok",
      });
      return;
    }
    if (request.url === "/health/startup") {
      respond(response, 200, {
        ...base,
        status: "ok",
      });
      return;
    }
    if (request.url === "/health/ready") {
      void readiness.isReady().then((ready) => {
        respond(response, ready ? 200 : 503, {
          ...base,
          status: ready ? "ok" : "not_ready",
        });
      });
      return;
    }
    if (
      request.url === "/health/provider-runtime" &&
      config.roles.includes("provider-execution")
    ) {
      void readiness.isReady().then((ready) => {
        response.writeHead(ready ? 200 : 503, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({
            ...base,
            status: ready ? "ok" : "not_ready",
            roles: config.roles,
            providerAdapterKeys: config.provider.adapterKeys,
            generationTasksImageProtocolRevision,
            startedAt,
          }),
        );
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.healthPort, config.healthHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
