import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import type { WorkerConfig } from "../src/config.js";
import { startHealthServer } from "../src/health-server.js";
import { generationTasksImageProtocolRevision } from "../src/provider/generation-tasks-image-protocol.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

function providerConfig(): WorkerConfig {
  return {
    serviceVersion: "0.1.0-test",
    processRole: "worker",
    healthHost: "127.0.0.1",
    healthPort: 0,
    roles: ["provider-execution", "reconciler"],
    provider: {
      adapterKeys: ["generation-tasks.image.upscale.reconstructive.v1"],
    },
  } as unknown as WorkerConfig;
}

describe("Worker Provider runtime health", () => {
  it("exposes ready roles, Adapter keys, and the protocol revision", async () => {
    const server = await startHealthServer(providerConfig(), {
      isReady: () => Promise.resolve(true),
    });
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/health/provider-runtime`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      serviceVersion: "0.1.0-test",
      processRole: "worker",
      roles: ["provider-execution", "reconciler"],
      providerAdapterKeys: ["generation-tasks.image.upscale.reconstructive.v1"],
      generationTasksImageProtocolRevision,
    });
  });

  it("fails closed when the Provider Worker is not ready", async () => {
    const server = await startHealthServer(providerConfig(), {
      isReady: () => Promise.resolve(false),
    });
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/health/provider-runtime`,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "not_ready",
      generationTasksImageProtocolRevision,
    });
  });
});
