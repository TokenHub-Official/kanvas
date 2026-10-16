import { createServer, type Socket } from "node:net";
import type { lookup } from "node:dns/promises";
import { describe, expect, it } from "vitest";
import { createProviderHttpTransport } from "../src/provider/provider-http-transport.js";

const timeoutPolicy = {
  connectMs: 200,
  headersMs: 200,
  firstByteMs: 80,
  idleMs: 80,
};

async function withResultServer(
  respond: (socket: Socket) => void,
  check: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => respond(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  try {
    await check(`http://127.0.0.1:${address.port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function request(baseUrl: string, totalMs = 600) {
  return createProviderHttpTransport({
    allowHttp: true,
    allowPrivateNetworks: true,
    maximumRequestBytes: 1024,
    maximumResponseBytes: 1024,
    resultTimeouts: timeoutPolicy,
  }).request({
    baseUrl,
    path: "/image",
    method: "GET",
    headers: {},
    targetKind: "provider_result",
    responseMode: "binary",
    deadlineAt: new Date(Date.now() + totalMs),
    signal: new AbortController().signal,
  });
}
const headers =
  "HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\n";

describe("result transfer timeouts", () => {
  it("allows a slow body that continually makes progress beyond the idle window", async () => {
    await withResultServer(
      (socket) => {
        socket.write(headers);
        let count = 0;
        const timer = setInterval(() => {
          socket.write("x");
          if (++count === 6) {
            clearInterval(timer);
            socket.end();
          }
        }, 25);
        socket.once("close", () => clearInterval(timer));
      },
      async (url) => {
        await expect(request(url)).resolves.toMatchObject({
          body: Buffer.from("xxxxxx"),
        });
      },
    );
  });

  it("distinguishes headers without any body from a stalled partial body", async () => {
    for (const [body, code] of [
      ["", "provider.transport_first_byte_timeout"],
      ["x", "provider.transport_idle_timeout"],
    ]) {
      await withResultServer(
        (socket) => socket.write(headers + body),
        async (url) => {
          await expect(request(url)).rejects.toMatchObject({
            stableErrorCode: code,
          });
        },
      );
    }
  });

  it("bounds waiting for response headers separately", async () => {
    await withResultServer(
      () => {},
      async (url) => {
        await expect(request(url)).rejects.toMatchObject({
          stableErrorCode: "provider.transport_headers_timeout",
        });
      },
    );
  });

  it("still stops a never-ending trickle at the absolute deadline", async () => {
    await withResultServer(
      (socket) => {
        socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
        const timer = setInterval(() => socket.write("x"), 20);
        socket.once("close", () => clearInterval(timer));
      },
      async (url) => {
        await expect(request(url, 180)).rejects.toMatchObject({
          stableErrorCode: "provider.transport_deadline_exceeded",
        });
      },
    );
  });

  it("treats a completed empty response as data, not a timeout", async () => {
    await withResultServer(
      (socket) => {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
      },
      async (url) => {
        await expect(request(url)).resolves.toMatchObject({
          body: Buffer.alloc(0),
        });
      },
    );
  });

  it("interrupts unresolved DNS when the caller cancels", async () => {
    const controller = new AbortController();
    const transport = createProviderHttpTransport({
      allowHttp: false,
      allowPrivateNetworks: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      lookup: (() => new Promise(() => {})) as typeof lookup,
    });
    const pending = transport.request({
      baseUrl: "https://provider.example",
      path: "/image",
      method: "GET",
      headers: {},
      deadlineAt: new Date(Date.now() + 10_000),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      stableErrorCode: "provider.transport_aborted",
      effect: "not_started",
    });
  });

  it("bounds DNS lookup by the request deadline even when lookup never settles", async () => {
    const transport = createProviderHttpTransport({
      allowHttp: false,
      allowPrivateNetworks: false,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      lookup: (() => new Promise(() => {})) as typeof lookup,
    });
    await expect(
      transport.request({
        baseUrl: "https://provider.example",
        path: "/image",
        method: "GET",
        headers: {},
        deadlineAt: new Date(Date.now() + 40),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      stableErrorCode: "provider.transport_deadline_exceeded",
      effect: "not_started",
    });
  }, 500);
});

describe("safe result address failover", () => {
  it("tries another validated address for a result GET but never retries a generation POST", async () => {
    let received = 0;
    await withResultServer(
      (socket) => {
        received += 1;
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
        );
      },
      async (baseUrl) => {
        const transport = createProviderHttpTransport({
          allowHttp: true,
          allowPrivateNetworks: true,
          maximumRequestBytes: 1024,
          maximumResponseBytes: 1024,
          resultTimeouts: timeoutPolicy,
          lookup: (() =>
            Promise.resolve([
              { address: "127.0.0.2", family: 4 },
              { address: "127.0.0.1", family: 4 },
            ])) as unknown as typeof lookup,
        });
        const common = {
          baseUrl: baseUrl.replace("127.0.0.1", "result.example"),
          path: "/image",
          headers: {},
          deadlineAt: new Date(Date.now() + 1000),
          signal: new AbortController().signal,
          responseMode: "binary" as const,
        };
        await expect(
          transport.request({
            ...common,
            method: "GET",
            targetKind: "provider_result",
          }),
        ).resolves.toMatchObject({ body: Buffer.from("ok") });
        expect(received).toBe(1);
        await expect(
          transport.request({
            ...common,
            method: "POST",
            deadlineAt: new Date(Date.now() + 120),
            targetKind: "provider_api",
            body: { prompt: "test" },
          }),
        ).rejects.toThrow();
        expect(received).toBe(1);
      },
    );
  });
});
